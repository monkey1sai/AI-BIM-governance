"""A3 federation API E2E（FastAPI TestClient，合成 USD member）。"""
from __future__ import annotations

import importlib
import os

import pytest
from fastapi.testclient import TestClient
from pxr import Usd, UsdGeom


def _member_file(path, disc: str) -> str:
    path = str(path).replace("\\", "/")
    stage = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 0.001)
    world = stage.DefinePrim("/World", "Xform")
    stage.SetDefaultPrim(world)
    UsdGeom.Xform.Define(stage, f"/World/{disc}")
    UsdGeom.Cube.Define(stage, f"/World/{disc}/Box")
    stage.GetRootLayer().Save()
    return path


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    monkeypatch.setenv("GOV_FED_OUT", str(tmp_path / "fed").replace("\\", "/"))
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app)


def test_federation_api_end_to_end(client, tmp_path):
    arc = _member_file(tmp_path / "arc.usda", "ARC")
    strr = _member_file(tmp_path / "str.usda", "STR")
    set_id = client.post("/api/federated-sets", json={"name": "coord-meeting"}).json()["set_id"]
    assert client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "arc_v1", "discipline": "ARC", "usd_path": arc, "layer_order": 1, "root_prim": "/World/ARC"}).status_code == 201
    assert client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "str_v1", "discipline": "STR", "usd_path": strr, "layer_order": 2, "root_prim": "/World/STR"}).status_code == 201

    # 共享坐標系驗證（一致）
    report = client.post(f"/api/federated-sets/{set_id}/validate-coords").json()
    assert report["consistent"] is True

    # build federated USD
    res = client.post(f"/api/federated-sets/{set_id}/build").json()
    assert res["member_count"] == 2
    assert res["sublayer_order"][0].endswith("arc.usda")  # layer_order 1 最強
    assert os.path.exists(res["usda_path"])
    assert "/World/ARC" in res["prim_sample"] and "/World/STR" in res["prim_sample"]


def test_build_requires_two_members(client, tmp_path):
    arc = _member_file(tmp_path / "a.usda", "ARC")
    set_id = client.post("/api/federated-sets", json={"name": "x"}).json()["set_id"]
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "a", "discipline": "ARC", "usd_path": arc, "layer_order": 1})
    assert client.post(f"/api/federated-sets/{set_id}/build").status_code == 400


def test_member_missing_usd_rejected(client):
    set_id = client.post("/api/federated-sets", json={"name": "y"}).json()["set_id"]
    resp = client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "a", "discipline": "ARC", "usd_path": "C:/nope/missing.usda", "layer_order": 1})
    assert resp.status_code == 400
