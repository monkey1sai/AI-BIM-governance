## ADDED Requirements

### Requirement: Worker optimizes source entity enumeration for canonical IFC fixtures

`_worker` MUST treat `source_entity_enumeration` as an owned, measurable conversion subphase when converting canonical IFC fixtures. The converter MUST preserve the all-IFC-entity coverage denominator while avoiding unnecessary repeated full-model traversal, eager deep relationship expansion, or expensive metadata extraction that is not required to establish stable source entity identity.

The optimized enumeration path MUST keep stable identity fields for each source IFC entity: `ifc_entity_key`, `ifc_entity_id` when available, `ifc_class`, `ifc_guid` when present, and `name` when available without compromising bounded execution. It MUST NOT replace all-entity coverage with geometry-only, `IfcProduct`-only, GUID-only, or renderable-only coverage.

The real/canonical converter path MUST NOT use `model.by_type("IfcProduct")` as an all-entity fallback. If all-entity iteration is unavailable, `_worker` MUST fail or block the conversion with deterministic diagnostics rather than producing product-only coverage evidence.

During long-running canonical conversions, `_worker` MUST expose additive source enumeration diagnostics such as elapsed seconds, enumerated entity count, current phase status, `fallback_used`, last known operation, and blocker details when available. These diagnostics MUST remain backward-compatible with existing conversion result and quality metrics payloads. Fine-grained profiling diagnostics MAY be enabled for verification evidence and MUST be optional.

#### Scenario: Canonical source enumeration advances past timeout bottleneck

- **WHEN** canonical `--limit 1` storage verification runs against the first 89MB fixture with the configured per-fixture timeout
- **THEN** `_worker` completes `source_entity_enumeration` and advances to the next conversion phase before timeout, or records deterministic blocker diagnostics that identify a non-`_worker` limitation
- **AND** the batch result remains non-passed if conversion still does not complete

#### Scenario: Enumeration preserves all-entity denominator

- **WHEN** `_worker` optimizes source entity enumeration
- **THEN** `source_ifc_entity_count`, `coverage_denominator=source_ifc_entity_count`, mapping output, and non-renderable entity materialization still include all source IFC entities rather than only renderable geometry entities

#### Scenario: Enumeration diagnostics are additive

- **WHEN** source entity enumeration emits progress or completion diagnostics
- **THEN** existing conversion result fields remain available
- **AND** new diagnostics are optional nested fields that consumers can ignore without breaking lineage, readiness, or review viewer handoff

#### Scenario: Product-only fallback is rejected for canonical evidence

- **WHEN** the real converter cannot iterate all IFC source entities
- **THEN** `_worker` records a conversion blocker instead of falling back to `IfcProduct`-only enumeration
- **AND** the result MUST NOT claim all-entity coverage evidence from the product-only subset

#### Scenario: Optimization does not lock baseline prematurely

- **WHEN** source entity enumeration improves but the full canonical batch has not passed all archived baseline gates
- **THEN** `_worker` keeps `minimum_coverage_locked=false` and records the remaining blocker or next gate
