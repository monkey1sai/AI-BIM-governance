## MODIFIED Requirements

### Requirement: Worker reports conversion quality before enforcing coverage gates

`_worker` SHALL only mark an artifact group ready for review when the real conversion output passes hard quality gates. Hard gates MUST include USDC openability, renderable prim presence, non-placeholder output, and truthful mapping output when `generate_mapping=true`.

Mapping coverage MUST be measured and reported when `generate_mapping=true`. Before a baseline is locked, `_worker` MUST continue to report coverage as observed data and MUST NOT fail CI only because coverage is below an unstabilized threshold. After baseline stabilization, `_worker` MUST expose a locked minimum coverage policy with `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status`, and policy diagnostics.

Coverage calculation MUST include every source IFC entity in the denominator. `_worker` MUST carry every IFC entity in the artifact group with stable traceability back to the source IFC entity. Each source IFC entity's carrier MUST be one of: (a) a renderable or highlightable USD prim authored into `model.usdc` when geometry exists, (b) a non-renderable USD prim authored into `model.usdc`, or (c) a sidecar mapping artifact entry (`element_mapping.json` or a dedicated `entity_index.json`) that records the same stable IFC traceability fields. The chosen carrier MUST preserve IFC class, entity identifier, GlobalId when present, Name when present, and relationship metadata when available. No IFC entity class may be excluded from coverage solely because it is not renderable, regardless of which carrier is used.

Every source IFC entity MUST resolve to at least one carrier — a USD prim path or a sidecar mapping entry — for `coverage_status=pass`. When coverage status is `warn`, `_worker` MAY keep the artifact group eligible for review-session creation as degraded quality, but MUST NOT classify issue-to-real-prim readiness as verified. When coverage status is `fail`, `_worker` MUST NOT claim mapping readiness or issue-to-real-prim highlight readiness.

When a sidecar carrier is used for non-renderable IFC entities, the conversion result and lineage MUST surface the sidecar artifact alongside `model.usdc`, `ifc_index.json`, `usd_index.json`, and `element_mapping.json`, so that `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` can continue to obtain complete coverage data without requiring those entities to be present as USD prims. Renderable mapped entries MUST keep existing `primary_usd_prim_path` / `usd_prim_path` / `usd_prim_paths` semantics.

#### Scenario: Hard quality gate passes

- **WHEN** a conversion job produces an openable USDC, renderable prims, non-placeholder output, and truthful mapping report
- **THEN** `_worker` marks the conversion job `succeeded`, returns derived artifact URLs, and includes coverage metrics in the result payload

#### Scenario: Mapping coverage is measured before threshold lock

- **WHEN** a conversion job produces an openable USDC and coverage report before a minimum threshold is locked
- **THEN** `_worker` returns the coverage report with `minimum_coverage_baseline_locked=false`, does not fail CI only for low coverage, and does not claim that minimum issue-to-real-prim coverage has been verified

#### Scenario: Mapping coverage passes locked threshold

- **WHEN** every source IFC entity resolves to at least one carrier (USD prim path or sidecar mapping entry)
- **THEN** `_worker` returns `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status=pass`, the applied denominator, and no coverage failure diagnostic

#### Scenario: Mapping coverage falls into warning policy

- **WHEN** a conversion job produces openable USDC and mostly truthful mapping, but one or more IFC entities cannot be carried in either USD prim or sidecar form for a known, explicitly allowed degradation reason
- **THEN** `_worker` returns `coverage_status=warn`, preserves artifact traceability, keeps the artifact group eligible for review-session creation, and reports that issue-to-real-prim highlight readiness is degraded rather than verified

#### Scenario: Mapping coverage fails locked threshold

- **WHEN** any source IFC entity lacks any carrier (no USD prim and no sidecar mapping entry) and the condition is not covered by an explicitly allowed warning policy
- **THEN** `_worker` returns `coverage_status=fail`, records validation diagnostics, and MUST NOT mark mapping readiness or issue-to-real-prim highlight readiness as verified

#### Scenario: Quality metrics are exposed

- **WHEN** `GET /api/conversions/{conversion_job_id}/result` returns a conversion result with status `succeeded`
- **THEN** the payload includes converter identity, conversion duration, source IFC entity count, USD prim count, sidecar carrier count when present, mapped count, unmapped count, coverage ratio, `minimum_coverage_ratio`, denominator policy, baseline lock status, coverage status, and validation warnings when present

#### Scenario: Non-geometric IFC entity is carried with stable traceability

- **WHEN** the source IFC contains non-geometric entities such as property sets, type objects, relationship entities, project, site, building, or storey containers
- **THEN** `_worker` carries each entity in `model.usdc` (as a non-renderable USD prim) or in a sidecar mapping artifact, recording IFC class, entity identifier, GlobalId when present, Name when present, and relationship metadata when available
- **AND** those entities are included in `source_ifc_entity_count` and coverage calculation regardless of which carrier was used

#### Scenario: Sidecar carrier is surfaced in conversion result and lineage

- **WHEN** `_worker` uses a sidecar mapping artifact to carry non-renderable IFC entity identity
- **THEN** the conversion result, `derived_artifact_ids`, and the lineage graph response identify the sidecar artifact alongside `model.usdc`, `ifc_index.json`, `usd_index.json`, and `element_mapping.json`
- **AND** downstream consumers can obtain complete coverage data without requiring non-renderable entities to be present as USD prims

## ADDED Requirements

### Requirement: Worker optimizes non-renderable entity materialization for canonical IFC fixtures

`_worker` MUST treat `non_renderable_entity_materialization` as an owned, measurable conversion subphase when converting canonical IFC fixtures. The converter MUST preserve the all-IFC-entity coverage denominator while reducing per-entity authoring cost enough for canonical large fixtures to produce `model.usdc` within the configured per-fixture timeout.

`_worker` MUST NOT achieve materialization throughput by dropping non-renderable IFC entities from coverage, by substituting synthetic identifiers for real IFC GUIDs, by replacing all-entity coverage with `IfcProduct`-only / geometry-only / renderable-only coverage, or by marking unmaterialized entities as mapped.

During long-running canonical conversions, `_worker` MUST expose additive non-renderable materialization diagnostics such as `materialized_entity_count`, `materialization_strategy` (`usd_prim`, `sidecar`, or a documented hybrid), `elapsed_seconds`, `progress_write_count`, `last_operation`, and blocker details when available. These diagnostics MUST remain backward-compatible with existing conversion result and quality metrics payloads. Fine-grained profiling diagnostics MAY be enabled for verification evidence and MUST be optional.

#### Scenario: Canonical non-renderable materialization advances past timeout bottleneck

- **WHEN** canonical `--limit 1 --timeout-seconds 600` storage verification runs against the first 89MB fixture
- **THEN** `_worker` completes `non_renderable_entity_materialization` and produces `model.usdc` before timeout, or records deterministic blocker diagnostics that identify a non-`_worker` limitation
- **AND** the batch result remains non-passed if conversion still does not complete

#### Scenario: Materialization preserves all-entity denominator

- **WHEN** `_worker` optimizes non-renderable entity materialization
- **THEN** `source_ifc_entity_count`, `coverage_denominator=source_ifc_entity_count`, mapping output, and unmapped diagnostics still include all source IFC entities rather than only renderable geometry entities
- **AND** `mapped_count + unmapped_count = source_ifc_entity_count`

#### Scenario: Materialization diagnostics are additive

- **WHEN** non-renderable materialization emits progress or completion diagnostics
- **THEN** existing conversion result fields remain available
- **AND** new diagnostics are optional nested fields that consumers can ignore without breaking lineage, readiness, or review viewer handoff

#### Scenario: Sidecar carrier choice is recorded in diagnostics

- **WHEN** `_worker` materializes non-renderable IFC entities into a sidecar carrier instead of USD prims
- **THEN** the conversion phase diagnostics record `materialization_strategy=sidecar` and the count of entities written to the sidecar
- **AND** the artifact group readiness, lineage, and review viewer handoff continue to surface complete coverage data

#### Scenario: Optimization does not lock baseline prematurely

- **WHEN** non-renderable materialization improves but the full canonical batch has not passed all archived baseline gates
- **THEN** `_worker` keeps `minimum_coverage_locked=false` and records the remaining blocker or next gate
