"""HTTP adapter against real SQLite/engine; supervisor is test-only DI."""
import sqlite3
from dataclasses import asdict

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from issues import api
from test_issue_remediation import make_case, reopen_case


@pytest.fixture
def context(tmp_path, monkeypatch):
    case = make_case(tmp_path)
    monkeypatch.setenv("GOV_DB_PATH", case.path)
    app = FastAPI()
    app.include_router(api.router)
    with TestClient(app) as client:
        yield case, app, client
    app.dependency_overrides.clear()


def payload(case):
    body = asdict(case.command)
    body.pop("issue_id")
    return body


def route(case):
    return f"/api/issues/{case.command.issue_id}/confirm-remediation"


def wire(app, authorize):
    # Keep pre-implementation RED at missing HTTP route, not fixture/import errors.
    dependency = getattr(api, "get_remediation_authorizer", None)
    if dependency is not None:
        app.dependency_overrides[dependency] = lambda: authorize


def state(case):
    return case.issues.get_issue(case.command.issue_id), case.issues.get_events(case.command.issue_id)


def test_default_dependency_ignores_browser_role_and_hides_issue_existence(context):
    case, app, client = context
    before = state(case)
    for path in (route(case), "/api/issues/not-found/confirm-remediation"):
        response = client.post(path, json=payload(case), headers={"x-role": "supervisor"})
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "remediation_authorization_unavailable"
    assert state(case) == before


def test_real_http_confirm_replay_and_reopened_history(context):
    case, app, client = context
    wire(app, case.authorize)
    before = state(case)[0]
    response = client.post(route(case), json=payload(case))
    assert response.status_code == 200
    first = response.json()
    assert first["issue"]["status"] == "resolved"
    assert first["issue"]["revision"] == 1
    assert first["confirmation"]["principal_ref"] == "test-supervisor"
    for field in ("model_version_id", "ifc_guid", "source_type", "source_ref"):
        assert first["issue"][field] == before[field]
    assert len(state(case)[1]) == 2
    repeated = client.post(route(case), json=payload(case)).json()
    assert repeated["replayed"] is True
    assert repeated["confirmation"] == first["confirmation"]
    assert len(state(case)[1]) == 2
    reopened = client.post(f"/api/issues/{case.command.issue_id}/transition",
                           json={"to_status": "reopened", "expected_revision": 1})
    assert reopened.status_code == 400
    reopen_case(case)
    repeated = client.post(route(case), json=payload(case)).json()
    assert repeated["issue"]["status"] == "reopened"
    assert repeated["confirmation"] == first["confirmation"]
    assert len(state(case)[1]) == 3


def test_denied_authorizer_never_mutates(context):
    case, app, client = context
    wire(app, lambda context: None)
    before = state(case)
    response = client.post(route(case), json=payload(case))
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "remediation_authorization_denied"
    assert state(case) == before


def test_fixture_authority_cannot_confirm_other_resources(context, tmp_path, monkeypatch):
    case, app, client = context
    other = make_case(tmp_path / "other")
    monkeypatch.setenv("GOV_DB_PATH", other.path)
    wire(app, case.authorize)
    before = state(other)
    response = client.post(route(other), json=payload(other))
    assert response.status_code == 403
    assert state(other) == before


@pytest.mark.parametrize("extra", [{"actor": "supervisor"}, {"PASS": True}, {"role": "supervisor"},
                                   {"expected_revision": True}, {"expected_revision": "0"},
                                   {"revised_run_id": 123}, {"idempotency_key": ""}])
def test_http_schema_rejects_spoofed_or_malformed_fields(context, extra):
    case, app, client = context
    wire(app, case.authorize)
    before = state(case)
    response = client.post(route(case), json={**payload(case), **extra})
    assert response.status_code == 422
    assert state(case) == before


def test_stale_revision_and_changed_replay_are_conflicts(context):
    case, app, client = context
    wire(app, case.authorize)
    assigned = client.post(f"/api/issues/{case.command.issue_id}/transition",
                           json={"to_status": "assigned", "expected_revision": 0})
    assert assigned.status_code == 200
    before = state(case)
    assert client.post(route(case), json=payload(case)).status_code == 409
    assert state(case) == before
    body = {**payload(case), "expected_revision": 1}
    assert client.post(route(case), json=body).status_code == 200
    before = state(case)
    response = client.post(route(case), json={**body, "note": "changed"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "remediation_conflict"
    assert state(case) == before


def test_missing_pass_returns_generic_evidence_error(context):
    case, app, client = context
    wire(app, case.authorize)
    with sqlite3.connect(case.path) as conn:
        conn.execute("UPDATE rule_results SET status='fail' WHERE id=?", (case.command.revised_result_id,))
    before = state(case)
    response = client.post(route(case), json=payload(case))
    assert response.status_code == 422
    assert response.json()["detail"] == {"code": "remediation_evidence_invalid"}
    assert state(case) == before


def test_sql_failure_is_sanitized_and_rolls_back(context):
    case, app, client = context
    wire(app, case.authorize)
    with sqlite3.connect(case.path) as conn:
        conn.execute("CREATE TRIGGER reject_audit BEFORE INSERT ON issue_events "
                     "BEGIN SELECT RAISE(ABORT,'private SQL test detail'); END")
    before = state(case)
    response = client.post(route(case), json=payload(case))
    assert response.status_code == 503
    assert response.json()["detail"] == {"code": "remediation_persistence_unavailable"}
    assert "private SQL" not in response.text
    assert state(case) == before
    with sqlite3.connect(case.path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM issue_remediation_confirmations").fetchone()[0] == 0


def test_test_dependency_override_does_not_enable_default(context):
    case, app, client = context
    wire(app, case.authorize)
    assert client.post(route(case), json=payload(case)).status_code == 200
    app.dependency_overrides.clear()
    response = client.post(route(case), json=payload(case))
    assert response.status_code == 503
