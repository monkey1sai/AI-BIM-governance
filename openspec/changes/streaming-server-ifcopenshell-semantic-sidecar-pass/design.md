## Context

`Ifc2UsdcPowershellConverterAdapter._materialize_sidecars` 在 conversion 完成
後產 sidecars。三條 path:

```text
_materialize_sidecars
├── adopted = _adopt_converter_sidecars(...)          # converter (HOOPS/Kit) emits sidecars?
│   └── if all four files exist → load + supplement quality_metrics
├── _enumerate_usd_stage(...)                          # 自己 traverse USD
│   └── pxr.Usd.Stage.Open + 列 prim + 抽 CustomData ifc:* keys
└── _run_ifcopenshell_openusd_fallback(...)            # 只在 HOOPS import failure 才走
    └── IfcOpenShell + usd-core 自寫 mapping + IFC-class grouped prim
```

C1(2026-05-25 `streaming-server-fallback-semantic-mapping`)讓 fallback 寫
semantic 欄位。C6(2026-05-26 `streaming-server-enumeration-semantic-mapping`)
讓 enumeration / adopt 兩條 path 從 prim CustomData 抽 semantic。

2026-05-26 archive-closeout evidence 證實 HOOPS 產出 USD 100% 沒任何
`ifc:*` / `ifcGlobalId` / `ifcType` / `ifcName` CustomData(forensics 在
`c2-viewer-semantic-final-vendor-blocker.md`)。enumeration 抽不到 →
quality_metrics 三欄位寫 `null` / `false` → viewer Semantic = `no`。

`_run_ifcopenshell_openusd_fallback` 內 IfcOpenShell 已證明能解使用者
341MB IFC(2026-05-22 `fix-ifc-usdc-hoops-load-failure`:fallback path
`source_ifc_entity_count=4889`,`mapped_count=4889`)。本 change 把
IfcOpenShell 從 fallback-only 推到 HOOPS happy path 後 sidecar pass。

## Approach

### D1. 新 helper `_run_ifcopenshell_semantic_sidecar`

新增 module-level helper(`ifc2usdc_powershell_adapter.py`):

```python
def _run_ifcopenshell_semantic_sidecar(
    ifc_source_path: Path,
    artifact_dir: Path,
    *,
    logger: logging.Logger | None = None,
) -> Path | None:
    """Open IFC, iterate IfcProduct, write ifc_semantic_sidecar.json.

    Returns sidecar path on success; None when IFC missing or parse fails.
    Never raises — sidecar pass MUST NOT block HOOPS-success ready publication.
    """
    if not ifc_source_path.is_file():
        return None
    try:
        import ifcopenshell  # already in fallback external prerequisites
    except ImportError:
        return None
    try:
        ifc_file = ifcopenshell.open(str(ifc_source_path))
    except Exception:
        return None
    entries: list[dict[str, Any]] = []
    for shape_index, product in enumerate(ifc_file.by_type("IfcProduct")):
        guid = getattr(product, "GlobalId", None)
        if not guid:
            continue
        entries.append({
            "ifc_guid": str(guid),
            "ifc_type": str(product.is_a()) if hasattr(product, "is_a") else None,
            "ifc_name": str(getattr(product, "Name", "") or "") or None,
            "shape_index": shape_index,
        })
    sidecar_doc = {
        "format_version": "1",
        "ifc_source": str(ifc_source_path),
        "entries": entries,
        "summary": {
            "count": len(entries),
            "has_type": any(e["ifc_type"] for e in entries),
            "has_name": any(e["ifc_name"] for e in entries),
        },
    }
    sidecar_path = artifact_dir / "ifc_semantic_sidecar.json"
    sidecar_path.write_text(json.dumps(sidecar_doc, ensure_ascii=False, indent=2))
    return sidecar_path
```

### D2. sidecar JSON schema

```json
{
  "format_version": "1",
  "ifc_source": "<host-absolute IFC path>",
  "entries": [
    {
      "ifc_guid": "<IFC GlobalId>",
      "ifc_type": "<IfcCableCarrierSegment | IfcWall | ... | null>",
      "ifc_name": "<entity name | null>",
      "shape_index": 0
    }
  ],
  "summary": {
    "count": 4889,
    "has_type": true,
    "has_name": true
  }
}
```

- `format_version` 用 string 不用 int,以利未來 schema 演進
- `entries` 以 IfcProduct iterator 順序排列(`shape_index` = enumerate 序號)
- 沒 GlobalId 的 IfcProduct 不寫(避免 fabricate)
- `summary` 為 enumeration / quality_metrics 推導用 cache,避免每次 re-iterate
- co-located with `model.usdc`(artifact dir 內)

### D3. `_enumerate_usd_stage` 讀 sidecar supplement

既有 enumeration loop 維持 CustomData 優先抽:

```python
# 既有 (C6 archive):
ifc_guid = _read_prim_custom(prim, "ifc:guid", "ifcGlobalId", "ifc_guid")
if ifc_guid:
    ifc_type = _read_prim_custom(prim, "ifc:type", "ifcType", "ifc_type")
    ifc_name = _read_prim_custom(prim, "ifc:name", "ifcName", "ifc_name")
    mapping_items.append({...})  # 五 keys + entity_id
```

新增 sidecar fallback:

```python
# C6 loop 結束後,若 mapping_items 為空 (HOOPS 沒寫 IFC CustomData):
if not mapping_items:
    sidecar = _load_sidecar_if_present(artifact_dir)  # returns dict or None
    if sidecar:
        prim_list = list(stage.Traverse())  # 同 enumeration order
        for prim_index, prim in enumerate(prim_list):
            if not prim.IsValid() or not prim.IsA(UsdGeom.Mesh):
                continue
            entry = _sidecar_entry_for_index(sidecar, prim_index)  # best-effort
            if not entry:
                continue
            mapping_items.append({
                "ifc_guid": entry["ifc_guid"],
                "usd_prim_path": str(prim.GetPath()),
                "ifc_type": entry["ifc_type"],
                "ifc_name": entry["ifc_name"],
                "entity_id": f"entity_{prim_index:06d}",
            })
            entity_items.append({...})
```

對齊策略(`_sidecar_entry_for_index`):
- v1:enumeration mesh prim 順序 vs sidecar entries 順序,best-effort 1:1
- 不要求 1:1 完美對齊;若兩邊 count 不同則用 `min(len(mesh_prims), len(entries))`
- 設計理由:viewer 的「點選 USD prim → 查 IFC element」這層即使順序錯一個
  entity,只要 prim ↔ entity 雙向都能查到,demo 體驗就成立。精準 GUID join
  屬 Sidecar Pass v2(open question Q1)

### D4. quality_metrics 推導擴充

```python
# 既有 C6:
has_type = any(item.get("ifc_type") for item in mapping_items)
has_name = any(item.get("ifc_name") for item in mapping_items)
if mapping_items_came_from_prim_custom_data:
    fidelity = ("ifc_class_grouped_with_name" if (has_type and has_name)
                else "usd_enumeration_with_ifc_custom_data" if (has_type or has_name)
                else None)
elif mapping_items_came_from_sidecar_supplement:
    fidelity = "usd_enumeration_with_ifc_sidecar_supplement"
else:
    fidelity = None
```

viewer `computeSemanticReady`(`web-viewer-sample`)只看
`mapping_has_ifc_type` + `mapping_has_ifc_name`(2026-05-26 archive 已確認),
不解 fidelity 字串 → 新 fidelity value 不破壞 viewer。

### D5. Main flow 整合

`_materialize_sidecars` 在 HOOPS success / `_adopt_converter_sidecars` 走完
但 quality_metrics 三 semantic 欄位仍 falsy 時,序列追加 sidecar pass:

```python
def _materialize_sidecars(self, ...):
    adopted = self._adopt_converter_sidecars(...)
    if adopted and adopted.get("quality_metrics", {}).get("mapping_has_ifc_type"):
        return adopted  # 既有 path:HOOPS 寫好 IFC metadata,不需 sidecar

    # 新增:HOOPS happy path 沒 IFC CustomData → 跑 sidecar pass
    sidecar_path = _run_ifcopenshell_semantic_sidecar(
        ifc_source_path=self._resolve_ifc_source_path(job),
        artifact_dir=self._artifact_dir(job),
        logger=self._logger,
    )
    enumerated = self._enumerate_usd_stage(..., sidecar_path=sidecar_path)
    return enumerated
```

序列順序 (HOOPS success):
1. HOOPS 寫 `model.usdc`
2. `_adopt_converter_sidecars` 嘗試讀 emitted sidecars(若 HOOPS 自己有寫)
3. 若 (2) 沒拿到 IFC semantic → 跑 `_run_ifcopenshell_semantic_sidecar`(此處 +30-40s for 89MB)
4. `_enumerate_usd_stage` 帶 sidecar_path 參數,prim CustomData 抽不到時讀 sidecar
5. quality_metrics 三 semantic 欄位推導 + publish ready

### D6. 失敗 / 缺資料 honest fallback

| 狀況 | 行為 |
|---|---|
| IFC source path 不存在(已過期 / 已清理) | sidecar pass 回 None;enumeration 走 no-data path;semantic 三欄位 falsy;ready 不被阻塞 |
| IfcOpenShell ImportError | 同上 |
| `ifcopenshell.open()` 例外 | 同上 + log warning |
| sidecar 寫成功但 entries 空(`IfcProduct` 全沒 GlobalId,實務不會發生) | sidecar 落地但 enumeration 仍 no-data;semantic 三欄位 falsy |
| sidecar 寫成功且 enumeration 順利對齊 | semantic 三欄位 truthy,viewer Semantic ready = yes |

**Non-fabricating 原則**:
- sidecar 來源限定 IfcOpenShell 解析真實 IFC source
- enumeration 只在 mapping_items 為空時讀 sidecar(prim CustomData 有 IFC 時不
  shadow 它)
- 不從 prim path 名稱、mesh name、material 推導 IFC 語意

### D7. Test strategy

`bim-streaming-server/tests/test_host_native_conversion_service.py` 新增 unit
test(走 module-level helper + adapter method,不需要真實 IFC):

1. `test_sidecar_pass_writes_json_for_valid_ifc`:fake IFC fixture +
   monkey-patched `ifcopenshell.open` → assert sidecar JSON 落地、schema 正確
2. `test_sidecar_pass_returns_none_for_missing_ifc`:IFC path 不存在 → 回 None,
   不抛例外
3. `test_sidecar_pass_returns_none_when_ifcopenshell_missing`:monkey-patch
   `ifcopenshell.open` raise ImportError → 回 None
4. `test_enumeration_reads_sidecar_when_prim_custom_data_empty`:fake USD stage
   無 prim CustomData + sidecar entries 存在 → mapping_items 從 sidecar 補 +
   quality_metrics `semantic_mapping_fidelity =
   "usd_enumeration_with_ifc_sidecar_supplement"`、`mapping_has_ifc_type` /
   `mapping_has_ifc_name` truthy
5. `test_enumeration_prefers_prim_custom_data_over_sidecar`:fake USD stage
   有 prim CustomData 寫 ifc keys + sidecar entries 同時存在 → mapping_items
   用 CustomData,sidecar 不 shadow(維持 C6 archive 行為)
6. `test_enumeration_stays_honest_when_neither_source_present`:fake USD stage
   無 CustomData + 無 sidecar → mapping_items 空 + semantic 三欄位 falsy
7. **既有 C1 / C6 test** 不破壞(`_run_ifcopenshell_openusd_fallback` 與
   `_enumerate_usd_stage` CustomData-only path 維持 baseline)

L4 (apply 後,真機 evidence):
- 重啟 host-native conversion service
- 重跑 89MB IFC 或使用者 341MB IFC(`storage/ifc-cache/ifcready_*/source.ifc`)
- 驗 `GET /api/conversions/<id>/result.quality_metrics.semantic_mapping_fidelity
  = "usd_enumeration_with_ifc_sidecar_supplement"`、`mapping_has_ifc_type = true`、
  `mapping_has_ifc_name = true`
- 驗 artifact dir 內 `ifc_semantic_sidecar.json` 存在 + summary count > 0
- Chrome MCP 抓 viewer `tri-ready-semantic = "Semantic: yes"`
- 證據放 `docs/evidence/streaming-server-ifcopenshell-semantic-sidecar-pass/`

## Risks

- **Sidecar 與 USD prim 對齊不精準**:IfcProduct iterator 順序 vs HOOPS USD
  Traverse mesh prim 順序不保證 1:1。本 change v1 走 best-effort enumeration
  order index,demo 上「點選 prim → 查 IFC element」即使順序錯一個 entity
  在 viewer 體驗上仍可用(類 column-store)。精準 GUID-level join 屬 Sidecar
  Pass v2 follow-up,需要更深的 HOOPS USD prim → IFC GUID inverse lookup
  研究。
- **Conversion ready latency 增加**:對 89MB IFC,sidecar pass 序列 +30-40s。
  fast MVP demo 可接受;若使用者 demo 主要使用更大 IFC(341MB +),可能要
  考慮 async / progress chunk。本 change 不引入 async 路徑;若 latency 變 demo
  blocker 再開 Sidecar Pass v2 改 async。
- **IfcOpenShell 版本漂移**:fallback path 用 IfcOpenShell 的 `.by_type` /
  `.open` API 是 stable surface(v0.7+ 一致),但若 host-native Python env
  ifcopenshell ImportError,本 change 走 honest skip(D6),不抛例外。
- **HOOPS 未來版本可能補 IFC CustomData**:若 vendor 後續修正 A3D 寫 IFC keys
  進 USD prim,本 change 的 sidecar pass 自動被 CustomData 路徑 shadow(D3
  優先序),sidecar 仍寫但不被讀,屬無害冗餘。後續可開 follow-up 把 sidecar
  pass 改 conditional 跑(prim CustomData 已有時跳過 sidecar)。
- **真實 IFC 找不到**:若 conversion 完成後 IFC source 已被 retention 清理
  (對齊 `queue-batch-dispatch-and-post-usdc-artifact-retention` strategy A
  scratch retention),sidecar pass 回 None。demo 主鏈不受影響,只是 Semantic
  ready 維持 no(誠實)。

- **Sidecar 暴露於 /artifacts public mount**(CodeRabbit P2,follow-up):
  `host_native_conversion_service.py` 把 `config.artifacts_root` 整個 mount 在
  `/artifacts` StaticFiles。`ifc_semantic_sidecar.json` 寫在 artifact dir 內,
  與既有 `element_mapping.json` / `entity_index.json` / `quality_metrics.json`
  公開暴露程度一致(它們都含 IFC GUID / Name)。本 change 不增量擴大 attack
  surface 也不縮小;後續若要把 mapping / sidecar 從公開 tree 拉出,屬獨立
  hardening change(會牽動 coordinator artifact_refs URL contract 與 viewer
  fetch path),不在本 sidecar pass scope。
