"""A4 POST /api/search/model — deterministic semantic search."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from search.interpreter import interpret_query
from search.engine import PartialFallbackUnavailable, SearchRequest, _storey_match, confirm_partial_fallback, run_model_search
from search.proofs import ProofRegistry, _safe_ttl_seconds

A4_FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "_fixtures" / "a4-semantic-search"
A4_FIRE_DOORS_IFC = A4_FIXTURE_ROOT / "a4_fire_doors.ifc"
A4_ELEMENT_MAPPING = A4_FIXTURE_ROOT / "element_mapping.json"

TINY = Path(__file__).resolve().parents[2] / "storage" / "e2e-a1" / "demo" / "tiny.ifc"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "gov.db"
    monkeypatch.setenv("GOV_DB_PATH", str(db))
    import importlib
    import app as gov_app

    importlib.reload(gov_app)
    return TestClient(gov_app.app)


@pytest.fixture()
def a4_ifc() -> Path:
    assert A4_FIRE_DOORS_IFC.is_file()
    assert A4_ELEMENT_MAPPING.is_file()
    return A4_FIRE_DOORS_IFC


def test_interpret_fire_door_query():
    filters = interpret_query("找 4F 防火門且 FireRating < 60")
    assert filters.interpretable
    assert "IfcDoor" in filters.ifc_classes
    assert any(t in ("4", "4F") for t in filters.storey_tokens)
    assert any(p.name == "FireRating" and p.op == "<" and p.value == 60 for p in filters.property_filters)


def test_storey_match_requires_whole_floor_number_not_prefix():
    assert _storey_match("1F", ["1", "1F"])
    assert _storey_match("Level 1", ["1", "1F"])
    assert not _storey_match("10F", ["1", "1F"])
    assert not _storey_match("11F", ["1", "1F"])
    assert _storey_match("10F", ["10", "10F"])


def test_deterministic_interpreter_exposes_server_computed_coverage():
    filters = interpret_query("找 4F 防火門且 FireRating < 60")
    assert filters.schema_valid is True
    assert filters.usable is True
    assert filters.complete is True
    assert filters.unresolved_terms == []


def test_proximity_constraint_is_not_silently_treated_as_complete():
    filters = interpret_query("IfcDoor within 3m of exit")
    assert filters.schema_valid is True
    assert filters.usable is True
    assert filters.complete is False
    assert filters.unresolved_terms


def test_deterministic_unknown_ifc_class_and_negation_are_not_executable():
    unknown = interpret_query("IfcBogus")
    assert unknown.schema_valid is False
    assert unknown.usable is False

    negated = interpret_query("IfcDoor not FireRating < 60")
    assert negated.usable is True
    assert negated.complete is False
    assert negated.unresolved_terms


@pytest.mark.parametrize("query", ["IfcDoor and IfcWall", "IfcDoor or FireRating < 60", "4F and 5F"])
def test_boolean_semantics_are_not_silently_rewritten(query):
    filters = interpret_query(query)
    assert filters.usable is True
    assert filters.complete is False
    assert filters.unresolved_terms


@pytest.mark.parametrize("name", ["candy", "floor", "indoor"])
def test_english_stopwords_and_ifc_aliases_do_not_rewrite_name_terms(name):
    filters = interpret_query(f"IfcDoor {name}")
    assert filters.complete is True
    assert filters.name_contains == [name]


@pytest.mark.parametrize("query", ["IfcDoor and IfcWall", "IfcDoor or FireRating < 60", "4F and 5F"])
def test_boolean_candidate_never_opens_or_scans_ifc(a4_ifc, monkeypatch, query):
    import search.engine as engine_mod

    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not scan")))
    body = run_model_search(SearchRequest(ifc_source_path=str(a4_ifc), query=query, interpret_mode="deterministic"))
    assert body["status"] == "partial_fallback_requires_trusted_context"
    assert body["stats"]["scanned"] == 0


def _trusted_partial_context(*, principal_ref="a4p_test", revision="binding_a4_1"):
    return {
        "scope": "session_table_only",
        "review_session_id": "review_session_deadbeef12",
        "principal_ref": principal_ref,
        "primary_artifact_id": "artifact_a4",
        "active_binding_revision": revision,
        "model_version_id": "a4_fixture_v1",
        "auth_scope": "production",
        "mapping_provenance": "server_resolved",
        "primary_lease_capability": "verified",
    }


def _proof_snapshot(*, query_id="a4q_proof_fixture_0001"):
    return {
        "schema_version": "a4-proof-v1",
        "query_id": query_id,
        "query": "IfcDoor",
        "normalized_filters": {"ifc_classes": ["IfcDoor"]},
        "interpretation": {"mode": "deterministic", "complete": True},
        "row": {
            "ifc_guid": "0A4DoorLow000000000001",
            "ifc_class": "IfcDoor",
            "accepted_usd_prim": "/World/Doors/Low",
            "mapping_observed": True,
        },
        "model_version_id": "a4_fixture_v1",
        "session_binding": _trusted_partial_context(),
        "mapping_digest": "a" * 64,
    }


def test_proof_registry_uses_unambiguous_token_and_never_evicts_an_active_record(monkeypatch):
    import search.proofs as proofs_mod

    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "test-proof-signing-key-material-32bytes")
    ids = iter(("proof_id_with_under_score_0001", "proof_id_with_under_score_0002"))
    monkeypatch.setattr(proofs_mod.secrets, "token_urlsafe", lambda _n: next(ids))
    registry = ProofRegistry(max_records=1)

    first = registry.issue(_proof_snapshot())
    assert first is not None
    assert first["evidence_proof"].startswith("a4p.a4_test_kid.proof_id_with_under_score_0001.")
    assert registry.verify(first["evidence_proof"]).proof_id == "proof_id_with_under_score_0001"

    # Saturation degrades the second request to table-only but does not remove a
    # still-valid proof belonging to the first request.
    assert registry.issue(_proof_snapshot(query_id="a4q_proof_fixture_0002")) is None
    assert registry.verify(first["evidence_proof"]).proof_id == "proof_id_with_under_score_0001"


def test_proof_registry_rejects_invalid_config_and_unsafe_snapshot(monkeypatch):
    import search.proofs as proofs_mod

    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "short")
    registry = ProofRegistry()
    assert registry.issue(_proof_snapshot()) is None

    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "test-proof-signing-key-material-32bytes")
    unsafe = _proof_snapshot()
    unsafe["row"]["ifc_source_path"] = "C:/host/path/never-eligible.ifc"
    assert registry.issue(unsafe) is None

    monkeypatch.setenv("A4_PROOF_TTL_SECONDS", "NaN")
    assert _safe_ttl_seconds() is None
    assert registry.issue(_proof_snapshot()) is None

    monkeypatch.setenv(
        "A4_PROOF_TTL_SECONDS",
        str(proofs_mod.MAX_PROOF_TTL_SECONDS + 1),
    )
    assert _safe_ttl_seconds() is None
    assert registry.issue(_proof_snapshot()) is None


def test_session_bound_partial_confirmation_executes_only_the_minted_candidate(a4_ifc, monkeypatch):
    import search.engine as engine_mod

    open_calls = []
    original_open = engine_mod.open_model

    def capture_open(path):
        open_calls.append(path)
        return original_open(path)

    monkeypatch.setattr(engine_mod, "open_model", capture_open)
    context = _trusted_partial_context()
    first = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            query="IfcDoor within 3m of exit",
            interpret_mode="deterministic",
            model_version_id="a4_fixture_v1",
            trusted_a4_context=context,
        )
    )

    assert first["status"] == "partial_fallback_confirmation_required"
    assert first["partial_confirmation_available"] is True
    assert first["partial_fallback_id"].startswith("a4pf_")
    assert first["results"] == []
    assert first["stats"]["scanned"] == 0
    assert open_calls == []

    confirmed = confirm_partial_fallback(first["partial_fallback_id"], context)
    assert confirmed["status"] == "ok"
    assert confirmed["completion_scope"] == "partial_table_only"
    assert confirmed["partial_execution_confirmed"] is True
    assert confirmed["degraded_to_deterministic"] is True
    assert confirmed["interpreted_filters"]["raw_query"] == "IfcDoor within 3m of exit"
    assert confirmed["retry_of_query_id"] == first["query_id"]
    assert confirmed["proof_eligible"] is False
    assert confirmed["issue_eligible"] is False
    assert confirmed["highlight_eligible"] is False
    assert open_calls == [str(a4_ifc)]


def test_partial_confirmation_rejects_mismatched_or_replayed_binding_without_scan(a4_ifc, monkeypatch):
    import search.engine as engine_mod

    original_open = engine_mod.open_model
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not scan")))
    context = _trusted_partial_context()
    first = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            query="IfcDoor within 3m of exit",
            interpret_mode="deterministic",
            model_version_id="a4_fixture_v1",
            trusted_a4_context=context,
        )
    )
    assert first["status"] == "partial_fallback_confirmation_required"

    with pytest.raises(PartialFallbackUnavailable):
        confirm_partial_fallback(first["partial_fallback_id"], _trusted_partial_context(principal_ref="a4p_other"))
    # A mismatched principal must not consume the valid holder's opaque handle.
    monkeypatch.setattr(engine_mod, "open_model", original_open)
    confirmed = confirm_partial_fallback(first["partial_fallback_id"], context)
    assert confirmed["status"] == "ok"
    with pytest.raises(PartialFallbackUnavailable):
        confirm_partial_fallback(first["partial_fallback_id"], context)


def test_partial_confirmation_capacity_never_evicts_another_active_binding(a4_ifc, monkeypatch):
    import search.engine as engine_mod

    fallback_store = engine_mod._PartialFallbackStore(max_entries=1)
    monkeypatch.setattr(engine_mod, "_PARTIAL_FALLBACKS", fallback_store)
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not scan")))
    first = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            query="IfcDoor within 3m of exit",
            interpret_mode="deterministic",
            model_version_id="a4_fixture_v1",
            trusted_a4_context=_trusted_partial_context(),
        )
    )
    second = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            query="IfcDoor within 3m of exit",
            interpret_mode="deterministic",
            model_version_id="a4_fixture_v1",
            trusted_a4_context=_trusted_partial_context(principal_ref="a4p_other"),
        )
    )
    assert first["status"] == "partial_fallback_confirmation_required"
    assert second["status"] == "partial_fallback_unavailable"
    assert first["partial_fallback_id"] in fallback_store._entries


def test_search_resource_budgets_fail_closed_without_partial_rows(a4_ifc, monkeypatch):
    import search.engine as engine_mod

    monkeypatch.setattr(engine_mod, "MAX_A4_IFC_BYTES", 1)
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not open oversized IFC")))
    oversized = run_model_search(SearchRequest(ifc_source_path=str(a4_ifc), query="IfcDoor", interpret_mode="deterministic"))
    assert oversized["status"] == "search_resource_limit_exceeded"
    assert oversized["error_code"] == "ifc_source_too_large"
    assert oversized["results"] == []
    assert oversized["stats"]["scanned"] == 0
    assert oversized["proof_eligible"] is False

    monkeypatch.setattr(engine_mod, "MAX_A4_IFC_BYTES", 1024 * 1024)

    class Candidate:
        def __init__(self, identifier):
            self.identifier = identifier

        def id(self):
            return self.identifier

    class Model:
        def by_type(self, _ifc_class):
            return [Candidate(1), Candidate(2)]

    monkeypatch.setattr(engine_mod, "MAX_A4_SEARCH_CANDIDATES", 1)
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: Model())
    too_many = run_model_search(SearchRequest(ifc_source_path=str(a4_ifc), query="IfcDoor", interpret_mode="deterministic"))
    assert too_many["status"] == "search_resource_limit_exceeded"
    assert too_many["error_code"] == "candidate_budget_exhausted"
    assert too_many["results"] == []
    assert too_many["stats"]["scanned"] == 0


def test_search_wall_time_budget_stops_before_scanning(a4_ifc, monkeypatch):
    import search.engine as engine_mod

    class Model:
        def by_type(self, _ifc_class):
            return []

    ticks = iter((0.0, 2.0, 4.0, 6.0))
    monkeypatch.setattr(engine_mod, "MAX_A4_SEARCH_WALL_TIME_SECONDS", 1.0)
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: Model())
    monkeypatch.setattr(engine_mod.time, "monotonic", lambda: next(ticks))
    exhausted = run_model_search(SearchRequest(ifc_source_path=str(a4_ifc), query="IfcDoor", interpret_mode="deterministic"))
    assert exhausted["status"] == "search_resource_limit_exceeded"
    assert exhausted["error_code"] == "scan_time_budget_exhausted"
    assert exhausted["results"] == []
    assert exhausted["stats"]["scanned"] == 0


def test_complete_trusted_row_mints_a_path_free_proof(a4_ifc, monkeypatch):
    import search.engine as engine_mod

    mapping = A4_ELEMENT_MAPPING
    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "test-proof-signing-key-material-32bytes")
    registry = ProofRegistry()
    monkeypatch.setattr(engine_mod, "proof_registry", registry)
    body = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            element_mapping_path=str(mapping),
            query="找 4F 防火門且 FireRating < 60",
            interpret_mode="deterministic",
            model_version_id="a4_fixture_v1",
            trusted_a4_context=_trusted_partial_context(),
        )
    )

    assert body["status"] == "ok"
    assert body["completion_scope"] == "complete_table"
    assert body["proof_eligible"] is True
    assert body["issue_eligible"] is True
    row = body["results"][0]
    assert row["proof_eligible"] is True
    assert row["issue_eligible"] is True
    assert row["evidence_proof"].startswith("a4p.")
    verified = registry.verify(row["evidence_proof"])
    assert verified.snapshot["row"]["ifc_guid"] == row["ifc_guid"]
    assert verified.snapshot["row"]["accepted_usd_prim"] == "/World/Doors/Low"
    assert str(a4_ifc) not in str(verified.snapshot)
    assert str(mapping) not in str(verified.snapshot)


@pytest.mark.parametrize("invalid_ttl", ["NaN", "Infinity", "0", "-1", "901"])
def test_invalid_explicit_proof_ttl_keeps_search_table_only(
    a4_ifc,
    monkeypatch,
    invalid_ttl,
):
    import search.engine as engine_mod

    mapping = A4_ELEMENT_MAPPING
    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "test-proof-signing-key-material-32bytes")
    monkeypatch.setenv("A4_PROOF_TTL_SECONDS", invalid_ttl)
    monkeypatch.setattr(engine_mod, "proof_registry", ProofRegistry())

    body = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            element_mapping_path=str(mapping),
            query="找 4F 防火門且 FireRating < 60",
            interpret_mode="deterministic",
            model_version_id="a4_fixture_v1",
            trusted_a4_context=_trusted_partial_context(),
        )
    )

    assert body["status"] == "ok"
    assert body["results"]
    assert body["proof_eligible"] is False
    assert body["issue_eligible"] is False
    assert all(row["proof_eligible"] is False for row in body["results"])
    assert all(row["issue_eligible"] is False for row in body["results"])
    assert all("evidence_proof" not in row for row in body["results"])


def test_session_model_binding_mismatch_never_mints_a_proof(a4_ifc, monkeypatch):
    import search.engine as engine_mod

    monkeypatch.setenv("A4_PROOF_ACTIVE_KID", "a4_test_kid")
    monkeypatch.setenv("A4_PROOF_ACTIVE_KEY", "test-proof-signing-key-material-32bytes")
    monkeypatch.setattr(engine_mod, "proof_registry", ProofRegistry())
    context = _trusted_partial_context()
    context["model_version_id"] = "a4_other_model"
    body = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            query="IfcDoor",
            interpret_mode="deterministic",
            model_version_id="a4_fixture_v1",
            trusted_a4_context=context,
        )
    )
    assert body["status"] == "ok"
    assert body["proof_eligible"] is False
    assert body["issue_eligible"] is False
    assert all("evidence_proof" not in row for row in body["results"])


def test_search_model_fire_rating_filter(client, a4_ifc):
    res = client.post(
        "/api/search/model",
        json={
            "ifc_source_path": str(a4_ifc),
            "query": "找 4F 防火門且 FireRating < 60",
            "model_version_id": "a4_fixture_v1",
            "limit": 50,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "ok"
    assert body["interpreted_filters"]["interpretable"] is True
    guids = {r["ifc_guid"] for r in body["results"]}
    # Low rating door on 4F matches; high rating on 4F and 1F door do not.
    assert "0A4DoorLow000000000001" in guids
    assert "0A4DoorHigh00000000001" not in guids
    assert "0A4Door1F0000000000001" not in guids
    for row in body["results"]:
        assert row["match_status"] == "matched_query"
        assert row["ifc_class"] == "IfcDoor"
        assert "FireRating" in (row.get("properties") or {})
        assert row.get("evidence_refs")
    assert body["stats"]["scanned"] >= body["stats"]["matched"]
    assert body["stats"]["returned"] == len(body["results"])
    assert body["stats"]["not_matched"] >= 0


def test_committed_a4_fixture_covers_mapping_nonmatch_and_truncation(a4_ifc):
    complete = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            element_mapping_path=str(A4_ELEMENT_MAPPING),
            query="IfcDoor",
            interpret_mode="deterministic",
        )
    )
    assert complete["stats"] == {
        "total": 3,
        "scanned": 3,
        "matched": 3,
        "not_matched": 0,
        "returned": 3,
        "mapped": 1,
        "unmapped": 2,
        "truncated": False,
        "total_is_lower_bound": False,
        "scan_complete": True,
    }

    empty = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            element_mapping_path=str(A4_ELEMENT_MAPPING),
            query="找 4F 防火門且 FireRating > 100",
            interpret_mode="deterministic",
        )
    )
    assert empty["stats"]["matched"] == 0
    assert empty["stats"]["not_matched"] == 3
    assert empty["results"] == []

    limited = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            element_mapping_path=str(A4_ELEMENT_MAPPING),
            query="IfcDoor",
            limit=1,
            interpret_mode="deterministic",
        )
    )
    assert limited["stats"]["matched"] == 3
    assert limited["stats"]["returned"] == 1
    assert limited["stats"]["truncated"] is True


def test_session_table_scope_returns_only_sanitized_trusted_binding(a4_ifc):
    body = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            query="IfcDoor",
            interpret_mode="deterministic",
            model_version_id="a4_fixture_v1",
            trusted_a4_context={
                "scope": "session_table_only",
                "review_session_id": "review_session_deadbeef12",
                "principal_ref": "a4p_opaque",
                "primary_artifact_id": "artifact_a4",
                "active_binding_revision": None,
                "mapping_provenance": "unavailable",
                "primary_lease_capability": "lab_unverified",
            },
        )
    )
    assert body["status"] == "ok"
    assert body["search_scope"] == "session_table_only"
    assert body["session_binding"] == {
        "review_session_id": "review_session_deadbeef12",
        "principal_ref": "a4p_opaque",
        "model_version_id": "a4_fixture_v1",
        "primary_artifact_id": "artifact_a4",
        "active_binding_revision": None,
        "mapping_provenance": "unavailable",
        "primary_lease_capability": "lab_unverified",
    }
    assert str(a4_ifc) not in str(body)


def test_generic_model_route_rejects_forged_a4_trusted_context(client, a4_ifc):
    res = client.post(
        "/api/search/model",
        json={
            "ifc_source_path": str(a4_ifc),
            "query": "IfcDoor",
            "a4_trusted_context": {
                "scope": "session_table_only",
                "review_session_id": "forged-session",
                "principal_ref": "forged-principal",
            },
        },
    )
    assert res.status_code == 422
    assert "session_binding" not in res.text


def test_generic_model_route_bounds_untrusted_request_sizes(client, a4_ifc):
    oversized_query = client.post(
        "/api/search/model",
        json={"ifc_source_path": str(a4_ifc), "query": "x" * 4001},
    )
    assert oversized_query.status_code == 422

    oversized_path = client.post(
        "/api/search/model",
        json={"ifc_source_path": "C:/" + ("x" * 4094), "query": "IfcDoor"},
    )
    assert oversized_path.status_code == 422


def test_internal_model_route_requires_matching_context_token(client, a4_ifc, monkeypatch):
    payload = {
        "ifc_source_path": str(a4_ifc),
        "query": "IfcDoor",
        "model_version_id": "a4_fixture_v1",
        "a4_trusted_context": {
            "scope": "session_table_only",
            "review_session_id": "review_session_deadbeef12",
            "principal_ref": "a4p_opaque",
            "primary_artifact_id": "artifact_a4",
            "active_binding_revision": None,
            "model_version_id": "a4_fixture_v1",
            "mapping_provenance": "unavailable",
            "primary_lease_capability": "lab_unverified",
        },
    }

    monkeypatch.delenv("A4_INTERNAL_CONTEXT_TOKEN", raising=False)
    unavailable = client.post("/api/internal/a4/search/model", json=payload)
    assert unavailable.status_code == 503
    assert unavailable.json()["detail"]["code"] == "a4_internal_context_unavailable"

    monkeypatch.setenv("A4_INTERNAL_CONTEXT_TOKEN", "test-internal-context-token")
    unauthorized = client.post(
        "/api/internal/a4/search/model",
        headers={"X-A4-Internal-Token": "wrong-token"},
        json=payload,
    )
    assert unauthorized.status_code == 401
    assert unauthorized.json()["detail"]["code"] == "a4_internal_context_unauthorized"

    accepted = client.post(
        "/api/internal/a4/search/model",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=payload,
    )
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["search_scope"] == "session_table_only"
    assert body["session_binding"]["review_session_id"] == "review_session_deadbeef12"

    mismatched = {
        **payload,
        "a4_trusted_context": {**payload["a4_trusted_context"], "model_version_id": "a4_other_model"},
    }
    rejected = client.post(
        "/api/internal/a4/search/model",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json=mismatched,
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "a4_model_binding_mismatch"


def test_internal_partial_confirmation_requires_the_same_trusted_binding(client, a4_ifc, monkeypatch):
    monkeypatch.setenv("A4_INTERNAL_CONTEXT_TOKEN", "test-internal-context-token")
    context = {
        "scope": "session_table_only",
        "review_session_id": "review_session_deadbeef12",
        "principal_ref": "a4p_opaque",
        "primary_artifact_id": "artifact_a4",
        "active_binding_revision": "binding_a4_1",
        "model_version_id": "a4_fixture_v1",
        "auth_scope": "production",
        "mapping_provenance": "server_resolved",
        "primary_lease_capability": "verified",
    }
    first = client.post(
        "/api/internal/a4/search/model",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json={
            "ifc_source_path": str(a4_ifc),
            "query": "IfcDoor within 3m of exit",
            "model_version_id": "a4_fixture_v1",
            "interpret_mode": "deterministic",
            "a4_trusted_context": context,
        },
    )
    assert first.status_code == 200, first.text
    partial_fallback_id = first.json()["partial_fallback_id"]

    confirmed = client.post(
        "/api/internal/a4/search/model/confirm-partial",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json={"partial_fallback_id": partial_fallback_id, "a4_trusted_context": context},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["completion_scope"] == "partial_table_only"

    replay = client.post(
        "/api/internal/a4/search/model/confirm-partial",
        headers={"X-A4-Internal-Token": "test-internal-context-token"},
        json={"partial_fallback_id": partial_fallback_id, "a4_trusted_context": context},
    )
    assert replay.status_code == 409
    assert replay.json()["detail"]["code"] == "partial_fallback_unavailable"


def test_search_model_uninterpreted(client, a4_ifc):
    res = client.post(
        "/api/search/model",
        json={"ifc_source_path": str(a4_ifc), "query": "??? ###", "interpret_mode": "deterministic"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "uninterpreted"
    assert body["results"] == []
    assert body.get("next_step")


def test_unusable_candidate_never_opens_or_scans_ifc(a4_ifc, monkeypatch):
    import search.engine as engine_mod

    def fail_open(_path):
        raise AssertionError("scanner must not open IFC for an unusable candidate")

    monkeypatch.setattr(engine_mod, "open_model", fail_open)
    body = run_model_search(
        SearchRequest(ifc_source_path=str(a4_ifc), query="??? ###", interpret_mode="deterministic")
    )
    assert body["status"] == "uninterpreted"
    assert body["stats"]["scanned"] == 0
    assert body["results"] == []


def test_limit_keeps_honest_full_candidate_counts(client, a4_ifc):
    res = client.post(
        "/api/search/model",
        json={"ifc_source_path": str(a4_ifc), "query": "IfcDoor", "limit": 1},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "ok"
    assert len(body["results"]) == 1
    assert body["stats"]["scanned"] == 3
    assert body["stats"]["matched"] == 3
    assert body["stats"]["returned"] == 1
    assert body["stats"]["not_matched"] == 0
    assert body["stats"]["truncated"] is True
    assert body["highlight_eligible"] is False
    assert all(row["action_eligible"] is False for row in body["results"])
    assert all(row["highlight_eligible"] is False for row in body["results"])


def test_search_model_missing_path(client, a4_ifc):
    missing = a4_ifc.parent / "nope.ifc"
    res = client.post(
        "/api/search/model",
        json={"ifc_source_path": str(missing), "query": "IfcDoor"},
    )
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "ifc_source_not_found"
    assert str(missing) not in res.text


def test_search_tiny_door_if_present(client):
    if not TINY.is_file():
        pytest.skip("tiny.ifc not in worktree storage")
    res = client.post(
        "/api/search/model",
        json={"ifc_source_path": str(TINY), "query": "IfcDoor"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["stats"]["matched"] >= 1
