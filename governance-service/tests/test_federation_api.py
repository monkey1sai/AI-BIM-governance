"""A3 federation API E2E（FastAPI TestClient，合成 USD member）。"""
from __future__ import annotations

import importlib
import os

import pytest
from fastapi.testclient import TestClient
from pxr import Usd, UsdGeom


def _member_file(path, disc: str, up: str = "Z", mpu: float = 0.001) -> str:
    path = str(path).replace("\\", "/")
    stage = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z if up == "Z" else UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, mpu)
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
    # A3-3 / A3-4：build 從驗證後一致的 member 取座標系，不硬編、不回退單位。
    assert res["up_axis"] == "Z"
    assert res["meters_per_unit"] == pytest.approx(0.001)


def test_build_rejects_inconsistent_up_axis(client, tmp_path):
    """A3-4：member upAxis 不一致時 build SHALL 回 409 並回報 issues，不靜默宣告成 Z-up。"""
    arc = _member_file(tmp_path / "arc.usda", "ARC", up="Z")
    strr = _member_file(tmp_path / "str.usda", "STR", up="Y")  # Y-up，與 ARC 不一致
    set_id = client.post("/api/federated-sets", json={"name": "mismatch"}).json()["set_id"]
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "arc_v1", "discipline": "ARC", "usd_path": arc, "layer_order": 1, "root_prim": "/World/ARC"})
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "str_v1", "discipline": "STR", "usd_path": strr, "layer_order": 2, "root_prim": "/World/STR"})
    resp = client.post(f"/api/federated-sets/{set_id}/build")
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert any("up_axis" in i for i in detail["issues"])


def test_review_room_descriptor_after_build(client, tmp_path):
    arc = _member_file(tmp_path / "arc.usda", "ARC")
    strr = _member_file(tmp_path / "str.usda", "STR")
    set_id = client.post("/api/federated-sets", json={"name": "coord-meeting"}).json()["set_id"]
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "arc_v1", "discipline": "ARC", "usd_path": arc, "layer_order": 1, "root_prim": "/World/ARC"})
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "str_v1", "discipline": "STR", "usd_path": strr, "layer_order": 2, "root_prim": "/World/STR"})

    # build 前：尚未就緒，誠實導引去 build
    pre = client.get(f"/api/federated-sets/{set_id}/review-room").json()
    assert pre["ready"] is False and pre["stage_composition"] is None and "build" in pre["note"]

    client.post(f"/api/federated-sets/{set_id}/build")

    # build 後：handoff descriptor 形如 viewer streamConfig.stage_composition
    rr = client.get(f"/api/federated-sets/{set_id}/review-room").json()
    assert rr["ready"] is True
    assert rr["stage_url"].endswith("federated_review.usda")
    assert rr["stage_composition"]["primary"]["url"] == rr["stage_url"]
    assert rr["stage_composition"]["secondary_layers"] == []
    assert {m["discipline"] for m in rr["members"]} == {"ARC", "STR"}


def test_build_clears_stale_artifact_when_coords_become_inconsistent(client, tmp_path):
    """Codex P2：先成功 build，之後加入 Y-up member 使座標不一致再 build → 回 409，
    且先前的 build artifact SHALL 被清除（DB pointer + on-disk usda），review-room 回 ready=false。

    否則 review-room 會把過時且現已無效的 federated stage 當作 ready 交給 Kit。
    """
    arc = _member_file(tmp_path / "arc.usda", "ARC", up="Z")
    strr = _member_file(tmp_path / "str.usda", "STR", up="Z")
    set_id = client.post("/api/federated-sets", json={"name": "stale"}).json()["set_id"]
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "arc_v1", "discipline": "ARC", "usd_path": arc, "layer_order": 1, "root_prim": "/World/ARC"})
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "str_v1", "discipline": "STR", "usd_path": strr, "layer_order": 2, "root_prim": "/World/STR"})

    # 先成功 build（兩 member 皆 Z-up）
    first = client.post(f"/api/federated-sets/{set_id}/build").json()
    built_path = first["usda_path"]
    assert os.path.exists(built_path)
    assert client.get(f"/api/federated-sets/{set_id}/review-room").json()["ready"] is True

    # 加入一個 Y-up member 使座標系不一致
    ydisc = _member_file(tmp_path / "mep.usda", "MEP", up="Y")
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "mep_v1", "discipline": "MEP", "usd_path": ydisc, "layer_order": 3, "root_prim": "/World/MEP"})

    # 再 build → 409，且清除 stale build
    resp = client.post(f"/api/federated-sets/{set_id}/build")
    assert resp.status_code == 409
    assert any("up_axis" in i for i in resp.json()["detail"]["issues"])
    # stale on-disk artifact 被刪除
    assert not os.path.exists(built_path)
    # review-room 回 ready=false（不再把過時 stage 當作可載入）
    rr = client.get(f"/api/federated-sets/{set_id}/review-room").json()
    assert rr["ready"] is False
    assert rr["stage_composition"] is None


def test_review_room_404_unknown_set(client):
    assert client.get("/api/federated-sets/nope/review-room").status_code == 404


def test_build_requires_two_members(client, tmp_path):
    arc = _member_file(tmp_path / "a.usda", "ARC")
    set_id = client.post("/api/federated-sets", json={"name": "x"}).json()["set_id"]
    client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "a", "discipline": "ARC", "usd_path": arc, "layer_order": 1})
    assert client.post(f"/api/federated-sets/{set_id}/build").status_code == 400


def test_member_missing_usd_rejected(client):
    set_id = client.post("/api/federated-sets", json={"name": "y"}).json()["set_id"]
    resp = client.post(f"/api/federated-sets/{set_id}/members", json={"model_version_id": "a", "discipline": "ARC", "usd_path": "C:/nope/missing.usda", "layer_order": 1})
    assert resp.status_code == 400
