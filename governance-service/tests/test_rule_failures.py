"""A1 failures 端點：按規則分組 + 分頁 + 開 model 補 name/type/storey。
storey helper 直接對合成 model 驗(W-001 在 L1、無名牆無樓層)。"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app)


def test_storey_from_element(synthetic_model):
    from app import _storey_from_element

    wall_ok = next(w for w in synthetic_model.by_type("IfcWall") if w.Name == "W-001")
    assert _storey_from_element(wall_ok) == "L1"
    unnamed = next(w for w in synthetic_model.by_type("IfcWall") if not w.Name)
    assert _storey_from_element(unnamed) is None


def _run(client, ifc_path) -> str:
    rid = client.post("/api/rule-runs", json={"ifc_source_path": ifc_path}).json()["rule_run_id"]
    status = None
    for _ in range(50):
        status = client.get(f"/api/rule-runs/{rid}").json()
        if status["status"] in ("succeeded", "failed"):
            break
    # 比照 test_api.py:44:斷言 run 本身 succeeded;若背景任務拋例外以 status=failed
    # 完成,下游 total>=1 會誤判為「無失敗構件」,此 guard 直接點出 rule run 本身失敗。
    assert status and status["status"] == "succeeded", status
    return rid


def test_failures_endpoint_groups_paginates_enriches(client, synthetic_ifc_path):
    rid = _run(client, synthetic_ifc_path)
    body = client.get(f"/api/rule-runs/{rid}/failures").json()
    # spec §4.2 contract:top-level rule_code(未過濾時 None)+ array key "items"。
    assert body["rule_run_id"] == rid
    assert body["rule_code"] is None  # 無 rule 過濾 → top-level rule_code 為 None
    assert body["total"] >= 1
    # 每筆都有 enrichment 欄位(值可能為 null，但 key 必在)
    for f in body["items"]:
        assert "ifc_guid" in f and "ifc_name" in f and "ifc_type" in f and "storey" in f
        assert f["ifc_guid"]  # 誠實:失敗構件必有真實 ifc_guid

    # HTTP 層 enrichment 必須端對端真的算出樓層值,而非只回 key、值恆為 null。
    # 若 model.by_guid → _storey_from_element 的空間鏈查詢壞掉對所有構件回 null,
    # 上面的 "storey" in f 仍會綠 → 下面用「已知有容器」與「已知無容器」雙構件鎖死值。
    by_guid = {f["ifc_guid"]: f for f in body["items"]}
    door_in_storey = next(f for f in body["items"] if f["ifc_type"] == "IfcDoor")
    assert door_in_storey["storey"] == "L1"  # D-002 缺 FireRating 失敗,且指派於 L1 → 非 null
    unassigned = next(
        f for f in body["items"]
        if f["ifc_type"] == "IfcWall" and f["rule_code"] == "WALL-STOREY-ASSIGNED"
    )
    assert unassigned["storey"] is None  # 無名牆未指派樓層 → 誠實 null,不捏造
    assert by_guid  # join 索引非空(防呆)


def test_failures_rule_filter_and_pagination(client, synthetic_ifc_path):
    rid = _run(client, synthetic_ifc_path)
    code = client.get(f"/api/rule-runs/{rid}/failures").json()["items"][0]["rule_code"]
    one = client.get(f"/api/rule-runs/{rid}/failures", params={"rule": code, "limit": 1, "offset": 0}).json()
    assert one["rule_code"] == code  # spec §4.2:過濾時 top-level rule_code 回填該規則碼
    assert all(f["rule_code"] == code for f in one["items"])
    assert len(one["items"]) <= 1


def test_failures_pagination_bounds_rejected(client, synthetic_ifc_path):
    """負 offset / 非正 limit 必須被 422 擋下,不可落進 rows[offset:offset+limit] 取錯頁。
    例:offset=-1 在 Python slice 是從尾端取元素(回完全錯誤的一頁),非空集合。"""
    rid = _run(client, synthetic_ifc_path)
    base = f"/api/rule-runs/{rid}/failures"
    assert client.get(base, params={"offset": -1}).status_code == 422  # 負 offset 拒絕
    assert client.get(base, params={"limit": 0}).status_code == 422   # limit 0 無意義
    assert client.get(base, params={"limit": -5}).status_code == 422   # 負 limit 拒絕
    # 邊界內仍正常服務(下界 guard 不誤傷合法請求)
    assert client.get(base, params={"offset": 0, "limit": 1}).status_code == 200


def test_failures_unknown_run_404(client):
    assert client.get("/api/rule-runs/nope/failures").status_code == 404
