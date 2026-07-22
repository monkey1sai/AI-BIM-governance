"""A4 search REST — hung under governance-service; browser reaches via coordinator proxy."""
from __future__ import annotations

import os
import secrets
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints

from .engine import SearchRequest, run_model_search
from .handoff import ProofAuthority, verify_handoff_evidence
from .llm_client import load_llm_config

router = APIRouter()

InterpretMode = Literal["deterministic", "semantic", "auto"]


class ModelSearchBody(BaseModel):
    ifc_source_path: str = Field(..., min_length=1)
    query: str = Field(..., min_length=1)
    model_version_id: Optional[str] = None
    element_mapping_path: Optional[str] = None
    limit: int = Field(default=200, ge=1, le=1000)
    # deterministic = grammar only; semantic = Ornith LLM JSON filters; auto = det then LLM.
    interpret_mode: InterpretMode = "auto"


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


_handoff_proof_authority: Optional[ProofAuthority] = None


def _internal_context_token() -> Optional[str]:
    token = os.getenv("A4_INTERNAL_CONTEXT_TOKEN", "").strip()
    return token or None


def _internal_token_matches(candidate: str, configured: str) -> bool:
    """Compare the opaque token without letting non-ASCII config/input raise."""
    try:
        candidate_bytes = candidate.encode("ascii")
        configured_bytes = configured.encode("ascii")
    except UnicodeEncodeError:
        return False
    return secrets.compare_digest(candidate_bytes, configured_bytes)


@router.get("/api/search/llm-status")
def search_llm_status() -> dict[str, Any]:
    """Public status for Edge Console (never returns API key)."""
    cfg = load_llm_config()
    return {
        "service": "a4-search-llm",
        **cfg.public_status(),
        "reference": "Ornith vLLM OpenAI-compatible /v1/chat/completions",
        "env_keys": ["ORNITH_API_KEY or A4_LLM_API_KEY", "A4_LLM_BASE_URL", "A4_LLM_MODEL", "A4_LLM_ENABLED"],
    }


@router.post("/api/search/model")
def search_model(body: ModelSearchBody) -> dict[str, Any]:
    try:
        return run_model_search(
            SearchRequest(
                ifc_source_path=body.ifc_source_path,
                query=body.query,
                model_version_id=body.model_version_id,
                element_mapping_path=body.element_mapping_path,
                limit=body.limit,
                interpret_mode=body.interpret_mode,
            )
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"search_failed: {exc}") from exc


@router.post("/api/internal/a4/handoffs/verify")
def verify_a4_handoff(
    body: InternalA4HandoffVerifyBody,
    internal_token: Optional[str] = Header(default=None, alias="X-A4-Internal-Token"),
):
    """Verify an atomic proof set; never persist intent or return proof/query data."""
    configured_token = _internal_context_token()
    if configured_token is None:
        raise HTTPException(status_code=503, detail={"code": "a4_internal_context_unavailable"})
    if not internal_token or not _internal_token_matches(internal_token, configured_token):
        raise HTTPException(status_code=401, detail={"code": "a4_internal_context_unauthorized"})
    if _handoff_proof_authority is None:
        raise HTTPException(status_code=503, detail={"code": "a4_handoff_authority_unavailable"})
    verified = verify_handoff_evidence(
        action=body.action,
        proof_tokens=body.evidence_proofs,
        binding=body.binding.model_dump(),
        authority=_handoff_proof_authority,
    )
    payload = verified.to_payload()
    if not verified.accepted:
        return JSONResponse(status_code=409, content=payload)
    return payload
