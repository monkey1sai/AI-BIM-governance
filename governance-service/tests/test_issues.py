"""Issue tracking 驗證 — 生命週期 + audit + A1/A2 來源綁定 + BCF kind 區分。"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client_and_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "gov.db")
    monkeypatch.setenv("GOV_DB_PATH", db_path)
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app), db_path


def _seed_rule_run(db_path: str) -> str:
    from db import Store as RuleStore
    from rule_engine.models import RuleResult, RuleRunResult

    rs = RuleStore(db_path)
    run_id = rs.create_run("mv1", "x.ifc", "default-governance")
    results = [
        RuleResult(ifc_guid=f"GUID{i}", ifc_type="IfcDoor", ifc_name=f"D{i}", rule_code="DOOR-FIRERATING-REQUIRED",
                   severity="high", status="fail", message="缺 FireRating")
        for i in range(3)
    ]
    run = RuleRunResult(rule_set="default-governance", version="1", target_summary={}, total=3, passed=0,
                        failed=3, errored=0, score=0.0, results=results)
    rs.complete_run(run_id, run)
    return run_id


def _seed_diff(db_path: str) -> str:
    from diff_engine.models import DiffItem, DiffResult
    from diff_engine.store import DiffStore

    ds = DiffStore(db_path)
    diff_id = ds.create_diff("b", "t", "b.ifc", "t.ifc")
    items = [DiffItem(change_type="moved", ifc_guid="GMOVED", ifc_type="IfcWall", ifc_name="W", change_summary="moved 5m")]
    ds.complete_diff(diff_id, DiffResult(base_count=1, target_count=1, matched=1, counts={"moved": 1}, items=items))
    return diff_id


def test_issue_lifecycle_and_audit(client_and_db):
    client, _ = client_and_db
    created = client.post("/api/issues", json={"title": "防火門缺 FireRating", "severity": "high", "ifc_guid": "G1", "model_version_id": "mv1"}).json()
    assert created["kind"] == "issue"  # 有 ifc_guid → 正式 issue
    assert created["status"] == "open"
    iid = created["id"]

    # 合法轉換
    assert client.post(f"/api/issues/{iid}/transition", json={"to_status": "assigned", "note": "指派給 MEP"}).json()["status"] == "assigned"
    assert client.post(f"/api/issues/{iid}/transition", json={"to_status": "resolved"}).json()["status"] == "resolved"
    # 非法轉換被擋
    assert client.post(f"/api/issues/{iid}/transition", json={"to_status": "open"}).status_code == 400
    # resolved → reopened 合法
    assert client.post(f"/api/issues/{iid}/transition", json={"to_status": "reopened"}).json()["status"] == "reopened"

    # audit：created + 3 次 transition = 4 events
    detail = client.get(f"/api/issues/{iid}").json()
    assert len(detail["events"]) == 4
    assert detail["events"][0]["event_type"] == "created"


def test_annotation_without_guid(client_and_db):
    client, _ = client_and_db
    # BCF rule 10：無 ifc_guid → annotation（非正式 issue）
    created = client.post("/api/issues", json={"title": "視覺標註"}).json()
    assert created["kind"] == "annotation"


def test_issues_from_rule_run(client_and_db):
    client, db_path = client_and_db
    run_id = _seed_rule_run(db_path)
    resp = client.post(f"/api/issues/from-rule-run/{run_id}")
    assert resp.status_code == 201
    body = resp.json()
    assert body["created"] == 3
    # 每個由 rule-run 來的 issue 都帶真實 ifc_guid + source_type
    issues = client.get("/api/issues").json()["issues"]
    rule_issues = [i for i in issues if i["source_type"] == "rule_result"]
    assert len(rule_issues) == 3
    assert all(i["ifc_guid"] and i["kind"] == "issue" for i in rule_issues)


def test_issues_from_diff(client_and_db):
    client, db_path = client_and_db
    diff_id = _seed_diff(db_path)
    resp = client.post(f"/api/issues/from-diff/{diff_id}")
    assert resp.status_code == 201
    assert resp.json()["created"] == 1
    diff_issues = [i for i in client.get("/api/issues").json()["issues"] if i["source_type"] == "diff_item"]
    assert len(diff_issues) == 1
    assert diff_issues[0]["ifc_guid"] == "GMOVED"


def test_from_rule_run_not_found(client_and_db):
    client, _ = client_and_db
    assert client.post("/api/issues/from-rule-run/nope").status_code == 404
