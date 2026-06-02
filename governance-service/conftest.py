"""pytest fixtures for governance-service.

- 把 service 根目錄加入 sys.path，讓測試能 ``import rule_engine`` / ``import app``。
- 提供確定性的合成 IFC4 model（不需真實大檔，毫秒級）：
  2 扇門（1 有 / 1 缺 FireRating）、2 道牆（1 有名+在樓層 / 1 無名+未指派）。
"""
from __future__ import annotations

import os
import sys

import ifcopenshell
import ifcopenshell.guid
import pytest

_SERVICE_ROOT = os.path.dirname(__file__)
if _SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _SERVICE_ROOT)


def _guid() -> str:
    return ifcopenshell.guid.new()


def _build_synthetic_model() -> ifcopenshell.file:
    f = ifcopenshell.file(schema="IFC4")
    f.create_entity("IfcProject", GlobalId=_guid(), Name="GovTestProject")
    storey = f.create_entity("IfcBuildingStorey", GlobalId=_guid(), Name="L1")

    door_ok = f.create_entity("IfcDoor", GlobalId=_guid(), Name="D-001")
    f.create_entity("IfcDoor", GlobalId=_guid(), Name="D-002")  # 缺 FireRating
    wall_ok = f.create_entity("IfcWall", GlobalId=_guid(), Name="W-001")
    f.create_entity("IfcWall", GlobalId=_guid(), Name=None)  # 無名 + 未指派樓層

    # door_ok 取得 Pset_DoorCommon.FireRating
    prop = f.create_entity(
        "IfcPropertySingleValue",
        Name="FireRating",
        NominalValue=f.create_entity("IfcLabel", "EI60"),
    )
    pset = f.create_entity(
        "IfcPropertySet", GlobalId=_guid(), Name="Pset_DoorCommon", HasProperties=[prop]
    )
    f.create_entity(
        "IfcRelDefinesByProperties",
        GlobalId=_guid(),
        RelatedObjects=[door_ok],
        RelatingPropertyDefinition=pset,
    )
    # wall_ok 指派到樓層
    f.create_entity(
        "IfcRelContainedInSpatialStructure",
        GlobalId=_guid(),
        RelatedElements=[wall_ok],
        RelatingStructure=storey,
    )
    return f


@pytest.fixture(scope="session")
def synthetic_model() -> ifcopenshell.file:
    return _build_synthetic_model()


@pytest.fixture(scope="session")
def synthetic_ifc_path(tmp_path_factory) -> str:
    path = tmp_path_factory.mktemp("gov") / "synthetic.ifc"
    _build_synthetic_model().write(str(path))
    return str(path)
