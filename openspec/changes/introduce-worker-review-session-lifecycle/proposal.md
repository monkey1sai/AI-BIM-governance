## Why

目前 PoC 把 `_s3_storage`、`_conversion-service`、review session 建立、Kit instance 分配與 browser bootstrap 串成可跑 demo，但檔案本體、轉檔任務、artifact lineage、review intent 與 session lifecycle 的權責仍分散。這次調整要把檔案與轉檔責任收斂到 `_worker`，並讓 review session 從可追蹤的 review intent 開始，支援多 artifact / 多 Kit instance 的 SaaS 型審查拓撲。

## What Changes

- 新增 `_worker` 服務邊界，作為 `_s3_storage`、`_conversion-service`、`_conversion-server` 對外能力的收斂入口；它負責 file bytes、source/derived artifacts、conversion jobs、index/mapping build、object layout 與 conversion lineage。
- `_bim-control` 保留 fake BIM metadata / review data authority，只保存 project、model version、artifact metadata、artifact group metadata、review intent、session binding 與 lifecycle events，不直接保存大型檔案或執行轉檔。
- 新增 `_bim-control` review session request flow：`POST /api/review-session-requests` 先保存 review intent，再查 `_worker` artifact group ready 狀態，最後呼叫 coordinator 建立 review session 並回寫 session / Kit binding。
- `bim-review-coordinator` 從單純建立 session 升級為 lifecycle + KitInstancePool 控制面，支援 `created -> active -> closing -> closed -> instance released`，並保存 `artifact_bindings[]` 與 `kit_instance_bindings[]`。
- `bim-review-coordinator` 依 routing policy 決定同一 review session 使用同一 Kit instance、dedicated instance 或多 instance；session 是協作空間，不等於一台 Kit。
- `bim-streaming-server` 維持 3D runtime 邊界，支援多 artifact load order、overlay / payload 載入、honest `missing_paths` / `applied_mode` 回報；不保存業務資料。
- 現有 `openStageRequest`、`highlightPrimsRequest`、`focusPrimRequest` 與 selection fallback 流程應保留；本 change 只補 artifact load order / overlay contract 與 lifecycle binding，不重寫既有 DataChannel runtime。
- `web-viewer-sample` / review page 改成 session-first bootstrap：讀 review request / session、讀 stream config、顯示 lifecycle state，透過 DataChannel 與 Socket.IO 操作 runtime 與協作事件。
- 非目標：不導入真實 SSO、真實雲端 object storage、真實 GPU autoscaling、正式 BIM platform 權限模型、法規 / 碳排 / AI 判斷，且不讓 web viewer 或 streaming server 成為資料權威。

## Capabilities

### New Capabilities

- `worker-artifact-pipeline`: `_worker` 接收原始 IFC/RVT/DWG 或 signed upload，建立 source artifact，排程 conversion job，產生 USDC、indexes、mapping 與版本化 object layout。
- `review-session-request-lifecycle`: `_bim-control` 保存 review intent，coordinator 建立可追蹤 review session lifecycle，並回寫 session、artifact 與 Kit instance binding。
- `multi-artifact-kit-routing`: 同一 review session 可綁定多個 artifact group，並依 routing policy 分配同一 Kit instance、dedicated instance 或多 Kit instance。
- `session-first-review-viewer`: browser review page 以 review request / session 為入口，讀取 stream config、artifact panel、lifecycle state，並透過 DataChannel + Socket.IO 發送互動與協作事件。

### Modified Capabilities

- 無。`openspec/specs/` 目前沒有既有 capability，因此本 change 以新增規格描述目標行為。

## Impact

- `_worker`: 新增或收斂 `POST /api/artifacts`、`POST /api/conversions`、`GET /api/conversions/{id}`、`GET /api/conversions/{id}/result`、`GET /objects/*`，並保留舊 `_s3_storage` / `_conversion-service` demo URL adapter 或 alias，避免一次破壞既有 demo UI。
- `_bim-control`: 新增 `ReviewSessionRequest` model、artifact group metadata、review intent status、session binding、artifact binding 與 lifecycle event persistence；新增 `POST /api/review-session-requests`、`GET /api/review-session-requests/{id}`、`PATCH` request status / bindings。
- `bim-review-coordinator`: 調整 `POST /api/review-sessions`、新增 close / release flow，保存 `artifact_bindings[]`、`kit_instance_bindings[]`、participants、lifecycle events 與 KitInstancePool state。
- `bim-streaming-server`: 維持 DataChannel runtime contract，擴充 `openStageRequest` 或新增 optional `loadArtifactGroupRequest` 支援 artifact load order / overlay；回應必須誠實列出 missing paths 與 applied mode。
- `web-viewer-sample`: review page 改以 session bootstrap、artifact panel、lifecycle state 與多 artifact 操作為主要使用流程；不硬編模型路徑。
- 儲存 layout: `_worker` 版本化保存 object，例如 `tenants/{tenant_id}/projects/{project_id}/versions/{model_version_id}/artifact-groups/{artifact_group_id}/source/{source_system}/{source_artifact_id}/original/{sha8}_{filename}.ifc` 與 `derived/{conversion_job_id}/usdc/` 下的 `model.usdc`、`ifc_index.json`、`usd_index.json`、`element_mapping.json`、`metadata.json`。
- 驗證影響：需要分階段驗證 `_worker` API-only、`_bim-control` intent / metadata、coordinator lifecycle / Kit binding、web viewer bootstrap，以及有 GPU / Kit 時的 streaming multi-artifact runtime。
