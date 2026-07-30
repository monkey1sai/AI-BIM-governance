"""A4 confirmed-row Issue persistence, authorization, and replay contract."""
from __future__ import annotations

import concurrent.futures
import importlib
import json
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from search.proofs import ProofExpired, ProofRegistry


_INTERNAL_TOKEN = "test-internal-a4-context-token"
_SIGNING_KEY = "test-proof-signing-key-material-32bytes"


def _trusted_context(*, principal_ref: str = "principal_a4", session_id: str = "review_session_a4") -> dict:
    return {
        "scope": "session_table_only",
        "review_session_id": session_id,
        "principal_ref": principal_ref,
        "primary_artifact_id": "artifact_a4",
        "active_binding_revision": "binding_a4_1",
        "model_version_id": "a4_fixture_v1",
        "auth_scope": "production",
        "mapping_provenance": "server_resolved",
        "primary_lease_capability": "verified",
    }


def _snapshot(
    *,
    query_id: str = "a4q_issue_fixture_0001",
    ifc_guid: str = "0A4DoorLow000000000001",
    accepted_prim: str | None = "/World/Doors/Low",
) -> dict:
    context = _trusted_context()
    return {
        "schema_version": "a4-proof-v1",
        "query_id": query_id,
        "query": "找 4F 防火門且 FireRating < 60",
        "normalized_filters": {
            "ifc_classes": ["IfcDoor"],
            "storeys": ["4F"],
            "property_filters": [{"name": "FireRating", "op": "lt", "value": 60}],
        },
        "interpretation": {
            "mode": "deterministic",
            "source": "deterministic_grammar",
            "complete": True,
            "completion_scope": "complete_table",
            "partial_execution": False,
            "scan_complete": True,
            "truncated": False,
            "degraded_to_deterministic": False,
            "unresolved_terms": [],
        },
        "row": {
            "ifc_guid": ifc_guid,
            "ifc_class": "IfcDoor",
            "name": "Low Door",
            "storey": "4F",
            "matched_properties": {"FireRating": 30},
            "predicate_trace": ["IfcDoor", "storey=4F", "FireRating=30 < 60"],
            "accepted_usd_prim": accepted_prim,
            "mapping_observed": accepted_prim is not None,
            "usd_prim_path": accepted_prim,
            "highlight_eligible": accepted_prim is not None,
        },
        "model_version_id": "a4_fixture_v1",
        "session_binding": {
            **context,
            "session_id": context["review_session_id"],
            "principal": context["principal_ref"],
            "model_artifact": context["primary_artifact_id"],
        },
        "mapping_digest": "a" * 64,
    }


def _payload(registry: ProofRegistry, snapshot: dict | None = None, **overrides) -> dict:
    source_evidence = snapshot or _snapshot()
    proof = registry.issue(source_evidence)
    assert proof is not None
    evidence = proof["a4_evidence_snapshot"]
    payload = {
        "title": "4F 防火門 FireRating 不足",
        "description": "請由人工確認並修正。",
        "severity": "high",
        "assignee": "reviewer-a4",
        "ifc_guid": evidence["row"]["ifc_guid"],
        "usd_prim_path": evidence["row"]["accepted_usd_prim"],
        "evidence_proof": proof["evidence_proof"],
        "a4_evidence_snapshot": evidence,
        "a4_trusted_context": _trusted_context(),
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def a4_client(tmp_path, monkeypatch):
    db_path = str(tmp_path / "gov.db")
    monkeypatch.setenv("GOV_DB_PATH", db_path)
    monkeypatch.setenv("A4_INTERNAL_CONTEXT_TOKEN", _INTERNAL_TOKEN)
    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", _SIGNING_KEY)
    monkeypatch.delenv("A4_PROOF_PREVIOUS_KID", raising=False)
    monkeypatch.delenv("A4_PROOF_PREVIOUS_KEY", raising=False)

    import app as app_module
    import issues.a4_api as a4_api

    importlib.reload(app_module)
    registry = ProofRegistry()
    monkeypatch.setattr(a4_api, "proof_registry", registry)
    return TestClient(app_module.app), db_path, registry


def _post(client: TestClient, payload: dict):
    return client.post(
        "/api/internal/a4/issues/from-search",
        headers={"X-A4-Internal-Token": _INTERNAL_TOKEN},
        json=payload,
    )


def _persisted_issue_count(db_path: str) -> int:
    with sqlite3.connect(db_path) as conn:
        return conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0]


def test_confirmed_a4_issue_persists_immutable_provenance_and_audit(a4_client):
    from issues.store import IssueStore

    client, db_path, registry = a4_client
    payload = _payload(registry)

    response = _post(client, payload)

    assert response.status_code == 201
    body = response.json()
    assert body["replayed"] is False
    issue = body["issue"]
    assert issue["source_type"] == "a4_search"
    assert issue["source_ref"] == payload["a4_evidence_snapshot"]["query_id"]
    assert issue["model_version_id"] == "a4_fixture_v1"
    assert issue["primary_artifact_id"] == "artifact_a4"
    assert issue["active_binding_revision"] == "binding_a4_1"
    assert issue["a4_evidence_snapshot"] == payload["a4_evidence_snapshot"]
    assert len(issue["snapshot_hash"]) == 64
    assert len(issue["proof_digest"]) == 64
    assert len(issue["creation_request_hash"]) == 64
    assert "evidence_proof" not in issue

    detail = client.get(f"/api/issues/{issue['id']}")
    assert detail.status_code == 404
    assert client.get("/api/issues").json()["issues"] == []
    events = IssueStore(db_path).get_events(issue["id"])
    assert events[0]["note"] == f"source=a4_search;query_id={issue['source_ref']}"
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM a4_issue_evidence").fetchone()[0] == 1
        query_history = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%query%history%'"
        ).fetchall()
    assert query_history == []


def test_exact_replay_survives_expiry_and_signing_key_removal(a4_client, monkeypatch):
    client, db_path, registry = a4_client
    payload = _payload(registry)
    first = _post(client, payload)
    assert first.status_code == 201

    fresh_replay = _post(client, payload)
    assert fresh_replay.status_code == 200
    assert fresh_replay.json()["replayed"] is True
    assert fresh_replay.json()["issue"]["id"] == first.json()["issue"]["id"]

    with pytest.raises(ProofExpired):
        registry.verify(payload["evidence_proof"], now=time.time() + 10_000)
    monkeypatch.delenv("A4_PROOF_ACTIVE_KID")
    monkeypatch.delenv("A4_PROOF_ACTIVE_KEY")
    replay = _post(client, payload)

    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert replay.json()["issue"]["id"] == first.json()["issue"]["id"]
    assert _persisted_issue_count(db_path) == 1
    assert client.get("/api/issues").json()["issues"] == []


def test_unconsumed_previous_key_proof_verifies_during_normal_rotation(a4_client, monkeypatch):
    import issues.a4_api as a4_api

    client, _, registry = a4_client
    payload = _payload(registry)
    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_new_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "new-proof-signing-key-material-32bytes")
    monkeypatch.setenv("A4_PROOF_PREVIOUS_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_PREVIOUS_KEY", _SIGNING_KEY)
    # Normal key rotation commonly restarts the service. Verification must rely
    # on signed opaque claims + the submitted snapshot, not old process memory.
    monkeypatch.setattr(a4_api, "proof_registry", ProofRegistry())

    response = _post(client, payload)

    assert response.status_code == 201
    assert response.json()["issue"]["source_type"] == "a4_search"


@pytest.mark.parametrize("mutation", ["draft", "proof_bytes", "snapshot"])
def test_consumed_proof_conflicting_replay_is_409(a4_client, mutation):
    client, db_path, registry = a4_client
    payload = _payload(registry)
    first = _post(client, payload)
    assert first.status_code == 201
    original = first.json()["issue"]

    conflicting = {**payload}
    if mutation == "draft":
        conflicting["title"] = "altered draft"
    elif mutation == "proof_bytes":
        proof = payload["evidence_proof"]
        conflicting["evidence_proof"] = proof[:-1] + ("0" if proof[-1] != "0" else "1")
    else:
        conflicting["a4_evidence_snapshot"] = {
            **payload["a4_evidence_snapshot"],
            "query": "altered query",
        }

    response = _post(client, conflicting)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "a4_issue_replay_conflict"
    current = _post(client, payload).json()["issue"]
    assert current["a4_evidence_snapshot"] == original["a4_evidence_snapshot"]
    assert _persisted_issue_count(db_path) == 1


def test_unauthorized_replay_is_403_before_digest_details(a4_client):
    client, db_path, registry = a4_client
    payload = _payload(registry)
    assert _post(client, payload).status_code == 201

    stolen = {
        **payload,
        "title": "also altered",
        "a4_trusted_context": _trusted_context(principal_ref="other_principal"),
    }
    response = _post(client, stolen)

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "a4_issue_unauthorized"
    assert _persisted_issue_count(db_path) == 1


def test_unconsumed_expired_proof_returns_recovery_hints_with_zero_write(a4_client, monkeypatch):
    import issues.a4_api as a4_api

    client, db_path, registry = a4_client
    payload = _payload(registry)

    class ExpiredProofAuthority:
        def verify(self, token, *, snapshot=None):
            return registry.verify(token, snapshot=snapshot, now=time.time() + 10_000)

    monkeypatch.setattr(a4_api, "proof_registry", ExpiredProofAuthority())

    response = _post(client, payload)

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "a4_proof_expired",
        "retryable": True,
        "recovery": "rerun_query",
        "draft_preserved": True,
    }
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM a4_issue_evidence").fetchone()[0] == 0


def test_cross_boundary_and_forged_proof_are_rejected_without_writes(a4_client):
    client, db_path, registry = a4_client
    cross_session = _payload(
        registry,
        a4_trusted_context=_trusted_context(session_id="other_session"),
    )
    cross_response = _post(client, cross_session)
    assert cross_response.status_code == 403
    assert cross_response.json()["detail"]["code"] == "a4_issue_unauthorized"

    forged = _payload(registry)
    proof = forged["evidence_proof"]
    forged["evidence_proof"] = proof[:-1] + ("0" if proof[-1] != "0" else "1")
    forged_response = _post(client, forged)
    assert forged_response.status_code == 409
    assert forged_response.json()["detail"]["code"] == "a4_proof_invalid"

    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM a4_issue_evidence").fetchone()[0] == 0


def test_even_signed_incomplete_snapshot_is_rejected_without_writes(a4_client):
    client, db_path, registry = a4_client
    incomplete = _snapshot()
    incomplete["interpretation"] = {
        **incomplete["interpretation"],
        "complete": False,
        "completion_scope": "confirmed_partial_table",
        "partial_execution": True,
    }

    response = _post(client, _payload(registry, incomplete))

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "a4_evidence_snapshot_invalid"
    with sqlite3.connect(db_path) as conn:
        issue_table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='issues'"
        ).fetchone()
        if issue_table is not None:
            assert conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM a4_issue_evidence").fetchone()[0] == 0


def test_same_query_different_rows_create_distinct_issues(a4_client):
    client, db_path, registry = a4_client
    first_snapshot = _snapshot()
    second_snapshot = _snapshot(ifc_guid="0A4DoorLow000000000002", accepted_prim="/World/Doors/Low2")

    first = _post(client, _payload(registry, first_snapshot))
    second = _post(client, _payload(registry, second_snapshot))

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["issue"]["source_ref"] == second.json()["issue"]["source_ref"]
    assert first.json()["issue"]["id"] != second.json()["issue"]["id"]
    assert _persisted_issue_count(db_path) == 2


def test_concurrent_identical_requests_have_one_issue_and_one_replay(a4_client):
    client, db_path, registry = a4_client
    payload = _payload(registry)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _index: _post(client, payload), range(2)))

    assert sorted(response.status_code for response in responses) == [200, 201]
    assert sorted(response.json()["replayed"] for response in responses) == [False, True]
    assert len({response.json()["issue"]["id"] for response in responses}) == 1
    assert _persisted_issue_count(db_path) == 1


def test_unicode_canonicalization_makes_equivalent_replay_idempotent(a4_client):
    client, _, registry = a4_client
    decomposed = "Cafe\u0301 防火門"
    snapshot = _snapshot()
    snapshot["query"] = "Cafe\u0301 door"
    snapshot["row"]["name"] = "Cafe\u0301 Door"
    payload = _payload(registry, snapshot, title=decomposed)
    first = _post(client, payload)
    assert first.status_code == 201
    assert first.json()["issue"]["title"] == "Café 防火門"
    assert first.json()["issue"]["a4_evidence_snapshot"]["query"] == "Café door"

    composed_snapshot = {
        **snapshot,
        "query": "Café door",
        "row": {**snapshot["row"], "name": "Café Door"},
    }
    replay = _post(
        client,
        {
            **payload,
            "title": "Café 防火門",
            "a4_evidence_snapshot": composed_snapshot,
        },
    )
    assert replay.status_code == 200
    assert replay.json()["issue"]["id"] == first.json()["issue"]["id"]


def test_proof_snapshot_numeric_values_survive_node_json_roundtrip(a4_client):
    client, _, registry = a4_client
    snapshot = _snapshot()
    snapshot["normalized_filters"]["property_filters"][0]["value"] = 30.0
    snapshot["row"]["matched_properties"] = {
        "FloatValue": 30.0,
        "UnsafeInteger": 9_007_199_254_740_993,
    }
    payload = _payload(registry, snapshot)

    wire_snapshot = json.loads(json.dumps(payload["a4_evidence_snapshot"], ensure_ascii=False))
    assert wire_snapshot["normalized_filters"]["property_filters"][0]["value"] == "30.0"
    assert wire_snapshot["row"]["matched_properties"] == {
        "FloatValue": "30.0",
        "UnsafeInteger": "9007199254740993",
    }
    payload["a4_evidence_snapshot"] = wire_snapshot

    response = _post(client, payload)

    assert response.status_code == 201
    assert response.json()["issue"]["a4_evidence_snapshot"] == wire_snapshot


def test_lifecycle_hides_a4_evidence_and_requires_session_authority(a4_client):
    from issues.store import IssueStore

    client, db_path, registry = a4_client
    created = _post(client, _payload(registry)).json()["issue"]
    immutable = {
        key: created[key]
        for key in (
            "source_type",
            "source_ref",
            "a4_evidence_snapshot",
            "snapshot_hash",
            "proof_digest",
            "creation_request_hash",
        )
    }

    transitioned = client.post(
        f"/api/issues/{created['id']}/transition",
        json={"to_status": "assigned", "note": "review"},
    )
    assert transitioned.status_code == 404
    assert transitioned.json()["detail"] == "issue not found"

    # Storage-level lifecycle changes remain additive and do not rewrite the
    # immutable evidence row.  A future session-authorized transition route can
    # call this same transaction after it establishes authority.
    store = IssueStore(db_path)
    store.transition(created["id"], "assigned", "review")
    current = store.get_a4_issue(created["id"])
    assert current is not None
    assert {key: current[key] for key in immutable} == immutable

    legacy = client.post(
        "/api/issues",
        json={
                "title": "legacy manual",
                "ifc_guid": "LEGACY_GUID",
                "model_version_id": "legacy_mv_001",
                # Generic callers cannot self-assign A4 provenance; legacy extra
            # fields remain ignored and the existing manual semantics win.
            "source_type": "a4_search",
            "a4_evidence_snapshot": _snapshot(),
        },
    )
    assert legacy.status_code == 201
    assert legacy.json()["source_type"] == "manual"
    assert "a4_evidence_snapshot" not in legacy.json()


def test_additive_schema_keeps_historical_issue_readable_without_backfill(tmp_path):
    from issues.store import IssueStore

    db_path = str(tmp_path / "historical.db")
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE issues(
              id TEXT PRIMARY KEY, kind TEXT, title TEXT, description TEXT,
              status TEXT, severity TEXT, assignee TEXT, ifc_guid TEXT,
              usd_prim_path TEXT, model_version_id TEXT, source_type TEXT,
              source_ref TEXT, created_at TEXT, updated_at TEXT
            );
            CREATE TABLE issue_events(
              id TEXT PRIMARY KEY, issue_id TEXT, event_type TEXT,
              from_status TEXT, to_status TEXT, note TEXT, created_at TEXT
            );
            """
        )
        conn.execute(
            "INSERT INTO issues VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "iss_historical",
                "issue",
                "historical",
                None,
                "open",
                "medium",
                None,
                "HISTORICAL_GUID",
                None,
                "mv_old",
                "rule_result",
                "rule_old",
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
            ),
        )
        conn.execute(
            "INSERT INTO issues VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "iss_historical_null_source",
                "issue",
                "historical null source",
                None,
                "open",
                "medium",
                None,
                "HISTORICAL_NULL_GUID",
                None,
                "mv_old",
                None,
                None,
                "2026-01-01T00:00:01Z",
                "2026-01-01T00:00:01Z",
            ),
        )

    store = IssueStore(db_path)
    issue = store.get_issue("iss_historical")

    assert issue is not None
    assert issue["source_type"] == "rule_result"
    assert "a4_evidence_snapshot" not in issue
    assert {item["id"] for item in store.list_issues()} == {
        "iss_historical",
        "iss_historical_null_source",
    }
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM a4_issue_evidence").fetchone()[0] == 0


def test_internal_route_requires_server_token(a4_client):
    client, db_path, registry = a4_client
    payload = _payload(registry)

    response = client.post("/api/internal/a4/issues/from-search", json=payload)

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "a4_internal_context_unauthorized"
    with sqlite3.connect(db_path) as conn:
        issue_table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='issues'"
        ).fetchone()
        if issue_table is not None:
            assert conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0] == 0


def test_internal_route_rejects_short_configured_token(a4_client, monkeypatch):
    client, db_path, registry = a4_client
    payload = _payload(registry)
    monkeypatch.setenv("A4_INTERNAL_CONTEXT_TOKEN", "short")

    response = client.post(
        "/api/internal/a4/issues/from-search",
        headers={"X-A4-Internal-Token": "short"},
        json=payload,
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "a4_internal_context_unavailable"
    with sqlite3.connect(db_path) as conn:
        issue_table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='issues'"
        ).fetchone()
        if issue_table is not None:
            assert conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0] == 0


def test_store_authorizes_consumed_replay_before_digest_comparison(a4_client):
    from issues.store import A4IssueUnauthorized, IssueStore

    client, db_path, registry = a4_client
    payload = _payload(registry)
    assert _post(client, payload).status_code == 201
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        evidence = conn.execute("SELECT * FROM a4_issue_evidence").fetchone()
    assert evidence is not None

    with pytest.raises(A4IssueUnauthorized):
        IssueStore(db_path).find_a4_issue_replay(
            proof_id=evidence["proof_id"],
            review_session_id="different_session",
            principal_ref="different_principal",
            snapshot_hash="0" * 64,
            proof_digest="1" * 64,
            creation_request_hash="2" * 64,
        )
