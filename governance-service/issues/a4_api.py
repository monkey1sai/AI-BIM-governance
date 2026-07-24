"""Coordinator-only A4 confirmed-row Issue creation boundary."""
from __future__ import annotations

import hashlib
import hmac
import re
import unicodedata
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from search.proofs import (
    ProofExpired,
    ProofUnavailable,
    canonical_json,
    canonicalize_proof_snapshot,
    parse_proof_token,
    proof_digest as digest_proof,
    proof_registry,
)
from search.internal_auth import internal_context_token, internal_token_matches

from .api import _get_store
from .store import A4IssueReplayConflict, A4IssueUnauthorized

router = APIRouter()

_HEX_64_RE = re.compile(r"^[0-9a-f]{64}$")
_PROOF_TOKEN_PATTERN = r"^a4p\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{16,96}\.[0-9a-f]{64}$"


class TrustedA4IssueContext(BaseModel):
    """Current coordinator authority; browsers cannot establish this object."""

    model_config = ConfigDict(extra="forbid")

    scope: Literal["session_table_only"]
    review_session_id: str = Field(..., min_length=1, max_length=160)
    principal_ref: str = Field(..., min_length=1, max_length=160)
    primary_artifact_id: str = Field(..., min_length=1, max_length=160)
    active_binding_revision: str = Field(..., min_length=1, max_length=160)
    model_version_id: str = Field(..., min_length=1, max_length=256)
    auth_scope: Literal["production"]
    mapping_provenance: Literal["server_resolved"]
    primary_lease_capability: Literal["verified"]


class InternalA4IssueCreateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = Field(default=None, max_length=4_000)
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    assignee: Optional[str] = Field(default=None, max_length=256)
    ifc_guid: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_$-]+$")
    usd_prim_path: Optional[str] = Field(default=None, max_length=2_048)
    evidence_proof: str = Field(..., min_length=87, max_length=230, pattern=_PROOF_TOKEN_PATTERN)
    a4_evidence_snapshot: dict[str, Any]
    a4_trusted_context: TrustedA4IssueContext


def _error(status_code: int, code: str, **details: Any) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, **details})


def _normalize_required_text(value: str, *, code: str) -> str:
    normalized = unicodedata.normalize("NFC", value).strip()
    if not normalized:
        raise _error(422, code)
    return normalized


def _normalize_optional_text(value: Optional[str], *, strip: bool = False) -> Optional[str]:
    if value is None:
        return None
    normalized = unicodedata.normalize("NFC", value)
    if strip:
        normalized = normalized.strip()
        return normalized or None
    return normalized


def _require_snapshot_structure(snapshot: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    filters = snapshot.get("normalized_filters")
    interpretation = snapshot.get("interpretation")
    row = snapshot.get("row")
    if (
        not isinstance(snapshot.get("query"), str)
        or not snapshot["query"].strip()
        or not isinstance(filters, dict)
        or not isinstance(interpretation, dict)
        or not isinstance(interpretation.get("source"), str)
        or interpretation.get("complete") is not True
        or interpretation.get("completion_scope") != "complete_table"
        or interpretation.get("partial_execution") is not False
        or interpretation.get("scan_complete") is not True
        or interpretation.get("truncated") is not False
        or not isinstance(interpretation.get("degraded_to_deterministic"), bool)
        or not isinstance(interpretation.get("unresolved_terms"), list)
        or not all(isinstance(item, str) for item in interpretation["unresolved_terms"])
        or not isinstance(row, dict)
        or not isinstance(row.get("ifc_guid"), str)
        or not row["ifc_guid"]
        or not isinstance(row.get("ifc_class"), str)
        or not row["ifc_class"]
        or not isinstance(row.get("matched_properties"), dict)
        or not isinstance(row.get("predicate_trace"), list)
        or not all(isinstance(item, str) for item in row["predicate_trace"])
        or not isinstance(row.get("mapping_observed"), bool)
        or not isinstance(snapshot.get("mapping_digest"), str)
        or not _HEX_64_RE.fullmatch(snapshot["mapping_digest"])
    ):
        raise _error(422, "a4_evidence_snapshot_invalid")
    return row, interpretation


def _require_current_binding(
    snapshot: dict[str, Any],
    context: TrustedA4IssueContext,
) -> dict[str, Any]:
    binding = snapshot.get("session_binding")
    if not isinstance(binding, dict):
        raise _error(422, "a4_evidence_snapshot_invalid")
    expected = {
        "review_session_id": context.review_session_id,
        "principal_ref": context.principal_ref,
        "primary_artifact_id": context.primary_artifact_id,
        "active_binding_revision": context.active_binding_revision,
        "model_version_id": context.model_version_id,
        "mapping_provenance": "server_resolved",
        "primary_lease_capability": "verified",
        "auth_scope": "production",
        "session_id": context.review_session_id,
        "principal": context.principal_ref,
        "model_artifact": context.primary_artifact_id,
    }
    if snapshot.get("model_version_id") != context.model_version_id or any(
        binding.get(name) != value for name, value in expected.items()
    ):
        raise _error(403, "a4_issue_unauthorized")
    return binding


def _canonical_issue_snapshot(
    body: InternalA4IssueCreateBody,
) -> dict[str, Any]:
    snapshot = canonicalize_proof_snapshot(body.a4_evidence_snapshot)
    if snapshot is None:
        raise _error(422, "a4_evidence_snapshot_invalid")
    row, _interpretation = _require_snapshot_structure(snapshot)
    _require_current_binding(snapshot, body.a4_trusted_context)

    accepted_prim = row.get("accepted_usd_prim")
    row_prim = row.get("usd_prim_path")
    if row["ifc_guid"] != body.ifc_guid:
        raise _error(422, "a4_issue_row_mismatch")
    if row["mapping_observed"]:
        if (
            not isinstance(accepted_prim, str)
            or not accepted_prim
            or row_prim != accepted_prim
            or body.usd_prim_path != accepted_prim
        ):
            raise _error(422, "a4_issue_mapping_mismatch")
    elif accepted_prim is not None or row_prim is not None or body.usd_prim_path is not None:
        raise _error(422, "a4_issue_mapping_mismatch")
    return snapshot


def _creation_fields(body: InternalA4IssueCreateBody) -> dict[str, Any]:
    return {
        "title": _normalize_required_text(body.title, code="a4_issue_title_invalid"),
        "description": _normalize_optional_text(body.description),
        "severity": body.severity,
        "assignee": _normalize_optional_text(body.assignee, strip=True),
        "ifc_guid": unicodedata.normalize("NFC", body.ifc_guid),
        "usd_prim_path": _normalize_optional_text(body.usd_prim_path),
    }


@router.post("/api/internal/a4/issues/from-search")
def create_issue_from_a4_search(
    body: InternalA4IssueCreateBody,
    response: Response,
    internal_token: Optional[str] = Header(default=None, alias="X-A4-Internal-Token"),
) -> dict[str, Any]:
    """Consume one signed A4 row after coordinator reauthorization."""
    configured_token = internal_context_token()
    if configured_token is None:
        raise _error(503, "a4_internal_context_unavailable")
    if not internal_token or not internal_token_matches(internal_token, configured_token):
        raise _error(401, "a4_internal_context_unauthorized")

    snapshot = _canonical_issue_snapshot(body)
    fields = _creation_fields(body)
    reference = parse_proof_token(body.evidence_proof)
    if reference is None:
        raise _error(422, "a4_proof_invalid")

    snapshot_bytes = canonical_json(snapshot)
    snapshot_hash = hashlib.sha256(snapshot_bytes).hexdigest()
    proof_hash = digest_proof(body.evidence_proof)
    context = body.a4_trusted_context
    creation_request_hash = hashlib.sha256(
        canonical_json(
            {
                **fields,
                "model_version_id": context.model_version_id,
                "primary_artifact_id": context.primary_artifact_id,
                "active_binding_revision": context.active_binding_revision,
                "snapshot_hash": snapshot_hash,
                "proof_digest": proof_hash,
            }
        )
    ).hexdigest()

    replay_args = {
        "proof_id": reference.proof_id,
        "review_session_id": context.review_session_id,
        "principal_ref": context.principal_ref,
        "snapshot_hash": snapshot_hash,
        "proof_digest": proof_hash,
        "creation_request_hash": creation_request_hash,
    }
    store = _get_store()
    try:
        existing = store.find_a4_issue_replay(**replay_args)
    except A4IssueUnauthorized as exc:
        raise _error(403, "a4_issue_unauthorized") from exc
    except A4IssueReplayConflict as exc:
        raise _error(409, "a4_issue_replay_conflict") from exc
    if existing is not None:
        response.status_code = 200
        return {"issue": existing, "replayed": True}

    try:
        verified = proof_registry.verify(body.evidence_proof, snapshot=snapshot)
    except ProofExpired as exc:
        raise _error(
            409,
            "a4_proof_expired",
            retryable=True,
            recovery="rerun_query",
            draft_preserved=True,
        ) from exc
    except ProofUnavailable as exc:
        raise _error(409, "a4_proof_invalid") from exc

    snapshot_matches = hmac.compare_digest(verified.snapshot_hash, snapshot_hash)
    proof_matches = hmac.compare_digest(verified.proof_digest, proof_hash)
    bytes_match = hmac.compare_digest(canonical_json(verified.snapshot), snapshot_bytes)
    if (
        verified.proof_id != reference.proof_id
        or not snapshot_matches
        or not proof_matches
        or not bytes_match
    ):
        raise _error(409, "a4_proof_invalid")

    try:
        issue, replayed = store.create_a4_issue(
            **fields,
            model_version_id=context.model_version_id,
            primary_artifact_id=context.primary_artifact_id,
            active_binding_revision=context.active_binding_revision,
            query_id=snapshot["query_id"],
            schema_version=snapshot["schema_version"],
            evidence_snapshot_json=snapshot_bytes.decode("utf-8"),
            **replay_args,
        )
    except A4IssueUnauthorized as exc:
        raise _error(403, "a4_issue_unauthorized") from exc
    except A4IssueReplayConflict as exc:
        raise _error(409, "a4_issue_replay_conflict") from exc

    response.status_code = 200 if replayed else 201
    return {"issue": issue, "replayed": replayed}
