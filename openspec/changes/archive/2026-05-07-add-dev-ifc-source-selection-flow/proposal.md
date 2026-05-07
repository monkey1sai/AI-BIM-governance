## Why

目前 demo 的步驟 ①/② 已經宣告由 `_worker` 承接檔案與轉檔邊界，但 UI、啟動腳本與部分文件仍保留 `_s3_storage`、`_conversion-service`、`_conversion-server` 的舊路徑，導致客戶流程與實際架構不一致。

這次 change 要讓 `_worker` 成為唯一的本地 demo artifact + conversion 入口：使用者在 worker demo UI 從假的 `.\storage` dev folder 選擇 `*.ifc`，觸發 worker artifact intake 與 conversion job，並在完成後進入既有 review session flow。

## What Changes

- 新增 `_worker` dev IFC source selection flow：`_worker` 掃描設定好的 fake local storage folder，列出所有 `*.ifc`，讓 demo UI 可選擇其中一個檔案。
- 新增 `_worker` demo UI，對應 demo 步驟 ①「上傳建模」與步驟 ②「自動轉換」：顯示 IFC 清單、選取狀態、artifact intake 結果、conversion job 狀態、artifact group readiness 與下一步 review session 入口。
- 新增 worker API contract，支援 dev-only IFC listing 與從已知 local dev source 建立 source artifact；worker 仍只把 metadata / readiness 發布到 `_bim-control`。
- 調整 `_bim-control` demo stepbar：步驟 ①/② 導向 `_worker` demo UI，而不是要求 `_bim-control` 掃描本機資料夾或觸發 conversion。
- 調整 `web-viewer-sample` 與文件中的 demo stepbar / architecture copy，將 `_s3_storage`、`_conversion-service`、`_conversion-server` 從主要 demo path 移除。
- **BREAKING** 移除 `_s3_storage` 作為獨立可啟動服務；新 demo 不再依賴 port `8002` 或 `/static/projects/...` URLs。
- **BREAKING** 移除 `_conversion-service` 與 `_conversion-server` 作為獨立可啟動服務；新 demo 不再依賴 port `8003` 或 legacy conversion console。
- 更新 root scripts、health checks、smoke tests 與 docs，讓 one-shot bring-up 只啟動 `_bim-control`、`_worker`、`bim-review-coordinator`、可選的 `bim-streaming-server`、以及 `web-viewer-sample`。
- 更新 `bim-streaming-server` stage loading：當 review session 帶入多個 ready artifact bindings 時，streaming runtime 需依 `load_order` 真正把多個 worker-hosted USDC/USD 以 sublayer 或 payload 方式組入目前 stage，而不是只載入第一個 binding。
- 非目標：不導入真實 S3、真實雲端 upload、正式檔案選取權限、真實 BIM platform 權限模型、真實 GPU autoscaling，也不讓 `_bim-control` 或 web viewer 讀取 local filesystem。

## Capabilities

### New Capabilities

- `worker-dev-ifc-source-selection`: `_worker` 在 local demo mode 下列出 fake storage folder 的 `*.ifc`，讓 worker demo UI 選取 IFC 並建立 source artifact / conversion job。
- `worker-demo-upload-convert-ui`: `_worker` 提供面向 demo 觀眾的步驟 ①/② UI，呈現 IFC 選取、上傳建模、轉換 job、artifact readiness 與下一步入口。
- `legacy-storage-conversion-retirement`: workspace 移除 `_s3_storage`、`_conversion-service`、`_conversion-server` 的主要 demo dependency，並把文件、scripts、tests、stepbar 與 contract 改到 worker-only path。
- `streaming-multi-layer-payload-loading`: `bim-streaming-server` 在 `same_instance` multi-artifact review session 中依 binding load order 載入 primary stage，並把其餘 model bindings composition 到同一 runtime stage。

### Modified Capabilities

- None. `openspec/specs/` 目前沒有既有 capability；本 change 以新增規格描述目標行為。

## Impact

- `_worker`: 新增 dev source discovery API、local file ingestion path、demo UI route/static asset、CORS/health visibility、tests 與 README 更新；`_worker` 仍是 file bytes、conversion job、object layout、lineage 與 object URL owner。
- `_bim-control`: demo stepbar / UI 文案改為導向 `_worker`；不得掃描 `.\storage`、讀取 IFC bytes 或直接觸發 conversion；仍只保存 project/model/artifact/review metadata。
- `web-viewer-sample`: demo control panel、architecture overview、stepbar links 與 service copy 改為 worker-only artifact path；不再引用 `_s3_storage` 或 `_conversion-service` 作為主要服務。
- `bim-review-coordinator`: 移除或更新 `_s3_storage` / `_conversion-service` assumptions，artifact URL 與 mapping URL 以 `_worker` object URLs 為準；session lifecycle contract 不改變。
- `bim-streaming-server`: stage loading 行為會擴充；單一 URL 路徑保持相容，多 artifact binding 路徑需回報實際載入的 primary / layer / payload / failed binding 結果。
- `scripts/`: `start-all.*`、`stop-all.*`、health checks、verify scripts、smoke scripts 移除 8002/8003 dependency，新增或更新 worker demo flow validation。
- `docs/`: 更新 AGENTS.md、CLAUDE.md、README.md、contracts、demo UI guidelines references 與 legacy conversion/storage docs；舊文件可搬到 archive 或標為 historical，不再當作 current runbook。
- Filesystem: 新增明確的 dev-only source folder setting，例如 `WORKER_DEV_STORAGE_ROOT`，預設可指向 repo root 的 `storage/` 或 `_worker/storage/`；必須限制 path traversal，只列出該 root 之內的 `.ifc` 檔。
- Ports: `8005` 取代 `8002`/`8003` 成為 demo 步驟 ①/② 唯一入口；移除服務後要更新所有 health check 與 open-demo scripts。
