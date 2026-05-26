# streaming-ifc-usdc-conversion-authority — Spec Delta (streaming-server-enumeration-semantic-mapping)

> Delta against `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`。
> 接續 `streaming-server-fallback-semantic-mapping`(2026-05-25 archived)把 C1
> semantic fidelity 推到 enumeration 與 adoption 兩條主流 sidecar path,讓
> HOOPS 成功 happy path 也能讓 viewer / `/ui` Semantic ready 真實算出 yes。

## ADDED Requirements

### Requirement: Enumeration and adoption sidecar paths emit IFC-semantic mapping fidelity

`bim-streaming-server` SHALL write the three C1 semantic fields
(`semantic_mapping_fidelity` / `mapping_has_ifc_type` / `mapping_has_ifc_name`)
into `quality_metrics.json` from both sidecar materialization paths
(`_enumerate_usd_stage` and `_adopt_converter_sidecars`), so that the
HOOPS-success happy path and the IfcOpenShell fallback path both let viewer /
`/ui` compute Semantic ready as `yes` when IFC semantics are present. The
enumeration path MUST extract `ifcType` / `ifcName` from USD prim CustomData
(tolerating `ifc:type` / `ifc:name` key variants); the adoption path MUST
supplement missing semantic fields from converter-emitted `element_mapping.items`
in a non-fabricating manner (never overwriting fields the converter already
wrote).

#### Scenario: Enumeration path enriches mapping items with IFC type / name

- **WHEN** `_enumerate_usd_stage` 從 USD stage Traverse 列出 prims
- **AND** prim CustomData 含 `ifcGlobalId`(或 `ifc:guid` / `ifc_guid`)、
  `ifcType`(或 `ifc:type` / `ifc_type`)、`ifcName`(或 `ifc:name` / `ifc_name`)
- **THEN** 寫出的 `element_mapping.json` items 每筆 SHALL 含
  `ifc_guid` / `usd_prim_path` / `ifc_type` / `ifc_name` / `entity_id` 五個 keys
- **AND** `entity_index.json` entries 每筆 SHALL 對齊同一 `entity_id`
- **AND** 沒 IFC custom data 的 prim SHALL 不寫進 mapping_items(避免 fabricate)

#### Scenario: Enumeration quality_metrics declares semantic fidelity

- **WHEN** `_enumerate_usd_stage` 完成 sidecars
- **AND** mapping_items 中至少一筆 `ifc_type` 與一筆 `ifc_name` 為 truthy string
- **THEN** `quality_metrics.json` SHALL 含
  `semantic_mapping_fidelity = "ifc_class_grouped_with_name"`、
  `mapping_has_ifc_type = true`、`mapping_has_ifc_name = true`
- **AND** viewer `computeSemanticReady` 對此 conversion 的 stream-config
  SHALL 計算為 `"yes"`(對齊 `session-first-review-viewer`)

#### Scenario: Enumeration path with no IFC custom data stays honest

- **WHEN** USD stage 內 prim 完全沒 IFC custom data(例如純 mesh export 無
  IFC metadata)
- **THEN** `quality_metrics.json` SHALL 含 `semantic_mapping_fidelity = null`
  /`undefined`,`mapping_has_ifc_type = false`、`mapping_has_ifc_name = false`
- **AND** viewer SHALL 計算 Semantic ready 為 `no`(誠實不偽宣告)

#### Scenario: Adoption path supplements missing semantic fields

- **WHEN** `_adopt_converter_sidecars` 讀 converter-emitted `quality_metrics.json`
- **AND** 該 quality_metrics 缺少 `semantic_mapping_fidelity` /
  `mapping_has_ifc_type` / `mapping_has_ifc_name` 任一
- **AND** emitted `element_mapping.json` items 內既有 `ifc_type` / `ifc_name` data
- **THEN** adapter SHALL supplement 三個 missing 欄位,依 mapping items
  推導對應 truthy 值(`has_type = any(item.ifc_type)`、
  `has_name = any(item.ifc_name)`,fidelity 依 has_type / has_name 組合)
- **AND** supplement SHALL NOT 蓋過 converter 自己已寫的非 null / 非缺失欄位
  (`is None` / `not in` guard)
- **AND** supplement 不從 element_mapping 以外的來源推導,維持 non-fabricating
  原則

#### Scenario: Backward compatible mapping schema

- **WHEN** 既有 consumer(viewer / coordinator)只認 legacy `ifc_guid` +
  `usd_prim_path` keys 而不認 `ifc_type` / `ifc_name` / `entity_id` 新 keys
- **THEN** 它們 SHALL 仍能解析新 element_mapping.json 與 entity_index.json
- **AND** 新 keys SHALL 是 additive,既有 keys 不被刪除或重新命名
