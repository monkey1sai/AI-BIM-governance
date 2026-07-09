"""governance-service API E2E（FastAPI TestClient，CPU-only，合成 IFC）。

驗證 POST rule-run -> 背景執行 -> GET 狀態/結果 -> Excel 匯出全鏈路，
並守誠實：每個 failed result 必有真實 ifc_guid；ifctester 已安裝（host 0.8.5），
/health 如實回報 ifctester=true（見 test_health_reports_ifctester_true）。
"""
from __future__ import annotations

import importlib
import sqlite3

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


def test_rule_run_persists_source_metadata(client, synthetic_ifc_path):
    metadata = {
        "source_kind": "minio_ifc_ready",
        "ifc_ready_job_id": "ifcready_abc123",
        "idempotency_key": "mw_0000000000000001",
        "project_id": "p1",
        "project_display_name": "松風庵",
        "model_category": "建築",
        "model_version_id": "v1",
        "source_ifc_etag": "etag_demo_001",
        "conversion_job_id": "conv_1",
        "conversion_status": "ready",
    }
    resp = client.post(
        "/api/rule-runs",
        json={"ifc_source_path": synthetic_ifc_path, "model_version_id": "v1", "source_metadata": metadata},
    )
    assert resp.status_code == 202
    run_id = resp.json()["rule_run_id"]

    status = None
    for _ in range(50):
        status = client.get(f"/api/rule-runs/{run_id}").json()
        if status["status"] in ("succeeded", "failed"):
            break
    assert status and status["status"] == "succeeded", status
    assert status["model_version_id"] == "v1"
    assert status["source_metadata"] == metadata


def test_rule_run_history_filters_by_source_lineage(client, synthetic_ifc_path):
    arch_metadata = {
        "source_kind": "minio_ifc_ready",
        "ifc_ready_job_id": "ifcready_arch",
        "idempotency_key": "mw_arch",
        "project_id": "p1",
        "project_display_name": "松風庵",
        "model_category": "建築",
        "model_version_id": "v1",
        "source_ifc_etag": "etag_arch",
    }
    struct_metadata = {
        "source_kind": "minio_ifc_ready",
        "ifc_ready_job_id": "ifcready_struct",
        "idempotency_key": "mw_struct",
        "project_id": "p1",
        "project_display_name": "松風庵",
        "model_category": "結構",
        "model_version_id": "v2",
        "source_ifc_etag": "etag_struct",
    }
    client.post(
        "/api/rule-runs",
        json={"ifc_source_path": synthetic_ifc_path, "model_version_id": "v1", "source_metadata": arch_metadata},
    )
    client.post(
        "/api/rule-runs",
        json={"ifc_source_path": synthetic_ifc_path, "model_version_id": "v2", "source_metadata": struct_metadata},
    )

    history = client.get(
        "/api/rule-runs",
        params={
            "project_id": "p1",
            "model_category": "建築",
            "model_version_id": "v1",
            "ifc_ready_job_id": "ifcready_arch",
            "limit": 5,
        },
    ).json()

    assert history["total"] == 1
    assert history["filters"] == {
        "project_id": "p1",
        "model_category": "建築",
        "model_version_id": "v1",
        "ifc_ready_job_id": "ifcready_arch",
    }
    item = history["items"][0]
    assert item["model_version_id"] == "v1"
    assert item["source_metadata"] == arch_metadata
    assert item["status"] == "succeeded"
    assert "ifc_source_path" not in item


def test_rule_run_public_responses_redact_failed_summary_paths(client, synthetic_ifc_path):
    import app as app_module

    metadata = {
        "source_kind": "minio_ifc_ready",
        "ifc_ready_job_id": "ifcready_failed",
        "idempotency_key": "mw_failed",
        "project_id": "p1",
        "model_category": "建築",
        "model_version_id": "v1",
    }
    run_id = app_module.store.create_run(
        "v1",
        synthetic_ifc_path,
        "default-governance",
        metadata,
    )
    app_module.store.fail_run(
        run_id,
        (
            "failed to open C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\secret\\source.ifc "
            "from https://storage.example.invalid/source.ifc?X-Amz-Signature=secret"
        ),
    )

    history = client.get("/api/rule-runs", params={"project_id": "p1"}).json()
    status = client.get(f"/api/rule-runs/{run_id}").json()

    for payload in (history, status):
        serialized = str(payload)
        assert "C:\\Repos\\active" not in serialized
        assert "storage.example.invalid" not in serialized
        assert "X-Amz-Signature" not in serialized
        assert "[redacted-path]" in serialized
        assert "[redacted-url]" in serialized

    item = history["items"][0]
    assert item["summary"]["error"] == status["summary"]["error"]
    assert item["source_metadata"] == metadata


def test_rule_run_rejects_unsafe_source_metadata_keys(client, synthetic_ifc_path):
    resp = client.post(
        "/api/rule-runs",
        json={
            "ifc_source_path": synthetic_ifc_path,
            "source_metadata": {
                "project_id": "p1",
                "host_local_path": "C:/secret/source.ifc",
                "source_ifc_ref": "http://signed.example.invalid/source.ifc?X-Amz-Signature=secret",
            },
        },
    )
    assert resp.status_code == 400
    assert "source_metadata contains unsupported keys" in resp.json()["detail"]


def test_store_migrates_legacy_rule_runs_schema_for_source_metadata(tmp_path):
    from db import Store

    db_path = tmp_path / "legacy-gov.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE rule_runs(
              id TEXT PRIMARY KEY,
              model_version_id TEXT,
              ifc_source_path TEXT,
              rule_set TEXT,
              status TEXT,
              started_at TEXT,
              finished_at TEXT,
              score REAL,
              summary_json TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE rule_results(
              id TEXT PRIMARY KEY,
              rule_run_id TEXT,
              ifc_guid TEXT,
              usd_prim_path TEXT,
              rule_code TEXT,
              severity TEXT,
              status TEXT,
              message TEXT,
              evidence_json TEXT
            )
            """
        )

    store = Store(str(db_path))
    run_id = store.create_run(
        "v1",
        "C:/safe/source.ifc",
        "default-governance",
        {"source_kind": "minio_ifc_ready", "project_id": "p1"},
    )
    row = store.get_run(run_id)
    assert row["source_metadata_json"] == '{"project_id": "p1", "source_kind": "minio_ifc_ready"}'


def test_rule_run_bcf_export_redirects_to_issue_flow(client, synthetic_ifc_path):
    resp = client.post("/api/rule-runs", json={"ifc_source_path": synthetic_ifc_path})
    run_id = resp.json()["rule_run_id"]
    for _ in range(50):
        if client.get(f"/api/rule-runs/{run_id}").json()["status"] in ("succeeded", "failed"):
            break
    # rule-run 匯出僅 Excel；BCF 匯出走 issue → /api/bcf/export（誠實 400 + 導引，非空白成功）。
    bcf = client.get(f"/api/rule-runs/{run_id}/export", params={"fmt": "bcf"})
    assert bcf.status_code == 400
    assert "/api/bcf/export" in bcf.json()["detail"]


def test_missing_ifc_path_rejected(client):
    resp = client.post("/api/rule-runs", json={"ifc_source_path": "C:/nope/does-not-exist.ifc"})
    assert resp.status_code == 400
