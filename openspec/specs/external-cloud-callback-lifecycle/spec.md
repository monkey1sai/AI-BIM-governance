# external-cloud-callback-lifecycle Specification

## Purpose
TBD - created by archiving change local-coordinator-ifc-ready-intake-boundary. Update Purpose after archive.
## Requirements
### Requirement: Conversion result is reported to company cloud via metadata-only callback

After a local conversion job completes or fails, `bim-review-coordinator` SHALL callback the company cloud `bim-control` with a metadata-only payload. The callback MUST NOT carry `.usdc` or other large model/3D bytes; large artifacts MUST stay on the customer edge.

#### Scenario: Successful conversion callback carries only metadata refs

- **WHEN** a local conversion job succeeds
- **THEN** `bim-review-coordinator` sends `event="conversion_result_ready"` with `tenant_id`, `project_id`, `external_model_version_id`, `conversion_job_id`, `correlation_id`, `status="ready"`, `source_ifc.ref`/`etag`, and `artifacts.{usdc_ref,element_mapping_ref,manifest_ref}` plus `artifact_summary`
- **AND** the payload contains references only, never the `.usdc` body

#### Scenario: Failed conversion callback is explicit

- **WHEN** a local conversion job fails
- **THEN** `bim-review-coordinator` sends `event="conversion_failed"` with `status="failed"`, `reason`, `retryable`, and `correlation_id`

### Requirement: Callback delivery is durable via an outbox with retry and dead-letter

Callback delivery SHALL use a `callback_outbox` with a retry policy and a terminal dead-letter state, and SHALL record callback evidence. A single best-effort call that is dropped on failure is NOT acceptable, because the customer edge may be temporarily unable to reach the company cloud.

#### Scenario: Company cloud temporarily unreachable

- **WHEN** the callback attempt to company cloud `bim-control` fails (network/5xx/timeout)
- **THEN** the callback is retained in `callback_outbox` and retried per policy
- **AND** the local conversion result stays queryable from this repo independent of callback success

#### Scenario: Exhausted retries become dead-letter, not silent loss

- **WHEN** retries are exhausted
- **THEN** the callback enters a `dead_letter` state with recorded evidence (target URL, attempts, last error, `correlation_id`)
- **AND** it is not silently discarded

#### Scenario: Callback status is separate from conversion success

- **WHEN** conversion succeeded but callback has not yet been acknowledged
- **THEN** `conversion_job` status remains `ready` locally
- **AND** `callback_status` is reported as a separate field

