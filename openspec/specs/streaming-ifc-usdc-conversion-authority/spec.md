# streaming-ifc-usdc-conversion-authority Specification

## Purpose
TBD - created by archiving change architecture-rework-2026-05-14. Update Purpose after archive.
## Requirements
### Requirement: `bim-streaming-server` owns IFC→USDC conversion jobs under B 方案

`bim-streaming-server` SHALL remain the authority for IFC→USDC conversion jobs as an internal conversion engine. When the primary Kit/HOOPS converter cannot import a source IFC but the source IFC is locally readable and parseable by an approved host-native IFC parser, `bim-streaming-server` SHALL attempt a real geometry fallback conversion within the same conversion authority boundary before publishing a terminal failed result. The fallback MUST produce a real OpenUSD/USDC stage and the required sidecars; it MUST NOT publish placeholder USDC, fake mapping, or smoke-only artifacts as ready.

#### Scenario: HOOPS import failure falls back to real OpenUSD conversion

- **WHEN** a valid internal conversion request points to a local IFC that has been downloaded by `bim-review-coordinator`
- **AND** the primary Kit/HOOPS conversion fails with an IFC import failure such as `A3D_LOAD_CANNOT_LOAD_MODEL`
- **AND** the IFC can be parsed and tessellated by the host-native fallback converter
- **THEN** `bim-streaming-server` attempts fallback conversion under the same `conversion_job_id`
- **AND** the final result returns `ready=true`, `model.status="ready"`, and a `model_usdc` artifact ref only if the fallback writes an openable `model.usdc`
- **AND** the result includes `element_mapping`, `entity_index`, `metadata`, lineage, and quality metrics generated from the real IFC geometry
- **AND** `bim-review-coordinator` can ingest the ready result for local web view handoff and callback outbox metadata

#### Scenario: fallback prerequisites missing remain honest non-ready failures

- **WHEN** the primary converter fails and the fallback parser or OpenUSD runtime is unavailable
- **THEN** the conversion job records a non-ready failure with actionable diagnostics
- **AND** `bim-streaming-server` MUST NOT mark `model.status="ready"`
- **AND** coordinator/viewer readiness remains non-passed

#### Scenario: fallback output is validated before ready publication

- **WHEN** fallback conversion writes `model.usdc`
- **THEN** `bim-streaming-server` opens the produced stage with USD runtime before publishing the result
- **AND** validates that at least one renderable mesh prim exists
- **AND** validates that required sidecars exist
- **AND** rejects placeholder or fake smoke outputs

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

### Requirement: Streaming conversion authority can run as a host-native service

`bim-streaming-server` SHALL support running its IFC to USDC conversion authority as a host-native service that is separate from the live Kit/WebRTC viewport runtime. The service SHALL remain internal-only and SHALL NOT expose the external IFC-ready intake contract.

#### Scenario: Host-native service preserves streaming ownership

- **WHEN** the host-native conversion service accepts an internal conversion request
- **THEN** the returned job and result identify `authority="bim-streaming-server"`
- **AND** coordinator consumes the result as streaming-owned conversion evidence

#### Scenario: External IFC-ready caller cannot bypass coordinator

- **WHEN** an external IFC Worker needs to report IFC readiness
- **THEN** the supported entry point remains `bim-review-coordinator` `POST /api/external/ifc-ready`
- **AND** the host-native conversion authority service remains an internal API called by coordinator

#### Scenario: Conversion readiness is not WebRTC readiness

- **WHEN** the host-native conversion service successfully produces USDC and mapping artifacts
- **THEN** conversion readiness MAY be classified as passed
- **AND** Kit launcher, WebRTC `49100`, DataChannel stage loading, and browser visual evidence remain separate tiers

### Requirement: Host-native conversion keeps heavy work off the live viewport path

Heavy IFC to USDC conversion SHALL run through the host-native service runner, converter subprocess, or worker lane instead of blocking the live viewport thread. The implementation SHALL keep a clear operational boundary between conversion execution and Kit/WebRTC streaming.

#### Scenario: Live Kit runtime is down while conversion succeeds

- **WHEN** `127.0.0.1:49101` is healthy and `127.0.0.1:49100` is not listening
- **THEN** a conversion API smoke MAY pass
- **AND** WebRTC or viewport smoke MUST remain `blocked` or `not_observed`

#### Scenario: Converter dependency fails

- **WHEN** the converter adapter fails because of missing executable, invalid IFC, missing output, or process failure
- **THEN** the conversion job records a non-ready failure
- **AND** live Kit/WebRTC runtime status is reported separately
