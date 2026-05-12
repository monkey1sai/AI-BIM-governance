## ADDED Requirements

### Requirement: Worker exposes artifact lineage graph API

`_worker` SHALL expose `GET /api/artifacts/{artifact_id}/lineage` for source, derived model, index, and mapping artifact identifiers that belong to the worker object layout. The response MUST normalize existing `metadata.json`, source artifact index, artifact group index, conversion job result, and derived artifact identifiers into a single lineage graph without making `_bim-control` read local files or become artifact byte authority.

The lineage response MUST include `artifact_id`, `artifact_group_id`, `tenant_id`, `project_id`, `model_version_id`, `nodes[]`, `edges[]`, `root_source_artifact_id`, `conversion_job_ids[]`, `quality_metrics_summary`, and `diagnostics[]`. Nodes MUST identify source IFC, derived USDC, `ifc_index.json`, `usd_index.json`, `element_mapping.json`, and `metadata.json` when present. Every source, derived model, index, and mapping node MUST include a stable `artifact_id`. Derived model, index, and mapping node IDs MUST prefer the conversion result `derived_artifact_ids` values. Missing optional artifacts MUST be reported in `diagnostics[]` rather than causing a server error.

#### Scenario: Derived artifact lineage is queried

- **WHEN** a client calls `GET /api/artifacts/{artifact_id}/lineage` for a succeeded `model.usdc` artifact
- **THEN** `_worker` returns a lineage graph linking the source IFC artifact to the conversion job, derived USDC, index files, mapping file, and metadata URL
- **AND** the graph includes quality metrics summary for the conversion that produced the derived artifact
- **AND** derived USDC, IFC index, USD index, and element mapping nodes use the stable artifact IDs from `derived_artifact_ids`

#### Scenario: Mapping and index lineage are queried by stable ID

- **WHEN** a client calls `GET /api/artifacts/{artifact_id}/lineage` using `derived_artifact_ids.ifc_index`, `derived_artifact_ids.usd_index`, or `derived_artifact_ids.element_mapping`
- **THEN** `_worker` returns the same artifact group lineage graph and identifies the requested index or mapping node as the current artifact

#### Scenario: Source artifact lineage is queried before conversion

- **WHEN** a client calls `GET /api/artifacts/{artifact_id}/lineage` for an uploaded source artifact that has no succeeded conversion
- **THEN** `_worker` returns a graph with the source node and diagnostics that derived model, mapping, and index artifacts are not ready

#### Scenario: Unknown artifact lineage is rejected

- **WHEN** a client calls `GET /api/artifacts/{artifact_id}/lineage` for an artifact identifier not present in worker indexes, artifact groups, conversion results, or metadata
- **THEN** `_worker` returns `404` and does not fabricate lineage

#### Scenario: Legacy metadata is missing lineage fields

- **WHEN** `_worker` reads older metadata that lacks some lineage fields
- **THEN** the lineage API returns the recoverable graph fields and records missing fields in `diagnostics[]` without failing the request

### Requirement: Worker supports storage IFC batch quality verification

`_worker` SHALL provide an implementation path for batch quality verification over repo-local `storage/*.ifc` fixtures. The Windows local fixture glob `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` and the worktree-local `_worker` dev source root `../storage` SHALL be treated as the same fixture source class for local validation.

The batch verification path MUST use existing worker artifact intake and selected-source conversion contracts unless a later production batch-job spec is opened. Each fixture result MUST record filename, relative path, size, source artifact ID, artifact group ID, conversion job ID, USDC openability, mapped count, unmapped count, coverage ratio, coverage status, lineage API status, duration when available, and failure or warning details.

#### Scenario: Storage IFC fixtures are converted in batch

- **WHEN** batch verification runs against a readable `storage/*.ifc` fixture set
- **THEN** `_worker` creates distinct source artifacts and conversion jobs for each fixture through the worker artifact pipeline
- **AND** the batch summary records per-fixture conversion quality and lineage API status

#### Scenario: Storage fixture root is unavailable

- **WHEN** the configured dev storage root is missing, unreadable, or contains no `.ifc` files
- **THEN** batch verification reports `blocked` with the missing fixture prerequisite and MUST NOT claim that the coverage baseline is locked

#### Scenario: Batch fixture has duplicate bytes

- **WHEN** two fixture files have identical bytes but different filenames or relative paths
- **THEN** `_worker` MUST preserve each fixture's `original_filename`, source artifact ID, conversion job ID, and lineage independently

## MODIFIED Requirements

### Requirement: Worker reports conversion quality before enforcing coverage gates

`_worker` SHALL only mark an artifact group ready for review when the real conversion output passes hard quality gates. Hard gates MUST include USDC openability, renderable prim presence, non-placeholder output, and truthful mapping output when `generate_mapping=true`.

Mapping coverage MUST be measured and reported when `generate_mapping=true`. Before a baseline is locked, `_worker` MUST continue to report coverage as observed data and MUST NOT fail CI only because coverage is below an unstabilized threshold. After baseline stabilization, `_worker` MUST expose a locked minimum coverage policy with `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status`, and policy diagnostics.

Coverage calculation MUST include every source IFC entity in the denominator. `_worker` MUST materialize every IFC entity as a USD prim with stable traceability back to the source IFC entity. IFC product / geometry entities SHOULD become renderable or highlightable USD prims when geometry exists. Non-geometric IFC entities, including project/site/building containers, type metadata, property sets, and relationship entities, MUST become non-renderable USD prims that preserve IFC class, entity identifier, GlobalId when present, Name when present, and relationship metadata when available. No IFC entity class may be excluded from coverage solely because it is not renderable.

Every source IFC entity MUST map to at least one real USD prim path for `coverage_status=pass`. When coverage status is `warn`, `_worker` MAY keep the artifact group eligible for review-session creation as degraded quality, but MUST NOT classify issue-to-real-prim readiness as verified. When coverage status is `fail`, `_worker` MUST NOT claim mapping readiness or issue-to-real-prim highlight readiness.

#### Scenario: Hard quality gate passes

- **WHEN** a conversion job produces an openable USDC, renderable prims, non-placeholder output, and truthful mapping report
- **THEN** `_worker` marks the conversion job `succeeded`, returns derived artifact URLs, and includes coverage metrics in the result payload

#### Scenario: Mapping coverage is measured before threshold lock

- **WHEN** a conversion job produces an openable USDC and coverage report before a minimum threshold is locked
- **THEN** `_worker` returns the coverage report with `minimum_coverage_baseline_locked=false`, does not fail CI only for low coverage, and does not claim that minimum issue-to-real-prim coverage has been verified

#### Scenario: Mapping coverage passes locked threshold

- **WHEN** every source IFC entity maps to at least one real USD prim path
- **THEN** `_worker` returns `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status=pass`, the applied denominator, and no coverage failure diagnostic

#### Scenario: Mapping coverage falls into warning policy

- **WHEN** a conversion job produces openable USDC and mostly truthful mapping, but one or more IFC entities cannot be mapped for a known, explicitly allowed degradation reason
- **THEN** `_worker` returns `coverage_status=warn`, preserves artifact traceability, keeps the artifact group eligible for review-session creation, and reports that issue-to-real-prim highlight readiness is degraded rather than verified

#### Scenario: Mapping coverage fails locked threshold

- **WHEN** any source IFC entity lacks a real USD prim mapping and the condition is not covered by an explicitly allowed warning policy
- **THEN** `_worker` returns `coverage_status=fail`, records validation diagnostics, and MUST NOT mark mapping readiness or issue-to-real-prim highlight readiness as verified

#### Scenario: Quality metrics are exposed

- **WHEN** `GET /api/conversions/{conversion_job_id}/result` returns a conversion result with status `succeeded`
- **THEN** the payload includes converter identity, conversion duration, source IFC entity count, USD prim count, mapped count, unmapped count, coverage ratio, `minimum_coverage_ratio`, denominator policy, baseline lock status, coverage status, and validation warnings when present

#### Scenario: Non-geometric IFC entity materializes as USD prim

- **WHEN** the source IFC contains non-geometric entities such as property sets, type objects, relationship entities, project, site, building, or storey containers
- **THEN** `_worker` materializes each entity as a non-renderable USD prim with stable IFC traceability fields
- **AND** those entities are included in `source_ifc_entity_count` and coverage calculation
