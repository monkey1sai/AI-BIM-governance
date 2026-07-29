"""A4 proof-bound Issue persistence stays separate from legacy Issue semantics."""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from search.proofs import ProofRegistry


def _context(*, principal_ref: str = "a4p_current_principal") -> dict[str, str]:
    return {
        "scope": "session_table_only",
        "review_session_id": "review_session_deadbeef12",
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
    query_id: str = "a4q_issue_provenance_0001",
    principal_ref: str = "a4p_current_principal",
    ifc_guid: str = "0A4DoorLow000000000001",
    accepted_usd_prim: str = "/World/Doors/Low",
    mapping_digest: str = "b" * 64,
) -> dict:
    return {
        "schema_version": "a4-proof-v1",
        "query_id": query_id,
        "query": "找 4F 防火門且 FireRating < 60",
        "normalized_filters": {"ifc_classes": ["IfcDoor"], "storey_tokens": ["4F"]},
        "interpretation": {
            "mode": "deterministic",
            "source": "deterministic",
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
            "name": "FireDoor-Low",
            "storey": "4F",
            "matched_properties": {"FireRating": "30"},
            "predicate_trace": ["class_match:IfcDoor", "storey_match:4F"],
            "accepted_usd_prim": accepted_usd_prim,
            "mapping_observed": True,
        },
        "model_version_id": "a4_fixture_v1",
        "session_binding": _context(principal_ref=principal_ref),
        "mapping_digest": mapping_digest,
    }


@pytest.fixture()
def a4_client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    monkeypatch.setenv("A4_INTERNAL_CONTEXT_TOKEN", "test-internal-context-token")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "test-proof-signing-key-material-32bytes")
    import issues.api as issues_api
    import app as app_module

    registry = ProofRegistry()
    monkeypatch.setattr(issues_api, "proof_registry", registry)
    importlib.reload(app_module)
    return TestClient(app_module.app), registry, str(tmp_path / "gov.db")


def _request_body(proof: str, *, title: str = "A4 selected door needs review", principal_ref: str = "a4p_current_principal") -> dict:
    return {
        "evidence_proof": proof,
        "title": title,
        "description": "由已驗證的語意查詢列建立。",
        "severity": "high",
        "assignee": "ops-a4",
        "a4_trusted_context": _context(principal_ref=principal_ref),
    }


def test_a4_issue_is_atomic_proof_bound_and_exactly_replayable(a4_client):
    client, registry, db_path = a4_client
    issued = registry.issue(_snapshot())
    assert issued is not None
    payload = _request_body(issued["evidence_proof"])

    first = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=payload,
    )
    assert first.status_code == 201, first.text
    first_body = first.json()
    assert first_body["replayed"] is False
    issue = first_body["issue"]
    assert issue["source_type"] == "a4_search"
    assert issue["source_ref"] == "a4q_issue_provenance_0001"
    assert issue["ifc_guid"] == "0A4DoorLow000000000001"

    from issues.store import IssueStore

    store = IssueStore(db_path)
    provenance = store.get_a4_provenance(issue["id"])
    assert provenance is not None
    assert "evidence_proof" not in provenance["a4_evidence_snapshot_json"]
    assert "ifc_source_path" not in provenance["a4_evidence_snapshot_json"]
    assert len(store.get_events(issue["id"])) == 1

    replay = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=payload,
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True
    assert replay.json()["issue"]["id"] == issue["id"]
    assert len(store.get_events(issue["id"])) == 1

    altered = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(issued["evidence_proof"], title="altered draft"),
    )
    assert altered.status_code == 409
    assert altered.json()["detail"]["code"] == "a4_proof_unavailable"
    assert len([item for item in store.list_issues() if item["source_type"] == "a4_search"]) == 1


def test_a4_issue_replay_survives_expiry_but_unconsumed_expiry_is_retryable(a4_client, monkeypatch):
    import search.proofs as proofs_mod

    client, registry, _db_path = a4_client
    consumed = registry.issue(_snapshot())
    assert consumed is not None
    payload = _request_body(consumed["evidence_proof"])
    created = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=payload,
    )
    assert created.status_code == 201

    expired = registry.issue(_snapshot(query_id="a4q_issue_provenance_0002"))
    assert expired is not None
    expires_at = registry._records[expired["proof_id"]].verified.expires_at_epoch
    monkeypatch.setattr(proofs_mod.time, "time", lambda: expires_at + 1)

    replay = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=payload,
    )
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True

    expired_response = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(expired["evidence_proof"]),
    )
    assert expired_response.status_code == 409
    assert expired_response.json()["detail"] == {
        "code": "a4_proof_expired",
        "retryable": True,
        "recovery": "rerun_query",
        "draft_preserved": True,
    }


def test_a4_issue_rejects_forged_context_and_generic_manual_provenance(a4_client):
    client, registry, _db_path = a4_client
    issued = registry.issue(_snapshot())
    assert issued is not None

    forged = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(issued["evidence_proof"], principal_ref="a4p_other_principal"),
    )
    assert forged.status_code == 409
    assert forged.json()["detail"]["code"] == "a4_proof_unavailable"

    generic = client.post(
        "/api/issues",
        json={"title": "manual forged A4", "evidence_proof": issued["evidence_proof"]},
    )
    assert generic.status_code == 422


def test_a4_issue_concurrent_first_consume_has_one_winner_and_one_exact_replay(a4_client):
    import concurrent.futures

    client, registry, db_path = a4_client
    del client  # This test intentionally exercises the store's transaction seam.
    issued = registry.issue(_snapshot())
    assert issued is not None
    verified = registry.verify(issued["evidence_proof"])
    from issues.store import IssueStore

    store = IssueStore(db_path)

    def create_once():
        return store.create_a4_issue(
            verified_proof=verified,
            current_context=_context(),
            title="A4 selected door needs review",
            description="由已驗證的語意查詢列建立。",
            severity="high",
            assignee="ops-a4",
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = [future.result() for future in [pool.submit(create_once), pool.submit(create_once)]]

    assert {item["issue"]["id"] for item in outcomes} == {outcomes[0]["issue"]["id"]}
    assert sorted(item["replayed"] for item in outcomes) == [False, True]
    a4_issues = [item for item in store.list_issues() if item["source_type"] == "a4_search"]
    assert len(a4_issues) == 1
    assert len(store.get_events(a4_issues[0]["id"])) == 1


def test_consumed_replay_survives_key_retirement_but_unconsumed_old_key_fails(a4_client, monkeypatch):
    client, registry, db_path = a4_client
    consumed = registry.issue(_snapshot())
    unconsumed = registry.issue(_snapshot(query_id="a4q_issue_provenance_0002"))
    assert consumed is not None and unconsumed is not None
    consumed_payload = _request_body(consumed["evidence_proof"])
    created = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=consumed_payload,
    )
    assert created.status_code == 201

    old_kid = "a4_test_kid"
    old_key = "test-proof-signing-key-material-32bytes"
    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_new_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "new-test-proof-signing-key-material-32bytes")
    monkeypatch.setenv("A4_PROOF_PREVIOUS_KID", old_kid)
    monkeypatch.setenv("A4_PROOF_PREVIOUS_KEY", old_key)
    assert registry.verify(unconsumed["evidence_proof"]).kid == old_kid

    monkeypatch.delenv("A4_PROOF_PREVIOUS_KID")
    monkeypatch.delenv("A4_PROOF_PREVIOUS_KEY")
    replay = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=consumed_payload,
    )
    rejected = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(unconsumed["evidence_proof"]),
    )
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert replay.json()["issue"]["id"] == created.json()["issue"]["id"]
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "a4_proof_unavailable"

    from issues.store import IssueStore

    assert len([item for item in IssueStore(db_path).list_issues() if item["source_type"] == "a4_search"]) == 1


def test_consumed_replay_rejects_token_byte_mutation_and_cross_principal(a4_client):
    client, registry, db_path = a4_client
    issued = registry.issue(_snapshot())
    assert issued is not None
    payload = _request_body(issued["evidence_proof"])
    created = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=payload,
    )
    assert created.status_code == 201
    proof = issued["evidence_proof"]
    mutated_proof = f"{proof[:-1]}{'0' if proof[-1] != '0' else '1'}"

    mutated = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(mutated_proof),
    )
    unauthorized = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(proof, principal_ref="a4p_other_principal"),
    )
    assert mutated.status_code == 409
    assert mutated.json()["detail"]["code"] == "a4_proof_unavailable"
    assert unauthorized.status_code == 409
    assert unauthorized.json()["detail"]["code"] == "a4_proof_unavailable"
    assert created.json()["issue"]["id"] not in mutated.text
    assert created.json()["issue"]["id"] not in unauthorized.text

    from issues.store import IssueStore

    store = IssueStore(db_path)
    assert len([item for item in store.list_issues() if item["source_type"] == "a4_search"]) == 1
    assert len(store.get_events(created.json()["issue"]["id"])) == 1


def test_same_query_different_rows_create_distinct_issues(a4_client):
    client, registry, db_path = a4_client
    first = registry.issue(_snapshot())
    second = registry.issue(_snapshot(
        ifc_guid="0A4DoorLow000000000002",
        accepted_usd_prim="/World/Doors/Low2",
        mapping_digest="c" * 64,
    ))
    assert first is not None and second is not None

    responses = [
        client.post(
            "/api/internal/a4/issues",
            headers={"X-A4-Internal-Token": "test-internal-context-token"},
            json=_request_body(proof["evidence_proof"]),
        )
        for proof in (first, second)
    ]
    assert [response.status_code for response in responses] == [201, 201]
    issue_ids = {response.json()["issue"]["id"] for response in responses}
    assert len(issue_ids) == 2
    assert {response.json()["issue"]["source_ref"] for response in responses} == {
        "a4q_issue_provenance_0001"
    }

    from issues.store import IssueStore

    store = IssueStore(db_path)
    assert all(len(store.get_events(issue_id)) == 1 for issue_id in issue_ids)


def test_unicode_canonical_equivalence_replays_same_issue(a4_client):
    client, registry, _db_path = a4_client
    issued = registry.issue(_snapshot())
    assert issued is not None
    proof = issued["evidence_proof"]
    first = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(proof, title="Cafe\u0301 door"),
    )
    replay = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(proof, title="Caf\u00e9 door"),
    )
    altered = client.post(
        "/api/internal/a4/issues",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=_request_body(proof, title="Cafe door"),
    )
    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert replay.json()["issue"]["id"] == first.json()["issue"]["id"]
    assert altered.status_code == 409
    assert altered.json()["detail"]["code"] == "a4_proof_unavailable"
