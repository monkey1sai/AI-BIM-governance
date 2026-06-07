"""CH-H2 ③：空間巢狀樹端點 E2E（FastAPI TestClient，合成 aggregated IFC，CPU-only）。

真的走 ifcopenshell IsDecomposedBy/ContainsElements 遞迴空間結構 + 類別計數。
"""
from __future__ import annotations

import importlib

import ifcopenshell
import ifcopenshell.guid
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app)


def _g() -> str:
    return ifcopenshell.guid.new()


@pytest.fixture()
def aggregated_ifc_path(tmp_path) -> str:
    f = ifcopenshell.file(schema="IFC4")
    project = f.create_entity("IfcProject", GlobalId=_g(), Name="P")
    site = f.create_entity("IfcSite", GlobalId=_g(), Name="Site A")
    building = f.create_entity("IfcBuilding", GlobalId=_g(), Name="Building A")
    storey = f.create_entity("IfcBuildingStorey", GlobalId=_g(), Name="2F")
    f.create_entity("IfcRelAggregates", GlobalId=_g(), RelatingObject=project, RelatedObjects=[site])
    f.create_entity("IfcRelAggregates", GlobalId=_g(), RelatingObject=site, RelatedObjects=[building])
    f.create_entity("IfcRelAggregates", GlobalId=_g(), RelatingObject=building, RelatedObjects=[storey])
    w1 = f.create_entity("IfcWall", GlobalId=_g(), Name="W1")
    w2 = f.create_entity("IfcWall", GlobalId=_g(), Name="W2")
    c1 = f.create_entity("IfcColumn", GlobalId=_g(), Name="C1")
    f.create_entity("IfcRelContainedInSpatialStructure", GlobalId=_g(), RelatingStructure=storey, RelatedElements=[w1, w2, c1])
    p = tmp_path / "agg.ifc"
    f.write(str(p))
    return str(p)


def test_spatial_tree_nested_with_counts(client, aggregated_ifc_path):
    r = client.get("/api/spatial-tree", params={"ifc_source_path": aggregated_ifc_path})
    assert r.status_code == 200
    tree = r.json()["tree"]
    assert tree["ifc_type"] == "IfcProject"
    site = tree["children"][0]
    assert site["ifc_type"] == "IfcSite" and site["name"] == "Site A"
    building = site["children"][0]
    assert building["ifc_type"] == "IfcBuilding"
    storey = building["children"][0]
    assert storey["ifc_type"] == "IfcBuildingStorey" and storey["name"] == "2F"
    # 真實類別計數（直接容納於 storey）
    assert storey["type_counts"]["IfcWall"] == 2
    assert storey["type_counts"]["IfcColumn"] == 1


def test_spatial_tree_400_missing_path(client):
    r = client.get("/api/spatial-tree", params={"ifc_source_path": "C:/nope/x.ifc"})
    assert r.status_code == 400
