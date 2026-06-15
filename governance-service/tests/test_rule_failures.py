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
    for _ in range(50):
        if client.get(f"/api/rule-runs/{rid}").json()["status"] in ("succeeded", "failed"):
            break
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


def test_failures_rule_filter_and_pagination(client, synthetic_ifc_path):
    rid = _run(client, synthetic_ifc_path)
    code = client.get(f"/api/rule-runs/{rid}/failures").json()["items"][0]["rule_code"]
    one = client.get(f"/api/rule-runs/{rid}/failures", params={"rule": code, "limit": 1, "offset": 0}).json()
    assert one["rule_code"] == code  # spec §4.2:過濾時 top-level rule_code 回填該規則碼
    assert all(f["rule_code"] == code for f in one["items"])
    assert len(one["items"]) <= 1


def test_failures_unknown_run_404(client):
    assert client.get("/api/rule-runs/nope/failures").status_code == 404
