## Why

`docs/plans/` v3 規約第 7 條要求資料路徑比照真實 MinIO `bim-control/{projectId}/{modelId}/model.ifc…`，但現況 `#/minio` 是寫死示意頁（`prov="demo"`）、`#/a1` 檢核來源只有一個手填絕對路徑文字框。使用者已在本機 `storage/` 備妥三個專案（270/889/990 × 機電/水電/消防 × 4 版本，共 36 個 IFC）的真實結構，需要一條唯讀 file-server 瀏覽鏈路把它變成可操作的檢核來源（M0-R2 殼層真資料化 + M1-R6 端到端驗收的資料地基）。

## What Changes

- governance-service 新增 `file_library` router：`GET /api/files/tree` 唯讀列出 `BIM_FILE_LIBRARY_ROOT`（預設 repo `storage/`）下兩層 `{projectId}/{modelId}/*.ifc` 結構；`realpath` 防 path traversal；保留目錄（`ifc-cache`、`coordinator`）排除；`ver 竣工.ifc` 排版本序最後；root 缺失回 200 空樹。
- coordinator `governanceProxy` 白名單新增一條 `GET /api/governance/files/tree` 透傳。
- EdgeConsole `governanceClient` 新增 `filesTree()` 方法與 `FilesTreeResponse` 型別。
- `#/minio`（MinioDataPage）接真檔案庫樹（loading/error/empty 三態），`source_kind: "local_fs"` 誠實標示「local file-server（比照 bim-control 規約）；真 S3/MinIO 待接」；`model.usdc` 仍標 p1 待建。
- `#/a1`（IssuesRuleCenterPage）新增專案→模型→版本三層選擇器，選定路徑填入既有 `ifc_source_path`；手動輸入保留（graceful degradation）。
- Browser E2E（Playwright）：`#/minio` 真樹三專案可見 + `#/a1` 選擇器選 `270/機電/ver 竣工.ifc` 跑出真 rule-run；抽樣證據 tracked 於 `docs/evidence/minio-fileserver-source/`。
- 非目標：不接真 S3/MinIO client、不做上傳/刪除、不做轉檔自動觸發（O4/M2）、不做版本 diff（A2/M5）、不動 conversion 與 session/instance 邏輯。

## Capabilities

### New Capabilities

- `minio-fileserver-source`: 以本機 `storage/` 為 MinIO `bim-control` 規約的唯讀 file-server 來源，前端可瀏覽專案/模型/版本並把選定 IFC 作為 A1 檢核來源。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder：`governance-service/file_library/`、`bim-review-coordinator/src/routes/governanceProxy.ts`、`web-viewer-sample/src/console/`、`web-viewer-sample/e2e/`。
- API / data shape：新增唯讀 `GET /api/files/tree`（governance）與 `GET /api/governance/files/tree`（coordinator proxy）；既有 rule-run/Issue/BCF API 不變。
- Runtime boundary：governance-service 維持 loopback :49102 經 coordinator :8004 proxy；前端不直連。部署區生效需 merge 後重建（coordinator web-plane image 烘入新 dist 與 proxy）。
