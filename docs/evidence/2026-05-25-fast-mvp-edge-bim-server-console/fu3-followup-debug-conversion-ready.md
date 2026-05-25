# FU3 Follow-up Debug:把 conversion 跑通的 5 個根因鏈(2026-05-25)

> 接續 `follow-up-evidence.json` 的「C1 fallback semantic mapping 真實 conversion
> evidence deferred」項目。Operator 在 `/ui` 表單按「送出 ifc-ready」沒看到下載
> 轉檔的根因 + 修法。

## 結論

**完整閉環跑通**:
- `ifc_ready_job_id = ifcready_1779705788713_69bdc794`
- `conversion_status = ready`
- `viewer_url = http://127.0.0.1:8004/ui/open?session=review_session_9911e2e39f77`
- IFC fixture:`storage/許良宇圖書館建築_2026 - 轉檔測試12.ifc`(89MB)

## 5 個根因鏈(由淺到深)

### 1. `edge-local://` scheme 不真實下載

`bim-review-coordinator/src/services/ifcDownloader.ts:116-121`:

```typescript
if (!["http:", "https:"].includes(url.protocol)) {
  // fast-ifc-link-demo-loop §2.1 fallback:test fixture / 非 production scheme
  // (`edge-local://`、`file://` 等)不實際下載,回傳 placeholder path 並讓
  // intake 流程繼續。
  return placeholderSuccess();
}
```

- `edge-local://storage/X.ifc` 走 `placeholderSuccess()`,只回 placeholder path,
  **不複製 file 到 ifc-cache**
- streaming-server 後續嘗試讀 `ifc-cache/<jobId>/source.ifc`,`is_file()=false`
- fallback 試 `local_path`(docker container 路徑)→ outside storage_root reject

**修法**:改用 `http://host.docker.internal:8910/<file>`(host 起 python http
server 把 storage/ 暴露給 docker container)。

### 2. `storage/許良宇圖書館建築_2026.ifc` 檔案不存在

實際檔案只有 `... - 轉檔測試N.ifc`(N = 2 ~ 13,各 89MB)。

**修法**:URL 改填 `... - 轉檔測試12.ifc`(URL-encoded 或瀏覽器自動 encode)。

### 3. docker compose `STORAGE_HOST_ROOT` default `./storage`(相對路徑)

`compose.runtime-manager.yml:38`:

```yaml
STORAGE_HOST_ROOT: ${RUNTIME_STORAGE_ROOT:-./storage}
```

如果 host shell 沒設 `$env:RUNTIME_STORAGE_ROOT`,coordinator 寫進 dispatch payload
的 `host_local_path` 是 `./storage/ifc-cache/<jobId>/source.ifc` 相對路徑。

streaming-server 端 `Ifc2UsdcPowershellConverterAdapter._try_local_path` 把它與
`storage_root` join 後 resolve;若 streaming-server cwd 不對,resolve 到不存在
路徑,`is_file()=false`,fallback 試 `local_path`(docker 內 `/workspace/...`),
sandbox check fail。

**修法**:重啟 docker coordinator 前設 host shell env:

```powershell
$env:RUNTIME_STORAGE_ROOT = 'C:\Repos\active\iot\AI-BIM-governance\storage'
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml `
  --env-file .env.web-plane.host-kit.example up -d --force-recreate coordinator viewer
```

之後 `host_local_path` 變絕對路徑 `C:\Repos\active\iot\AI-BIM-governance\storage\ifc-cache\<jobId>\source.ifc`。

### 4. host-native conversion service 49101 沒拿到 `STORAGE_ROOT` env

`Ifc2UsdcPowershellConverterAdapter.__init__`:

```python
env_root = os.environ.get("STORAGE_ROOT")
self.storage_root = (Path(env_root) if env_root else Path.cwd()).resolve()
```

`bim-streaming-server/scripts/start-host-native-conversion-service.ps1:61` 有
`Push-Location $moduleDir`,把 conversion service 子 process cwd 改為 module
dir(`bim-streaming-server/source/extensions/.../messaging/`)。若 `STORAGE_ROOT`
env 沒透到 python,`storage_root` fallback 為 module dir → 與 `host_local_path`
的 `C:\Repos\...\storage\...` 不在同 root → reject。

**PowerShell `Start-Process` + `$env:STORAGE_ROOT` 不一定 propagate 到 python**
(實測 ProcessStartInfo.EnvironmentVariables 也不夠)。

**修法**:用 cmd wrapper 強制 set 進 cmd process env block:

```powershell
Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c','set STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance && pwsh.exe -NoProfile -ExecutionPolicy Bypass -File bim-streaming-server\scripts\start-host-native-conversion-service.ps1' `
  -WorkingDirectory (Get-Location).Path
```

### 5. **隱藏 bug**:`Stop-Process` 沒殺到舊 python(env 一直是 stale 狀態)

中間嘗試多次重啟 conversion service 都沒生效 — 因為 `Get-Content scripts/.run/bim-streaming-conversion-service.pid` 只拿到 PowerShell wrapper PID,`Stop-Process` 只殺 wrapper,**真正 listen 49101 的 python 子 process(PID 29888 從 2026-05-25 09:15 起活了 2 小時)沒被殺**。

**修法**:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 49101 -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
```

直接殺 port 49101 的 owner PID,不要靠 `scripts/.run/*.pid` 的 wrapper id。

## 改善建議(未在本輪做)

1. **修 `adapter_from_env`**(`ifc2usdc_powershell_adapter.py:868`)讓它顯式
   propagate `STORAGE_ROOT` env 給 `Ifc2UsdcPowershellConverterAdapter`
   constructor,避免依賴 env inheritance 不可靠
2. **改 `scripts/start-all.ps1`** wrapper 與 child process tracking:寫
   wrapper PID 也寫 child python PID 進 `.pid` 檔(`.wrapper.pid` /
   `.child.pid`),讓 `stop-all.ps1` 兩個都殺
3. **`/ui` 表單**加 explicit warning:`edge-local://` 是 placeholder fixture
   path,真實測試請用 `http://` 並起 file server
4. **`.env.web-plane.host-kit.example`** 加 `RUNTIME_STORAGE_ROOT` template
   行(目前 example 沒列,operator 容易漏設)

四項都屬 enhancement,需新 OpenSpec change。建議 change-id:

- `coordinator-edge-local-host-copy-fallback`(對應 #1)
- `streaming-server-adapter-explicit-storage-root`(對應 #2)
- `scripts-start-all-child-pid-tracking`(對應 #2 後半)
- `dev-console-ifc-path-input-validation`(對應 #3)
