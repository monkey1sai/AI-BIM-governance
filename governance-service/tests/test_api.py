"""governance-service API E2E（FastAPI TestClient，CPU-only，合成 IFC）。

驗證 POST rule-run -> 背景執行 -> GET 狀態/結果 -> Excel 匯出全鏈路，
並守誠實：每個 failed result 必有真實 ifc_guid；/health 誠實回報 ifctester=false。
"""
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


def test_health_reports_ifctester_true(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["ifcopenshell"] is True
    # ifctester 已安裝（IDS-XML 匯入啟用）
    assert body["ifctester"] is True
    assert "default-governance" in body["rule_sets"]


def test_rule_run_end_to_end(client, synthetic_ifc_path):
    resp = client.post("/api/rule-runs", json={"ifc_source_path": synthetic_ifc_path})
    assert resp.status_code == 202
    run_id = resp.json()["rule_run_id"]

    # TestClient 會在回應後同步跑 BackgroundTask；輪詢確保完成
    status = None
    for _ in range(50):
        status = client.get(f"/api/rule-runs/{run_id}").json()
        if status["status"] in ("succeeded", "failed"):
            break
    assert status and status["status"] == "succeeded", status
    assert 0 <= status["score"] <= 100
    assert status["summary"]["total"] == status["summary"]["passed"] + status["summary"]["failed"] + status["summary"]["errored"]

    failed = client.get(f"/api/rule-runs/{run_id}/results", params={"status": "failed"}).json()["results"]
    assert failed, "synthetic model has known failures"
    # 誠實：每個 failed 都有真實 ifc_guid
    assert all(r["ifc_guid"] for r in failed)

    export = client.get(f"/api/rule-runs/{run_id}/export", params={"fmt": "excel"})
    assert export.status_code == 200
    assert export.content[:2] == b"PK"  # xlsx 是 zip 容器


def test_bcf_export_is_not_built(client, synthetic_ifc_path):
    resp = client.post("/api/rule-runs", json={"ifc_source_path": synthetic_ifc_path})
    run_id = resp.json()["rule_run_id"]
    for _ in range(50):
        if client.get(f"/api/rule-runs/{run_id}").json()["status"] in ("succeeded", "failed"):
            break
    # BCF 匯出誠實標 501（p15）
    bcf = client.get(f"/api/rule-runs/{run_id}/export", params={"fmt": "bcf"})
    assert bcf.status_code == 501


def test_missing_ifc_path_rejected(client):
    resp = client.post("/api/rule-runs", json={"ifc_source_path": "C:/nope/does-not-exist.ifc"})
    assert resp.status_code == 400
