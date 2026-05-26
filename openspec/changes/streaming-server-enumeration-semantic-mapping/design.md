## Context

`Ifc2UsdcPowershellConverterAdapter._materialize_sidecars` 在 conversion 完成後
產 sidecars。兩條 path:

```text
_materialize_sidecars
├── adopted = _adopt_converter_sidecars(...)  # converter (HOOPS/Kit) emits sidecars?
│   └── if all four files exist → 直接 load quality_metrics.json
└── _enumerate_usd_stage(...)                  # fallback: 自己 traverse USD
    └── pxr.Usd.Stage.Open + 列 prim + 抽 CustomData ifc:guid
```

C1 archive 讓 `_run_ifcopenshell_openusd_fallback`(更下層的 fallback,只在
HOOPS import failure 才走)寫 semantic 欄位 + IFC-class grouped prim path。
但 enumeration / adopt 兩條 main happy path 沒寫。

2026-05-26 89MB IFC 實測:走 enumeration → `materialization_strategy =
"usd_stage_enumeration"`,quality_metrics 沒 semantic 欄位 → viewer Semantic=no。

## Approach

### D1. enumeration path:從 USD CustomData 抽 IFC 語意

C1 fallback 寫的 USD prim 有 CustomData:`ifcGlobalId` / `ifc_guid` / `ifcName`
/ `ifcType`。HOOPS converter 寫的 prim 也常用 `ifc:guid` / `ifcGlobalId` /
`ifcType` / `ifcName`(Omniverse IFC import convention)。

```python
# 既有 enumerate:
for prim in prims:
    ifc_guid = prim.GetCustomDataByKey("ifc:guid") or prim.GetCustomDataByKey("ifcGlobalId")
    if ifc_guid:
        mapping_items.append({"ifc_guid": str(ifc_guid), "usd_prim_path": str(prim.GetPath())})

# 新加:
def _read_prim_custom(prim, *keys):
    for key in keys:
        value = prim.GetCustomDataByKey(key)
        if value not in (None, ""):
            return str(value)
    return None

# 改 loop:
for prim_index, prim in enumerate(prims):
    ifc_guid = _read_prim_custom(prim, "ifc:guid", "ifcGlobalId", "ifc_guid")
    if not ifc_guid:
        continue
    ifc_type = _read_prim_custom(prim, "ifc:type", "ifcType", "ifc_type")
    ifc_name = _read_prim_custom(prim, "ifc:name", "ifcName", "ifc_name")
    entity_id = f"entity_{prim_index:06d}"
    mapping_items.append({
        "ifc_guid": ifc_guid,
        "usd_prim_path": str(prim.GetPath()),
        "ifc_type": ifc_type,
        "ifc_name": ifc_name,
        "entity_id": entity_id,
    })
    entity_items.append({
        "ifc_guid": ifc_guid,
        "ifc_type": ifc_type,
        "name": ifc_name,
        "usd_prim_path": str(prim.GetPath()),
        "entity_id": entity_id,
    })
```

`entity_index.json` schema 也對齊 C1(entities list 含 ifc_guid / ifc_type /
name / usd_prim_path / entity_id)。

### D2. enumeration path:quality_metrics 加 semantic 欄位

```python
has_type = any(item.get("ifc_type") for item in mapping_items)
has_name = any(item.get("ifc_name") for item in mapping_items)
# Strict:同時有 type 與 name 才宣 ifc_class_grouped_with_name;否則 enum-only
fidelity = "ifc_class_grouped_with_name" if (has_type and has_name) else \
           ("usd_enumeration_with_ifc_custom_data" if (has_type or has_name) else None)

return {
    # 既有
    "source_ifc_entity_count": ...,
    "mapped_count": ...,
    "materialization_strategy": "usd_stage_enumeration",
    ...,
    # 新增
    "semantic_mapping_fidelity": fidelity,
    "mapping_has_ifc_type": has_type,
    "mapping_has_ifc_name": has_name,
    ...
}
```

注意:fidelity 三狀態
- `"ifc_class_grouped_with_name"`(對齊 C1)→ viewer Semantic=yes
- `"usd_enumeration_with_ifc_custom_data"`(只有部分)→ viewer Semantic=incomplete
- `None`(prim 沒任何 IFC custom data)→ viewer Semantic=no(誠實)

### D3. adopt path:supplement 既有 quality

converter (HOOPS) 自己 emit `quality_metrics.json` 時可能已寫 semantic 欄位,
也可能沒寫。`_adopt_converter_sidecars` 改:

```python
quality = json.loads(emitted_quality.read_text(...))
# 若 converter 自己沒寫 semantic 欄位,但 emitted_mapping.items 已有 ifc_type
# / ifc_name(可能是 C1 fallback 之前的某次成功 + 仍 reuse,或 HOOPS 自己也寫),
# supplement 補上(non-fabricating)。
if quality.get("semantic_mapping_fidelity") is None:
    emitted_mapping_doc = json.loads(emitted_mapping.read_text(...))
    items = emitted_mapping_doc.get("items", [])
    has_type = any(item.get("ifc_type") for item in items)
    has_name = any(item.get("ifc_name") for item in items)
    if has_type and has_name:
        quality["semantic_mapping_fidelity"] = "ifc_class_grouped_with_name"
    elif has_type or has_name:
        quality["semantic_mapping_fidelity"] = "usd_enumeration_with_ifc_custom_data"
    if "mapping_has_ifc_type" not in quality:
        quality["mapping_has_ifc_type"] = has_type
    if "mapping_has_ifc_name" not in quality:
        quality["mapping_has_ifc_name"] = has_name
return quality
```

**Non-fabricating principle**:只看 emitted_mapping 內既有 data,不從外部
推導也不假造。converter 自己有寫的 path 不被蓋(用 `is None` / `not in`
guard)。

### D4. Test strategy

`bim-streaming-server/tests/test_host_native_conversion_service.py` 加:

- **enumeration path with ifc custom data**:fake USD prim 帶 `ifcGlobalId`
  / `ifcType` / `ifcName` custom data → assert mapping items 含 ifc_type/
  ifc_name/entity_id,quality_metrics 有 fidelity / has_type=True / has_name=True
- **enumeration path with empty custom data**:fake prim 無 IFC custom data →
  assert mapping_items 空 + fidelity=None + has_type=False + has_name=False
- **adopt path supplement**:emitted_quality 無 semantic 欄位但 emitted_mapping
  items 有 ifc_type/ifc_name → adopt 後 quality 補三欄位
- **adopt path no supplement**:emitted_quality 已有 semantic_mapping_fidelity
  時 不被蓋掉
- **既有 fallback test** 不破壞(C1 archive 行為保留)

### D5. Archive evidence

- 用既有 89MB IFC 重跑 → conversion ready + `quality_metrics_summary.semantic_mapping_fidelity` /
  `mapping_has_ifc_type` / `mapping_has_ifc_name` 非 null/true
- Chrome MCP 抓 viewer:`tri-ready-semantic = "Semantic: yes"`

## Risks

- USD CustomData 內 IFC key 命名不統一:不同 HOOPS / Kit 版本可能寫 `ifc:type`
  / `ifcType` / `ifc_type` 任一。本 change 用 `_read_prim_custom` 對三種 key
  都嘗試,降低 key naming gap 風險
- enumeration path 的 prim count 在大 IFC 可能上萬,逐 prim CustomData read
  有 perf 成本。對 89MB IFC 實測 1-2 秒可接受;若未來 IFC 更大需另外 profile
- adopt path supplement 邏輯不應蓋過 converter 自己寫的值;test 必須驗證
  pre-existing 欄位不被 overwrite
