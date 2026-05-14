# worker-rvt-ifc-bridge Specification

## ADDED Requirements

### Requirement: `_worker` exports RVT to IFC and does not own USDC conversion jobs

`_worker` SHALL act as a Dockerized RVT→IFC bridge. It SHALL receive `rvt_uploaded` events from `_bim-control`, queue export work, produce an IFC artifact or a blocked/failed result, and notify `bim-streaming-server` with `ifc_ready`. Under B 方案, `_worker` SHALL NOT own IFC→USDC conversion jobs and SHALL NOT mark `model.usdc` ready.

#### Scenario: Worker queues RVT export

- **WHEN** `_worker` receives a valid `rvt_uploaded` event
- **THEN** it creates an export job with status `queued`
- **AND** the job records `correlation_id`, `source_rvt_artifact_id`, target `ifc`, and callback/handoff targets

#### Scenario: Worker produces IFC-ready handoff

- **WHEN** RVT→IFC export succeeds
- **THEN** `_worker` records an IFC artifact with `format="ifc"`
- **AND** it sends `ifc_ready` to `bim-streaming-server` with the IFC artifact URL/reference
- **AND** it does not create or update a USDC conversion job

#### Scenario: Worker has no Revit runtime

- **WHEN** real Revit export prerequisites are missing
- **THEN** `_worker` classifies RVT→IFC as `blocked` unless fake fixture mode is explicitly enabled
- **AND** the evidence records the missing prerequisite instead of fabricating an IFC export

### Requirement: `_worker` fake fixture mode is explicit

For local non-Revit validation, `_worker` MAY expose a fake fixture mode that maps a demo RVT artifact to an existing IFC fixture. This mode MUST be marked as fake fixture mode in evidence and lineage.

#### Scenario: Fake fixture mode emits clear lineage

- **WHEN** fake fixture mode is enabled and an IFC fixture is used
- **THEN** `_worker` records `export_mode="fake_fixture"`
- **AND** lineage records the RVT source artifact, IFC fixture artifact, and the fact that no real Revit export occurred

#### Scenario: Production-like mode rejects fake export

- **WHEN** fake fixture mode is disabled
- **THEN** `_worker` MUST NOT use fixture IFC output for a real RVT upload
- **AND** it returns `blocked` or `failed` when real export cannot run
