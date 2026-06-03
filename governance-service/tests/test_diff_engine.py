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
