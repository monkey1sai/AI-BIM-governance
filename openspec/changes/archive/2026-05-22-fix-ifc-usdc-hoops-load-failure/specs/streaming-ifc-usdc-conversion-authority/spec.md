# streaming-ifc-usdc-conversion-authority — Spec Delta (fix-ifc-usdc-hoops-load-failure)

> Delta against `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`。本 change 將真實 341MB IFC 在 HOOPS import failure 後仍可透過 streaming-owned fallback conversion 產出可開啟 USD/USDC，作為 archive 前硬性驗收。

## MODIFIED Requirements

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
