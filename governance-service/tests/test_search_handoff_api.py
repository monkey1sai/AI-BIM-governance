"""A4 handoff internal API wiring for the #365 proof-set authority."""
from __future__ import annotations

from fastapi.testclient import TestClient
import pytest
from unittest.mock import Mock

import app as app_module
from search import api as search_api
from search.proofs import ProofRegistry


INTERNAL_TOKEN = "test-a4-internal-context-token"
ACTIVE_KEY = "test-only-a4-proof-key-material-at-least-32-bytes"
VALID_SHAPED_UNKNOWN_PROOF = "a4p.a4_test_kid." + ("a" * 16) + "." + ("b" * 64)


@pytest.fixture()
def handoff_api(monkeypatch):
    monkeypatch.setenv("A4_INTERNAL_CONTEXT_TOKEN", INTERNAL_TOKEN)
    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", ACTIVE_KEY)
    registry = ProofRegistry()
    monkeypatch.setattr(search_api, "proof_registry", registry)
    return TestClient(app_module.app), registry


def _snapshot(*, guid: str, prim: str, artifact: str = "artifact_a4") -> dict:
    return {
        "schema_version": "a4-proof-v1",
        "query_id": "a4q_handoff_api_fixture_0001",
        "query": "IfcDoor",
        "normalized_filters": {"ifc_class": "IfcDoor"},
        "interpretation": {"source": "deterministic", "complete": True},
        "row": {
            "ifc_guid": guid,
            "usd_prim_path": prim,
            "highlight_eligible": True,
        },
        "model_version_id": "a4_fixture_v1",
        "session_binding": {
            "session_id": "review_session_deadbeef12",
            "principal": "a4p_test_opaque",
            "model_artifact": artifact,
            "active_binding_revision": "binding_a4_1",
        },
        "mapping_digest": "mapping-digest-fixture",
    }


def _binding() -> dict[str, str]:
    return {
        "session_id": "review_session_deadbeef12",
        "principal": "a4p_test_opaque",
        "model_version_id": "a4_fixture_v1",
        "model_artifact": "artifact_a4",
        "active_binding_revision": "binding_a4_1",
    }


def _issue(registry: ProofRegistry, *, guid: str, prim: str, artifact: str = "artifact_a4") -> str:
    issued = registry.issue(_snapshot(guid=guid, prim=prim, artifact=artifact))
    assert issued is not None
    return issued["evidence_proof"]


def test_internal_handoff_api_returns_only_sanitized_trusted_rows(handoff_api):
    client, registry = handoff_api
    proof = _issue(registry, guid="GUID-DOOR-001", prim="/World/Doors/Door_001")

    response = client.post(
        "/api/internal/a4/handoffs/verify",
        headers={"X-A4-Internal-Token": INTERNAL_TOKEN},
        json={"action": "focus", "evidence_proofs": [proof], "binding": _binding()},
    )

    assert response.status_code == 200
    assert response.json() == {
        "accepted": True,
        "action": "focus",
        "code": None,
        "failed_index": None,
        "min_proof_expires_at": response.json()["min_proof_expires_at"],
        "rows": [
            {
                "proof_id": response.json()["rows"][0]["proof_id"],
                "ifc_guid": "GUID-DOOR-001",
                "prim_path": "/World/Doors/Door_001",
                "proof_expires_at": response.json()["rows"][0]["proof_expires_at"],
            }
        ],
    }
    serialized = response.text
    assert proof not in serialized
    assert "IfcDoor" not in serialized
    assert "normalized_filters" not in serialized
    assert "session_binding" not in serialized


def test_internal_handoff_api_atomic_rejects_invalid_multi_row_set(handoff_api):
    client, registry = handoff_api
    valid = _issue(registry, guid="GUID-DOOR-001", prim="/World/Doors/Door_001")
    wrong_binding = _issue(
        registry,
        guid="GUID-DOOR-002",
        prim="/World/Doors/Door_002",
        artifact="artifact_other",
    )

    response = client.post(
        "/api/internal/a4/handoffs/verify",
        headers={"X-A4-Internal-Token": INTERNAL_TOKEN},
        json={"action": "highlight", "evidence_proofs": [valid, wrong_binding], "binding": _binding()},
    )

    assert response.status_code == 409
    assert response.json() == {
        "accepted": False,
        "action": "highlight",
        "code": "binding_mismatch",
        "failed_index": 1,
        "min_proof_expires_at": None,
        "rows": [],
    }
    assert valid not in response.text
    assert wrong_binding not in response.text


def test_internal_handoff_api_requires_coordinator_token_before_proof_lookup(handoff_api, monkeypatch):
    client, registry = handoff_api
    verify = Mock(wraps=registry.verify)
    monkeypatch.setattr(registry, "verify", verify)

    response = client.post(
        "/api/internal/a4/handoffs/verify",
        json={"action": "focus", "evidence_proofs": [VALID_SHAPED_UNKNOWN_PROOF], "binding": _binding()},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": {"code": "a4_internal_context_unauthorized"}}
    verify.assert_not_called()


def test_internal_handoff_api_rejects_oversized_proof_before_registry_lookup(handoff_api, monkeypatch):
    client, registry = handoff_api
    verify = Mock(wraps=registry.verify)
    monkeypatch.setattr(registry, "verify", verify)

    response = client.post(
        "/api/internal/a4/handoffs/verify",
        headers={"X-A4-Internal-Token": INTERNAL_TOKEN},
        json={"action": "focus", "evidence_proofs": ["x" * 100_000], "binding": _binding()},
    )

    assert response.status_code == 422
    verify.assert_not_called()
