## Context

`_run_ifcopenshell_openusd_fallback`(`bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`)
目前產出：

```python
prim_path = f"/World/IfcShape_{shape_count:06d}"
mapping_items.append({"ifc_guid": ifc_guid, "usd_prim_path": prim_path})
entity_items.append({
    "ifc_guid": ifc_guid or None,
    "ifc_type": ifc_type or None,
    "name": ifc_name or None,
    "usd_prim_path": prim_path,
})
```

`ifc_type` / `ifc_name` 已在 `entity_index.json` 保留，但 `element_mapping.json` 的
mapping item 沒帶這些欄位，且 mapping_items / entity_items 兩 list 沒有顯式 row id
對齊。viewer / `/ui` 因而只能拿到 IFC GUID + shape-level USD path，無法直接呈現
BIM 語意。

## Approach

### D1. mapping item schema 加 IFC 語意欄位（additive）

```python
mapping_items.append({
    "ifc_guid": ifc_guid,
    "usd_prim_path": prim_path,
    "ifc_type": ifc_type or None,
    "ifc_name": ifc_name or None,
    "entity_id": entity_id,        # 與 entity_index 對齊
})
```

`ifc_type` / `ifc_name` 可為 null（IfcOpenShell 對某些 shape 取不到 type/name），但
欄位 schema 必須存在。新欄位 additive，既有 viewer / coordinator ingest 仍可用舊
schema 解析。

### D2. USD prim path 改為 IFC class grouped

```python
ifc_class_token = _safe_usd_prim_name(ifc_type) or "Unclassified"
guid_token = _safe_usd_prim_name(ifc_guid) or f"Shape_{shape_count:06d}"
prim_path = f"/World/{ifc_class_token}/{guid_token}"
```

`_safe_usd_prim_name` 把 IFC GUID 與 IFC class 字串轉成 USD-legal identifier：

- 只保留 `[A-Za-z0-9_]`
- 開頭非字母 / `_` 則 prepend `_`
- 空字串回傳 None

IFC GUID 22 字元 base64-like 中含 `$` 等特殊字元，必須 sanitize。USD prim 中
parent xform `/World/<IfcClass>` 用 `UsdGeom.Xform.Define` 建立（per IfcClass
僅建一次）。

### D3. entity_id 對齊

```python
entity_id = f"entity_{shape_count:06d}"
mapping_items.append({..., "entity_id": entity_id})
entity_items.append({"entity_id": entity_id, ...})
```

mapping_items 與 entity_items 用同一 entity_id 對齊，viewer 可拿 mapping item 的
entity_id 查 entity_index.json 取得完整 IFC entity info。

### D4. quality_metrics 新欄位

```python
quality_metrics = {
    # 既有
    "source_ifc_entity_count": source_count,
    "mapped_count": mapped_count,
    "unmapped_count": ...,
    "coverage_ratio": coverage_ratio,
    "coverage_status": "pass" if mapped_count == source_count else "warn",
    "materialization_strategy": "ifcopenshell_openusd_fallback",
    "sidecar_carrier_count": shape_count,
    "minimum_coverage_baseline_locked": False,
    "hard_quality_gates": {...},
    # 新增
    "semantic_mapping_fidelity": "ifc_class_grouped_with_name",
    "mapping_has_ifc_type": True,
    "mapping_has_ifc_name": True,
}
```

`semantic_mapping_fidelity` 是 enum-like string：
- `"ifc_class_grouped_with_name"`：本 change 落地後 fallback 的標準值
- 未來若引入 IfcRelAggregates 還原可加新 enum value（不在本 change scope）

`mapping_has_ifc_type` / `mapping_has_ifc_name` 是 boolean，coordinator / viewer
判定 Semantic ready 時拿這兩個欄位作為快速判斷依據（不需要逐筆掃 mapping_items）。

### D5. Backward compatibility

- `mapping_items[i]["usd_prim_path"]` 仍存在，舊 viewer / coordinator ingest 仍能用
- `mapping_items[i]["ifc_guid"]` 仍存在
- 新增欄位 viewer / coordinator 不認識也不會報錯
- `quality_metrics` 新欄位以 additive 方式加入；舊 consumer 不會 break

### D6. USD prim 衝突處理

同 IFC class + 同 GUID 重複時（不該發生，但保險起見）：

```python
if stage.GetPrimAtPath(prim_path).IsValid():
    prim_path = f"/World/{ifc_class_token}/{guid_token}_{shape_count:06d}"
```

雖然 IFC GUID 在同一 IFC file 內應該唯一，但若 IfcOpenShell geometry iterator
對同一 entity 產出多個 shape（不常見），衝突 path 加 shape_count 後綴。

### D7. Test strategy

- 新增 fixture：mock IfcOpenShell shape with (guid="GUID_A", name="樓梯1", type="IfcStair")
  → 驗證 mapping item 含 `ifc_type="IfcStair"` / `ifc_name="樓梯1"` / `entity_id` /
  prim path `/World/IfcStair/<sanitized GUID_A>`
- 新增 fixture：shape with empty type → 驗證 fallback 使用 `/World/Unclassified/...`
- 新增 fixture：shape with special-char GUID → 驗證 sanitization
- 驗證 quality_metrics 含三個新欄位
- 驗證 entity_index.json 與 mapping_items entity_id 對齊
- 既有 fallback test（USDC openable / has_renderable_prims / placeholder_output=false）
  保持通過

### D8. Archive evidence

- 用既有 IFC fixture 重跑 fallback path：
  - `element_mapping.json` 每筆帶 `ifc_type` + `ifc_name` field（值可為 null）
  - `model.usdc` 內有 `/World/IfcCableCarrierSegment/...` 等 IFC class grouped prim
  - `quality_metrics.json` 含 `semantic_mapping_fidelity=ifc_class_grouped_with_name`
  - `mapping_items[i].entity_id` 與 `entity_index.entities[i].entity_id` 對齊
- 不需要 GPU / Kit live evidence
- C2 / C3 archive 時才需要 Chrome E2E viewer evidence

## Risks

- mapping_items 的 ifc_type / ifc_name 可能為 null（IfcOpenShell 對部分 entity 取不
  到 type/name）。Spec scenario 必須允許 null，但 schema field 存在
- USD prim sanitization 規則改動可能影響 element_mapping 與 USD stage 的 round-trip
  讀取；test 必須驗證 `Usd.Stage.Open` 之後 prim path 可被 GetPrimAtPath 找到
- IFC class grouped 後 `/World` 下會多很多 IfcClass xform 節點；viewer USD stage
  tree 顯示時要承受這個層次。本 change 不改 viewer USD stage tree 行為（viewer
  目前用 mapping item 的 usd_prim_path 操作，不依賴 stage tree 排序）
