## ADDED Requirements

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

Coordinator SHALL ingest the host-native conversion result through polling, an internal result loop, or an equivalent internal callback. A ready conversion result SHALL be transformed into the existing metadata-only `conversion_result_ready` callback outbox entry; a failed result SHALL become `conversion_failed`. Callback delivery state SHALL remain separate from conversion success.

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
