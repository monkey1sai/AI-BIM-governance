"""CH-H2：per-element 語意端點 E2E（FastAPI TestClient，合成 IFC，CPU-only）。

守誠實：真的以 ifcopenshell 讀 Pset/空間鏈；缺維度（分類碼/幾何）回 null + roadmap，不捏造。
"""
from __future__ import annotations

import importlib

import ifcopenshell
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app)


def _guid_of(path: str, ifc_type: str, name: str) -> str:
    model = ifcopenshell.open(path)
    for entity in model.by_type(ifc_type):
        if getattr(entity, "Name", None) == name:
            return entity.GlobalId
    raise AssertionError(f"no {ifc_type} named {name} in {path}")


def test_element_semantics_reads_real_pset_and_type(client, synthetic_ifc_path):
    guid = _guid_of(synthetic_ifc_path, "IfcDoor", "D-001")
    resp = client.get("/api/elements/semantics", params={"ifc_source_path": synthetic_ifc_path, "ifc_guid": guid})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ifc_type"] == "IfcDoor"
    assert body["ifc_name"] == "D-001"
    # 真實讀到 Pset_DoorCommon.FireRating（door_ok 有 EI60）
    assert "Pset_DoorCommon" in body["psets"]
    assert body["psets"]["Pset_DoorCommon"].get("FireRating") == "EI60"
    # 合成 'id' key 已剝除（不冒充真實屬性）
    assert "id" not in body["psets"]["Pset_DoorCommon"]
    # 誠實 roadmap：分類碼/幾何未萃取 → null（不捏造）
    assert body["classification"] is None
    assert body["geometry"] is None
    assert any("classification" in r for r in body["roadmap"])


def test_element_semantics_spatial_chain(client, synthetic_ifc_path):
    guid = _guid_of(synthetic_ifc_path, "IfcWall", "W-001")  # 指派到樓層 L1
    resp = client.get("/api/elements/semantics", params={"ifc_source_path": synthetic_ifc_path, "ifc_guid": guid})
    assert resp.status_code == 200
    body = resp.json()
    types = [s["ifc_type"] for s in body["spatial"]]
    assert "IfcBuildingStorey" in types


def test_element_semantics_404_unknown_guid(client, synthetic_ifc_path):
    resp = client.get(
        "/api/elements/semantics",
        params={"ifc_source_path": synthetic_ifc_path, "ifc_guid": "0XXXXXXXXXXXXXXXXXXXXX"},
    )
    assert resp.status_code == 404


def test_element_semantics_400_missing_path(client):
    resp = client.get(
        "/api/elements/semantics",
        params={"ifc_source_path": "C:/nope/does-not-exist.ifc", "ifc_guid": "x"},
    )
    assert resp.status_code == 400
