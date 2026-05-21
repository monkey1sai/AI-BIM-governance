# Design — fast-ifc-link-demo-loop

> Brainstorming 整體 design 見 `docs/superpowers/specs/2026-05-21-fast-mvp-loop-overall-design.md`(已 merged 到 main by PR #90)Section 3 / 4。本檔聚焦此 change 的技術決策與實作邊界。

## 1. 決策回顧(brainstorming 結果)

| 設計題 | 選擇 | 取捨摘要 |
|---|---|---|
| IFC 下載時機 | **A 同步下載完才回 200** | Postman caller 收到 200 即代表 IFC 已落地;trade-off:大檔可能花數十秒~分鐘,Postman timeout 要設 600s |
| Viewer URL 交付 | **A Postman 輪詢同一 job URL 到 viewer_url 出現** | 不需 callback,Postman 5s polling 看 conversion ready |
| 衝突檢討清理 | **A 直接刪 code**(已在 predecessor 完成) | baseline 乾淨 |
| Viewer 主畫面 | **A 全螢幕 stream + 邊框輕 HUD** | 一條連結點進來看畫面,demo 友善 |
| `/ui` 介面 | **A 單欄垂直流程 + 試控台 + polling + viewer 連結卡** | 一頁完成 happy path |
| IFC handoff | **A Shared volume**(coordinator 寫 → streaming-server 讀) | 不多一輪 disk→net→disk;邊界 carve-out 收進文件 |
| viewer URL token / expiry | demo-only,**不加 token**(Kit 1:1 自然處理) | fast MVP 簡化 |
| viewer port bind | `127.0.0.1:5173` 已在 predecessor 完成 | LAN 連 viewer URL 走 coordinator redirect |

## 2. Coordinator API 變更細節

### 2.1 `POST /api/external/ifc-ready`(行為改變:202 → 同步 200)

```
POST /api/external/ifc-ready
Headers:
  Content-Type: application/json
  X-Webhook-Secret: <secret>           # 既有
  X-Correlation-Id: <uuid>             # canonical 必;worker compat 可派生
  X-Idempotency-Key: <uuid>            # canonical 必;worker compat 可派生

Body (worker compat,Postman 用):
{
  "status": "ifc_ready",
  "ifc_path": "http://192.168.20.234:9000/bim-control/899/xxx/model.ifc",
  "project_id": "899",
  "version": "xxx",
  "task_id": "task_001"
}

Process(server side):
  1. auth + normalize → canonical event
  2. idempotency check;既存 job → return 200 + idempotent_replay:true,不重下載
  3. externalIfcReadyStore.create(... download_status:"pending")
  4. download_ifc_to_shared_volume(event.source_ifc.ref → /workspace/storage/ifc-cache/<jobId>/source.ifc)
       - HTTP GET (streaming,寫到 disk)
       - timeout: IFC_DOWNLOAD_TIMEOUT_SECONDS env (default 600s)
       - 失敗 → externalIfcReadyStore.markDownloadFailed + 502 download_failed
  5. externalIfcReadyStore.markDownloaded(jobId, local_path, host_local_path)
  6. streamingConversionClient.createConversionJob({...event, local_path, host_local_path})
       - 失敗(connection refused / 500)→ markDispatchFailed,**仍回 200**(intake 成功),caller 看 conversion_status:dispatch_failed
  7. return 200

Response 200:
{
  "ifc_ready_job_id": "ifr_2026_...",
  "download_status": "downloaded",
  "message": "IFC 已下載至本地共享卷,轉檔已派工",
  "local_path": "/workspace/storage/ifc-cache/ifr_2026_.../source.ifc",
  "conversion_job_id": "stream_conv_...",
  "conversion_status": "queued",
  "correlation_id": "...",
  "idempotent_replay": false
}

Response 502 (download fail):
{ "detail": "IFC download failed", "ifc_ready_job_id": "ifr_2026_...", "error": "...", "download_status": "failed" }
```

### 2.2 `GET /api/external/ifc-ready/:jobId`(新增欄位)

```
GET /api/external/ifc-ready/{jobId}

Response 200:
{
  "ifc_ready_job_id": "...",
  "download_status": "pending|downloading|downloaded|failed",
  "download_failure": "...",          # 失敗時填
  "local_path": "/workspace/...",     # downloaded 時填
  "conversion_job_id": "...",
  "conversion_status": "queued|running|ready|failed",
  "viewer_url": null | "http://192.168.10.105:8004/ui/open?session=lwv_abc",
  "web_view_session_id": null | "lwv_abc",
  // ...既有欄位(correlation_id / external_model_version_id / source_ifc_ref / artifact_manifest_ref / etc.)
}
```

`viewer_url` 與 `web_view_session_id` 在 conversion ready 時 coordinator 自動 spawn local-web-view session 並寫進 job state。

### 2.3 `POST /api/internal/conversions/:conversionJobId/ingest`(既有 endpoint,行為加強)

既有 `ingestConversionReport`(`bim-review-coordinator/src/app.ts`)在 terminal `ready` 分支已呼叫 `autoCreateOrActivateSession`(backfill-coordinator-webhook-and-auto-session change),建 review session。本 change 加上**spawn local-web-view session 並把 viewer_url 寫進 ifc-ready job state**:

```ts
if (outcome.status === "ready") {
  // 既有:enqueue callback outbox + autoCreateOrActivateSession
  await callbackOutbox.enqueue(...);
  await autoCreateOrActivateSession(...);

  // 新增(fast-ifc-link-demo-loop):spawn local-web-view session,寫 viewer_url 到 job
  const lwvSession = createLocalWebViewSession({
    ifc_ready_job_id: job.ifc_ready_job_id,
    user: user(default provider),
  });
  const viewerUrl = buildViewerUrl(config.publicHost, lwvSession.web_view_session_id);
  externalIfcReadyStore.setViewerLink(job.ifc_ready_job_id, lwvSession.web_view_session_id, viewerUrl);
}
```

### 2.4 新 endpoint `GET /ui/open?session=<id>`

```ts
app.get("/ui/open", (req, res) => {
  const session = String(req.query.session ?? "");
  if (!/^lwv_[A-Za-z0-9_]+$/.test(session)) {
    return res.status(400).json({ detail: "invalid session id" });
  }
  const target = `http://127.0.0.1:5173/?session=${encodeURIComponent(session)}`;
  res.redirect(302, target);
});
```

對 LAN client 來說:browser 連 `http://<host-lan-ip>:8004/ui/open?session=lwv_abc` → coordinator 回 302 → browser 改連 `http://127.0.0.1:5173/?session=lwv_abc`。這要求 **client 機器本機就是 host 機**(fast MVP 邊界)。

### 2.5 `POST /api/local-web-view/sessions`(既有,Response 加 viewer_url)

`viewer_url` 從 `config.publicHost` 與 `web_view_session_id` 組出,同 §2.4 redirect target 邏輯。

## 3. Shared volume layout

```
host: C:\Repos\active\iot\AI-BIM-governance\storage\
       └── ifc-cache\
           └── <ifc_ready_job_id>\
               └── source.ifc       # coordinator 下載寫入,streaming-server 讀取

coordinator container 內:
  /workspace/storage/ifc-cache/<jobId>/source.ifc

streaming-server (host-native):
  C:\Repos\active\iot\AI-BIM-governance\storage\ifc-cache\<jobId>\source.ifc

dispatch payload 同時帶兩條 path:
  - local_path:container 角度(coordinator 寫入時用)
  - host_local_path:host 角度(streaming-server 讀取用)
```

streaming-server 設 `STORAGE_HOST_ROOT` env(預設 `C:\Repos\active\iot\AI-BIM-governance\storage`),自動把 container path → host path 換算。

## 4. 邊界文字 carve-out

### `AGENTS.md` §3.4

```
> 例外(2026-05-21 fast-ifc-link-demo-loop):允許 coordinator 在 ifc-ready intake
> 同步階段,將外部 IFC 下載至本地 shared volume 路徑
> `storage/ifc-cache/<ifc_ready_job_id>/source.ifc`,作為 dispatch streaming-server
> 前的臨時通道快取。coordinator 不視為該 IFC bytes 的資料權威;權威仍屬外部公司
> 雲端 control-plane(`external_model_version_id` 參照),streaming-server 為
> conversion authority。
```

### `bim-review-coordinator/CLAUDE.md` MUST NOT

同上 carve-out。

## 5. `/ui` UI mockup(3 卡單欄垂直)

```
+--------------------------------------------------------------+
| BIM 審查雲端 / 快速 Demo                                       |
+--------------------------------------------------------------+
| ① 提交 IFC source(模擬外部 ifc-ready)                       |
|    ifc_path  [_________________________________________]      |
|    project_id [____]  version [____]  task_id [____]         |
|    [ 送出 ifc-ready ]                                         |
|    submit result: 200 / 4xx / 5xx | ifc_ready_job_id: ...    |
+--------------------------------------------------------------+
| ② 下載 + 轉檔進度(每 5s 自動 polling)                       |
|    ● download_status:  downloaded                            |
|    ● conversion_status: running (45s)                       |
|    ● viewer_open_ready: false                                |
+--------------------------------------------------------------+
| ③ 開啟 viewer                                                 |
|    viewer_url:  http://192.168.10.105:8004/ui/open?...       |
|    [ 複製 ]  [ 開啟 viewer ]                                  |
+--------------------------------------------------------------+
```

dev-console.html 整頁重寫(保留 `審查協調 (Review Coordinator)` 標題作 dev-console.test 字串斷言),inline script 內保留 `joinSession` Socket.IO event(`presence` 流程仍可用)。

## 6. Viewer query-string auto-attach + 全螢幕版面

### 6.1 `src/main.tsx` 解析 query string

```tsx
const params = new URLSearchParams(location.search);
const session = params.get("session");
if (session) {
  bootstrapAutoAttachViewer(session);  // 新 helper
} else {
  renderStaticEntryPrompt();
}
```

`bootstrapAutoAttachViewer(sessionId)`:
1. `GET coordinator /api/local-web-view/sessions/{sessionId}` 取 stream config
2. 直接 render `<AppStream>` 含 stream config(跳過 NVIDIA Forms)
3. WebRTC 接 streaming-server signaling

### 6.2 `src/App.tsx` / `src/AppStream.tsx` 全螢幕版面

- 移除 NVIDIA `Forms.IDLE / AppOnly / StreamURLs / Applications / Versions / Profiles` 切換邏輯
- `headerHeight` 36px(原 60)
- 加 footer HUD 36px
- video element fill viewport between header / footer
- top HUD:project name + session id + 重連 button
- bottom HUD:kit instance id + WebRTC status + fps + diagnostic button

## 7. Postman collection 結構

`docs/postman/fast-ifc-link-demo.postman_collection.json`(v2.1):

```
Requests:
├── Submit ifc-ready
│   POST  {{coordinator_base_url}}/api/external/ifc-ready
│   Headers: Content-Type, X-Webhook-Secret, X-Correlation-Id (UUID), X-Idempotency-Key (UUID)
│   Body: { status:"ifc_ready", ifc_path:{{ifc_path}}, project_id, version, task_id }
│   Tests: status===200; pm.collectionVariables.set("ifc_ready_job_id", json.ifc_ready_job_id)
│   Settings: timeout 600s
├── Poll ifc-ready job
│   GET   {{coordinator_base_url}}/api/external/ifc-ready/{{ifc_ready_job_id}}
│   Tests:
│     if (json.viewer_url) {
│       pm.collectionVariables.set("viewer_url", json.viewer_url);
│     } else {
│       setTimeout(() => pm.execution.setNextRequest("Poll ifc-ready job"), 5000);
│     }
└── Open viewer (info only)
    GET   {{viewer_url}}
    Pre-request: console.log("viewer_url:", pm.collectionVariables.get("viewer_url"))

Environment:
  - coordinator_base_url    http://127.0.0.1:8004
  - webhook_secret           dev-webhook-secret
  - ifc_path                  http://192.168.20.234:9000/bim-control/899/xxx/model.ifc
  - project_id                899
  - version                   xxx
  - task_id                   task_img_001
```

`docs/postman/README.md`:導入步驟、env 配置、Collection Runner 跑法、debug tips。

## 8. Verification 5 級

```
L1 unit:
  cd bim-review-coordinator && npm run verify
  cd web-viewer-sample      && npm run build && npm run test:session-first
  python -m pytest tests -p no:cacheprovider
  cd bim-streaming-server   && python -m pytest tests/test_conversion_authority_api.py -q

L2 spec:
  npx openspec validate fast-ifc-link-demo-loop --strict
  npx openspec validate --specs --strict

L3 graph:
  gitnexus_impact 對所有改動 symbol → 無 HIGH/CRITICAL
  gitnexus_detect_changes()                # 影響面 = expected

L4 container & network:
  docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml \
    --env-file .env.web-plane.host-kit.example up -d --build coordinator viewer
  netstat -ano | grep -E ":(8004|5173|49100|49101)"
       # 5173 → 127.0.0.1 only, 8004 → 0.0.0.0, 49100/49101 host-native
  docker exec coordinator node -e "fetch('/health').then(...)"
  docker exec coordinator node -e "fetch('/api/external/ifc-ready', {method:'POST',...payload})"
       # 200 download_status:downloaded 在 Postman 不可用時用 container 內 fetch 模擬

L5 真實 UI / client(mcp__claude-in-chrome):
  (A) navigate /ui → 3 卡單欄垂直視覺驗收
  (B) 填 ifc_path / project_id / version / task_id → 點「送出 ifc-ready」→ 卡 ② polling 顯示 downloaded → conversion ready
  (C) 卡 ③ viewer_url 出現,點「開啟 viewer」→ 自動跳轉 127.0.0.1:5173/?session=...
  (D) viewer 進入全螢幕 stream + HUD,console 無 unhandled error
  (E) gif_creator 錄整段 → 附 PR description
  (F) Postman Collection Runner 跑通同樣 happy path

注意:L5(B)-(D) 需要 streaming-server 真實在 host 跑 + 有真 IFC fixture。若 dev 機 MinIO 192.168.20.234 不可達,改用本機 `storage/許良宇圖書館建築_2026.ifc` 透過 file:// 或 worker compat `ifc_path:"http://127.0.0.1:8004/static/許良宇圖書館建築_2026.ifc"` 之類臨時 fixture。
```

## 9. Blast radius / Risks

| 風險 | 評估 | 緩解 |
|---|---|---|
| 同步下載 hang Postman 連線 | MEDIUM | timeout 600s 文件明示;若 caller 撐不住,改 design 階段選項 B(async + polling) |
| coordinator 持有 IFC bytes 違反邊界 | LOW(已 carve-out) | 文字寫進 AGENTS.md / CLAUDE.md;reviewer 看得到 |
| streaming-server host path vs container path 混淆 | MEDIUM | dispatch payload 同時帶 local_path + host_local_path,streaming-server STORAGE_HOST_ROOT 校正 |
| viewer ?session= 漏帶或 invalid → 白屏 | LOW | renderStaticEntryPrompt fallback,顯示「請從 /ui 建立會議」 |
| Kit 1:1 多人同 URL 點開 | LOW | Kit 自然行為「後到取代前到」;HUD 顯示「另有 viewer 已接管」 |
| MinIO 192.168.20.234 在 dev 機不可達 | MEDIUM | implementation 用本機 fixture `storage/許良宇圖書館建築_2026.ifc`;Postman env 切換 |
| GitNexus index stale | LOW | commit 後 PostToolUse hook 自動 `npx gitnexus analyze`;archive 前重新 index 一次 |
| Postman Test script setNextRequest 行為差異 | LOW | README 寫明 Runner 模式;或附 Newman command 自動化 |

## 10. Predecessor coupling

- `remove-conflict-review-from-fast-mvp` 已 archived(PR #90/#91)
- 本 change 假設:viewer 已無 `IssuePanel` / `EventLogPanel` slot、coordinator socket 已無 issue handlers、`/ui` 步驟 ④⑤ 已刪、compose viewer 已 `127.0.0.1` bind
- 若 predecessor 中途回滾,本 change 也要對應調整(回到舊 baseline 再做 net add + 刪除衝突檢討)— 但 predecessor 已 archived,不會發生
