# streaming-ifc-usdc-conversion-authority Specification

## Purpose
TBD - created by archiving change architecture-rework-2026-05-14. Update Purpose after archive.
## Requirements
### Requirement: `bim-streaming-server` owns IFC→USDC conversion jobs under B 方案

`bim-streaming-server` SHALL be the authority for IFC→USDC conversion jobs. It SHALL accept `ifc_ready` handoff from `_worker`, create `conversion_job_id`, manage conversion state, run or orchestrate headless conversion, produce USDC and mapping artifacts, and expose job status/result endpoints.

#### Scenario: ifc_ready creates streaming conversion job

- **WHEN** `_worker` sends a valid `ifc_ready` payload to `bim-streaming-server`
- **THEN** `bim-streaming-server` creates a conversion job
- **AND** the response includes `conversion_job_id`, `status="queued"`, `authority="bim-streaming-server"`, and `correlation_id`

#### Scenario: Conversion result is owned by streaming server

- **WHEN** IFC→USDC conversion succeeds
- **THEN** `bim-streaming-server` result endpoint returns the derived `model.usdc`, `element_mapping.json`, `entity_index.json`, and quality metrics
- **AND** `_worker` MUST NOT be required to answer USDC job status for the same conversion

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
