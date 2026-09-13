"""Read-only history against real SQLite; authority is strictly test DI."""
import json
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from issues.remediation import confirm_remediation
from fastapi import FastAPI
from fastapi.testclient import TestClient

from issues import api
from test_issue_remediation import make_case, reopen_case, fresh_confirmation


def client_for(authorize=None):
    app = FastAPI()
    app.include_router(api.router)
    dependency = getattr(api, "get_remediation_history_authorizer", None)
    if dependency is not None and authorize is not None:
        app.dependency_overrides[dependency] = lambda: authorize
    return TestClient(app)


def grant(case, **changes):
    from issues.remediation_history import HistoryReadGrant
    value = HistoryReadGrant(case.command.issue_id, frozenset({"v1", "v2", "v3"}),
                            (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat())
    return replace(value, **changes)


def route(case):
    return f"/api/issues/{case.command.issue_id}/remediation-history"


def db_state(case):
    with sqlite3.connect(case.path) as conn:
        return tuple(tuple(conn.execute(f"SELECT * FROM {table} ORDER BY rowid")) for table in
                     ("issues", "issue_events", "issue_remediation_confirmations"))


@pytest.fixture
def case(tmp_path, monkeypatch):
    value = make_case(tmp_path)
    monkeypatch.setenv("GOV_DB_PATH", value.path)
    return value


def confirm(case):
    return confirm_remediation(case.issues, case.command, authorize=case.authorize)["confirmation"]


def test_default_denies_before_db_and_ignores_browser_role(tmp_path, monkeypatch):
    path = tmp_path / "absent" / "never-create.db"
    monkeypatch.setenv("GOV_DB_PATH", str(path))
    with client_for() as client:
        for issue in ("known", "missing"):
            result = client.get(f"/api/issues/{issue}/remediation-history?role=supervisor",
                                headers={"x-role": "supervisor"})
            assert result.status_code == 503
            assert result.json()["detail"]["code"] == "remediation_history_authorization_unavailable"
    assert not path.parent.exists()


def test_reload_reopened_preserves_evidence_and_never_initializes_store(case, monkeypatch):
    snapshot = confirm(case)
    reopen_case(case)
    before = db_state(case)
    monkeypatch.setattr(api, "_get_store", lambda: pytest.fail("history must not initialize IssueStore"))
    for _ in range(2):
        with client_for(lambda issue: grant(case)) as client:
            result = client.get(route(case))
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        body = result.json()
        assert body["issue"] == {key: case.issues.get_issue(case.command.issue_id)[key] for key in
                                 ("id", "status", "revision", "model_version_id", "ifc_guid", "source_ref")}
        assert body["issue"]["status"] == "reopened"
        assert body["issue"]["revision"] == 2
        expected = {key: snapshot[key] for key in ("schema_version", "id", "issue_id", "principal_ref",
                    "created_at", "revision_before", "revision_after", "note", "original", "revised", "actor_kind")}
        assert body["items"] == [expected]
        assert (body["total"], body["limit"], body["offset"], body["next_offset"]) == (1, 50, 0, None)
        assert db_state(case) == before


@pytest.mark.parametrize("mode", ["none", "throw", "bool", "wrong", "v1", "v2", "expired", "naive"])
def test_denied_grants_return_no_partial_history(case, mode):
    confirm(case)
    before = db_state(case)
    def authorize(issue):
        if mode == "throw":
            raise RuntimeError("private adapter detail")
        return {"none": None, "bool": True, "wrong": grant(case, issue_id="other"),
                "v1": grant(case, model_version_ids=frozenset({"v2"})),
                "v2": grant(case, model_version_ids=frozenset({"v1"})),
                "expired": grant(case, expires_at="2000-01-01T00:00:00+00:00"),
                "naive": grant(case, expires_at="2099-01-01T00:00:00")}[mode]
    with client_for(authorize) as client:
        result = client.get(route(case))
    assert result.status_code == 403
    assert result.json() == {"detail": {"code": "remediation_history_denied"}}
    assert db_state(case) == before


def test_empty_missing_and_manual_history(case):
    with client_for(lambda issue: grant(case, issue_id=issue)) as client:
        empty = client.get(route(case))
        assert empty.status_code == 200
        assert empty.json()["items"] == [] and empty.json()["total"] == 0
        assert client.get("/api/issues/missing/remediation-history").status_code == 404
        manual = case.issues.create_issue("manual", model_version_id="v1")
        assert client.get(f"/api/issues/{manual['id']}/remediation-history").status_code == 404


def test_pagination_uses_existing_confirmations(case):
    first = confirm(case)
    reopen_case(case)
    second = fresh_confirmation(case)["confirmation"]
    expected = sorted((first, second), key=lambda item: (item["created_at"], item["id"]))
    before = db_state(case)
    with client_for(lambda issue: grant(case)) as client:
        for offset in (0, 1):
            result = client.get(route(case), params={"limit": 1, "offset": offset}).json()
            assert result["items"][0]["id"] == expected[offset]["id"]
            assert result["total"] == 2
            assert result["next_offset"] == (1 if offset == 0 else None)
        result = client.get(route(case), params={"offset": 9223372036854775807})
        assert result.status_code == 200 and result.json()["items"] == []
    assert db_state(case) == before


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1", "offset=9223372036854775808", "limit=x"])
def test_http_query_bounds(case, query):
    with client_for(lambda issue: grant(case)) as client:
        assert client.get(route(case) + "?" + query).status_code == 422


@pytest.mark.parametrize("limit,offset", [(True, 0), (1, False), (0, 0), (1, -1), (1, 9223372036854775808)])
def test_helper_bounds_before_authorization_or_db(tmp_path, limit, offset):
    from issues.remediation_history import HistoryUnavailable, read_remediation_history
    with pytest.raises(HistoryUnavailable):
        read_remediation_history(tmp_path / "absent.db", "issue", lambda _: pytest.fail("invalid controls"), limit, offset)
    assert not (tmp_path / "absent.db").exists()


@pytest.mark.parametrize("mutation", ["json", "schema", "issue", "group", "principal", "created", "anchor", "guid"])
def test_corrupt_record_fails_closed(case, mutation):
    snapshot = confirm(case)
    if mutation == "schema": snapshot["schema_version"] = "unknown"
    if mutation == "issue": snapshot["issue_id"] = "other"
    if mutation == "group": del snapshot["revised"]["run_id"]
    if mutation == "principal": snapshot["principal_ref"] = "other"
    if mutation == "created": snapshot["created_at"] = "2000-01-01T00:00:00+00:00"
    if mutation == "anchor": snapshot["original"]["anchor_id"] = "other"
    if mutation == "guid": snapshot["revised"]["ifc_guid"] = "other"
    with sqlite3.connect(case.path) as conn:
        conn.execute("UPDATE issue_remediation_confirmations SET snapshot_json=?",
                     ("{" if mutation == "json" else json.dumps(snapshot),))
    before = db_state(case)
    with client_for(lambda issue: grant(case)) as client:
        result = client.get(route(case))
    assert result.status_code == 503
    assert result.json() == {"detail": {"code": "remediation_history_unavailable"}}
    assert db_state(case) == before


def test_projection_strips_extra_proof_fields_at_every_level(case):
    snapshot = confirm(case)
    snapshot["idempotency_key"] = "private"
    for group in (snapshot["original"], snapshot["revised"]):
        group["authorization_ref"] = "private"
        group["members"][0]["request_hash"] = "private"
    with sqlite3.connect(case.path) as conn:
        conn.execute("UPDATE issue_remediation_confirmations SET snapshot_json=?", (json.dumps(snapshot),))
    with client_for(lambda issue: grant(case)) as client:
        result = client.get(route(case))
    assert result.status_code == 200
    for key in ("request_hash", "authorization_ref", "correspondence_ref", "idempotency_key"):
        assert key not in result.text


def test_reader_opens_existing_database_in_readonly_mode(case, monkeypatch):
    from issues import remediation_history as history
    connect = sqlite3.connect
    calls = []
    def observe(path, **kwargs):
        assert str(path).endswith("?mode=ro") and kwargs["uri"] is True
        conn = connect(path, **kwargs)
        conn.set_trace_callback(calls.append)
        return conn
    monkeypatch.setattr(history.sqlite3, "connect", observe)
    history.read_remediation_history(case.path, case.command.issue_id, lambda issue: grant(case))
    assert "PRAGMA query_only=ON" in calls and "BEGIN" in calls
    assert all(sql.upper().startswith(("PRAGMA QUERY_ONLY=ON", "BEGIN", "SELECT")) for sql in calls)


def test_expiry_rechecked_after_page_materialization(case, monkeypatch):
    from issues import remediation_history as history
    confirm(case)
    start = datetime.now(timezone.utc)
    times = iter((start, start + timedelta(minutes=10)))
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return next(times)
    authorization = grant(case, expires_at=(start + timedelta(minutes=1)).isoformat())
    monkeypatch.setattr(history, "datetime", Clock)
    before = db_state(case)
    with client_for(lambda issue: authorization) as client:
        result = client.get(route(case))
    assert result.status_code == 403
    assert result.json() == {"detail": {"code": "remediation_history_denied"}}
    assert db_state(case) == before


def test_authorized_missing_database_is_not_created(case, tmp_path, monkeypatch):
    path = tmp_path / "never-created.db"
    monkeypatch.setenv("GOV_DB_PATH", str(path))
    with client_for(lambda issue: grant(case)) as client:
        result = client.get(route(case))
    assert result.status_code == 503
    assert result.json() == {"detail": {"code": "remediation_history_unavailable"}}
    assert not path.exists()


@pytest.mark.parametrize("versions", [frozenset(), {"v1", "v2"}, frozenset({" v1"}), frozenset({"v1\n"})])
def test_malformed_grant_is_rejected_before_db(case, monkeypatch, versions):
    from issues import remediation_history as history
    authorization = grant(case, model_version_ids=versions)
    monkeypatch.setattr(history.sqlite3, "connect", lambda *args, **kwargs: pytest.fail("denied before DB"))
    with pytest.raises(history.HistoryDenied):
        history.read_remediation_history(case.path, case.command.issue_id, lambda issue: authorization)
