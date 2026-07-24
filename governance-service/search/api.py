"""A4 search REST — hung under governance-service; browser reaches via coordinator proxy."""
from __future__ import annotations

from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints

from .engine import PartialFallbackUnavailable, SearchRequest, confirm_partial_fallback, run_model_search
from .handoff import ProofAuthority, ProofRejected, verify_handoff_evidence
from .internal_auth import internal_context_token, internal_token_matches
from .llm_client import load_llm_config
from .proofs import ProofExpired, ProofUnavailable, proof_registry

router = APIRouter()

InterpretMode = Literal["deterministic", "semantic", "auto"]
TrustedA4Scope = Literal["session_table_only", "ifc_ready_table_only"]


class TrustedA4Context(BaseModel):
    """Coordinator-to-governance provenance; never accepted from browser routes."""

    scope: TrustedA4Scope
    review_session_id: Optional[str] = Field(default=None, max_length=160)
    principal_ref: Optional[str] = Field(default=None, max_length=160)
    primary_artifact_id: Optional[str] = Field(default=None, max_length=160)
    active_binding_revision: Optional[str] = Field(default=None, max_length=160)
    model_version_id: Optional[str] = Field(default=None, max_length=256)
    auth_scope: Optional[Literal["production", "lab"]] = None
    mapping_provenance: Optional[Literal["server_resolved", "unavailable"]] = None
    primary_lease_capability: Optional[Literal["verified", "lab_unverified"]] = None

    class Config:
        extra = "forbid"


class ModelSearchBody(BaseModel):
    ifc_source_path: str = Field(..., min_length=1, max_length=4096)
    query: str = Field(..., min_length=1, max_length=4000)
    model_version_id: Optional[str] = Field(default=None, max_length=256)
    element_mapping_path: Optional[str] = Field(default=None, max_length=4096)
    limit: int = Field(default=200, ge=1, le=1000)
    # deterministic = grammar only; semantic = Ornith LLM JSON filters; auto = det then LLM.
    interpret_mode: InterpretMode = "auto"
    # Opaque client correlation only. The search service validates the shape and
    # never treats it as authority or as a persistent query-history key.
    retry_of_query_id: Optional[str] = Field(default=None, max_length=80)
    class Config:
        # A browser/direct caller must not silently smuggle coordinator-only
        # authority.  In particular, a4_trusted_context is not accepted here.
        extra = "forbid"


class InternalModelSearchBody(ModelSearchBody):
    """Coordinator-only A4 request, authenticated independently of the browser."""

    a4_trusted_context: TrustedA4Context


class InternalPartialConfirmationBody(BaseModel):
    partial_fallback_id: str = Field(..., min_length=16, max_length=104, pattern=r"^a4pf_[A-Za-z0-9_-]{12,96}$")
    a4_trusted_context: TrustedA4Context

    class Config:
        extra = "forbid"


class A4HandoffBinding(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=160)
    principal: str = Field(..., min_length=1, max_length=160)
    model_version_id: str = Field(..., min_length=1, max_length=256)
    model_artifact: str = Field(..., min_length=1, max_length=160)
    active_binding_revision: str = Field(..., min_length=1, max_length=160)

    class Config:
        extra = "forbid"


A4ProofToken = Annotated[
    str,
    StringConstraints(
        min_length=87,
        max_length=230,
        pattern=r"^a4p\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{16,96}\.[0-9a-f]{64}$",
    ),
]


class InternalA4HandoffVerifyBody(BaseModel):
    action: Literal["focus", "highlight"]
    evidence_proofs: list[A4ProofToken] = Field(..., min_length=1, max_length=64)
    binding: A4HandoffBinding

    class Config:
        extra = "forbid"


class _ProofRegistryHandoffAuthority:
    """Map the shared proof registry onto #365's sanitized authority seam."""

    def verify(self, token: str, *, now: Optional[float] = None):
        try:
            return proof_registry.verify(token, now=now)
        except ProofExpired as exc:
            raise ProofRejected("proof_expired") from exc
        except ProofUnavailable as exc:
            raise ProofRejected("proof_invalid") from exc


_handoff_proof_authority: Optional[ProofAuthority] = _ProofRegistryHandoffAuthority()


def _require_matching_session_model_version(body: InternalModelSearchBody) -> None:
    """A session proof may never bind a different model than the scanned model."""
    context = body.a4_trusted_context
    if context.scope != "session_table_only":
        return
    if (
        not body.model_version_id
        or not context.model_version_id
        # Model identifiers are public binding values, not credentials.  Plain
        # equality preserves exact Unicode IDs; compare_digest(str, str) raises
        # TypeError for non-ASCII input.
        or body.model_version_id != context.model_version_id
    ):
        raise HTTPException(status_code=422, detail={"code": "a4_model_binding_mismatch"})


@router.get("/api/search/llm-status")
def search_llm_status() -> dict[str, Any]:
    """Public status for Edge Console (never returns API key)."""
    cfg = load_llm_config()
    return {
        "service": "a4-search-llm",
        **cfg.public_status(),
        "reference": "openai_compatible_structured_filter_transport",
        "config_source_keys": [
            "A4_LLM_ENABLED",
            "A4_LLM_MODEL",
            "A4_LLM_BASE_URL",
            "A4_LLM_API_KEY",
            "A4_LLM_TIMEOUT_S",
            "A4_LLM_PROFILE",
            "A4_LLM_TRANSPORT_MODE",
            "A4_LLM_ALLOW_INSECURE",
            "A4_LLM_HTTP_ALLOWLIST",
            "ORNITH_ENABLED",
            "ORNITH_MODEL",
            "ORNITH_API_BASE",
            "ORNITH_API_KEY",
            "ORNITH_TIMEOUT_S",
            "ORNITH_PROFILE",
            "ORNITH_TRANSPORT_MODE",
        ],
    }


def _run_search(body: ModelSearchBody, trusted_context: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    try:
        return run_model_search(
            SearchRequest(
                ifc_source_path=body.ifc_source_path,
                query=body.query,
                model_version_id=body.model_version_id,
                element_mapping_path=body.element_mapping_path,
                limit=body.limit,
                interpret_mode=body.interpret_mode,
                retry_of_query_id=body.retry_of_query_id,
                trusted_a4_context=trusted_context,
            )
        )
    except FileNotFoundError as exc:
        # Never echo a host path from a governance error payload.
        raise HTTPException(status_code=400, detail={"code": "ifc_source_not_found"}) from exc
    except Exception as exc:  # noqa: BLE001
        # The search engine is responsible for structured safe failures. This is a
        # last-resort boundary that must not serialize upstream exception text.
        raise HTTPException(status_code=500, detail={"code": "search_failed"}) from exc


@router.post("/api/search/model")
def search_model(body: ModelSearchBody) -> dict[str, Any]:
    return _run_search(body)


@router.post("/api/internal/a4/search/model")
def search_model_with_trusted_context(
    body: InternalModelSearchBody,
    internal_token: Optional[str] = Header(default=None, alias="X-A4-Internal-Token"),
) -> dict[str, Any]:
    """Accept coordinator provenance only over the configured internal channel."""
    configured_token = internal_context_token()
    if configured_token is None:
        raise HTTPException(status_code=503, detail={"code": "a4_internal_context_unavailable"})
    if not internal_token or not internal_token_matches(internal_token, configured_token):
        raise HTTPException(status_code=401, detail={"code": "a4_internal_context_unauthorized"})
    _require_matching_session_model_version(body)
    return _run_search(body, body.a4_trusted_context.model_dump(exclude_none=True))


@router.post("/api/internal/a4/search/model/confirm-partial")
def confirm_model_search_partial(
    body: InternalPartialConfirmationBody,
    internal_token: Optional[str] = Header(default=None, alias="X-A4-Internal-Token"),
) -> dict[str, Any]:
    """Run only the exact short-lived session-bound candidate after confirmation."""
    configured_token = internal_context_token()
    if configured_token is None:
        raise HTTPException(status_code=503, detail={"code": "a4_internal_context_unavailable"})
    if not internal_token or not internal_token_matches(internal_token, configured_token):
        raise HTTPException(status_code=401, detail={"code": "a4_internal_context_unauthorized"})
    try:
        return confirm_partial_fallback(
            body.partial_fallback_id,
            body.a4_trusted_context.model_dump(exclude_none=True),
        )
    except PartialFallbackUnavailable as exc:
        raise HTTPException(status_code=409, detail={"code": "partial_fallback_unavailable"}) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=409, detail={"code": "partial_fallback_unavailable"}) from exc


@router.post("/api/internal/a4/handoffs/verify")
def verify_a4_handoff(
    body: InternalA4HandoffVerifyBody,
    internal_token: Optional[str] = Header(default=None, alias="X-A4-Internal-Token"),
):
    """Verify an atomic proof set; never persist intent or return proof/query data."""
    configured_token = internal_context_token()
    if configured_token is None:
        raise HTTPException(status_code=503, detail={"code": "a4_internal_context_unavailable"})
    if not internal_token or not internal_token_matches(internal_token, configured_token):
        raise HTTPException(status_code=401, detail={"code": "a4_internal_context_unauthorized"})
    authority = _handoff_proof_authority
    if authority is None:
        raise HTTPException(status_code=503, detail={"code": "a4_handoff_authority_unavailable"})
    verified = verify_handoff_evidence(
        action=body.action,
        proof_tokens=body.evidence_proofs,
        binding=body.binding.model_dump(),
        authority=authority,
    )
    payload = verified.to_payload()
    if not verified.accepted:
        return JSONResponse(status_code=409, content=payload)
    return payload
