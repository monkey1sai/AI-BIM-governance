"""A2 diff 引擎驗證 — 合成（確定性）+ 真實版本對（GUID 多級對齊證明）。"""
from __future__ import annotations

import os

import ifcopenshell
import ifcopenshell.guid
import pytest

from diff_engine import open_model, run_diff, run_diff_on_paths

_GA = ifcopenshell.guid.new()
_GB = ifcopenshell.guid.new()
_GC = ifcopenshell.guid.new()

BASE_IFC = r"C:\Repos\active\iot\AI-BIM-governance\storage\許良宇圖書館建築_2026.ifc"
TGT_IFC = r"C:\Repos\active\iot\AI-BIM-governance\storage\許良宇圖書館建築_2026 - 轉檔測試2.ifc"


def _wall(f, name, xyz, guid, status=None):
    pt = f.create_entity("IfcCartesianPoint", Coordinates=tuple(float(v) for v in xyz))
    ax = f.create_entity("IfcAxis2Placement3D", Location=pt)
    plc = f.create_entity("IfcLocalPlacement", RelativePlacement=ax)
    wall = f.create_entity("IfcWall", GlobalId=guid, Name=name, ObjectPlacement=plc)
    if status is not None:
        prop = f.create_entity("IfcPropertySingleValue", Name="Status", NominalValue=f.create_entity("IfcLabel", status))
        pset = f.create_entity("IfcPropertySet", GlobalId=ifcopenshell.guid.new(), Name="Pset_WallCommon", HasProperties=[prop])
        f.create_entity("IfcRelDefinesByProperties", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[wall], RelatingPropertyDefinition=pset)
    return wall


def _base():
    f = ifcopenshell.file(schema="IFC4")
    _wall(f, "W-A", (0, 0, 0), _GA, status="EXISTING")
    _wall(f, "W-B", (5000, 0, 0), _GB, status="EXISTING")
    return f


def _target():
    f = ifcopenshell.file(schema="IFC4")
    _wall(f, "W-A", (0, 0, 10000), _GA, status="DEMOLISHED")  # moved + pset changed
    _wall(f, "W-C", (9000, 0, 0), _GC, status="NEW")  # added
    # W-B removed
    return f


def test_synthetic_diff_classifies_changes():
    diff = run_diff(_base(), _target(), move_tol=1.0)
    assert diff.matched == 1  # 只有 W-A 以 GUID 對齊
    assert diff.counts.get("added") == 1  # W-C
    assert diff.counts.get("removed") == 1  # W-B
    assert diff.counts.get("moved") == 1  # W-A 移動 10m
    assert diff.counts.get("property_changed") == 1  # W-A Status 改變

    # 誠實：added/removed 帶真實 guid
    added = diff.items_by_type("added")[0]
    assert added.ifc_guid == _GC
    moved = diff.items_by_type("moved")[0]
    assert moved.ifc_guid == _GA
    assert moved.evidence["target_xyz"] == (0.0, 0.0, 10000.0)


def test_no_changes_when_identical():
    diff = run_diff(_base(), _base(), move_tol=1.0)
    assert diff.matched == 2
    assert diff.counts.get("added", 0) == 0
    assert diff.counts.get("removed", 0) == 0
    assert diff.counts.get("moved", 0) == 0


# ---- A2-002：退階對齊（Tag / type+name+loc）路徑測試（含 A2-001 型別護欄）----

def _element(f, ifc_type, name, xyz, guid, tag=None, status=None):
    """合成任意型別 IfcElement，可指定 Tag 與 Pset_*Common.Status；風格沿用 _wall。"""
    pt = f.create_entity("IfcCartesianPoint", Coordinates=tuple(float(v) for v in xyz))
    ax = f.create_entity("IfcAxis2Placement3D", Location=pt)
    plc = f.create_entity("IfcLocalPlacement", RelativePlacement=ax)
    el = f.create_entity(ifc_type, GlobalId=guid, Name=name, ObjectPlacement=plc, Tag=tag)
    if status is not None:
        prop = f.create_entity("IfcPropertySingleValue", Name="Status", NominalValue=f.create_entity("IfcLabel", status))
        pset = f.create_entity("IfcPropertySet", GlobalId=ifcopenshell.guid.new(), Name="Pset_Common", HasProperties=[prop])
        f.create_entity("IfcRelDefinesByProperties", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[el], RelatingPropertyDefinition=pset)
    return el


def test_tag_alignment_same_type_different_guid():
    """(a) GUID 不同但 Tag 相同且同型別 → 應以 tag 對齊（evidence.match == 'tag'）。"""
    base = ifcopenshell.file(schema="IFC4")
    _element(base, "IfcWall", "W-A", (0, 0, 0), ifcopenshell.guid.new(), tag="123", status="EXISTING")
    target = ifcopenshell.file(schema="IFC4")
    # 不同 GUID、同 Tag、同型別 → GUID 級不中、Tag 級命中；移動以產生可觀察的 moved 證據
    _element(target, "IfcWall", "W-A", (0, 0, 10000), ifcopenshell.guid.new(), tag="123", status="DEMOLISHED")

    diff = run_diff(base, target, move_tol=1.0)
    assert diff.matched == 1
    assert diff.counts.get("added", 0) == 0
    assert diff.counts.get("removed", 0) == 0
    moved = diff.items_by_type("moved")
    assert len(moved) == 1
    assert moved[0].evidence["match"] == "tag"  # 退到 Tag 對齊
    prop = diff.items_by_type("property_changed")
    assert len(prop) == 1 and prop[0].evidence["match"] == "tag"


def test_type_name_loc_alignment_when_guid_and_tag_differ():
    """(b) GUID 與 Tag 都不同，但 type+Name+取整 loc 相同 → 以 type_name_loc 對齊。"""
    base = ifcopenshell.file(schema="IFC4")
    _element(base, "IfcWall", "W-A", (1000, 2000, 3000), ifcopenshell.guid.new(), tag="t-base", status="EXISTING")
    target = ifcopenshell.file(schema="IFC4")
    # 不同 GUID、不同 Tag、同 type+Name+loc → 退到第三級；改 Status 觸發 property_changed 以驗證歸屬
    _element(target, "IfcWall", "W-A", (1000, 2000, 3000), ifcopenshell.guid.new(), tag="t-target", status="DEMOLISHED")

    diff = run_diff(base, target, move_tol=1.0)
    assert diff.matched == 1
    assert diff.counts.get("added", 0) == 0
    assert diff.counts.get("removed", 0) == 0
    prop = diff.items_by_type("property_changed")
    assert len(prop) == 1
    assert prop[0].evidence["match"] == "type_name_loc"  # 退到第三級鍵


def test_cross_type_same_tag_not_misaligned():
    """(c) A2-001：被刪的牆與新增的門恰好同 Tag → 應 removed+added，不誤配成 1 配對 0 變更。"""
    base = ifcopenshell.file(schema="IFC4")
    _element(base, "IfcWall", "W-X", (0, 0, 0), ifcopenshell.guid.new(), tag="SHARED-TAG")
    target = ifcopenshell.file(schema="IFC4")
    _element(target, "IfcDoor", "D-Y", (0, 0, 0), ifcopenshell.guid.new(), tag="SHARED-TAG")

    diff = run_diff(base, target, move_tol=1.0)
    # 型別護欄：跨型別同 Tag 不得成對
    assert diff.matched == 0
    assert diff.counts.get("removed") == 1
    assert diff.counts.get("added") == 1
    removed = diff.items_by_type("removed")[0]
    added = diff.items_by_type("added")[0]
    assert removed.ifc_type == "IfcWall"
    assert added.ifc_type == "IfcDoor"


def test_same_key_cluster_pairing_is_stable():
    """A2-003：同 type+Name+loc 鍵的多構件配對須穩定可重現（以 GlobalId 次鍵排序），
    property_changed 證據歸屬不依 by_type 迭代序。"""
    ga, gb = "0aaaaaaaaaaaaaaaaaaaa0", "0bbbbbbbbbbbbbbbbbbbb0"  # 固定可比較的 GlobalId 次鍵

    def _build():
        base = ifcopenshell.file(schema="IFC4")
        target = ifcopenshell.file(schema="IFC4")
        # base / target 各兩個 IfcWall 同鍵（同 Name、同 loc、無 Tag、GUID 不同）；
        # 同 GlobalId 者 Status 一致、不同者不一致 → 穩定配對下應 0 個 property_changed。
        _element(base, "IfcWall", "WC", (4000, 0, 0), ga, status="EXISTING")
        _element(base, "IfcWall", "WC", (4000, 0, 0), gb, status="NEW")
        _element(target, "IfcWall", "WC", (4000, 0, 0), gb, status="NEW")
        _element(target, "IfcWall", "WC", (4000, 0, 0), ga, status="EXISTING")
        return base, target

    base, target = _build()
    diff = run_diff(base, target, move_tol=1.0)
    assert diff.matched == 2
    assert diff.counts.get("property_changed", 0) == 0  # 穩定配對：ga↔ga、gb↔gb，Status 相同
    assert diff.counts.get("added", 0) == 0
    assert diff.counts.get("removed", 0) == 0
    # 可重現：再跑一次同樣輸入，配對與計數一致
    base2, target2 = _build()
    diff2 = run_diff(base2, target2, move_tol=1.0)
    assert diff2.counts == diff.counts


@pytest.mark.skipif(not (os.path.exists(BASE_IFC) and os.path.exists(TGT_IFC)), reason="real IFC fixture absent")
def test_real_identity_roundtrip_all_matched():
    """誠實揭露：storage 內的 許良宇*.ifc 變體彼此 byte 完全相同（同一 SHA1）。

    本測試是 identity / round-trip 檢查，**不是**變更分類測試：它只證明 GUID 多級對齊
    在真實 7139 元素規模能找到「全部匹配、0 變更」。真實模型的變更分類由
    test_real_model_modified_classification（in-memory 修改真實模型）證明；
    完整 added/removed/moved/property_changed 由合成測試證明。
    """
    diff = run_diff_on_paths(BASE_IFC, TGT_IFC, move_tol=1.0)
    assert diff.base_count > 7000 and diff.target_count > 7000
    assert diff.matched > 7000
    # 計數一致性（identity → removed=added=0）
    assert diff.matched + diff.counts.get("removed", 0) == diff.base_count
    assert diff.matched + diff.counts.get("added", 0) == diff.target_count


def _shift_placements(model, n: int) -> int:
    moved = 0
    for el in model.by_type("IfcElement"):
        if moved >= n:
            break
        plc = getattr(el, "ObjectPlacement", None)
        if plc and plc.is_a("IfcLocalPlacement") and plc.RelativePlacement and plc.RelativePlacement.is_a("IfcAxis2Placement3D"):
            loc = plc.RelativePlacement.Location
            if loc and loc.is_a("IfcCartesianPoint") and loc.Coordinates:
                coords = list(loc.Coordinates)
                coords[0] = float(coords[0]) + 5000.0
                loc.Coordinates = coords
                moved += 1
    return moved


def _add_marker_prop(model, n: int) -> int:
    changed = 0
    for el in model.by_type("IfcElement"):
        if changed >= n:
            break
        for rel in (el.IsDefinedBy or []):
            if rel.is_a("IfcRelDefinesByProperties"):
                pdef = rel.RelatingPropertyDefinition
                if pdef and pdef.is_a("IfcPropertySet"):
                    marker = model.create_entity("IfcPropertySingleValue", Name="DiffTestMarker", NominalValue=model.create_entity("IfcLabel", "X"))
                    pdef.HasProperties = list(pdef.HasProperties) + [marker]
                    changed += 1
                    break
    return changed


@pytest.mark.skipif(not os.path.exists(BASE_IFC), reason="real IFC fixture absent")
def test_real_model_modified_classification():
    """真實模型變更分類：開兩份真實 IFC，把其中一份 in-memory 修改（位移 + 加屬性），
    證明 diff 在真實 IFC4X3 模型上真的偵測到 moved / property_changed（非 identity）。"""
    base = open_model(BASE_IFC)
    modified = open_model(BASE_IFC)  # 獨立 model 物件，修改不影響 base
    moved_n = _shift_placements(modified, 8)
    prop_n = _add_marker_prop(modified, 8)
    assert moved_n > 0 and prop_n > 0, "前置：修改需真的套到真實元素"

    diff = run_diff(base, modified, move_tol=1.0)
    assert diff.matched > 7000  # 同模型 → 幾乎全 GUID 對齊
    assert diff.counts.get("moved", 0) > 0, "真實模型應偵測到位移"
    assert diff.counts.get("property_changed", 0) > 0, "真實模型應偵測到屬性變更"
    moved_item = diff.items_by_type("moved")[0]
    assert moved_item.ifc_guid and moved_item.evidence.get("target_xyz")
