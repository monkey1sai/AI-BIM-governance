"""A2 diff 引擎驗證 — 合成（確定性）+ 真實版本對（GUID 多級對齊證明）。"""
from __future__ import annotations

import os

import ifcopenshell
import ifcopenshell.guid
import pytest

from diff_engine import run_diff, run_diff_on_paths

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


@pytest.mark.skipif(not (os.path.exists(BASE_IFC) and os.path.exists(TGT_IFC)), reason="version-pair fixtures absent")
def test_real_version_pair_guid_alignment():
    """真實版本對：證明 GUID 多級對齊在真實 IFC4X3 模型上運作。"""
    diff = run_diff_on_paths(BASE_IFC, TGT_IFC, move_tol=1.0)
    assert diff.base_count > 7000 and diff.target_count > 7000
    # 近同 re-export：絕大多數應以 GUID 對齊
    assert diff.matched > 7000
    # 計數一致性：matched + removed == base_count；matched + added == target_count
    removed = diff.counts.get("removed", 0)
    added = diff.counts.get("added", 0)
    assert diff.matched + removed == diff.base_count
    assert diff.matched + added == diff.target_count
    # 任一 added/removed 帶真實 guid 與型別
    for it in diff.items:
        assert it.ifc_type
