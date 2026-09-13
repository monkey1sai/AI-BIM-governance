"""Real signed HTTP requests against SQLite; no dependency override for grants."""
import base64
import hashlib
import hmac
import json
import sqlite3
import time
from dataclasses import asdict

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from issues import api
from test_issue_remediation import make_case, state

KEY = "synthetic-test-only-key-32-bytes-long"


def claims(case, operation="confirm", body=None):
    return {"version": 1, "operation": operation, "issue_id": case.command.issue_id,
        "body_sha256": hashlib.sha256(body or b"").hexdigest(), "expires_at_ms": int(time.time() * 1000) + 20000,
        "principal_ref": "test-operator", "actor_kind": "external_authority", "authorization_ref": "test-grant",
        "cases": [{"issue_id": case.command.issue_id, "tenant_id": "fixture-tenant", "project_id": "fixture-project",
            "ifc_guid": "0abcdefghijklmnopqrstu", "rule_code": "NAME", "correspondence_ref": "stable-test-pair",
            "original": {"run_id": case.original, "model_version_id": "v1", "source_sha256": "a" * 64},
            "revised": {"run_id": case.revised, "model_version_id": "v2", "source_sha256": "b" * 64}}]}


def header(value):
    encoded = base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=")
    return {"X-A1-Remediation-Grant": encoded.decode() + "." + hmac.new(KEY.encode(), encoded, hashlib.sha256).hexdigest(),
            "Content-Type": "application/json"}


@pytest.fixture
def context(tmp_path, monkeypatch):
    case = make_case(tmp_path)
    # Synthetic, persisted source bindings; real snapshot generation is covered separately.
    with sqlite3.connect(case.path) as conn:
        for run_id, version, sha in [(case.original, "v1", "a" * 64), (case.revised, "v2", "b" * 64)]:
            summary = json.loads(conn.execute("SELECT summary_json FROM rule_runs WHERE id=?", (run_id,)).fetchone()[0])
            summary["source_sha256"] = sha
            conn.execute("UPDATE rule_runs SET source_metadata_json=?,summary_json=? WHERE id=?", (
                json.dumps({"tenant_id": "fixture-tenant", "project_id": "fixture-project", "model_version_id": version}),
                json.dumps(summary), run_id))
    monkeypatch.setenv("GOV_DB_PATH", case.path)
    monkeypatch.setenv("A1_REMEDIATION_INTERNAL_KEY", KEY)
    monkeypatch.delenv("A1_REMEDIATION_LOCAL_VALIDATION", raising=False)
    app = FastAPI(); app.include_router(api.router)
    with TestClient(app) as client:
        yield case, client


def body(case):
    value = asdict(case.command); value.pop("issue_id")
    return json.dumps(value).encode()


def send(case, client, value=None, operation="confirm", raw=None):
    raw = body(case) if raw is None and operation == "confirm" else raw
    suffix = {"confirm": "confirm-remediation", "history": "remediation-history", "reopen": "reopen-remediation"}[operation]
    return client.request("GET" if operation == "history" else "POST",
        f"/api/issues/{case.command.issue_id}/{suffix}", content=raw,
        headers=header(value or claims(case, operation, raw)))


@pytest.mark.parametrize("side,field", [(s, f) for s in ("original", "revised") for f in ("tenant_id", "source_sha256", "missing_sha")])
@pytest.mark.parametrize("replay", [False, True])
def test_source_drift_is_rejected_without_writes(context, side, field, replay):
    case, client = context
    if replay: assert send(case, client).status_code == 200
    run_id = getattr(case, side)
    with sqlite3.connect(case.path) as conn:
        column = "source_metadata_json" if field == "tenant_id" else "summary_json"
        value = json.loads(conn.execute(f"SELECT {column} FROM rule_runs WHERE id=?", (run_id,)).fetchone()[0])
        if field == "missing_sha": value.pop("source_sha256")
        else: value[field] = "other-tenant" if field == "tenant_id" else "f" * 64
        conn.execute(f"UPDATE rule_runs SET {column}=? WHERE id=?", (json.dumps(value), run_id))
    before = state(case)
    assert send(case, client).status_code in (403, 422)
    assert state(case) == before


@pytest.mark.parametrize("mutation", ["operation", "issue", "body", "expired", "long_expiry", "principal", "role", "tenant", "sha", "local"])
def test_signed_invalid_scope_denied(context, mutation):
    case, client = context
    value = claims(case, body=body(case))
    if mutation == "operation": value["operation"] = "reopen"
    elif mutation == "issue": value["issue_id"] = "other"
    elif mutation == "body": value["body_sha256"] = "c" * 64
    elif mutation == "expired": value["expires_at_ms"] = 1
    elif mutation == "long_expiry": value["expires_at_ms"] += 300000
    elif mutation == "principal": value["principal_ref"] = ""
    elif mutation == "role": value["actor_kind"] = "local_supervisor_preview"
    elif mutation == "tenant": value["cases"][0]["tenant_id"] = "other"
    elif mutation == "sha": value["cases"][0]["revised"]["source_sha256"] = "c" * 64
    else: value["actor_kind"] = "local_validation"
    before = state(case)
    assert send(case, client, value).status_code == 403
    assert state(case) == before


def test_signed_confirm_history_reopen_and_stale(context):
    case, client = context
    first = send(case, client)
    assert first.status_code == 200
    assert first.json()["confirmation"]["source_identity"]["tenant_id"] == "fixture-tenant"
    assert send(case, client).json()["replayed"] is True
    history = send(case, client, operation="history")
    assert history.status_code == 200 and history.json()["total"] == 1
    raw = json.dumps({"expected_revision": 1, "note": "test recheck"}).encode()
    assert send(case, client, operation="reopen", raw=raw).json()["issue"]["status"] == "reopened"
    before = state(case)
    assert send(case, client, operation="reopen", raw=raw).status_code == 409
    assert state(case) == before
    assert send(case, client, operation="history").json()["items"] == history.json()["items"]


def test_reopen_audit_failure_rolls_back(context):
    case, client = context
    assert send(case, client).status_code == 200
    with sqlite3.connect(case.path) as conn:
        conn.execute("CREATE TRIGGER reject_reopen BEFORE INSERT ON issue_events BEGIN SELECT RAISE(ABORT,'private'); END")
    before = state(case)
    response = send(case, client, operation="reopen", raw=b'{"expected_revision":1}')
    assert response.status_code == 503 and "private" not in response.text
    assert state(case) == before


@pytest.mark.parametrize("operation", ["history", "reopen"])
def test_read_and_reopen_reject_original_source_drift(context, operation):
    case, client = context
    assert send(case, client).status_code == 200
    with sqlite3.connect(case.path) as conn:
        summary = json.loads(case.runs.get_run(case.original)["summary_json"])
        summary["source_sha256"] = "f" * 64
        conn.execute("UPDATE rule_runs SET summary_json=? WHERE id=?", (json.dumps(summary), case.original))
    before = state(case)
    assert send(case, client, operation=operation, raw=b'{"expected_revision":1}' if operation == "reopen" else None).status_code == 403
    assert state(case) == before


def test_expiry_during_reopen_audit_rolls_back(context, monkeypatch):
    from issues.remediation_authority import RequestAuthority
    case, client = context
    assert send(case, client).status_code == 200
    real = RequestAuthority.reopen
    def expire_after_authorization(self, *args):
        actor = real(self, *args)
        self.claims["expires_at_ms"] = 1
        return actor
    monkeypatch.setattr(RequestAuthority, "reopen", expire_after_authorization)
    before = state(case)
    assert send(case, client, operation="reopen", raw=b'{"expected_revision":1}').status_code == 403
    assert state(case) == before
