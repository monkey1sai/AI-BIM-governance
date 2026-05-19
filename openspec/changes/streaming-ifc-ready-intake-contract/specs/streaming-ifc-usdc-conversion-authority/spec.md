## MODIFIED Requirements

### Requirement: `bim-streaming-server` owns IFC→USDC conversion jobs under B 方案

`bim-streaming-server` SHALL be the authority for IFC→USDC conversion jobs as an internal conversion engine. It SHALL accept an internal conversion request from `bim-review-coordinator` (not an external `ifc_ready` handoff and not from `_worker`), create `conversion_job_id`, manage conversion state, run or orchestrate headless conversion, produce USDC and mapping artifacts, and expose internal job status/result endpoints. It SHALL NOT expose an external IFC-ready entry point. The internal conversion API `POST /api/conversions/ifc-to-usdc` SHALL support configured service-token authentication, idempotent replay, and explicit 4xx request rejection without changing the IFC→USDC conversion core.

#### Scenario: Internal conversion request creates streaming conversion job

- **WHEN** `bim-review-coordinator` sends a valid internal conversion request to `bim-streaming-server`
- **THEN** `bim-streaming-server` creates a conversion job
- **AND** the response includes `conversion_job_id`, `status="queued"`, `authority="bim-streaming-server"`, and `correlation_id`

#### Scenario: Authenticated internal request is required when configured

- **WHEN** `bim-streaming-server` is configured with an internal conversion token
- **THEN** `POST /api/conversions/ifc-to-usdc` MUST require `X-Internal-Conversion-Token`
- **AND** a missing token returns 401 without creating a conversion job
- **AND** an invalid token returns 403 without creating a conversion job

#### Scenario: Duplicate internal request is idempotent

- **WHEN** `bim-review-coordinator` retries the same internal conversion request with the same `idempotency_key` and compatible payload
- **THEN** `bim-streaming-server` returns the existing conversion job
- **AND** it MUST NOT create a second active conversion job for the same retry

#### Scenario: Conflicting idempotency key is rejected

- **WHEN** `bim-review-coordinator` reuses an already accepted `idempotency_key` with a different request fingerprint
- **THEN** `bim-streaming-server` returns 409
- **AND** it MUST NOT create a new conversion job

#### Scenario: Invalid internal request is rejected

- **WHEN** the request is not an `ifc_ready`-shaped internal conversion request or is missing required IFC artifact fields
- **THEN** `bim-streaming-server` returns 400
- **AND** it MUST NOT create a conversion job

#### Scenario: Conversion result is owned by streaming server

- **WHEN** IFC→USDC conversion succeeds
- **THEN** `bim-streaming-server` result endpoint returns the derived `model.usdc`, `element_mapping.json`, `entity_index.json`, and quality metrics
- **AND** `bim-review-coordinator` consumes the result to drive callback and local web view, while `bim-streaming-server` remains the conversion authority

#### Scenario: Conversion job failure is honest

- **WHEN** converter execution fails, USDC is missing, USDC cannot be opened, or mapping generation fails past allowed policy
- **THEN** `bim-streaming-server` marks the job `failed` or `succeeded_with_warnings` only when explicitly allowed
- **AND** it MUST NOT publish `model.status="ready"` for a placeholder or missing model
