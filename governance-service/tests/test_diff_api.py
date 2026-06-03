"""A2 diff API E2E（FastAPI TestClient，合成 IFC 寫檔 → POST diffs → poll → items）。"""
from __future__ import annotations

import importlib

import ifcopenshell
import ifcopenshell.guid
import pytest
from fastapi.testclient import TestClient

_GA = ifcopenshell.guid.new()
_GB = ifcopenshell.guid.new()
_GC = ifcopenshell.guid.new()


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


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app)


@pytest.fixture()
def pair(tmp_path):
    base = ifcopenshell.file(schema="IFC4")
    _wall(base, "W-A", (0, 0, 0), _GA, "EXISTING")
    _wall(base, "W-B", (5000, 0, 0), _GB, "EXISTING")
    target = ifcopenshell.file(schema="IFC4")
    _wall(target, "W-A", (0, 0, 10000), _GA, "DEMOLISHED")
    _wall(target, "W-C", (9000, 0, 0), _GC, "NEW")
    bp = tmp_path / "base.ifc"
    tp = tmp_path / "tgt.ifc"
    base.write(str(bp))
    target.write(str(tp))
    return str(bp), str(tp)


def test_diff_api_end_to_end(client, pair):
    base, target = pair
    resp = client.post("/api/diffs", json={"base_ifc_path": base, "target_ifc_path": target})
    assert resp.status_code == 202
    diff_id = resp.json()["diff_id"]

    status = None
    for _ in range(60):
        status = client.get(f"/api/diffs/{diff_id}").json()
        if status["status"] in ("succeeded", "failed"):
            break
    assert status and status["status"] == "succeeded", status
    counts = status["summary"]["counts"]
    assert counts.get("added") == 1
    assert counts.get("removed") == 1
    assert counts.get("moved") == 1

    moved = client.get(f"/api/diffs/{diff_id}/items", params={"change_type": "moved"}).json()["items"]
    assert len(moved) == 1
    assert moved[0]["ifc_guid"]  # 誠實：帶真實 guid

    # 3D overlay 為 p15
    assert client.post(f"/api/diffs/{diff_id}/apply-overlay").status_code == 501


def test_diff_api_missing_path_rejected(client):
    resp = client.post("/api/diffs", json={"base_ifc_path": "C:/nope/a.ifc", "target_ifc_path": "C:/nope/b.ifc"})
    assert resp.status_code == 400
