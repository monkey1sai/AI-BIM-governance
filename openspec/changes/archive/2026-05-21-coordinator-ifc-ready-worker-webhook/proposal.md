## Why

現行 B 方案已規定外部 IFC-ready 入口歸 `bim-review-coordinator`，但實際 worker 端目前送出的 webhook payload 是較簡化的 `status / ifc_path / project_id / version / task_id` 格式。若 coordinator 不明確支援這個格式，worker 完成 IFC 後仍無法穩定把「IFC 已準備好」事件交給本 repo 的轉檔閉環。

但只接住 webhook 還不夠：`review-session-request-lifecycle` 規格原本指派「artifact readiness 確認後，由 `_bim-control` 或核可 service adapter 呼叫 `POST /api/review-sessions`」。B 方案已把 `_bim-control` / `_worker` 自 product runtime 刪除（僅留 test-double），這個「轉檔 ready 後自動建 review session」的責任因此變成**無人承接的孤兒**：目前 `ingestConversionReport` 走到 ready 只進 metadata-only callback outbox 與標記 job ready，**不會**在本地自動建立綁好新 USDC 與 Kit endpoint 的 review session。結果是 worker-webhook 驅動的閉環在「轉檔成功」之後對本地 viewer 是死路，session-first 的 `web-viewer-sample` 沒有 session 可接。本 change 因此從「窄的入口格式相容」重新定位為「**讓 worker-webhook 驅動的 B 方案閉環一路通到一個可被 viewer 接上的 review session**」，把退役 `_bim-control` 孤立掉的 session 觸發責任 re-home 回 coordinator 自身的 conversion-ready ingestion。

## What Changes

入口相容（既有 scope）：

- 在 `bim-review-coordinator` 規格中定義 `POST /api/external/ifc-ready` 可接收 worker `ifc_ready` payload（`status: "ifc_ready"`、`ifc_path`、`project_id`、`version`、`task_id`）。
- coordinator 將此 payload 正規化為既有 B 方案 conversion job 所需欄位（`source_ifc_ref`、`external_model_version_id`、`external_conversion_task_id`、`correlation_id`、`idempotency_key`）。
- `task_id` 在 worker 未提供明確 `correlation_id` / `idempotency_key` 時作為可追蹤與可重試的主要來源。
- 保留 `bim-streaming-server` 為 internal-only IFC→USDC conversion engine；coordinator 仍負責外部 webhook intake、idempotency、shadow metadata 與 callback outbox。

出口 session 編排（本次新增 scope — B 方案 re-home）：

- coordinator 在自身的 conversion-ready ingestion（terminal `ready`，即 `ingestConversionReport` 路徑）達成時，**自動觸發**本地 review session 的建立/啟用，重用既有 `POST /api/review-sessions` 內部路徑、`SessionStore` 與 `kitPool`，把新轉出的 USDC artifact 與 Kit endpoint binding 綁進 session，讓 session-first 的 `web-viewer-sample` 能自動接上。
- 自動建立必須與既有 explicit `POST /api/review-sessions` 呼叫者共存，並對同一 `correlation_id` / `external_model_version_id` 具 idempotency（不得對同一轉檔結果重複建 active session）。
- session 的 model readiness 必須沿用 `bim-streaming-server` 為 conversion authority 的既有語意：非 ready / failed 不得被包裝成可串流的 ready session（沿用 `Review sessions reference streaming-owned conversion readiness` 既有需求）。
- 此自動接線僅為 **control-plane 接線**：coordinator 只產生 session 紀錄、stream config 與 Kit binding metadata；**不**啟動或控制 Kit 進程、**不**開 USD stage、**不**渲染（沿用 coordinator 邊界規則，3D runtime 仍由 `bim-streaming-server` 自治、viewer 經 DataChannel 驅動）。

Non-goals：

- 不復活已刪除的 `_worker` / `_bim-control` runtime；test-double 仍只放 `tests/fakes`。
- 不讓 `bim-streaming-server` 暴露 public IFC-ready webhook。
- 不新增 production dependency，不修改 secrets 或真實 `.env` 值。
- **真實 GPU / Kit render 啟動與瀏覽器可見畫面（`single_kit_render` / WebRTC `49100` / browser visual）不在本 change 的 pass 範圍**：那需要 Kit build + GPU host 前置，屬獨立 tier，本 change 只負責 control-plane 自動接線，render tier 維持獨立判定、不升等（與已合併 `introduce-host-native-conversion-authority-service` 的分層一致）。
- 不解 OQ1 真實公司雲端 callback endpoint/auth、不解 OQ5 SSO。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `local-coordinator-ifc-ready-intake-boundary`: 明確支援 worker `ifc_ready` webhook payload，並定義 coordinator 的欄位正規化、驗證、idempotency 與錯誤回應。
- `conversion-webhook-lifecycle`: 定義 worker payload 缺少 explicit correlation / idempotency 欄位時 coordinator 如何從 `task_id` 派生可追蹤事件；並新增「terminal `ready` ingestion SHALL 觸發本地 review session handoff（與 callback outbox 分離；`failed` 不得呈現可開）」的 seam。
- `review-session-request-lifecycle`: 把「Coordinator session is bound back to the request」需求加上 B 方案 re-home 變體 — `_bim-control` runtime 退役時，改由 coordinator 自身的 conversion-ready ingestion 自動建立/啟用 Kit-bound review session，session_id / stream config / bindings 改寫進本地最小 shadow metadata；canonical 呼叫者路徑保留。

## Impact

- Owner repo/folder: `bim-review-coordinator/`（intake normalization + conversion-ready ingestion → 自動 session 接線；重用既有 `SessionStore` / `kitPool` / `ingestConversionReport`，不新增 runtime service）。
- API: `POST /api/external/ifc-ready` 接受 worker payload 格式；既有 `POST /api/review-sessions` 內部建立路徑被 conversion-ready ingestion 自動觸發複用；API path 維持英文。
- Data structure: worker payload → local shadow conversion job mapping；conversion-ready → review session（綁 `usdc_artifact_id` + `kit_instance_bindings`）；不保存大型 IFC/USDC file body。
- Affected integration: external customer-edge IFC Worker → `bim-review-coordinator` → `bim-streaming-server` internal conversion → coordinator conversion-ready ingestion →（並行）metadata-only callback outbox ＋ 本地自動 review session → session-first `web-viewer-sample`。
- Affected symbols（apply 前需 GitNexus impact analysis）：`ingestConversionReport`、`SessionStore.create`、`allocateKitInstanceBindings`、`/api/internal/conversion-result`、`/api/internal/conversions/:id/ingest`、`/api/review-sessions`。
- Tests/contracts: 既有 intake route / contract test（valid payload、invalid status、missing fields、duplicate replay、conflicting retry）＋ 新增 conversion-ready → 自動 session 建立、idempotent 不重複建、非 ready/failed 不建可串流 session、callback outbox 與 session 接線狀態分離。
- Dependencies: none。
