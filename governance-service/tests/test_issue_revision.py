"""Issue optimistic concurrency: real SQLite/API, synthetic bound issue."""
import importlib
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from issues.store import IssueStore, TransitionError


@pytest.fixture
def store(tmp_path):
    return IssueStore(str(tmp_path / "issues.db"))


def create(store, **kwargs):
    return store.create_issue(title="test", ifc_guid="G1", model_version_id="v1", **kwargs)


def test_legacy_migration_preserves_rows_events_and_starts_revision_zero(tmp_path):
    path = str(tmp_path / "legacy.db")
    with sqlite3.connect(path) as conn:
        conn.execute("""CREATE TABLE issues(
            id TEXT PRIMARY KEY, kind TEXT, title TEXT, description TEXT,
            status TEXT, severity TEXT, assignee TEXT, ifc_guid TEXT, usd_prim_path TEXT,
            model_version_id TEXT, source_type TEXT, source_ref TEXT,
            created_at TEXT, updated_at TEXT)""")
        conn.execute("""INSERT INTO issues VALUES(
            'i1','issue','old',NULL,'open','high',NULL,'G1',NULL,'v1',
            'manual',NULL,'before','before')""")
    barrier = Barrier(2)
    def reopen():
        barrier.wait(timeout=5)
        return IssueStore(path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(reopen) for _ in range(2)]
        reopened, concurrent = [future.result(timeout=10) for future in futures]
    assert reopened.get_issue("i1")["revision"] == 0
    assert concurrent.get_issue("i1") == reopened.get_issue("i1")
    assert reopened.get_issue("i1")["updated_at"] == "before"
    assert reopened.get_events("i1") == []
    assert IssueStore(path).get_issue("i1") == reopened.get_issue("i1")


def test_revision_advances_only_with_successful_transition(store):
    issue = create(store)
    assert issue["revision"] == 0
    assigned = store.transition(issue["id"], "assigned", expected_revision=0)
    assert assigned["revision"] == 1
    before = store.get_issue(issue["id"]), store.get_events(issue["id"])
    with pytest.raises(TransitionError, match="stale"):
        store.transition(issue["id"], "in_progress", expected_revision=0)
    assert (store.get_issue(issue["id"]), store.get_events(issue["id"])) == before
    assert store.transition(issue["id"], "in_progress")["revision"] == 2


def test_audit_failure_rolls_back_revision_and_status(store):
    issue = create(store)
    before = store.get_issue(issue["id"]), store.get_events(issue["id"])
    with sqlite3.connect(store.db_path) as conn:
        conn.execute("""CREATE TRIGGER reject_transition BEFORE INSERT ON issue_events
            WHEN NEW.event_type='transition'
            BEGIN SELECT RAISE(ABORT,'test audit failure'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        store.transition(issue["id"], "assigned", expected_revision=0)
    assert (store.get_issue(issue["id"]), store.get_events(issue["id"])) == before


def test_concurrent_same_revision_accepts_one_writer(store):
    issue = create(store)
    barrier = Barrier(2)
    def attempt(target):
        barrier.wait(timeout=5)
        try:
            store.transition(issue["id"], target, expected_revision=0)
            return "accepted"
        except TransitionError as exc:
            assert "stale" in str(exc)
            return "stale"
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(attempt, state) for state in ("assigned", "in_progress")]
        assert sorted(f.result(timeout=10) for f in futures) == ["accepted", "stale"]
    assert store.get_issue(issue["id"])["revision"] == 1
    assert len(store.get_events(issue["id"])) == 2


@pytest.mark.parametrize("bad", [True, -1, "0", 0.5])
def test_store_rejects_invalid_revision(store, bad):
    issue = create(store)
    with pytest.raises(TransitionError, match="nonnegative integer"):
        store.transition(issue["id"], "assigned", expected_revision=bad)
    assert store.get_issue(issue["id"])["status"] == "open"


def test_api_exposes_revision_and_rejects_stale_or_malformed_values(tmp_path, monkeypatch):
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "api.db"))
    import app
    module = importlib.reload(app)
    with TestClient(module.app) as client:
        issue = client.post("/api/issues", json={
            "title": "test", "ifc_guid": "G1", "model_version_id": "v1"
        }).json()
        path = f"/api/issues/{issue['id']}/transition"
        first = client.post(path, json={"to_status": "assigned", "expected_revision": 0})
        assert first.status_code == 200 and first.json()["revision"] == 1
        assert client.post(path, json={"to_status": "in_progress", "expected_revision": 0}).status_code == 400
        for bad in [True, -1, "1", 1.5]:
            assert client.post(path, json={"to_status": "in_progress", "expected_revision": bad}).status_code == 422
        legacy = client.post(path, json={"to_status": "in_progress"})
        assert legacy.status_code == 200 and legacy.json()["revision"] == 2


@pytest.mark.parametrize("source_type", ["manual", "rule_result", "diff_item"])
def test_existing_resolution_and_reopen_flow_keeps_source_and_tracks_revision(store, source_type):
    issue = create(store, source_type=source_type, source_ref="source1")
    resolved = store.transition(issue["id"], "resolved")
    assert resolved["revision"] == 1
    reopened = store.transition(issue["id"], "reopened", expected_revision=1)
    assert reopened["revision"] == 2
    restarted = IssueStore(store.db_path)
    for key in ("ifc_guid", "model_version_id", "source_type", "source_ref"):
        assert restarted.get_issue(issue["id"])[key] == issue[key]
    assert len(restarted.get_events(issue["id"])) == 3
