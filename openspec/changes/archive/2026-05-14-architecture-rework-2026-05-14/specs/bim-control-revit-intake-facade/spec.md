# bim-control-revit-intake-facade Specification

## ADDED Requirements

### Requirement: `_bim-control` provides fake Revit/RVT intake without running Revit

`_bim-control` SHALL provide a fake Revit Plugin / RVT intake facade for local demo and architecture validation. It SHALL accept `.rvt` bytes or a signed/local upload reference, create source artifact metadata, and emit a `rvt_uploaded` event to `_worker`. It SHALL NOT execute Revit, consume a Revit license, export IFC, or perform IFC→USDC conversion.

#### Scenario: RVT upload creates source artifact metadata

- **WHEN** a client submits a fake RVT upload or upload reference
- **THEN** `_bim-control` records `project_id`, `model_version_id`, `source_artifact_id`, `format="rvt"`, filename, URL/reference, checksum when available, and intake status
- **AND** the record is queryable by project and model version

#### Scenario: Intake emits rvt_uploaded event

- **WHEN** source artifact metadata is accepted
- **THEN** `_bim-control` emits or exposes a `rvt_uploaded` event payload for `_worker`
- **AND** the payload includes `event_id`, `correlation_id`, `project_id`, `model_version_id`, source artifact fields, requested output `ifc`, and callback URL

#### Scenario: Revit runtime is not present

- **WHEN** local demo runs without Revit installed or licensed
- **THEN** `_bim-control` still accepts fake RVT intake metadata
- **AND** downstream export readiness is classified as `blocked` or handled by `_worker` fake fixture mode, not by pretending Revit export succeeded

### Requirement: RVT intake is idempotent and traceable

`_bim-control` SHALL support idempotency for repeated RVT upload/intake events so duplicate submissions do not create conflicting source artifacts.

#### Scenario: Duplicate intake with same idempotency key

- **WHEN** two RVT intake requests carry the same idempotency key and compatible payload
- **THEN** `_bim-control` returns the same source artifact identity
- **AND** it MUST NOT create a second active source artifact for the same model version unless explicitly forced

#### Scenario: Duplicate intake with conflicting payload

- **WHEN** the idempotency key is reused with a different filename, checksum, or source reference
- **THEN** `_bim-control` returns an error or blocked state
- **AND** the error includes enough information for the caller to correct or force a new version
