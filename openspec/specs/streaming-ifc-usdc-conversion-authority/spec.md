# streaming-ifc-usdc-conversion-authority Specification

## Purpose
TBD - created by archiving change architecture-rework-2026-05-14. Update Purpose after archive.
## Requirements
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

### Requirement: Heavy conversion execution does not block live WebRTC runtime

`bim-streaming-server` SHALL keep conversion authority within its service boundary while preventing heavy conversion execution from blocking the live Kit/WebRTC viewport runtime.

#### Scenario: Headless converter process is used

- **WHEN** an IFC conversion job runs
- **THEN** it SHOULD run through a headless converter app, subprocess, or worker lane
- **AND** the live WebRTC endpoint remains separately health-checked

#### Scenario: Live runtime dependency creep is detected

- **WHEN** converter-only dependencies are added to the live streaming Kit app
- **THEN** the change MUST document startup/runtime impact and provide a rollback path
- **AND** demo readiness MUST separately classify conversion readiness and WebRTC readiness

### Requirement: Streaming conversion preserves quality metrics and mapping semantics

`bim-streaming-server` SHALL preserve existing conversion quality semantics when it becomes conversion authority.

#### Scenario: Quality metrics are returned

- **WHEN** conversion completes
- **THEN** result includes `source_ifc_entity_count`, `mapped_count`, `unmapped_count`, `coverage_ratio`, `coverage_status`, `materialization_strategy`, `sidecar_carrier_count`, and `minimum_coverage_baseline_locked`

#### Scenario: Mapping is not fabricated

- **WHEN** IFC element cannot be mapped to a USD prim
- **THEN** the element is listed as unmapped or sidecar-only according to policy
- **AND** fake GUID/prim mapping MUST NOT be generated unless `allow_fake_mapping=true` and the result is clearly marked `fake_for_smoke_test`

#### Scenario: Entity index sidecar is preserved

- **WHEN** sidecar carrier strategy is used
- **THEN** the result includes an `entity_index` artifact identity/URL
- **AND** lineage indicates the sidecar relation between the IFC source, USDC artifact, mapping artifact, and entity index artifact
