# conversion-webhook-lifecycle Specification

## Purpose
TBD - created by archiving change architecture-rework-2026-05-14. Update Purpose after archive.
## Requirements
### Requirement: Conversion handoff uses correlation IDs and idempotent events

The architecture SHALL use event IDs and correlation IDs across the external customer-edge IFC Worker, `bim-review-coordinator`, and `bim-streaming-server` so external IFC-ready intake, internal IFC→USDC conversion, and company-cloud callback can be traced and retried safely. The external `ifc_ready` source SHALL be the customer-edge IFC Worker and the external entry point SHALL be `bim-review-coordinator` `POST /api/external/ifc-ready`; `bim-streaming-server` SHALL only receive internal conversion requests.

#### Scenario: End-to-end correlation is preserved

- **WHEN** the customer-edge IFC Worker calls `POST /api/external/ifc-ready` on `bim-review-coordinator`
- **THEN** `bim-review-coordinator` creates or propagates `correlation_id`
- **AND** `bim-streaming-server` (internal conversion) and the company-cloud callback preserve the same correlation ID in job records, callbacks, and evidence

#### Scenario: Duplicate ifc_ready event is idempotent

- **WHEN** the customer-edge IFC Worker retries the same `ifc_ready` event to `bim-review-coordinator`
- **THEN** `bim-review-coordinator` returns the existing local conversion job if payload is compatible
- **AND** it does not create duplicate active conversion jobs for the same IFC artifact unless forced

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

A failed or blocked RVT→IFC export SHALL NOT create a streaming conversion job. A failed streaming conversion job SHALL NOT create a ready review artifact.

#### Scenario: RVT export blocked

- **WHEN** `_worker` classifies RVT→IFC as blocked
- **THEN** it MUST NOT send `ifc_ready`
- **AND** `bim-streaming-server` MUST NOT create a conversion job from that blocked export

#### Scenario: IFC conversion failed

- **WHEN** `bim-streaming-server` marks conversion failed
- **THEN** `_bim-control` model artifact status is `failed` or `not_ready`
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
