## ADDED Requirements

### Requirement: coordinator SHALL 在所有瀏覽器可見/對外輸出 ifc-ready job 時遮蔽 presigned 簽章

任何「把整個 `IfcReadyIntakeJob` 序列化進對外（browser-visible / external）response」的端點 SHALL 先經單一 `sanitizeJobForExternal` 收斂函式遮蔽 `source_ifc_ref` 的 presigned 簽章（剝除 `X-Amz-*` query，只留物件位址）。涵蓋出口 SHALL 至少包含：`GET /api/external/ifc-ready`（列表）、`GET /api/external/ifc-ready/:jobId`、`GET /api/external/ifc-ready/:jobId/shadow`、`POST /api/external/ifc-ready` 的 200 idempotent replay 與 202 進件 response、`POST /api/local-web-view/sessions` 的 artifact_resolution。presigned 簽章 SHALL NOT 出現在上述任一對外 response 與 log。internal-token 路徑（`/api/internal/conversion-result`、`/api/internal/conversions/:id/ingest`）為刻意範圍外（pre-existing，下游 consumer 可能需 presigned 下載）。

#### Scenario: 含 presigned 簽章的 job 經對外端點輸出時被遮蔽

- **WHEN** 一筆 `source_ifc_ref` 含 `X-Amz-Signature` 的 ifc-ready job 經任一瀏覽器可見出口（GET 列表/:jobId/shadow、POST intake 200/202、local-web-view session）輸出
- **THEN** response body SHALL NOT 含 `X-Amz-Signature`，且 `source_ifc_ref` SHALL 只剩物件位址（origin+pathname）

### Requirement: coordinator SHALL 對外曝光單一權威轉檔生命週期狀態 conversion_lifecycle_status

`summarizeIfcReadyJob` SHALL additive 輸出 `conversion_lifecycle_status`，其值由單一純函式 `deriveLifecycleStatus(job)` 依凍結映射導出，並 SHALL 重用既有 `ConversionLedgerStatus`（`detected|queued|converting|ready|failed`）型別、SHALL NOT 在 job 端另宣告同名 enum。映射 SHALL 為：`status` ∈ {failed, dispatch_failed, dropped_on_restart} 或 `download_status==="failed"` → `failed`；`conversion_status==="ready"` → `ready`；`status==="dispatched"` → `converting`；`status==="queued_for_conversion"` → `queued`；其餘 → `detected`。轉檔權威落地前 SHALL NOT 出現 `ready`（誠實）。既有 26 欄輸出 SHALL 逐字保留。

#### Scenario: 派工中 job 的生命週期狀態為 converting、未派工為 detected

- **WHEN** 一筆 job `status==="dispatched"` 且 `conversion_status!=="ready"`
- **THEN** `summarizeIfcReadyJob` 輸出的 `conversion_lifecycle_status` SHALL 為 `converting`
- **AND** 當 job 為剛 accepted（未進佇列）時 SHALL 為 `detected`

### Requirement: coordinator SHALL 將 MinIO 專案原名與種類落 store 並對外曝光

`ExternalIfcReadyStore.create()` SHALL 把 `ExternalIfcReadyEvent.project_display_name` 與 `model_category` 擷取進 `IfcReadyIntakeJob`（additive nullable 欄 `project_display_name` / `category`）。`summarizeIfcReadyJob` SHALL 對外以 `project_display_name` 與 `category`（命名統一）曝光此二欄。非 MinIO 來源（無此二欄）SHALL 誠實輸出 `null`，SHALL NOT 塞假值。

#### Scenario: 帶專案原名與種類的進件對外可見

- **WHEN** intake payload 帶 `project_display_name="許良宇圖書館"` 與 `model_category="main"`
- **THEN** `GET /api/external/ifc-ready` 列表對應項 SHALL 含 `project_display_name="許良宇圖書館"` 與 `category="main"`
- **AND** 缺此二欄的進件對應項 SHALL 為 `null`

### Requirement: coordinator SHALL 提供手動觸發 MinIO 物件進入轉檔的端點

`POST /api/conversion/trigger` SHALL 接受 `{ key }`（MinIO object key），守門 SHALL 比照既有 `/api/conversion/*` 控制路由（`rejectIfIpNotAllowed`）。MinIO 未設定（endpoint/bucket/credentials 不齊全）SHALL 回 503。`key` 缺、含 `|`、超過 1024 bytes、或經 `deriveIntakeFromKey` 判不合法 SHALL 回 400。合法時 coordinator SHALL 於 server-side 產生 presigned GET URL（簽章 SHALL NOT 外洩瀏覽器）、重用 watcher `idempotencyKeyFor`/`correlationIdFor` 導出冪等鍵、self-POST loopback `/api/external/ifc-ready`（帶 webhook secret 與 `AbortSignal.timeout`）。同 key 重觸發 SHALL 回既有 job。回應 SHALL NOT 夾帶 presigned 簽章。

#### Scenario: 合法 key 觸發進入轉檔佇列、不洩漏簽章

- **WHEN** operator POST `/api/conversion/trigger` 帶一個 ≥3 段、不含 `|`、長度 ≤1024 的合法 MinIO object key（MinIO 已設定）
- **THEN** coordinator SHALL 回 200/202 含 `ifc_ready_job_id`
- **AND** response body SHALL NOT 含 `X-Amz-Signature`

#### Scenario: 不合法 key 被擋

- **WHEN** POST `/api/conversion/trigger` 的 key 缺、含 `|`、超過 1024 bytes、或去 prefix/suffix 後少於三段
- **THEN** coordinator SHALL 回 400 且 SHALL NOT 觸發 self-POST intake
