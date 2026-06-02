## Context

目前 `bim-streaming-server` 已是 IFC -> USDC conversion authority，但主流程仍偏向「先讓 HOOPS/CAD Converter 產可視化 USD，再嘗試從 USD CustomData 或 sidecar 補 mapping」。這條路可以改善 demo visual readiness，卻不能把 BIM identity 當成 source of truth：HOOPS happy path 不保證保留 IFC `GlobalId` / Pset / type / name 到 USD prim，因此只能得到 `sidecar_ordinal` 或 `unmapped`，不能宣稱 `guid_exact`。

不依賴 Revit plugin 的最佳路線是把 IFC 當成輸入契約，讓 `bim-streaming-server` 直接用 IfcOpenShell 解析 IFC，再用 OpenUSD API author stage。NVIDIA/OpenUSD 沒有固定 BIM prim path 官方格式；本 repo 需要定義一套合法、唯一、可讀、可維護，且對 Omniverse / Kit / web-viewer 可消費的 repo-owned prim path convention。

## Goals / Non-Goals

**Goals:**

- 支援 `ifcopenshell_openusd_identity` conversion profile，讓 IFC `GlobalId` 能穩定映射到 USD element root prim path。
- 產出 `mapping_fidelity = "guid_exact"` 的 `element_mapping.json`，並補齊 `entity_index`、`pset_index`、`spatial_index`、`bbox_index`、`quality_metrics` 與 geo reference artifact。
- 讓 element identity path 穩定支援後續 `ai-bim-geo` 功能：rule check、3D highlight/focus、version diff、spatial query、federation、scan-to-BIM、IoT/asset binding、4D/5D、AI search。
- 保持 repo 邊界：conversion artifact authority 在 `bim-streaming-server`，external IFC-ready intake 在 `bim-review-coordinator`，browser/viewer 只消費 artifact refs 與 `usd_prim_path`。

**Non-Goals:**

- 不依賴 Revit Connector / Revit plugin，也不要求 RVT 直轉。
- 不宣稱 HOOPS/CAD Converter happy path 能做精準 GUID mapping。
- 不把 floor/storey/space/system 放進 prim path；這些是 relationships / indexes，不是 identity path。
- 不在本 change 開發 governance rule engine、issue lifecycle、viewer UI redesign、多人 annotation 或 cloud data model。
- 不把 Pset/spatial sidecar 本體塞進 cloud callback；callback 仍 metadata-only。

## Decisions

### D1. IFC 是唯一必要輸入契約

外部落地端只需要提供 IFC；不要求 Revit Connector、Revit add-in、RVT file、或使用者安裝外掛。IfcOpenShell 負責解析 `GlobalId`、IFC entity type/name、Pset、quantities、spatial containment 與 geometry。

Alternative considered: 使用 NVIDIA Revit Connector 匯出 USD。它可能保留更多 Revit element parameters，但會把流程綁到 Revit plugin，與本 change 的 no-plugin 目標衝突。

### D2. Element root prim path identity-first

建議 path convention：

```txt
/World/Elements/<IfcType>/G_<encoded_GlobalId>
/World/Elements/<IfcType>/G_<encoded_GlobalId>/Body_000
/World/Elements/<IfcType>/G_<encoded_GlobalId>/Body_001
```

- `<IfcType>` 由 IFC entity class sanitize 成 USD-safe identifier。
- `G_<encoded_GlobalId>` 由 IFC `GlobalId` sanitize / encode 成 USD-safe identifier，並在 prim customData 保留原始 `bim:ifc_guid`。
- Element root prim 是 stable identity；child mesh 可依 tessellation 結果變動。
- 不採 `/World/Storeys/<Level>/...` floor-first path，避免樓層 / 空間調整破壞長期 binding。

Alternative considered: 繼續使用 fallback 既有 `/World/<IfcClass>/<identifier>`。該 path 已比 HOOPS sidecar 好，但缺少明確 `/World/Elements` namespace，後續要加 `/World/Spatial`、`/World/Systems`、`/World/Overlays`、`/World/GeoReference` 時邊界較不清楚。

### D3. USD stage package 分層

`model_root.usda` SHALL 設定 stage metadata 並組合 layers：

```usda
#usda
(
  defaultPrim = "World"
  metersPerUnit = 1
  upAxis = "Z"
)

def Scope "World" {
  def Scope "Elements" {}
  def Scope "Spatial" {}
  def Scope "Systems" {}
  def Scope "Overlays" {}
  def Scope "GeoReference" {}
}
```

建議 artifact package：

```txt
model_root.usda
layers/geometry.usdc
layers/semantics.usda
layers/materials.usda
layers/overlays.usda
layers/geo_reference.usda
index/element_mapping.json
index/entity_index.json
index/pset_index.json
index/spatial_index.json
index/bbox_index.json
index/quality_metrics.json
```

Implementation may initially publish a single `model.usdc` plus JSON sidecars for backward compatibility, but acceptance MUST prove the stable identity path and GUID-exact mapping are present.

### D4. Sidecars are authored during conversion, not guessed after conversion

`element_mapping.json` is created by the converter while authoring USD prims:

```json
{
  "format_version": 2,
  "mapping_fidelity": "guid_exact",
  "items": [
    {
      "ifc_guid": "19nzyxtx5CXwVzdF_4phxj",
      "usd_prim_path": "/World/Elements/IfcColumn/G_19nzyxtx5CXwVzdF_4phxj",
      "ifc_type": "IfcColumn",
      "ifc_name": "75x120cm",
      "entity_id": "ifc:19nzyxtx5CXwVzdF_4phxj",
      "bbox_local": [0, 0, 0, 1, 1, 3],
      "bbox_world": [100, 200, 0, 101, 201, 3],
      "pset_hash": "..."
    }
  ]
}
```

This differs from HOOPS ordinal sidecar matching: the converter knows the IFC entity at the moment it creates the USD prim, so it can emit `guid_exact` without reverse-engineering prim order later.

### D5. Geo handling uses local coordinates plus explicit reference transform

Mesh vertices SHOULD stay in local/project coordinates to avoid precision loss from very large world coordinates. Geo reference data lives in `geo_reference.usda` / `geo_reference.json` and indexes include both `bbox_local` and `bbox_world`.

Example geo metadata:

```json
{
  "crs": "EPSG:3826",
  "local_origin": [276543.12, 2765123.45, 12.3],
  "true_north_degrees": 1.25,
  "model_to_world_matrix": []
}
```

Federation uses root transforms and model metadata; it MUST NOT rewrite element identity paths.

### D6. Internal conversion profile is additive

Add an internal-only selectable route such as:

```json
{
  "conversion_profile": "ifcopenshell_openusd_identity"
}
```

Existing requests without the field keep current behavior. During rollout, coordinator can request identity authoring only for workflows that need precise identity, while HOOPS/CAD Converter remains available for visual comparison or fallback.

### D7. Source of truth ownership

- IFC source and conversion artifacts: `bim-streaming-server`.
- IFC-ready intake, review session, callback outbox metadata: `bim-review-coordinator`.
- Browser interaction and 3D focus/highlight commands: `web-viewer-sample`.
- Company cloud control-plane metadata: external `bim-control`.
- Full Pset/spatial/geo sidecar bodies: host-local artifacts unless a future cloud contract changes this explicitly.

## Risks / Trade-offs

- [Risk] IfcOpenShell geometry fidelity may differ from HOOPS visual output. -> Mitigation: keep HOOPS route available as visual fallback / comparison, and validate openable USD + mesh counts + bbox sanity before publishing ready.
- [Risk] IfcOpenShell / OpenUSD runtime dependency and LGPL/copyleft review remain production risks. -> Mitigation: document license/runtime requirements before making identity authoring the default production profile.
- [Risk] Large IFC conversion latency may increase. -> Mitigation: run heavy conversion in host-native service / worker lane, separate from live WebRTC viewport readiness.
- [Risk] Existing viewer may assume `model.usdc` path layout from old fallback. -> Mitigation: preserve absolute `usd_prim_path` in mapping and test DataChannel focus/highlight against element root paths.
- [Risk] Geo reference data varies by IFC authoring quality. -> Mitigation: emit explicit `geo_reference_quality` / warnings in `quality_metrics`; do not fabricate CRS when source lacks enough data.

## Migration Plan

1. Implement identity authoring behind an additive internal conversion profile.
2. Add unit tests for path sanitization, GUID-exact mapping, sidecar schema, bbox/geo outputs, and no-plugin behavior.
3. Add API/contract tests only for additive result fields and artifact refs.
4. Run a real IFC conversion evidence pass and record `mapping_fidelity = "guid_exact"` plus stage-open validation.
5. Consider making identity authoring the default only after geometry fidelity, dependency/license review, and viewer highlight validation are accepted.

Rollback: disable the internal profile or stop requesting it from coordinator; existing HOOPS/fallback routes remain available.

## Open Questions

- Should identity authoring become the default for all IFC conversions, or remain an explicit profile for governance / geo workflows first?
- Which geo fields are mandatory for `ai-bim-geo` MVP versus warnings-only when the IFC source lacks CRS / true north?
- Should Pset/spatial indexes remain host-local only, or should a future cloud contract allow selected metadata summaries?
