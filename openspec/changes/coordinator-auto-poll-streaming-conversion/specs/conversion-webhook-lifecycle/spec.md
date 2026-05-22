# conversion-webhook-lifecycle — Spec Delta (coordinator-auto-poll-streaming-conversion)

> Delta against `openspec/specs/conversion-webhook-lifecycle/spec.md`(本檔僅含本 change 的差異)。本 change 補實既有 `Coordinator ingests host-native conversion result into callback outbox` requirement 內已寫的「through polling, an internal result loop, or an equivalent internal callback」但 polling / internal result loop **皆未實作**的 gap。預設 dispatch 成功後 coordinator 自動 poll streaming-server,不需要外部手動觸發 internal ingest endpoint。

## MODIFIED Requirements

### Requirement: Coordinator ingests host-native conversion result into callback outbox

Coordinator SHALL ingest the host-native conversion result through polling, an internal result loop, or an equivalent internal callback. **A successful dispatch to `bim-streaming-server` SHALL automatically schedule an in-process polling task that periodically fetches `GET /api/conversions/<conversion_job_id>/result` until the result reaches a terminal state(`status` ∈ {`succeeded`, `succeeded_with_warnings`, `failed`, `cancelled`} or `model_status` ∈ {`ready`, `failed`}),then runs the same ingestion path as the manual `POST /api/internal/conversions/<id>/ingest` endpoint(callback outbox enqueue + local review session handoff per existing requirements).** Polling cadence and max attempts SHALL be configurable via env(`CONVERSION_POLL_INTERVAL_SECONDS` default `5`,`CONVERSION_POLL_MAX_ATTEMPTS` default `60`= 5 分鐘 ceiling);env `CONVERSION_POLL_ENABLED=false` MAY disable auto-poll for test fixtures while keeping the manual endpoint functional. A ready conversion result SHALL be transformed into the existing metadata-only `conversion_result_ready` callback outbox entry; a failed result SHALL become `conversion_failed`. Callback delivery state SHALL remain separate from conversion success. The same conversion_job_id MUST NOT spawn duplicate concurrent pollers; the manual ingest endpoint MUST cancel any active poller for that conversion_job_id before running ingestion to prevent double-delivery.

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
