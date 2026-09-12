"""Rule-result remediation rejection; synthetic SQLite rows, real store/router."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from issues.api import router
from issues.store import IssueStore, TransitionError


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = str(tmp_path / "issues.db")
    monkeypatch.setenv("GOV_DB_PATH", path)
    return IssueStore(path)


def seed(store, state="open", source_type="rule_result"):
    issue = store.create_issue(
        title="test rule finding", ifc_guid="TEST_GUID", model_version_id="test-original-v1",
        source_type=source_type, source_ref="test-original-result",
    )
    if state == "assigned":
        store.transition(issue["id"], "assigned")
    elif state == "in_progress":
        store.transition(issue["id"], "in_progress")
    elif state == "reopened":
        # Seed a legacy state to test the generic resolution guard in isolation.
        # Actual authorized reopen and its audit transaction have separate HTTP tests.
        with store._conn() as conn:
            conn.execute("UPDATE issues SET status='reopened' WHERE id=?", (issue["id"],))
    return store.get_issue(issue["id"])


@pytest.mark.parametrize("state", ["open", "assigned", "in_progress", "reopened"])
def test_store_requires_remediation_before_resolving_rule_issue(store, state):
    issue = seed(store, state)
    events = store.get_events(issue["id"])
    for _ in range(2):
        with pytest.raises(TransitionError, match="remediation evidence"):
            store.transition(issue["id"], "resolved", "test supervisor says PASS")
        assert store.get_issue(issue["id"]) == issue
        assert store.get_events(issue["id"]) == events
    # The rejected transaction must not leave a lock that blocks subsequent work.
    assert store.transition(issue["id"], "rejected")["status"] == "rejected"


@pytest.mark.parametrize("state", ["open", "assigned", "in_progress", "reopened"])
def test_generic_api_cannot_use_caller_supervisor_or_pass_claim(store, state):
    issue = seed(store, state)
    events = store.get_events(issue["id"])
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post(
            f"/api/issues/{issue['id']}/transition",
            headers={"x-user-role": "supervisor"},
            json={"to_status": "resolved", "note": "test supervisor",
                  "actor": "test supervisor", "status": "PASS"},
        )
    assert response.status_code == 400
    assert "remediation evidence" in response.json()["detail"]
    assert store.get_issue(issue["id"]) == issue
    assert store.get_events(issue["id"]) == events


@pytest.mark.parametrize("source_type", ["manual", "diff_item"])
def test_non_rule_issue_resolution_and_reopen_remain_unchanged(store, source_type):
    issue = seed(store, source_type=source_type)
    assert store.transition(issue["id"], "resolved")["status"] == "resolved"
    assert store.transition(issue["id"], "reopened")["status"] == "reopened"
    assert store.transition(issue["id"], "resolved")["status"] == "resolved"
    assert len(store.get_events(issue["id"])) == 4
