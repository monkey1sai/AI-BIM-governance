## Why

2026-05-22 archived change `fix-ifc-usdc-hoops-load-failure` 將 HOOPS A3D primary
converter 失敗的 IFC 接到 `IfcOpenShell + OpenUSD` fallback path，產出可開啟的
`model.usdc` 與 4,889 筆 mapping。但 fallback `element_mapping.json` 仍為 shape-level
path（`/World/IfcShape_000001`），mapping item 只帶 `ifc_guid` 與 `usd_prim_path`，
viewer 無法把高亮 / 聚焦行為對到原 IFC entity 的語意（`IfcCableCarrierSegment`、
`IfcBuildingElementProxy` 等）。

2026-05-25 觀察筆記（`docs/plans/TEMP-fast-mvp-session-artifact-binding-discussion-2026-05-25.md`）
明確指出：viewer / `/ui` 顯示 stage matched 並不證明 IFC 語意正確；目前 fast MVP
demo 的 Semantic ready 一律 incomplete。HOOPS primary 屬 vendor-side 不可控；要讓
viewer / `/ui` 有 Semantic ready 真實資料來源，務實作法是提升 fallback 的 mapping
fidelity，把 `ifc_type` / `ifc_name` / `entity_id` 帶進 mapping item，並把 USD prim
path 改為 IFC class grouped（`/World/<IfcClass>/<GUID>`）。

## What Changes

- 修改 `bim-streaming-server` 的 `_run_ifcopenshell_openusd_fallback`：
  - `element_mapping.json` 的 mapping item 必須帶 `ifc_type`、`ifc_name`、`entity_id`
    欄位（值可為 null，但 schema field 必須存在），維持既有 `ifc_guid` 與
    `usd_prim_path` 欄位（backward compatible）。
  - fallback 產出的 mesh prim path 改為 `/World/<IfcClass>/<sanitized_guid>` 結構，
    其中 `<IfcClass>` 是 IFC entity type（例如 `IfcCableCarrierSegment`），
    `<sanitized_guid>` 為 USD-safe identifier。無法取得 IFC class 的 shape 使用
    `/World/Unclassified/<sanitized_guid>` 或 `/World/Unclassified/Shape_NNNNNN`。
  - `entity_index.json` 維持產出，且每筆 entity 與 mapping_items 用同一 `entity_id`
    對齊（1:1，row index 等價即可）。
  - `quality_metrics.json` 新增三個欄位：
    - `semantic_mapping_fidelity`（fallback 必須填 `ifc_class_grouped_with_name`）
    - `mapping_has_ifc_type`（fallback 填 `true`）
    - `mapping_has_ifc_name`（fallback 填 `true`）
  - 維持既有 `coverage_ratio` / `coverage_status` / `materialization_strategy`
    / `sidecar_carrier_count` / `hard_quality_gates` 等欄位。
- 不改 `convert` 對外簽名、不改 `host_native_conversion_service.py` 對外 API、
  不改 coordinator 的 ingest path、不改 callback outbox。
- 不新增 production dependency。
- 不修 HOOPS primary path（vendor-side，不在本 change scope）。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `streaming-ifc-usdc-conversion-authority`：
  - ADD requirement「Fallback converter emits IFC-semantic mapping」covering
    IFC-class grouped prim path、mapping item ifc_type/ifc_name/entity_id、
    quality_metrics 新欄位
  - MODIFY 既有 requirement「Streaming conversion preserves quality metrics and
    mapping semantics」加新 scenario：fallback quality_metrics 必須包含
    `semantic_mapping_fidelity` 等新欄位

## Impact

- Owner repo / folder：`bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`、`bim-streaming-server/tests/`、`openspec/changes/streaming-server-fallback-semantic-mapping/`。
- Runtime boundary：conversion 仍由 `bim-streaming-server` 執行；coordinator / viewer
  不新增轉檔責任。
- API：`POST /api/conversions/ifc-to-usdc` 與 `GET /api/conversions/{id}/result`
  路徑不變；result `artifacts.element_mapping` / `artifacts.entity_index` /
  `quality_metrics` 等欄位形狀為 additive 變更（新增欄位不破壞既有 consumer）。
- Data：fallback 寫入同一 conversion artifact directory 的 `model.usdc` 結構
  改為 IFC-class grouped；`element_mapping.json` / `entity_index.json` 加新欄位；
  `quality_metrics.json` 加新欄位。
- Dependencies：不新增；`ifcopenshell`、`pxr` 已在 fallback path lazy import。
- Non-goals：
  - 不修復 HOOPS A3D primary converter（vendor-side）
  - 不還原 `IfcRelAggregates` / `IfcRelContainedInSpatialStructure` 等 BIM hierarchy
  - 不引入 production queue dependency
  - 不改變既有 mapping `mock=false` 規範
  - 不改變 `unmapped` / `sidecar-only` 政策
