## MODIFIED Requirements

### Requirement: Coordinator owns the external IFC-ready intake contract

`bim-review-coordinator` SHALL be the only service that exposes the external IFC-ready intake contract `POST /api/external/ifc-ready`. `bim-streaming-server` SHALL NOT expose an external IFC-ready entry; it MUST only receive internal conversion requests from `bim-review-coordinator`.

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：`bim-review-coordinator` SHALL 同時擁有 additive governed source intake `POST /api/external/source-bundles/ready`，兩個 intake contract SHALL 保持分離且 MUST NOT 互相冒充。`POST /api/external/ifc-ready` SHALL 維持本 requirement 既有語意，只建立 legacy intake job，MUST NOT 產生 governed source-bundle `READY`、`source_bundle_id` 或 `pipeline_job_id`。Governed ready claim SHALL 只經 `POST /api/external/source-bundles/ready` 進入，且該 claim MUST NOT 被視為 authority；coordinator SHALL 依 `minio-model-version-bundle` 重新驗證 manifest 與其 required roles、refs、ETags、object versions、SHA-256 與 sizes 後才宣告 `READY`。Governed lineage 的 result publication 與 cloud 發布 authority SHALL 由 `cloud-lineage-publication` 擁有，本 capability 不擁有。`bim-streaming-server` 仍 SHALL NOT 暴露任一 external intake entry。

#### Scenario: External IFC Worker posts ifc-ready to coordinator

- **WHEN** the customer-edge IFC Worker finishes producing a `.ifc` and calls `POST /api/external/ifc-ready` on `bim-review-coordinator`
- **THEN** `bim-review-coordinator` validates the request, creates a local conversion job, binds `external_model_version_id`, and dispatches an internal conversion request to `bim-streaming-server`
- **AND** `bim-streaming-server` exposes no public IFC-ready endpoint for that flow

#### Scenario: Streaming server is not a public entry

- **WHEN** any external caller targets `bim-streaming-server` directly for IFC-ready intake
- **THEN** the architecture MUST treat that as out of contract
- **AND** the supported external contract remains `bim-review-coordinator` `POST /api/external/ifc-ready`

#### Scenario: Governed source bundle 不走 legacy ifc-ready

- **WHEN** producer 最後發布 source `manifest.json` 並宣告 governed bundle 就緒
- **THEN** 支援的 entry SHALL 為 `POST /api/external/source-bundles/ready`
- **AND** 同一 version 物件若同時經 `POST /api/external/ifc-ready` 進入，SHALL 只建立 legacy intake job
- **AND** coordinator MUST NOT 由 legacy intake job 推導 governed `READY`、`source_bundle_id` 或 `pipeline_job_id`

### Requirement: Coordinator serializes concurrent IFC-ready dispatch with in-memory FIFO

`bim-review-coordinator` SHALL serialize the dispatch step (the synchronous
`POST /api/conversions/ifc-to-usdc` call to `bim-streaming-server`) for
`POST /api/external/ifc-ready` jobs using an in-memory FIFO queue. At any point
in time at most one job MAY be `in-flight` to streaming-server. Additional jobs
that have completed their local IFC download but are waiting for the dispatch
slot SHALL be reported with lifecycle status `queued_for_conversion` and an
integer `queue_position` (1-based). The HTTP `POST /api/external/ifc-ready`
response SHALL NOT block on the queue; it SHALL still return `202 Accepted`
immediately after the local intake / download stage.

This requirement is additive and MUST preserve the existing single-job happy
path: when only one job is being processed, behavior MUST be equivalent to the
pre-queue flow (no observable `queued_for_conversion` from the consumer's
perspective is required, though the store MAY transition through it briefly).

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：本 requirement 的 in-memory FIFO、`queued_for_conversion`／`queue_position` 與 `dropped_on_restart` 語意 SHALL 限於 `POST /api/external/ifc-ready` 的 legacy dispatch。Governed pipeline job MUST NOT 以此 in-memory 佇列作為排程或容量權威：容量等待 SHALL 表達為 `conversion-runtime-admission` 的 `WAITING_CAPACITY`（不消耗 attempt、不增加 attempt counter、不套用任意固定 timeout），pending／admission／publication state SHALL 為 durable，coordinator restart 後 SHALL 可恢復並重新進入 admission，MUST NOT 被標為 `dropped_on_restart`，也 MUST NOT 要求 operator 重送 intake。

#### Scenario: Two concurrent ifc-ready POSTs serialize dispatch

- **WHEN** two `POST /api/external/ifc-ready` requests arrive while
  `bim-streaming-server` is intentionally slow to respond to the first
  `POST /api/conversions/ifc-to-usdc`
- **THEN** the first job SHALL be observable as `status="dispatched"` (or
  transitional `status` reflecting in-flight dispatch) and SHALL NOT carry a
  positive `queue_position`
- **AND** the second job SHALL be observable with `status="queued_for_conversion"`
  and `queue_position >= 1` while the first dispatch is still in-flight
- **AND** the second job's `queue_position` MUST be 1 (only one job ahead)

#### Scenario: Queued job dispatches after in-flight completes

- **WHEN** the streaming-server returns a response for the first job's dispatch
  (success or failure)
- **THEN** the queue worker SHALL pick up the next queued job and dispatch it
- **AND** that previously queued job SHALL transition from
  `queued_for_conversion` to `dispatched` (on success) or `dispatch_failed` (on
  dispatch error)
- **AND** the dispatched job's `queue_position` SHALL be cleared (`null`)

#### Scenario: In-flight dispatch failure does not block queued items

- **WHEN** the first job's streaming-server dispatch fails (network error,
  non-2xx response, exception)
- **THEN** the first job SHALL transition to `status="dispatch_failed"`
- **AND** the queue worker SHALL proceed to dispatch the next queued job
  regardless of the first job's outcome
- **AND** the queue worker MUST NOT remain stuck on a failed in-flight slot

#### Scenario: Coordinator restart drops queued jobs

- **WHEN** the coordinator process is restarted (or the queue is explicitly
  drained for test / shutdown purposes)
- **THEN** every job that was in `queued_for_conversion` state SHALL be marked
  `status="dropped_on_restart"`
- **AND** subsequent `GET /api/external/ifc-ready/:jobId` responses SHALL show
  this `dropped_on_restart` lifecycle
- **AND** operators SHALL be expected to re-submit those IFC-ready POSTs
  (documented in the runbook)
- **AND** in-flight jobs (mid-dispatch) MAY still complete naturally; this
  scenario only covers the queued-but-not-yet-dispatched set

#### Scenario: Single-job happy path is unchanged

- **WHEN** a single `POST /api/external/ifc-ready` arrives with no other jobs
  in flight or queued
- **THEN** the resulting end state SHALL match the pre-queue behavior:
  `status="dispatched"` with a `conversion_job_id`, optional
  `conversion_status` from streaming-server, and no positive `queue_position`
- **AND** existing happy-path smoke (e.g. `scripts/smoke-bscheme-intake.ps1`)
  SHALL continue to pass without modification

#### Scenario: Queue does not delay HTTP response

- **WHEN** any `POST /api/external/ifc-ready` is enqueued for dispatch
- **THEN** the HTTP response SHALL still return `202 Accepted` immediately
  after the local IFC download stage completes
- **AND** the response MUST NOT block on the streaming-server dispatch
- **AND** `GET /api/external/ifc-ready/:jobId` SHALL be the supported way for
  clients to observe the eventual queue / dispatch progression

#### Scenario: governed job 在 coordinator restart 後可恢復

- **WHEN** coordinator 在 governed pipeline job 處於 `WAITING_CAPACITY` 或 publication 中途時重啟
- **THEN** 該 job SHALL 由 durable state 恢復並重新進入 runtime admission
- **AND** 它 MUST NOT 被標為 `dropped_on_restart`，也 MUST NOT 要求 operator 重送 intake
- **AND** legacy `POST /api/external/ifc-ready` 佇列的既有 `dropped_on_restart` 行為 SHALL 不變

### Requirement: coordinator SHALL 對外曝光單一權威轉檔生命週期狀態 conversion_lifecycle_status

`summarizeIfcReadyJob` SHALL additive 輸出 `conversion_lifecycle_status`，其值由單一純函式 `deriveLifecycleStatus(job)` 依凍結映射導出，並 SHALL 重用既有 `ConversionLedgerStatus`（`detected|queued|converting|ready|failed`）型別、SHALL NOT 在 job 端另宣告同名 enum。映射 SHALL 為：`status` ∈ {failed, dispatch_failed, dropped_on_restart} 或 `download_status==="failed"` → `failed`；`conversion_status==="ready"` → `ready`；`status==="dispatched"` → `converting`；`status==="queued_for_conversion"` → `queued`；其餘 → `detected`。轉檔權威落地前 SHALL NOT 出現 `ready`（誠實）。既有 26 欄輸出 SHALL 逐字保留。

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：本欄位的「單一權威」範圍 SHALL 限於 `summarizeIfcReadyJob` 對外曝光的 **legacy ifc-ready job**。它 MUST NOT 被當成 governed lineage 的狀態權威：governed pipeline job／attempt／formal result 的狀態由 `conversion-attempt-publication` 擁有的三個正交軸（`attempt_outcome`、`publication_state`、`selection_state`）與 `conversion-runtime-admission` 的 `admission_status`／`WAITING_CAPACITY` 決定。系統 MUST NOT 把這三軸壓縮成本欄位，MUST NOT 由本欄位的 `ready` 推導 governed `AVAILABLE`、active result 或 cloud publication 資格，也 MUST NOT 由 governed `AVAILABLE` 反向改寫本欄位的凍結映射。上述五值映射、`ConversionLedgerStatus` 型別重用與 26 欄輸出 SHALL 逐字不變。

#### Scenario: 派工中 job 的生命週期狀態為 converting、未派工為 detected

- **WHEN** 一筆 job `status==="dispatched"` 且 `conversion_status!=="ready"`
- **THEN** `summarizeIfcReadyJob` 輸出的 `conversion_lifecycle_status` SHALL 為 `converting`
- **AND** 當 job 為剛 accepted（未進佇列）時 SHALL 為 `detected`

#### Scenario: governed 三軸狀態不得壓縮成 conversion_lifecycle_status

- **WHEN** 一筆 governed pipeline job 的 attempt 具 `attempt_outcome="succeeded_with_warnings"` 且 `publication_state="AVAILABLE"`
- **THEN** 系統 SHALL 分開曝光三個正交軸與 admission state，MUST NOT 只以 `conversion_lifecycle_status="ready"` 代表
- **AND** `conversion_lifecycle_status` 的值 MUST NOT 被用來裁決 formal `AVAILABLE`、active-result selection 或 cloud publication 資格

### Requirement: coordinator SHALL 提供手動觸發 MinIO 物件進入轉檔的端點

`POST /api/conversion/trigger` SHALL 接受 `{ key }`（MinIO object key），守門 SHALL 比照既有 `/api/conversion/*` 控制路由（`rejectIfIpNotAllowed`）。MinIO 未設定（endpoint/bucket/credentials 不齊全）SHALL 回 503。`key` 缺、含 `|`、超過 1024 bytes、或經 `deriveIntakeFromKey` 判不合法 SHALL 回 400。合法時 coordinator SHALL 於 server-side 產生 presigned GET URL（簽章 SHALL NOT 外洩瀏覽器）、重用 watcher `idempotencyKeyFor`/`correlationIdFor` 導出冪等鍵、self-POST loopback `/api/external/ifc-ready`（帶 webhook secret 與 `AbortSignal.timeout`）。同 key 重觸發 SHALL 回既有 job。回應 SHALL NOT 夾帶 presigned 簽章。

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：`POST /api/conversion/trigger` SHALL 維持 legacy 手動觸發語意 —— 以 MinIO object key self-POST legacy `POST /api/external/ifc-ready`，MUST NOT 產生 governed `READY`、`source_bundle_id` 或 `pipeline_job_id`。Governed 的手動觸發、prioritize、cancel 與 retry SHALL 走 `conversion-runtime-admission` 的同一 admission 路徑，並由 `lineage-governance-console` 的 external capability decision 授權（`conversion.trigger`／`conversion.prioritize`／`conversion.cancel`／`conversion.retry`）；MUST NOT 以本端點繞過 admission、capability decision 或 audit。

#### Scenario: 合法 key 觸發進入轉檔佇列、不洩漏簽章

- **WHEN** operator POST `/api/conversion/trigger` 帶一個 ≥3 段、不含 `|`、長度 ≤1024 的合法 MinIO object key（MinIO 已設定）
- **THEN** coordinator SHALL 回 200/202 含 `ifc_ready_job_id`
- **AND** response body SHALL NOT 含 `X-Amz-Signature`

#### Scenario: 不合法 key 被擋

- **WHEN** POST `/api/conversion/trigger` 的 key 缺、含 `|`、超過 1024 bytes、或去 prefix/suffix 後少於三段
- **THEN** coordinator SHALL 回 400 且 SHALL NOT 觸發 self-POST intake

#### Scenario: legacy 手動觸發不得繞過 governed admission

- **WHEN** operator 對一個已屬於 governed source bundle 的 version 使用 `POST /api/conversion/trigger`
- **THEN** 產生的 SHALL 仍只是 legacy intake job
- **AND** 它 MUST NOT 建立或推進 governed `pipeline_job_id`
- **AND** 它 MUST NOT 繞過 runtime admission 與 external capability decision
