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


def test_from_rule_run_idempotent(client_and_db):
    """ISS-002：同一 run 重複 from-rule-run 不重複建 issue（來源冪等）。"""
    client, db_path = client_and_db
    run_id = _seed_rule_run(db_path)
    first = client.post(f"/api/issues/from-rule-run/{run_id}").json()
    assert first["created"] == 3
    second = client.post(f"/api/issues/from-rule-run/{run_id}").json()
    assert second["created"] == 0
    assert second["skipped"] == 3
    # 總 issue 數仍 3
    rule_issues = [i for i in client.get("/api/issues").json()["issues"] if i["source_type"] == "rule_result"]
    assert len(rule_issues) == 3


def test_from_diff_binds_target_model_version_id(client_and_db):
    """ISS-001/BCFUSD-1：diff issue SHALL 綁 target_model_version_id（_seed_diff target='t'）。"""
    client, db_path = client_and_db
    diff_id = _seed_diff(db_path)
    resp = client.post(f"/api/issues/from-diff/{diff_id}")
    assert resp.status_code == 201
    diff_issues = [i for i in client.get("/api/issues").json()["issues"] if i["source_type"] == "diff_item"]
    assert len(diff_issues) == 1
    assert diff_issues[0]["model_version_id"] == "t"


def test_from_diff_rejects_none_target_model_version_id(client_and_db):
    """ISS-001/BCFUSD-1：diff 缺 target_model_version_id（API 宣告 optional）時，from-diff
    SHALL 拒絕（422）而非建出 model_version_id=None 的無版本溯源 issue（誠實鐵律）。"""
    from diff_engine.models import DiffItem, DiffResult
    from diff_engine.store import DiffStore

    client, db_path = client_and_db
    ds = DiffStore(db_path)
    # target_mv=None：diff 本身缺 target 版本
    diff_id = ds.create_diff("b", None, "b.ifc", "t.ifc")
    items = [DiffItem(change_type="moved", ifc_guid="GNULLMV", ifc_type="IfcWall", ifc_name="W", change_summary="moved 5m")]
    ds.complete_diff(diff_id, DiffResult(base_count=1, target_count=1, matched=1, counts={"moved": 1}, items=items))

    resp = client.post(f"/api/issues/from-diff/{diff_id}")
    assert resp.status_code == 422  # 明確拒絕
    # 無 NULL-mv 洩漏：不得留下任何 diff_item 來源 issue
    diff_issues = [i for i in client.get("/api/issues").json()["issues"] if i["source_type"] == "diff_item"]
    assert diff_issues == []


def test_from_diff_idempotent(client_and_db):
    """ISS-002：同一 diff 重複 from-diff 不重複建 issue。"""
    client, db_path = client_and_db
    diff_id = _seed_diff(db_path)
    first = client.post(f"/api/issues/from-diff/{diff_id}").json()
    assert first["created"] == 1
    second = client.post(f"/api/issues/from-diff/{diff_id}").json()
    assert second["created"] == 0
    assert second["skipped"] == 1


def test_concurrent_transition_single_winner(tmp_path):
    """ISS-003：並發 transition 經 BEGIN IMMEDIATE 序列化，恰一個贏家、無自相矛盾雙 transition。"""
    import concurrent.futures

    from issues.store import IssueStore, TransitionError

    store = IssueStore(str(tmp_path / "concurrent.db"))
    issue = store.create_issue(title="並發測試", ifc_guid="CONCURRENTGUID00000001", model_version_id="mv1")
    iid = issue["id"]

    def _attempt(target: str):
        try:
            store.transition(iid, target)
            return target
        except TransitionError:
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(_attempt, "resolved"), pool.submit(_attempt, "rejected")]
        outcomes = [f.result() for f in concurrent.futures.as_completed(futures)]

    winners = [o for o in outcomes if o is not None]
    assert len(winners) == 1  # 恰一個成功
    final = store.get_issue(iid)
    assert final["status"] in {"resolved", "rejected"}
    transition_events = [e for e in store.get_events(iid) if e["event_type"] == "transition"]
    assert len(transition_events) == 1  # 無自相矛盾的雙 transition


def test_create_issues_batch_atomic_rollback_on_failure(tmp_path):
    """ISS-004：批次中途失敗整批回滾，不留部分寫入（all-or-nothing）。"""
    from issues.store import IssueStore

    store = IssueStore(str(tmp_path / "atomic.db"))
    items = [
        {"title": "good", "ifc_guid": "G1", "source_type": "rule_result", "source_ref": "r1"},
        # title=object() 無法繫結 sqlite 參數 → 第二筆 INSERT raise，觸發整批 ROLLBACK
        {"title": object(), "ifc_guid": "G2", "source_type": "rule_result", "source_ref": "r2"},
    ]
    with pytest.raises(Exception):
        store.create_issues_batch(items)
    assert store.list_issues() == []  # 第一筆 good 也不得留存
