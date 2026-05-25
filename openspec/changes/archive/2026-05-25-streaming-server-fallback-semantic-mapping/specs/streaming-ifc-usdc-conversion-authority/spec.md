# streaming-ifc-usdc-conversion-authority — Spec Delta (streaming-server-fallback-semantic-mapping)

> Delta against `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`。
> 本 change 提升 `_run_ifcopenshell_openusd_fallback` 產出的 mapping fidelity，讓
> viewer / `/ui` 的 Semantic ready 有真實 IFC 語意資料來源。

## ADDED Requirements

### Requirement: Fallback converter emits IFC-semantic mapping

`bim-streaming-server` 的 `IfcOpenShell + OpenUSD` fallback converter SHALL produce
`element_mapping.json` items that carry the originating IFC entity type and name
(when available from IfcOpenShell), align each mapping item with one entity in
`entity_index.json` via a shared `entity_id`, and structure the USD prim hierarchy
so each mesh prim is grouped under an `Xform` named after its IFC class. The
fallback SHALL also publish three quality-metric fields that downstream consumers
(coordinator `/ui`, viewer) can read to determine semantic readiness without
having to re-parse the mapping items themselves.

The new fields and structure SHALL be additive to the existing schema so existing
consumers that only know the legacy `ifc_guid` + `usd_prim_path` shape continue
to work without modification.

#### Scenario: Fallback mapping carries IFC class and name

- **WHEN** `_run_ifcopenshell_openusd_fallback` writes `element_mapping.json` for a
  successful IFC parse
- **THEN** every entry in `items[]` SHALL include the keys `ifc_guid`,
  `usd_prim_path`, `ifc_type`, `ifc_name`, and `entity_id`
- **AND** `ifc_type` / `ifc_name` MAY be `null` when IfcOpenShell does not return
  a type or name for that shape, but the keys MUST be present
- **AND** the legacy keys `ifc_guid` and `usd_prim_path` SHALL retain their
  existing meaning (IFC GUID and absolute USD prim path)

#### Scenario: Fallback prim paths are IFC-class grouped

- **WHEN** `_run_ifcopenshell_openusd_fallback` writes the fallback `model.usdc`
- **THEN** every mesh prim SHALL live under `/World/<IfcClass>/<identifier>` where
  `<IfcClass>` is a USD-safe identifier derived from the IFC entity type (e.g.
  `IfcCableCarrierSegment`, `IfcBuildingElementProxy`) and `<identifier>` is a
  USD-safe identifier derived from the IFC GUID
- **AND** shapes with no resolvable IFC class SHALL be grouped under
  `/World/Unclassified/<identifier>`
- **AND** any `<IfcClass>` segment SHALL be defined as a `UsdGeom.Xform` (only
  once per class) before any mesh under it is added
- **AND** the resulting `model.usdc` SHALL remain openable via `Usd.Stage.Open`
  with at least one `UsdGeom.Mesh` prim

#### Scenario: Mapping items align with entity index by entity_id

- **WHEN** `_run_ifcopenshell_openusd_fallback` writes `element_mapping.json` and
  `entity_index.json`
- **THEN** every `items[i].entity_id` value in `element_mapping.json` SHALL
  appear exactly once in `entity_index.json` `entities[].entity_id`
- **AND** the matching entity record SHALL contain the same `ifc_guid` and
  `usd_prim_path` as the mapping item
- **AND** consumers MAY join `element_mapping.items` with `entity_index.entities`
  on `entity_id` to retrieve full IFC entity information

#### Scenario: Quality metrics declare semantic mapping fidelity

- **WHEN** `_run_ifcopenshell_openusd_fallback` writes `quality_metrics.json`
- **THEN** the JSON object SHALL include the keys `semantic_mapping_fidelity`,
  `mapping_has_ifc_type`, and `mapping_has_ifc_name`
- **AND** when at least one mapping item has a non-null `ifc_type`,
  `mapping_has_ifc_type` SHALL be `true`
- **AND** when at least one mapping item has a non-null `ifc_name`,
  `mapping_has_ifc_name` SHALL be `true`
- **AND** when the fallback uses IFC-class grouped prim paths and emits the
  enriched mapping schema described above, `semantic_mapping_fidelity` SHALL be
  `"ifc_class_grouped_with_name"`

#### Scenario: USD-safe identifier sanitization for IFC GUID and class

- **WHEN** the fallback constructs a USD prim path segment from an IFC GUID or
  IFC class string that contains characters outside `[A-Za-z0-9_]`
- **THEN** the identifier SHALL be sanitized so each illegal character is replaced
  by `_`
- **AND** if the resulting identifier does not begin with a letter or `_`, the
  identifier SHALL be prefixed with `_`
- **AND** if sanitization yields an empty string, the fallback SHALL use a
  deterministic placeholder such as `Shape_NNNNNN` (zero-padded shape index) or
  the literal `Unclassified` (for the IFC class segment)
- **AND** the sanitized prim path SHALL remain unique within `model.usdc`

#### Scenario: Backward compatible mapping schema

- **WHEN** a consumer that only understands the legacy mapping shape reads
  `element_mapping.json`
- **THEN** the consumer SHALL still be able to parse `items[].ifc_guid` and
  `items[].usd_prim_path` without error
- **AND** the new keys `ifc_type`, `ifc_name`, `entity_id` MAY be ignored without
  breaking the consumer
- **AND** the fallback MUST NOT remove or rename any pre-existing key in the
  mapping or entity-index documents

## MODIFIED Requirements

### Requirement: Streaming conversion preserves quality metrics and mapping semantics

`bim-streaming-server` SHALL preserve existing conversion quality semantics when
it becomes conversion authority. When the fallback converter is the
materialization strategy, the quality metrics document SHALL additionally
declare semantic mapping fidelity so downstream consumers can distinguish a
shape-level fallback from an IFC-semantic fallback without re-parsing the mapping
artifact body.

#### Scenario: Quality metrics are returned

- **WHEN** conversion completes
- **THEN** result includes `source_ifc_entity_count`, `mapped_count`,
  `unmapped_count`, `coverage_ratio`, `coverage_status`,
  `materialization_strategy`, `sidecar_carrier_count`, and
  `minimum_coverage_baseline_locked`

#### Scenario: Mapping is not fabricated

- **WHEN** IFC element cannot be mapped to a USD prim
- **THEN** the element is listed as unmapped or sidecar-only according to policy
- **AND** fake GUID/prim mapping MUST NOT be generated unless
  `allow_fake_mapping=true` and the result is clearly marked `fake_for_smoke_test`

#### Scenario: Entity index sidecar is preserved

- **WHEN** sidecar carrier strategy is used
- **THEN** the result includes an `entity_index` artifact identity/URL
- **AND** lineage indicates the sidecar relation between the IFC source, USDC
  artifact, mapping artifact, and entity index artifact

#### Scenario: Fallback quality metrics declare semantic mapping fidelity

- **WHEN** conversion completes via the `IfcOpenShell + OpenUSD` fallback
  (`materialization_strategy == "ifcopenshell_openusd_fallback"`)
- **THEN** the result `quality_metrics` SHALL additionally include
  `semantic_mapping_fidelity` (string), `mapping_has_ifc_type` (boolean), and
  `mapping_has_ifc_name` (boolean)
- **AND** these three fields SHALL NOT be required for the primary HOOPS path
  in this change (HOOPS path remains out of scope)
