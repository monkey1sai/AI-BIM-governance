## Why

`AI-BIM-governance` 2026-05-21 收斂為 fast MVP demo path:外部 IFC Worker(由 Postman 模擬)送 `ifc-ready` → coordinator 同步下載 IFC 至本地 shared volume + dispatch streaming-server 轉檔 → 轉檔 ready 後 coordinator 自動建 local web view session 並輸出 viewer 連結 → client 點連結直接全螢幕看 3D stream。

Predecessor change `remove-conflict-review-from-fast-mvp` 已 archived(2026-05-21,PR #90/#91,squash `9e57015` / `4c892d0`),baseline 已收乾淨(衝突檢討功能整檔刪除、`compose.host-kit.yml` viewer 已 `127.0.0.1` bind)。本 successor change 補完 fast MVP loop 的核心 happy path:

- 既有 `POST /api/external/ifc-ready` 只 accept 規格化 payload 並 dispatch streaming-server,**不下載 IFC bytes**,且立刻回 202;Postman caller 無法用此 endpoint 取得「IFC 已下載」確認 message。
- 既有 `GET /api/external/ifc-ready/:jobId` 已暴露 `conversion_status` 但**未暴露 `viewer_url`**;caller 拿不到一條可點開 viewer 的連結。
- 既有 `/ui` 仍含 demo 5 步流程的 Lab(預設 ①/② 已縮減,③ 仍是 review session demo),沒有「Postman-style 提交 ifc-ready + polling + 連結卡」一條龍 happy path。
- 既有 `web-viewer-sample` 主入口仍 NVIDIA Forms 切換,使用者一進 viewer 必須手動填 streamServer/appServer,無法**點一條連結就自動 attach session**。
- 既有 boundary(`AGENTS.md` §3.4 / `bim-review-coordinator/CLAUDE.md` MUST NOT)明寫 coordinator 「不直接保存大型模型檔案 byte」,但同步下載到 shared volume 是 fast MVP 的關鍵設計;邊界需要 carve-out 收進文件。

本 change 補上以上五個缺口,以最小可用方式讓「Postman → coordinator → streaming-server → viewer 連結 → 全螢幕 stream」這條閉環跑通。

## What Changes

### 修改 — coordinator API (`bim-review-coordinator/`)

- `POST /api/external/ifc-ready`:**新增同步下載階段**
  - normalize 後從 `source_ifc.ref`(canonical) / `ifc_path`(worker compat)同步 HTTP GET 下載 IFC 至 `/workspace/storage/ifc-cache/<ifc_ready_job_id>/source.ifc`
  - 下載完成才 dispatch streaming-server `POST /api/conversions` 並回 200(改自原 202)
  - Response body 新增 `download_status: "downloaded"`、`message`、`local_path`(optional)
  - 失敗 → 502 `download_failed`、job 標 `download_status:"failed"`、不 dispatch
  - Idempotent replay → 既存 job 直接回 200 reuse,不重下、不重派工
  - timeout 預設 600s(env `IFC_DOWNLOAD_TIMEOUT_SECONDS` 可調)
- `GET /api/external/ifc-ready/:jobId`:**新增 response 欄位**
  - `download_status` (enum: `pending|downloading|downloaded|failed`)
  - `viewer_url` (nullable;conversion ready 時非 null)
  - `web_view_session_id` (nullable;conversion ready 時非 null)
- `POST /api/internal/conversions/:conversionJobId/ingest`(既有):**ready 分支補上 auto-create local-web-view session**
  - 既有 `autoCreateOrActivateSession` 已建 review session,但未產生 viewer URL
  - 本 change 在 ready 分支內 spawn local-web-view session 並寫 `viewer_url` 進 ifc-ready job state
- 新 endpoint `GET /ui/open?session=<id>`
  - server-side 302 redirect → `http://127.0.0.1:5173/?session=<id>`
  - 理由:viewer 已 `127.0.0.1` bind,LAN client 從 coordinator(`0.0.0.0:8004`)拿 redirect 後在自己機器的 `127.0.0.1:5173` 開 viewer
- `POST /api/local-web-view/sessions`(既有):**Response 新增 `viewer_url` 欄位**(同 GET .../{jobId})

### 修改 — coordinator `/ui`(`bim-review-coordinator/src/public/dev-console.html` + `.js`)

整頁重做為 3 卡單欄垂直流程:

- 卡 ①「提交 IFC source(模擬外部 ifc-ready)」
  - input: `ifc_path` / `project_id` / `version` / `task_id`
  - button: 送出 `POST /api/external/ifc-ready`(worker compat payload)
  - 顯示 response.status + ifc_ready_job_id + download_status
- 卡 ②「下載 + 轉檔進度(每 5s 自動 polling)」
  - `download_status` / `conversion_status` / `viewer_open_ready` 三個 indicator
- 卡 ③「開啟 viewer」
  - viewer_url 顯示 + 複製 button + 開啟 button(navigate to `/ui/open?session=...`)

### 修改 — viewer (`web-viewer-sample/`)

- `src/main.tsx`:解析 `?session=lwv_xxx` query string
  - 有 session → 跳過 NVIDIA Forms,從 coordinator `GET /api/local-web-view/sessions/{id}` 取 stream config → auto-attach `<AppStream>`
  - 沒 session → 顯示靜態 entry prompt「請從 coordinator /ui 建立會議後再點連結」
- `src/App.tsx` / `src/AppStream.tsx`:主畫面改全螢幕 stream + 邊框輕 HUD
  - 移除 NVIDIA Forms 切換與既有 setup UI
  - top HUD(36px):project name + session id(可隱藏) + 重連 button
  - bottom HUD(36px):kit instance id + WebRTC status + fps + diagnostic button
  - video element 填中央

### 新增 — Shared volume coordinator → streaming-server

- `compose.runtime-manager.yml` coordinator service 已有 `./storage:/workspace/storage` mount(不需新增)
- streaming-server(host-native)讀同一 host 路徑;dispatch payload 新增 `local_path` / `host_local_path`,streaming-server `STORAGE_HOST_ROOT` env 校正 container path → host path

### 新增 — Postman collection 與 README

- `docs/postman/fast-ifc-link-demo.postman_collection.json`(v2.1):
  - `Submit ifc-ready` (POST,worker compat body,600s timeout)
  - `Poll ifc-ready job`(GET,test 內 retry until viewer_url 出現)
  - `Open viewer` (info only)
- `docs/postman/README.md`:導入 + 環境設定步驟

### 修改 — 邊界文字 carve-out

- `AGENTS.md` §3.4 + `bim-review-coordinator/CLAUDE.md` MUST NOT 段加 carve-out
  - 允許 coordinator 同步下載 IFC 至 `storage/ifc-cache/<ifc_ready_job_id>/source.ifc` 作為 dispatch 前臨時通道
  - coordinator 不視為 IFC bytes 資料權威;權威仍屬外部公司雲端 control-plane;streaming-server 為 conversion authority

### 明確排除(本 change 不做)

- 不啟動 Kit / GPU 渲染本身(host-native,獨立於本 change)
- 不接真實外部 `bim-control` 雲端(`tests/fakes` 不動,Postman 模擬)
- 不解 OQ1(雲端 callback endpoint/auth)/ OQ5(SSO)
- 不做 viewer URL token / expiry / 多人權限(fast MVP demo-only,Kit 1:1 自然處理「後到取代前到」)
- 不做反向代理 → viewer URL 必須**在同台 host 的瀏覽器打開**(`127.0.0.1:5173` 走 coordinator redirect)
- 不升等 render tier(`single_kit_render` / WebRTC `49100` / browser visual 仍 `not_observed`)
- 不重新引入衝突檢討(predecessor 已 retire)

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `local-coordinator-ifc-ready-intake-boundary`:加同步下載 requirement + response 欄位 + viewer_url
- `conversion-webhook-lifecycle`:streaming dispatch payload 加 `local_path` / `host_local_path`
- `demo-fast-mvp-orchestration`:加 3 步單欄垂直 `/ui` runbook + Postman collection
- `documentation-source-of-truth`:加邊界 carve-out 記錄

### Removed Capabilities

- None.

## Impact

- Owner repo/folder:`bim-review-coordinator/src/`、`bim-review-coordinator/src/public/`、`web-viewer-sample/src/`、`docs/postman/`、`AGENTS.md`、`bim-review-coordinator/CLAUDE.md`
- API:`POST /api/external/ifc-ready` 行為改變(202 → 200 + sync download);`GET /api/external/ifc-ready/:jobId` 加 response 欄位;新 `GET /ui/open?session=`;`POST /api/local-web-view/sessions` response 加 viewer_url
- Data structure:`ifc_ready_job` 加 `download_status` / `viewer_url` / `web_view_session_id` 欄位;dispatch payload 加 `local_path` / `host_local_path`
- Affected integration:Postman collection 為新增 external simulator;`tests/fakes` 不動
- Affected symbols(apply 前需 GitNexus impact analysis):`createCoordinatorApp`、`normalizeIntakePayload`、`ingestConversionReport`、`autoCreateOrActivateSession`、`StreamingConversionClient.createConversionJob`、`createReviewSession` / `ReviewLauncher`(viewer);預期 GitNexus risk = LOW-MEDIUM
- Tests/contracts:coordinator unit + integration tests 新增 download success/fail/timeout/idempotent cases;viewer build + test:session-first 對齊 query-string auto-attach
- Dependencies:無新 prod dependency
- Predecessor/Successor:predecessor `remove-conflict-review-from-fast-mvp` 已 archived(PR #90/#91);本 change 直接從乾淨 baseline 開
- Acceptance verification:5 級(L1 unit / L2 spec validate / L3 GitNexus / L4 container/network/netstat/curl / L5 真實 UI by mcp__claude-in-chrome,gif 證據附 PR description);詳見 `acceptance.md`
- Brainstorming source-of-truth:`docs/superpowers/specs/2026-05-21-fast-mvp-loop-overall-design.md`(已 merged 到 main 由 PR #90 帶入)Section 3 / 4
