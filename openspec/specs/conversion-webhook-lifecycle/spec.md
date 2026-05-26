# conversion-webhook-lifecycle Specification

## Purpose
TBD - created by archiving change architecture-rework-2026-05-14. Update Purpose after archive.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` ADD 1 個 requirement `Coordinator dispatch payload carries local path references`(coordinator → streaming-server dispatch 加 `local_path` / `host_local_path`,streaming-server 優先用 host path 讀 shared volume,fallback 到 `source_ifc_ref` URL),並對既有 `Conversion result callback carries ready artifact references back to coordinator` requirement 加 implementation status note(ready 分支已擴充為 `setViewerLink`)。完整 ADD scenario 見 `openspec/changes/archive/2026-05-21-fast-ifc-link-demo-loop/specs/conversion-webhook-lifecycle/spec.md`。實作:`bim-review-coordinator/src/services/streamingConversionClient.ts` `toInternalIfcReadyEvent` payload + `ingestConversionReport` ready 分支 `setViewerLink`。
>
> **Implementation status (2026-05-22 fast-mvp loop, hotfix bundle)**: PR #94 / #95 補 coordinator host-native `storageRoot` default fallback 與 `compose.runtime-manager.yml` coordinator service `STORAGE_ROOT` / `STORAGE_HOST_ROOT` env(IFC bytes 真實落到 shared volume mount destination)。change `streaming-server-prefer-local-ifc-path` 補實 fast-ifc-link-demo-loop 已宣告但 streaming-server 端未實作的 consumer 行為:ADD 1 個 requirement `Streaming-server consumes shared-volume local IFC path before url fetch`,streaming-server `_resolve_local_ifc` 新解析順序 `host_local_path` → `local_path` → 既有 url fallback,並加 `STORAGE_ROOT` sandboxing 防 path traversal。實作:`bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py` `_ifc_artifact` propagate + `ifc2usdc_powershell_adapter.py` `Ifc2UsdcPowershellConverterAdapter._resolve_local_ifc` / `_try_local_path`。
## Requirements
### Requirement: Conversion handoff uses correlation IDs and idempotent events

The architecture SHALL use event IDs and correlation IDs across the external customer-edge IFC Worker, `bim-review-coordinator`, and `bim-streaming-server` so external IFC-ready intake, internal IFC→USDC conversion, and company-cloud callback can be traced and retried safely. The external `ifc_ready` source SHALL be the customer-edge IFC Worker and the external entry point SHALL be `bim-review-coordinator` `POST /api/external/ifc-ready`; `bim-streaming-server` SHALL only receive internal conversion requests. When the worker sends the compatibility payload (`status`, `ifc_path`, `project_id`, `version`, `task_id`) instead of the canonical payload, `bim-review-coordinator` SHALL derive the missing correlation and idempotency values at the intake boundary and SHALL preserve those values through internal conversion and callback evidence.

#### Scenario: End-to-end correlation is preserved

- **WHEN** the customer-edge IFC Worker calls `POST /api/external/ifc-ready` on `bim-review-coordinator`
- **THEN** `bim-review-coordinator` creates or propagates `correlation_id`
- **AND** `bim-streaming-server` (internal conversion) and the company-cloud callback preserve the same correlation ID in job records, callbacks, and evidence

#### Scenario: Worker task id becomes traceable fallback

- **WHEN** the worker compatibility payload supplies `task_id` but no explicit correlation or idempotency key
- **THEN** `bim-review-coordinator` derives stable retry metadata from `project_id`, `version`, and `task_id`
- **AND** the derived values are visible on the local IFC-ready job, internal conversion request, and later callback evidence

#### Scenario: Duplicate ifc_ready event is idempotent

- **WHEN** the customer-edge IFC Worker retries the same `ifc_ready` event to `bim-review-coordinator`
- **THEN** `bim-review-coordinator` returns the existing local conversion job if payload is compatible
- **AND** it does not create duplicate active conversion jobs for the same IFC artifact unless forced

#### Scenario: Worker compatibility payload enters internal conversion exactly once

- **WHEN** the worker posts the same compatible `project_id`, `version`, `task_id`, and `ifc_path` more than once
- **THEN** only the first accepted request dispatches a new internal conversion request
- **AND** later compatible retries return the existing local job state

### Requirement: Webhook failures are observable and retryable

Webhook delivery failures SHALL be reported as explicit job or event states, not silent missing artifacts.

#### Scenario: Worker cannot reach streaming server

- **WHEN** `_worker` cannot deliver `ifc_ready`
- **THEN** the export job remains `ifc_ready_pending_delivery` or equivalent
- **AND** evidence records the target URL, retry count, and next retry command or action

#### Scenario: Streaming server cannot callback bim-control

- **WHEN** conversion completes but `_bim-control` callback fails
- **THEN** conversion job remains queryable from `bim-streaming-server`
- **AND** callback status is reported separately from conversion success

### Requirement: Failed upstream stages do not create downstream success

A failed or blocked RVT→IFC export SHALL NOT create a streaming conversion job. A failed streaming conversion job SHALL NOT create a ready review artifact. For the worker compatibility payload, only `status="ifc_ready"` SHALL be treated as a completed upstream IFC export; all other worker statuses MUST be rejected or handled as non-ready upstream states without dispatching internal conversion.

#### Scenario: RVT export blocked

- **WHEN** the customer-edge IFC Worker classifies RVT→IFC as blocked or not ready
- **THEN** it MUST NOT create a downstream ready artifact
- **AND** `bim-review-coordinator` MUST NOT dispatch internal IFC→USDC conversion from a non-`ifc_ready` worker status

#### Scenario: IFC conversion failed

- **WHEN** `bim-streaming-server` marks conversion failed
- **THEN** company-cloud callback metadata reports `failed` or equivalent not-ready state
- **AND** coordinator/viewer do not present the model as openable

### Requirement: Coordinator dispatches IFC-ready intake to the host-native conversion service

After `bim-review-coordinator` accepts a valid external IFC-ready request, it SHALL dispatch an internal conversion request to `STREAMING_CONVERSION_API_BASE`, defaulting to `http://127.0.0.1:49101`. Dispatch failure SHALL be observable and retryable, and SHALL NOT invalidate the already accepted external intake job.

#### Scenario: Accepted intake creates dispatch record

- **WHEN** the customer-edge IFC Worker calls `POST /api/external/ifc-ready` with a valid payload and service auth
- **THEN** coordinator stores the local IFC-ready job and external model version binding
- **AND** coordinator attempts to create a streaming conversion job at `STREAMING_CONVERSION_API_BASE`
- **AND** the local job records the returned `conversion_job_id` when dispatch succeeds

#### Scenario: Conversion service is unavailable

- **WHEN** coordinator accepts IFC-ready intake but cannot reach `127.0.0.1:49101`
- **THEN** the IFC-ready job records `dispatch_failed` or equivalent retryable state
- **AND** downstream callback and viewer readiness remain non-ready
- **AND** the failure evidence includes the target URL and diagnostic

### Requirement: Coordinator ingests host-native conversion result into callback outbox

Coordinator SHALL ingest the host-native conversion result through polling, an internal result loop, or an equivalent internal callback. **A successful dispatch to `bim-streaming-server` SHALL automatically schedule an in-process polling task that periodically fetches `GET /api/conversions/<conversion_job_id>/result` until the result reaches a terminal state(`status` ∈ {`succeeded`, `succeeded_with_warnings`, `failed`, `cancelled`} or `model_status` ∈ {`ready`, `failed`}),then runs the same ingestion path as the manual `POST /api/internal/conversions/<id>/ingest` endpoint(callback outbox enqueue + local review session handoff per existing requirements).** Polling cadence and max attempts SHALL be configurable via env(`CONVERSION_POLL_INTERVAL_SECONDS` default `5`,`CONVERSION_POLL_MAX_ATTEMPTS` default `60`= 5 分鐘 ceiling);env `CONVERSION_POLL_ENABLED=false` MAY disable auto-poll for test fixtures while keeping the manual endpoint functional. A ready conversion result SHALL be transformed into the existing metadata-only `conversion_result_ready` callback outbox entry; a failed result SHALL become `conversion_failed`. Callback delivery state SHALL remain separate from conversion success. The same conversion_job_id MUST NOT spawn duplicate concurrent pollers; the manual ingest endpoint MUST cancel any active poller for that conversion_job_id before running ingestion to prevent double-delivery.

> **Implementation status (2026-05-22)**:auto-poll 由 archive `2026-05-22-coordinator-auto-poll-streaming-conversion` 實作。`bim-review-coordinator/src/services/streamingConversionClient.ts` 加 `pollConversionResult` + `isTerminalConversionResult` helper;`bim-review-coordinator/src/app.ts` 加 `pollerRegistry` + `schedulePollerForConversion` + refactor `ingestStreamingConversionResult` 共用 manual / auto-poll 兩條 path;`CoordinatorApp.dispose()` 清空所有 poller。L4 真實 runtime 驗證(2026-05-22):dispatch → 40 秒內 viewer_url 自動出現,無需 manual POST ingest。

#### Scenario: Ready result creates metadata-only callback

- **WHEN** `GET /api/conversions/{conversion_job_id}/result` reports `model.status="ready"` with artifact refs
- **THEN** coordinator records the local conversion job as ready
- **AND** coordinator enqueues a `conversion_result_ready` callback containing metadata refs only
- **AND** the callback payload MUST NOT include `.usdc`, `.ifc`, `.rvt`, or other large file bodies

#### Scenario: Failed result creates failed callback

- **WHEN** the host-native conversion result reports failure
- **THEN** coordinator records the local conversion job as failed
- **AND** coordinator enqueues or exposes `conversion_failed` with reason and retryable metadata

#### Scenario: Cloud callback is unreachable after conversion succeeds

- **WHEN** conversion succeeds but the company-cloud callback target is unavailable or OQ1 remains pending
- **THEN** conversion success remains queryable locally
- **AND** callback outbox records pending, retry, or dead-letter delivery state separately

#### Scenario: Dispatch auto-schedules a poller that drives ingestion to terminal

- **WHEN** coordinator returns 202 from `POST /api/external/ifc-ready` with a dispatched `conversion_job_id` and `CONVERSION_POLL_ENABLED` is unset or `true`
- **THEN** coordinator schedules an in-process polling task keyed by that `conversion_job_id`
- **AND** the polling task fetches `GET /api/conversions/<id>/result` every `CONVERSION_POLL_INTERVAL_SECONDS`
- **AND** when the result reaches a terminal state the polling task triggers the same ingestion path as the manual endpoint(callback outbox + local session handoff per existing requirements)
- **AND** the polling task de-registers itself after terminal ingestion or after `CONVERSION_POLL_MAX_ATTEMPTS` poll-timeout

#### Scenario: Auto-poll de-duplicates with manual ingest endpoint

- **WHEN** a poller is active for `conversion_job_id` and the operator(or other internal caller)POSTs `/api/internal/conversions/<conversion_job_id>/ingest` with a valid internal token
- **THEN** coordinator cancels and de-registers the auto-poller for that `conversion_job_id`
- **AND** the manual ingest path runs exactly once
- **AND** no duplicate `conversion_result_ready` / `conversion_failed` callback is enqueued for the same `conversion_job_id`

#### Scenario: Poll timeout yields a failed-equivalent terminal state

- **WHEN** the auto-poller reaches `CONVERSION_POLL_MAX_ATTEMPTS` without observing a terminal result from `bim-streaming-server`
- **THEN** coordinator treats the local conversion job as terminally failed with reason `poll_timeout`
- **AND** the manual ingest endpoint MAY still be invoked later to re-ingest if the streaming-server eventually reaches terminal

### Requirement: Terminal conversion-ready ingestion triggers local review session handoff

When `bim-review-coordinator` conversion ingestion reaches a terminal `ready` state for a correlated IFC-ready job, the coordinator SHALL trigger local review session creation or activation separately from, and in parallel with, the metadata-only callback outbox. Callback outbox delivery state and local session handoff state SHALL remain independently classified: a pending or dead-letter cloud callback MUST NOT block the local session handoff, and a successful local session handoff MUST NOT be reported as cloud callback success. A terminal `failed` conversion MUST NOT create an openable or streamable local review session. Review session creation, binding, idempotency, and lifecycle details are governed by `review-session-request-lifecycle`; this requirement only fixes the seam that terminal `ready` ingestion is what triggers that handoff in the B-scheme runtime.

> **Implementation status (2026-05-21)**: this requirement was ratified by archive `2026-05-21-coordinator-ifc-ready-worker-webhook` but the seam was never wired in `ingestConversionReport` (`bim-review-coordinator/src/app.ts:566-628`); only `callbackOutbox.enqueue` ran on terminal `ready` (retro-audit commit `a32fcd6`). Change `backfill-coordinator-webhook-and-auto-session` backfills the in-process trigger so the outbox and the local session handoff both run on terminal `ready` with independently classified status. See its `tasks.md` for the scenario-to-test mapping.

#### Scenario: Ready ingestion triggers session handoff alongside callback outbox

- **WHEN** coordinator conversion ingestion reaches terminal `ready` for a correlated IFC-ready job
- **THEN** the coordinator enqueues the metadata-only cloud callback in the outbox
- **AND** in parallel triggers local review session creation or activation for that correlation
- **AND** the two outcomes are reported as independently classified states

#### Scenario: Pending cloud callback does not block local session handoff

- **WHEN** the metadata-only cloud callback is `pending` or moved to dead-letter because the company-cloud endpoint is unavailable
- **THEN** the local review session handoff still proceeds for a terminal `ready` conversion
- **AND** the local session is not reported as cloud callback success

#### Scenario: Failed conversion creates no local session

- **WHEN** coordinator conversion ingestion reaches terminal `failed`
- **THEN** the coordinator MUST NOT create an openable or streamable local review session
- **AND** the callback metadata reports `failed` or an equivalent not-ready state

### Requirement: Coordinator dispatch payload carries local path references

`bim-review-coordinator` SHALL, when dispatching a conversion request to `bim-streaming-server` after a synchronous IFC download(see `local-coordinator-ifc-ready-intake-boundary` change `fast-ifc-link-demo-loop`),include both:

- `local_path`: container-view absolute path of the downloaded IFC inside coordinator's mounted shared volume(e.g. `/workspace/storage/ifc-cache/<ifc_ready_job_id>/source.ifc`)
- `host_local_path`: host-view absolute path of the same file(e.g. `C:\Repos\active\iot\AI-BIM-governance\storage\ifc-cache\<ifc_ready_job_id>\source.ifc`)

`bim-streaming-server` SHALL prefer `host_local_path` when present, fall back to translating `local_path` through `STORAGE_HOST_ROOT` env, and use the existing `source_ifc_ref`(URL form)only as a last-resort fallback. The legacy URL-only fallback MUST remain functional so that callers without the shared volume(test fakes, non-Docker setups)still work.

> **Implementation status (2026-05-21)**:dispatch payload schema added by archive `2026-05-21-fast-ifc-link-demo-loop`。streaming-server consumer 行為由 archive `2026-05-22-streaming-server-prefer-local-ifc-path` 補實(see also `Streaming-server consumes shared-volume local IFC path before url fetch` requirement)。

#### Scenario: Streaming-server reads from shared volume via host_local_path

- **WHEN** coordinator dispatches `POST /api/conversions` with `{ ifc_ready_job_id, local_path:"/workspace/storage/ifc-cache/<jobId>/source.ifc", host_local_path:"C:\\...\\storage\\ifc-cache\\<jobId>\\source.ifc", source_ifc_ref }`
- **THEN** `bim-streaming-server` opens the host-local file directly without performing an HTTP GET on `source_ifc_ref`

#### Scenario: Streaming-server falls back to URL when local paths unavailable

- **WHEN** coordinator dispatches a conversion without `local_path` / `host_local_path`(test fake, legacy caller)
- **THEN** `bim-streaming-server` falls back to fetching `source_ifc_ref` over HTTP as before
- **AND** no breaking change is exposed to legacy callers

#### Scenario: Streaming-server validates host path is inside STORAGE_HOST_ROOT

- **WHEN** coordinator dispatches a conversion whose `host_local_path` is outside the configured `STORAGE_HOST_ROOT`
- **THEN** `bim-streaming-server` rejects the request as `403 forbidden_path` and the conversion job is NOT started
- **AND** this protects against path traversal from a misconfigured coordinator

### Requirement: Streaming-server consumes shared-volume local IFC path before url fetch

`bim-streaming-server` SHALL, when receiving a conversion dispatch whose `ifc_artifact` carries `host_local_path` or `local_path`, resolve the IFC source from that local path before falling back to url-based resolution. The resolution order MUST be:

1. `host_local_path`(streaming-server 為 host-native runtime,直接讀 host fs)
2. `local_path`(coordinator 與 streaming-server 共享 fs 時生效,fast MVP host-native streaming-server 場景通常與 `host_local_path` 同值)
3. existing `url` / `file_url` / `signed_upload_reference` parsing(`file://` / `edge-local://` 既有 scheme 不變)

Resolved paths MUST be constrained inside `STORAGE_ROOT`(env,default streaming-server cwd);path 解析後 escape `STORAGE_ROOT` 範圍 MUST raise `invalid_ifc_input` 而不靜默 fallback。Path 在 `STORAGE_ROOT` 之內但檔案不存在 MUST soft fallback 至下一順位來源(不 raise),允許 race condition 期間用 url 重試。Legacy url-only 來源(無 `local_path` / `host_local_path`)MUST 保持 backward compatible。

> **Implementation status (2026-05-22)**:由 archive `2026-05-22-streaming-server-prefer-local-ifc-path` 實作。`bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py` `Ifc2UsdcPowershellConverterAdapter._resolve_local_ifc` 新解析順序 + `_try_local_path` storage_root sandbox helper;`conversion_authority.py` `_ifc_artifact` propagate `local_path` / `host_local_path` 進 job dict 給 lineage / debug 用。

#### Scenario: Streaming-server prefers host_local_path inside storage_root

- **WHEN** coordinator dispatches `POST /api/conversions` with `ifc_artifact.host_local_path` 指向 `${STORAGE_ROOT}/ifc-cache/<jobId>/source.ifc` 且檔案存在可讀
- **THEN** `bim-streaming-server` opens the host-local file directly
- **AND** does NOT attempt to fetch `ifc_artifact.url`
- **AND** the resolved path passes a `relative_to(STORAGE_ROOT)` security check

#### Scenario: Streaming-server falls back to url when local paths missing or unreadable

- **WHEN** dispatch carries `ifc_artifact` without `host_local_path` / `local_path`, or both point to files inside `STORAGE_ROOT` that do not yet exist
- **THEN** `bim-streaming-server` falls back to existing url parsing(`file://` / `edge-local://`)
- **AND** existing fixtures and test doubles that only supply `url` continue to work without behaviour change

#### Scenario: Streaming-server rejects local path outside storage_root

- **WHEN** dispatch carries `ifc_artifact.host_local_path = "/etc/passwd"`(or any resolved path outside `STORAGE_ROOT`)
- **THEN** `bim-streaming-server` raises `invalid_ifc_input` with diagnostic "local IFC path is outside storage_root"
- **AND** the conversion job is NOT started
- **AND** the failure is observable in the conversion result for retry / debug

### Requirement: Coordinator forwards streaming conversion quality summary into review session stream-config

`bim-review-coordinator` SHALL forward streaming conversion `quality_metrics`
into the review session's `quality_metrics_summary` slot whenever the coordinator
auto-ingests a terminal conversion result and creates a review session
(`createReviewSessionFromIngest` path or equivalent internal flow). The
extraction SHALL be best-effort: when the result has no `quality_metrics`
section, the summary SHALL be `null` and session creation MUST NOT be blocked.
The viewer and `/ui` dashboard SHALL receive the populated summary via
`GET /api/review-sessions/:id/stream-config` for tri-ready Semantic calculation.

#### Scenario: Auto ingest copies semantic mapping fidelity to stream-config

- **WHEN** streaming conversion result `quality_metrics` 含
  `semantic_mapping_fidelity` / `mapping_has_ifc_type` / `mapping_has_ifc_name`
  (對應 `streaming-server-fallback-semantic-mapping` 提供的欄位)
- **AND** coordinator 自動 ingest 該結果建立 review session
- **THEN** 後續 `GET /api/review-sessions/<session_id>/stream-config` 回應的
  `quality_metrics_summary` SHALL 包含這三個欄位的 truthy 值
- **AND** viewer `computeSemanticReady` SHALL 對該 session 計算為 `"yes"`
- **AND** `/ui` dashboard tri-ready Semantic badge SHALL 對齊顯示為 `yes`

#### Scenario: Auto ingest preserves existing summary fields

- **WHEN** streaming conversion result `quality_metrics` 含既有欄位
  `source_ifc_entity_count` / `sidecar_carrier_count` / `materialization_strategy`
  / `coverage_ratio` / `coverage_status` / `phase_timings.conversion_total.duration_seconds`
  / `original_filename` / `artifact_group_id`
- **THEN** 萃取的 `quality_metrics_summary` SHALL 把這些值對應到原既有 schema
  欄位(`source_ifc_entity_count` / `sidecar_carrier_count` /
  `materialization_strategy` / `coverage_ratio` / `coverage_status` /
  `conversion_duration_seconds` / `fixture_name` / `artifact_group_id`)
- **AND** missing 欄位 SHALL 填 `null`,不為 `undefined`,維持 JSON schema 穩定

#### Scenario: Missing quality_metrics keeps summary null

- **WHEN** streaming conversion result 沒有 `quality_metrics` 區段(舊版
  streaming server 或非 ready terminal 結果)
- **THEN** session 建立 SHALL 仍成功且 `quality_metrics_summary` 為 `null`
- **AND** viewer / `/ui` 對 null summary 仍按 C2 / C3 既有規則計算 Semantic ready
  為 `no`(不偽宣告)

#### Scenario: Explicit POST /api/review-sessions path is unchanged

- **WHEN** external caller 透過 `POST /api/review-sessions` 主動建立 session
  並帶 `quality_metrics_summary` 在 body
- **THEN** coordinator SHALL 按照 caller 提供的值寫入 store(既有行為,不被
  本 change 蓋掉)
- **AND** 本 change 的 auto ingest 萃取 SHALL 只在 auto path 觸發,不影響
  explicit caller path

#### Scenario: Coordinator types.ts schema is additive

- **WHEN** coordinator `ConversionQualityMetricsSummary` 介面被擴充以加入
  C1 新欄位
- **THEN** 既有 caller(包含外部 explicit POST / 既有 archived test fixture)
  使用舊 schema(無 `semantic_mapping_fidelity` 等)時 SHALL 仍能通過 zod
  schema parse 與 store create
- **AND** 新欄位 SHALL 是 optional(`?: string | null` / `?: boolean | null`)

