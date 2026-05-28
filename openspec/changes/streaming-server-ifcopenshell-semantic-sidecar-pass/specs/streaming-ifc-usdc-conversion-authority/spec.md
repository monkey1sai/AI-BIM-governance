# streaming-ifc-usdc-conversion-authority — Spec Delta (streaming-server-ifcopenshell-semantic-sidecar-pass)

> Delta against `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`。
> 接續 `streaming-server-enumeration-semantic-mapping`(2026-05-26 archived)。
> HOOPS A3D 不寫 IFC CustomData 進 USD prim,enumeration 抽不到 → viewer
> Semantic ready 仍 `no`。本 delta 新增 HOOPS happy path 後序列追加 IfcOpenShell
> semantic sidecar pass,讓 enumeration 在 prim CustomData 缺資料時讀 sidecar
> supplement,並推導 quality_metrics 三 semantic 欄位,使 viewer Semantic ready
> 真實算為 `yes`。

## ADDED Requirements

### Requirement: HOOPS happy path SHALL be augmented by an IfcOpenShell semantic sidecar pass

`bim-streaming-server` SHALL run an IfcOpenShell-based semantic sidecar pass
after a HOOPS happy-path conversion publishes a renderable `model.usdc`, when
the converter-emitted or USD-enumerated sidecars do not already carry IFC
semantic data. The sidecar pass MUST produce a host-local
`ifc_semantic_sidecar.json` co-located with `model.usdc`, MUST NOT block the
already-ready HOOPS result on its own failure, and MUST be consumed by
`_enumerate_usd_stage` only as a supplement when prim CustomData carries no
IFC keys. The pass MUST remain non-fabricating: sidecar entries SHALL originate
exclusively from real IfcOpenShell parsing of the originating IFC source, and
`element_mapping.json` items SHALL be derived only from prim CustomData or
sidecar entries (no name-based heuristics, no mesh-name guesses).

#### Scenario: HOOPS success without IFC CustomData triggers sidecar pass

- **WHEN** the host-native conversion service completes a HOOPS happy-path
  conversion that publishes a renderable `model.usdc`
- **AND** `_adopt_converter_sidecars` returns sidecars without
  `mapping_has_ifc_type` / `mapping_has_ifc_name` truthy
- **AND** the originating IFC source file is readable on the host
- **THEN** `bim-streaming-server` SHALL invoke
  `_run_ifcopenshell_semantic_sidecar` against the IFC source
- **AND** an `ifc_semantic_sidecar.json` file SHALL be written into the
  conversion's artifact directory, co-located with `model.usdc`
- **AND** the sidecar SHALL contain `format_version`, `ifc_source`, `entries[]`
  (each entry with `ifc_guid`, `ifc_type`, `ifc_name`, `shape_index`), and
  `summary` (with `count`, `has_type`, `has_name`)

#### Scenario: Enumeration reads sidecar when prim CustomData is empty

- **WHEN** `_enumerate_usd_stage` traverses the USD stage produced by HOOPS
- **AND** no prim carries `ifc:guid` / `ifcGlobalId` / `ifc_guid` CustomData
- **AND** an `ifc_semantic_sidecar.json` file exists in the artifact directory
  with non-empty `entries`
- **THEN** `_enumerate_usd_stage` SHALL load the sidecar and supplement
  `mapping_items[]` using best-effort enumeration order alignment between USD
  mesh prims and sidecar entries (by ordinal index)
- **AND** each supplemented mapping item SHALL contain the five keys
  `ifc_guid`, `usd_prim_path`, `ifc_type`, `ifc_name`, `entity_id`
- **AND** `entity_index.json` entries SHALL align with mapping items via the
  shared `entity_id`
- **AND** `quality_metrics.json` SHALL contain
  `semantic_mapping_fidelity = "usd_enumeration_with_ifc_sidecar_supplement"`,
  `mapping_has_ifc_type` derived from `any(item.ifc_type)`, and
  `mapping_has_ifc_name` derived from `any(item.ifc_name)`
- **AND** `web-viewer-sample` `computeSemanticReady` SHALL compute Semantic
  ready as `"yes"` for this conversion's stream-config (alignment with
  `session-first-review-viewer`)

#### Scenario: Enumeration prefers prim CustomData over sidecar

- **WHEN** `_enumerate_usd_stage` traverses the USD stage
- **AND** at least one prim carries valid IFC CustomData
  (`ifc:guid` / `ifcGlobalId` / `ifc_guid` plus optional `ifcType` / `ifcName`)
- **AND** an `ifc_semantic_sidecar.json` also exists in the artifact directory
- **THEN** `mapping_items[]` SHALL be derived from prim CustomData (existing
  `streaming-server-enumeration-semantic-mapping` archive behavior)
- **AND** `semantic_mapping_fidelity` SHALL remain
  `"ifc_class_grouped_with_name"` or
  `"usd_enumeration_with_ifc_custom_data"` per the C6 archive rules
- **AND** the sidecar SHALL NOT shadow or overwrite CustomData-derived mapping
  items

#### Scenario: Missing IFC source or IfcOpenShell unavailable stays honest

- **WHEN** the HOOPS-published artifact directory contains a ready
  `model.usdc` but the originating IFC source has been removed (e.g. by
  retention policy)
- **OR** the host Python environment does not have `ifcopenshell` importable
- **OR** `ifcopenshell.open()` raises an exception on the IFC source
- **THEN** `_run_ifcopenshell_semantic_sidecar` SHALL return `None` without
  raising
- **AND** no `ifc_semantic_sidecar.json` SHALL be written
- **AND** the HOOPS-published ready result SHALL NOT be retracted or reclassified
  as failed
- **AND** `_enumerate_usd_stage` SHALL fall back to its existing CustomData /
  no-data behavior; `quality_metrics.json` SHALL keep
  `semantic_mapping_fidelity = null`, `mapping_has_ifc_type = false`,
  `mapping_has_ifc_name = false`
- **AND** viewer Semantic ready SHALL stay `no` (honest, no false positive)

#### Scenario: Sidecar contents stay host-local and do not enter callback outbox

- **WHEN** coordinator enqueues a `conversion_ready` or `conversion_failed`
  callback for a job whose artifact directory contains
  `ifc_semantic_sidecar.json`
- **THEN** the callback payload sent to the external company-cloud control
  plane MUST NOT include the sidecar JSON body or any IfcOpenShell-derived
  semantic content
- **AND** the callback MAY only reference the sidecar via opaque diagnostic
  markers, in alignment with `conversion-webhook-lifecycle` metadata-only
  callback principle

#### Scenario: Backward compatible mapping schema and additive quality metrics

- **WHEN** an existing consumer (`bim-review-coordinator`, `web-viewer-sample`)
  reads `element_mapping.json`, `entity_index.json`, or `quality_metrics.json`
  produced through the sidecar supplement path
- **THEN** consumers that only understand the legacy `ifc_guid` /
  `usd_prim_path` mapping schema SHALL still parse the documents without
  error
- **AND** the new `semantic_mapping_fidelity` value
  `"usd_enumeration_with_ifc_sidecar_supplement"` SHALL be additive; existing
  consumers that switch on prior values (`"ifc_class_grouped_with_name"` /
  `"usd_enumeration_with_ifc_custom_data"`) SHALL treat the new value as an
  unknown-but-valid fidelity that asserts semantic presence via
  `mapping_has_ifc_type` / `mapping_has_ifc_name`
- **AND** no pre-existing key in `element_mapping.json`, `entity_index.json`,
  or `quality_metrics.json` SHALL be removed or renamed by this change

#### Scenario: Sidecar pass does not retro-fit previously archived conversions

- **WHEN** the streaming server starts after this change is deployed
- **AND** an existing `model.usdc` from a prior conversion still resides in
  storage but has no `ifc_semantic_sidecar.json`
- **THEN** the streaming server SHALL NOT automatically re-run the sidecar
  pass against the existing artifact directory on startup
- **AND** only newly dispatched conversion jobs SHALL invoke the sidecar pass
- **AND** operators MAY trigger a manual re-conversion through the existing
  coordinator dispatch path if retroactive sidecar coverage is required
