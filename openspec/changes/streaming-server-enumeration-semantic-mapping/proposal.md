## Why

`streaming-server-fallback-semantic-mapping`(2026-05-25 archived,PR #106)
讓 `_run_ifcopenshell_openusd_fallback` 寫 `semantic_mapping_fidelity` /
`mapping_has_ifc_type` / `mapping_has_ifc_name` + IFC-class grouped prim path,
但只動 fallback path(HOOPS A3D import failure 才走)。

`coordinator-forward-quality-metrics-summary`(2026-05-26 archived,PR #115)
讓 coordinator 把 streaming-server `quality_metrics_summary` forward 給 viewer
/ `/ui`。

2026-05-26 archive-closeout evidence(`docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/c2-viewer-semantic-yes-after-forward.md`)實測:89MB IFC happy
path 走 `materialization_strategy="usd_stage_enumeration"` — HOOPS primary 處理
成功 + sidecar enumeration 補 mapping,**不走** C1 fallback。`_enumerate_usd_stage`
與 `_adopt_converter_sidecars` 兩條 path 都沒寫 C1 三個 semantic 欄位 → viewer
Semantic 永遠 `no`。

fast MVP 真實 happy path 應該是「HOOPS 成功 → enumeration / adopt converter
sidecars」,不是「HOOPS 失敗 → IfcOpenShell fallback」。本 change 把 C1 semantic
mapping fidelity 推到這兩條主流 path,讓 fast MVP Semantic ready 真能 yes。

## What Changes

- 修改 `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`:
  - `_enumerate_usd_stage`:從 USD prim CustomData `ifcType` / `ifcName`(C1
    fallback 與 HOOPS converter 都會寫)抽出 IFC 語意,mapping items 加
    `ifc_type` / `ifc_name` / `entity_id` 欄位;entity_index entries 對齊
    補 `entity_id`;`quality_metrics` dict 加三 semantic 欄位
    (`semantic_mapping_fidelity = "usd_enumeration_with_ifc_custom_data"`、
    `mapping_has_ifc_type` / `mapping_has_ifc_name` 依實際 mapping items
    truthy 推導)
  - `_adopt_converter_sidecars`:讀完 converter-emitted quality 後,如果
    `semantic_mapping_fidelity` 缺失但 `emitted_mapping.items` 含 ifc_type
    /ifc_name,supplement 上述三欄位(non-fabricating:僅依現有 mapping data
    推導,不假造)
- 不改 `_run_ifcopenshell_openusd_fallback`(C1 已正確處理)
- 不改 HOOPS primary converter binary、不改 coordinator / viewer / callback
  outbox

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `streaming-ifc-usdc-conversion-authority`:
  - ADD requirement「Enumeration and adoption sidecar paths emit IFC-semantic
    mapping fidelity」covering 兩條 main happy path 寫 semantic 欄位 + IFC
    class / name from USD CustomData + entity_id 對齊 + backward compat

## Impact

- Owner repo / folder:`bim-streaming-server/source/extensions/.../ifc2usdc_powershell_adapter.py`、
  `bim-streaming-server/tests/test_host_native_conversion_service.py`、
  `openspec/changes/streaming-server-enumeration-semantic-mapping/`
- Runtime boundary:不改 streaming-server / coordinator / viewer / callback
  邊界;純 conversion adapter 內部 enrichment
- API:`GET /api/conversions/<id>/result` 回應 `quality_metrics` 為 additive
  變更(加 3 個 optional 欄位,既有 consumer 不受影響)
- Data:`element_mapping.json` items 為 additive(加 `ifc_type` / `ifc_name`
  / `entity_id` keys);`entity_index.json` entries 加 `entity_id` key
- Dependencies:無新增
- Non-goals:
  - 不改 HOOPS A3D primary converter library(vendor-side)
  - 不改 prim path 命名(USD stage 已產出,改名會破 viewer DataChannel highlight)
  - 不還原 IfcRelAggregates / IfcRelContainedInSpatialStructure 等 BIM
    hierarchy
  - 不引入新 production dependency
