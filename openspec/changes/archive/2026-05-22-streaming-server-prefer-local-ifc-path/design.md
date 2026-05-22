# Design — streaming-server-prefer-local-ifc-path

## 1. Context

fast-ifc-link-demo-loop 的 dispatch payload 結構(已實作 in PR #92):

```jsonc
// coordinator → streaming-server POST /api/conversions body
{
  "ifc_artifact": {
    "artifact_id": "...",
    "format": "ifc",
    "filename": "model.ifc",
    "url": "http://192.168.20.234:9000/.../model.ifc",
    "local_path": "/workspace/storage/ifc-cache/<jobId>/source.ifc",        // container view, coordinator 寫
    "host_local_path": "C:\\Repos\\...\\storage\\ifc-cache\\<jobId>\\source.ifc"  // host view, streaming-server 讀
  },
  // ...
}
```

streaming-server 目前無視 `local_path` / `host_local_path`,只讀 `url`,且 url scheme = http 直接 fail。

## 2. Resolution order(新)

```
def _resolve_local_ifc(event):
    artifact = event["ifc_artifact"]
    storage_root = self.storage_root  # absolute, from env STORAGE_ROOT or cwd
    work_dir = self.work_dir

    # 1. host_local_path 優先(streaming-server host-native 讀的就是 host fs)
    p = self._try_local(artifact.get("host_local_path"), storage_root)
    if p is not None:
        return p

    # 2. local_path(streaming-server 與 coordinator 共享 fs 時 same value;host-native 通常 same as host_local_path)
    p = self._try_local(artifact.get("local_path"), storage_root)
    if p is not None:
        return p

    # 3. fallback 既有 url 解析(file:// / edge-local://;http scheme 仍 fail)
    url = artifact.get("url") or artifact.get("file_url") or artifact.get("signed_upload_reference")
    if not url:
        raise ConversionAuthorityError("invalid_ifc_input", "ifc_artifact has no resolvable url.")
    p = self._url_to_local_path(str(url))
    if p is None or not p.is_file():
        raise ConversionAuthorityError("invalid_ifc_input", f"IFC source is not a readable local file: {url}")
    return p

def _try_local(self, candidate: str | None, storage_root: Path) -> Path | None:
    if not candidate:
        return None
    p = Path(candidate)
    if not p.is_absolute():
        p = (storage_root / p).resolve()
    else:
        p = p.resolve()
    # security: 必須在 storage_root 之內(防 path traversal)
    try:
        p.relative_to(storage_root.resolve())
    except ValueError:
        raise ConversionAuthorityError(
            "invalid_ifc_input",
            f"local IFC path is outside storage_root: {candidate}",
        )
    if not p.is_file():
        return None  # 不可讀 → fallback,不 raise
    return p
```

## 3. Why this shape

- **host_local_path 優先 over local_path**:streaming-server 是 **host-native**(per AGENTS.md §3.5,跑在 host 49100/49101 端口);它看的是 host fs,所以 `host_local_path` 直接可用;`local_path`(container view)在 host-native 場景 generally 與 `host_local_path` 同字串,當 fallback 防 coordinator 漏給其中一個
- **storage_root sandboxing**:防止 coordinator(或攻擊者偽造的 IFC-ready event)寫 `host_local_path: "C:\\Windows\\System32\\..."` 讓 streaming-server 把任意 host 檔案餵給 Kit。`storage_root` env(沿用 compose 既有 `STORAGE_ROOT`)收斂可讀範圍
- **不可讀 → fallback 不 raise**:host_local_path resolve 成功但 file 不存在(競爭條件、coordinator 寫到一半),soft fallback url;仍在 storage_root 外才 hard raise(security)
- **不引入 HTTP fetch**:streaming-server 端做 HTTP download 會引入 retry / timeout / cert handling 等複雜度,超出本 change 範圍;fast-mvp 場景 coordinator 已負責 HTTP download

## 4. Backward compatibility

- 既有 fixture / test 用 `file://` / `edge-local://` url → 沒給 `local_path` → fallback 走 既有 `_url_to_local_path` → 不變
- Coordinator 不帶 `local_path` / `host_local_path`(legacy / test fake)→ fallback 既有 url 行為 → 不變
- Coordinator 同時帶 `url` + `local_path` → 優先 local_path,url 留作 fallback(目前若 local_path 不可讀)

## 5. Storage root config

| 來源 | 值 |
|---|---|
| env `STORAGE_ROOT` | 顯式設定,常見 `/workspace/storage`(docker)或 `<repo>/storage`(host-native) |
| fallback | `Path.cwd()`(streaming-server 啟動 cwd) |

對齊 compose 既有 `streaming-server:94` env 設定。Host-native streaming-server 跑時 user 若 cd 到 repo root 啟動,fallback OK;但 explicit env 仍建議。

## 6. _anchor 兼容

既有 `_anchor`(line 196+)針對 url-derived path 做 work_dir sandboxing。本 change 對 `host_local_path` / `local_path` 走另一條 `_try_local` 用 storage_root sandbox,**不經 _anchor**。理由:

- work_dir 是 streaming-server 自己的轉檔工作目錄(`<work>/tmp/<job>/...`),跟 shared volume(`<repo>/storage`)是不同 dir,沒有 overlap 必要
- 兩個 sandbox 各自獨立、容易推理:url 來源 = work_dir;local_path 來源 = storage_root

## 7. Failure semantics

| 情境 | 行為 |
|---|---|
| `host_local_path` 在 storage_root 外 | `raise ConversionAuthorityError("invalid_ifc_input", "local IFC path is outside storage_root")`(security 硬失敗) |
| `host_local_path` 在 storage_root 內但 file 不存在 | soft fallback 嘗試 `local_path`,再 fallback url |
| `host_local_path` + `local_path` 都不可用,url scheme = http | 既有行為:`raise ConversionAuthorityError("invalid_ifc_input", ...)` |
| 既有 file:// / edge-local:// url | 不變(work_dir sandbox 仍生效) |

## 8. Observability

- 不新增 metric(本 change 是 path resolution 改造,既有 conversion job state machine 不變)
- 若有 path resolution debug log,放在 DEBUG level(streaming-server 既有 logger);production INFO 不變
