"""Execute validated A4 filters against an IFC model with safe evidence traces."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import ifcopenshell.util.element as ifc_el

from rule_engine import is_fake_mapping, load_element_mapping, open_model
from .interpreter import InterpretedFilters, PropertyFilter, filters_from_structured_dict, interpret_query
from .llm_client import CompletionResult, LlmError, _safe_model_name, chat_completion, extract_json_object, load_llm_config
from .proofs import canonical_json, proof_registry


# These limits protect the synchronous IFC scanner without changing the public
# result-page limit.  They are intentionally process constants so tests can
# exercise every boundary deterministically; a future operator configuration
# must preserve these as hard maximums rather than make them unbounded.
MAX_A4_IFC_BYTES = 128 * 1024 * 1024
MAX_A4_MAPPING_BYTES = 32 * 1024 * 1024
MAX_A4_SEARCH_CANDIDATES = 50_000
MAX_A4_SEARCH_WALL_TIME_SECONDS = 10.0
PARTIAL_FALLBACK_TTL_SECONDS = 300.0
PARTIAL_FALLBACK_MAX_ENTRIES = 256


@dataclass
class SearchRequest:
    ifc_source_path: str
    query: str
    model_version_id: Optional[str] = None
    element_mapping_path: Optional[str] = None
    limit: int = 200
    # deterministic | semantic (LLM) | auto (deterministic first, then one LLM attempt)
    interpret_mode: str = "auto"
    retry_of_query_id: Optional[str] = None
    # Coordinator-only provenance.  It may affect the safe response envelope,
    # never the user query/filter semantics or action authority in this worker.
    trusted_a4_context: Optional[dict[str, Any]] = None


@dataclass
class _FilterResolution:
    filters: InterpretedFilters
    evidence: list[dict[str, Any]] = field(default_factory=list)
    semantic_error_code: Optional[str] = None
    semantic_retryable: bool = False
    partial_candidate: bool = False


class PartialFallbackUnavailable(ValueError):
    """An opaque partial-confirmation handle is expired, consumed, or mismatched."""


@dataclass
class _PartialFallbackRecord:
    request: SearchRequest
    filters: InterpretedFilters
    evidence_refs: list[dict[str, Any]]
    query_id: str
    query_digest: str
    binding: dict[str, str]
    binding_digest: str
    expires_at: float


class _PartialFallbackStore:
    """Bounded process-local state for an explicitly confirmed partial scan.

    This is deliberately not query history: records are opaque, short-lived,
    single-use, and never persisted to a database or emitted in traces.
    """

    def __init__(self, *, ttl_seconds: float = PARTIAL_FALLBACK_TTL_SECONDS, max_entries: int = PARTIAL_FALLBACK_MAX_ENTRIES):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._entries: dict[str, _PartialFallbackRecord] = {}
        self._lock = threading.Lock()

    def _purge_expired(self, now: float) -> None:
        for identifier, record in list(self._entries.items()):
            if record.expires_at <= now:
                self._entries.pop(identifier, None)

    def mint(
        self,
        *,
        request: SearchRequest,
        filters: InterpretedFilters,
        evidence_refs: list[dict[str, Any]],
        query_id: str,
        binding: dict[str, str],
    ) -> tuple[str, str]:
        now = time.time()
        expires_at = now + self.ttl_seconds
        identifier = f"a4pf_{secrets.token_urlsafe(18)}"
        record = _PartialFallbackRecord(
            request=copy.deepcopy(request),
            filters=copy.deepcopy(filters),
            evidence_refs=copy.deepcopy(evidence_refs),
            query_id=query_id,
            query_digest=hashlib.sha256(request.query.encode("utf-8")).hexdigest(),
            binding=dict(binding),
            binding_digest=hashlib.sha256(
                json.dumps(binding, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest(),
            expires_at=expires_at,
        )
        with self._lock:
            self._purge_expired(now)
            # Capacity pressure must not evict another active session's opaque
            # confirmation.  Return a safe unavailable result to this request
            # instead of creating a cross-session cancellation primitive.
            if len(self._entries) >= self.max_entries:
                raise PartialFallbackUnavailable("partial fallback unavailable")
            self._entries[identifier] = record
        expires_at_iso = datetime.fromtimestamp(expires_at, timezone.utc).isoformat().replace("+00:00", "Z")
        return identifier, expires_at_iso

    def consume(self, identifier: str, binding: dict[str, str]) -> _PartialFallbackRecord:
        if not isinstance(identifier, str) or not re.fullmatch(r"a4pf_[A-Za-z0-9_-]{12,96}", identifier):
            raise PartialFallbackUnavailable("partial fallback unavailable")
        now = time.time()
        binding_digest = hashlib.sha256(
            json.dumps(binding, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        with self._lock:
            self._purge_expired(now)
            record = self._entries.get(identifier)
            if (
                record is None
                or record.expires_at <= now
                or not secrets.compare_digest(
                    record.query_digest,
                    hashlib.sha256(record.request.query.encode("utf-8")).hexdigest(),
                )
                or not secrets.compare_digest(record.binding_digest, binding_digest)
            ):
                raise PartialFallbackUnavailable("partial fallback unavailable")
            # A mismatched principal/binding must not be able to consume the
            # holder's opaque confirmation.  Remove it only after every bound
            # value has matched, preserving the single-use guarantee.
            self._entries.pop(identifier, None)
        return record


_PARTIAL_FALLBACKS = _PartialFallbackStore()


def _new_query_id() -> str:
    return f"a4q_{secrets.token_urlsafe(18)}"


def _safe_retry_id(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if re.fullmatch(r"a4q_[A-Za-z0-9_-]{12,64}", candidate):
        return candidate
    return None


def _storey_name(element: Any) -> Optional[str]:
    try:
        container = ifc_el.get_container(element)
    except Exception:  # noqa: BLE001
        container = None
    while container is not None:
        try:
            if container.is_a("IfcBuildingStorey"):
                return getattr(container, "Name", None) or getattr(container, "LongName", None)
        except Exception:  # noqa: BLE001
            return None
        try:
            container = ifc_el.get_aggregate(container)
        except Exception:  # noqa: BLE001
            return None
    return None


def _psets_flat(element: Any) -> dict[str, Any]:
    raw = ifc_el.get_psets(element) or {}
    flattened: dict[str, Any] = {}
    for bucket in raw.values():
        if not isinstance(bucket, dict):
            continue
        for key, value in bucket.items():
            if key != "id":
                flattened[key] = value
    return flattened


def _numeric(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).strip())
    if not match:
        return None
    try:
        numeric = float(match.group(0))
    except ValueError:
        return None
    return numeric if math.isfinite(numeric) else None


def _prop_match(properties: dict[str, Any], predicate: PropertyFilter) -> tuple[bool, Any, str]:
    if predicate.name not in properties:
        return False, None, f"property_missing:{predicate.name}"
    actual = properties[predicate.name]
    numeric = _numeric(actual)
    if numeric is None:
        return False, actual, f"property_not_numeric:{predicate.name}"
    matches = {
        "<": numeric < predicate.value,
        "<=": numeric <= predicate.value,
        ">": numeric > predicate.value,
        ">=": numeric >= predicate.value,
        "==": numeric == predicate.value,
    }.get(predicate.op, False)
    return matches, actual, f"{predicate.name}{predicate.op}{predicate.value} actual={actual}"


def _storey_match(storey: Optional[str], tokens: list[str]) -> bool:
    if not tokens:
        return True
    if not storey:
        return False
    normalized = storey.strip().lower()
    for token in tokens:
        candidate = token.strip().lower()
        if not candidate:
            continue
        if candidate == normalized:
            return True
        numeric_token = re.fullmatch(r"0*(\d+)(?:f)?", candidate)
        if numeric_token:
            number = str(int(numeric_token.group(1)))
            # Treat numeric floor aliases as a whole floor designation.  A
            # substring check would make 1F silently match 10F/11F.
            direct_floor = rf"(?<![a-z0-9])0*{re.escape(number)}\s*(?:f|樓)(?![a-z0-9])"
            named_floor = rf"(?:floor|level|l)\s*0*{re.escape(number)}(?!\d)"
            standalone_floor = rf"(?<![a-z0-9])0*{re.escape(number)}(?![a-z0-9])"
            if re.search(direct_floor, normalized) or re.search(named_floor, normalized) or re.search(standalone_floor, normalized):
                return True
            continue
        if re.search(rf"(?<![a-z0-9]){re.escape(candidate)}(?![a-z0-9])", normalized):
            return True
    return False


def _semantic_failure_filters(query: str, code: str) -> InterpretedFilters:
    filters = InterpretedFilters(raw_query=query, interpret_source="llm")
    filters.schema_valid = False
    filters.validation_errors.append(code)
    filters.notes.append("semantic_interpretation_failed")
    filters.refresh_validation()
    return filters


def _completion_text_and_metadata(completion: Any) -> tuple[str, Optional[dict[str, Any]]]:
    """Accept the typed production result; retain string support only for test fakes."""
    if isinstance(completion, CompletionResult):
        return completion.content, {
            "served_model": _safe_model_name(completion.served_model),
            "finish_reason": completion.finish_reason,
            "latency_ms": completion.latency_ms,
        }
    if isinstance(completion, str):
        # Test doubles from pre-v2 callers remain deterministic but are never a
        # production transport path (chat_completion itself always returns CompletionResult).
        return completion, {"served_model": None, "finish_reason": "mock", "latency_ms": None}
    raise LlmError("llm_bad_completion", "LLM completion result has an invalid shape")


def _resolve_filters(request: SearchRequest) -> _FilterResolution:
    mode = (request.interpret_mode or "auto").strip().lower()
    if mode not in {"deterministic", "semantic", "auto"}:
        mode = "auto"

    deterministic = interpret_query(request.query)
    if mode == "deterministic":
        return _FilterResolution(
            filters=deterministic,
            evidence=[{"kind": "interpreter", "version": "deterministic_filter_v2", "mode": mode}],
            partial_candidate=deterministic.usable and not deterministic.complete,
        )
    if mode == "auto" and deterministic.complete and deterministic.usable:
        return _FilterResolution(
            filters=deterministic,
            evidence=[{"kind": "interpreter", "version": "deterministic_filter_v2", "mode": mode}],
        )

    config = load_llm_config()
    evidence: list[dict[str, Any]] = [
        {
            "kind": "llm",
            "provider": "ornith_vllm_openai_compat",
            "configured_model": config.model if config.enabled else None,
            "transport_class": config.transport_class,
            "mode": mode,
        }
    ]
    try:
        completion = chat_completion(
            user_content=f"使用者問句：{request.query}\n請輸出 JSON 過濾條件。",
            config=config,
        )
        raw_text, metadata = _completion_text_and_metadata(completion)
        structured = extract_json_object(raw_text)
        semantic = filters_from_structured_dict(request.query, structured, source="llm")
        evidence.append(
            {
                "kind": "llm_result",
                "schema_valid": semantic.schema_valid,
                "complete": semantic.complete,
                "usable": semantic.usable,
                **(metadata or {}),
            }
        )
        if semantic.complete:
            return _FilterResolution(filters=semantic, evidence=evidence)
        if mode == "semantic":
            return _FilterResolution(
                filters=semantic,
                evidence=evidence,
                semantic_error_code="semantic_candidate_incomplete" if semantic.schema_valid else "semantic_candidate_invalid",
                semantic_retryable=True,
            )
        if deterministic.usable:
            evidence.append(
                {
                    "kind": "interpreter",
                    "version": "deterministic_filter_v2",
                    "fallback": "after_incomplete_llm",
                }
            )
            return _FilterResolution(filters=deterministic, evidence=evidence, partial_candidate=True)
        return _FilterResolution(
            filters=semantic,
            evidence=evidence,
            semantic_error_code="semantic_candidate_incomplete" if semantic.schema_valid else "semantic_candidate_invalid",
            semantic_retryable=True,
        )
    except LlmError as exc:
        evidence.append({"kind": "llm_error", "code": exc.code})
        if mode == "auto" and deterministic.usable:
            evidence.append(
                {
                    "kind": "interpreter",
                    "version": "deterministic_filter_v2",
                    "fallback": "after_llm_error",
                }
            )
            return _FilterResolution(filters=deterministic, evidence=evidence, partial_candidate=True)
        return _FilterResolution(
            filters=_semantic_failure_filters(request.query, exc.code),
            evidence=evidence,
            semantic_error_code=exc.code,
            semantic_retryable=True,
        )


def _model_invocation(evidence_refs: list[dict[str, Any]]) -> dict[str, Any]:
    """Project safe LLM invocation metadata without any raw completion text."""
    result = next((item for item in evidence_refs if item.get("kind") == "llm_result"), None)
    if result is not None:
        return {
            "attempted": True,
            "served_model": result.get("served_model"),
            "finish_reason": result.get("finish_reason"),
            "latency_ms": result.get("latency_ms"),
            "error_code": None,
        }
    error = next((item for item in evidence_refs if item.get("kind") == "llm_error"), None)
    if error is not None:
        return {
            "attempted": True,
            "served_model": None,
            "finish_reason": None,
            "latency_ms": None,
            "error_code": error.get("code"),
        }
    return {
        "attempted": False,
        "served_model": None,
        "finish_reason": None,
        "latency_ms": None,
        "error_code": None,
    }


def _session_binding(request: SearchRequest) -> Optional[dict[str, Any]]:
    """Expose only an opaque, coordinator-owned table-search binding."""
    context = request.trusted_a4_context if isinstance(request.trusted_a4_context, dict) else {}
    if context.get("scope") != "session_table_only":
        return None
    return {
        "review_session_id": context.get("review_session_id"),
        "principal_ref": context.get("principal_ref"),
        "model_version_id": request.model_version_id,
        "primary_artifact_id": context.get("primary_artifact_id"),
        "active_binding_revision": context.get("active_binding_revision"),
        "mapping_provenance": context.get("mapping_provenance"),
        "primary_lease_capability": context.get("primary_lease_capability"),
    }


def _partial_binding_from_context(
    trusted_context: Optional[dict[str, Any]], model_version_id: Optional[str]
) -> Optional[dict[str, str]]:
    """Return the exact non-browser binding required to replay a partial scan."""
    context = trusted_context if isinstance(trusted_context, dict) else {}
    if context.get("scope") != "session_table_only" or not isinstance(model_version_id, str) or not model_version_id:
        return None
    fields = {
        "review_session_id": context.get("review_session_id"),
        "principal_ref": context.get("principal_ref"),
        "primary_artifact_id": context.get("primary_artifact_id"),
        "active_binding_revision": context.get("active_binding_revision"),
        "model_version_id": model_version_id,
    }
    if any(not isinstance(value, str) or not value for value in fields.values()):
        return None
    return fields


def _partial_binding(request: SearchRequest) -> Optional[dict[str, str]]:
    return _partial_binding_from_context(request.trusted_a4_context, request.model_version_id)


def _proof_binding(request: SearchRequest) -> Optional[dict[str, str]]:
    """Return the stricter current authority tuple required for row proofs."""
    binding = _partial_binding(request)
    context = request.trusted_a4_context if isinstance(request.trusted_a4_context, dict) else {}
    if (
        binding is None
        or context.get("model_version_id") != request.model_version_id
        or context.get("mapping_provenance") != "server_resolved"
        or context.get("primary_lease_capability") != "verified"
        or context.get("auth_scope") != "production"
    ):
        return None
    return {
        **binding,
        "mapping_provenance": "server_resolved",
        "primary_lease_capability": "verified",
        "auth_scope": "production",
    }


def _proof_scalar(value: Any) -> Any:
    """Keep a proof snapshot to primitive, bounded row evidence only."""
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return value if len(value) <= 512 else None
    return None


def _issue_row_proof(
    request: SearchRequest,
    filters: InterpretedFilters,
    base_response: dict[str, Any],
    row: dict[str, Any],
) -> Optional[dict[str, str]]:
    """Mint a small immutable proof only for a complete trusted result row."""
    binding = _proof_binding(request)
    guid = row.get("ifc_guid")
    if binding is None or not isinstance(guid, str) or not guid:
        return None
    accepted_prim = row.get("usd_prim_path")
    if not isinstance(accepted_prim, str):
        accepted_prim = None
    matched_properties = {
        name: _proof_scalar(value)
        for name, value in (row.get("properties") or {}).items()
        if isinstance(name, str) and len(name) <= 160
    }
    predicate_trace = [
        trace
        for trace in (row.get("evidence_refs") or [])[:64]
        if isinstance(trace, str) and len(trace) <= 512
    ]
    mapping_digest = hashlib.sha256(
        canonical_json(
            {
                "ifc_guid": guid,
                "accepted_usd_prim": accepted_prim,
                "mapping_observed": bool(row.get("mapping_observed")),
            }
        )
    ).hexdigest()
    snapshot = {
        "schema_version": "a4-proof-v1",
        "query_id": base_response["query_id"],
        "query": request.query,
        "normalized_filters": filters.to_dict(),
        "interpretation": {
            "mode": request.interpret_mode,
            "source": filters.interpret_source,
            "complete": True,
            "completion_scope": "complete_table",
            "partial_execution": False,
            "scan_complete": True,
            "truncated": False,
            "degraded_to_deterministic": False,
            "unresolved_terms": list(filters.unresolved_terms[:64]),
        },
        "row": {
            "ifc_guid": guid,
            "ifc_class": _proof_scalar(row.get("ifc_class")),
            "name": _proof_scalar(row.get("name")),
            "storey": _proof_scalar(row.get("storey")),
            "matched_properties": matched_properties,
            "predicate_trace": predicate_trace,
            "accepted_usd_prim": accepted_prim,
            "mapping_observed": bool(row.get("mapping_observed")),
        },
        "model_version_id": request.model_version_id,
        "session_binding": binding,
        "mapping_digest": mapping_digest,
    }
    return proof_registry.issue(snapshot)


def _base_response(
    request: SearchRequest,
    filters: InterpretedFilters,
    evidence_refs: list[dict[str, Any]],
    *,
    query_id: Optional[str] = None,
) -> dict[str, Any]:
    query_id = query_id or _new_query_id()
    trusted_context = request.trusted_a4_context if isinstance(request.trusted_a4_context, dict) else {}
    return {
        "query_id": query_id,
        "retry_of_query_id": _safe_retry_id(request.retry_of_query_id),
        "model_version_id": request.model_version_id,
        "interpret_mode": request.interpret_mode,
        "interpreted_filters": filters.to_dict(),
        "results": [],
        "stats": {
            "total": 0,
            "scanned": 0,
            "matched": 0,
            "not_matched": 0,
            "returned": 0,
            "mapped": 0,
            "unmapped": 0,
            "truncated": False,
        },
        "evidence_refs": evidence_refs,
        "model_invocation": _model_invocation(evidence_refs),
        "session_binding": _session_binding(request),
        "search_scope": trusted_context.get("scope", "table_only"),
        "completion_scope": "not_executed",
        # A search worker lacks trusted session/lease/proof context.  Mapping may
        # be observed but it never becomes an action authority in this layer.
        "proof_eligible": False,
        "issue_eligible": False,
        "highlight_eligible": False,
    }


def _resource_limit_response(
    base_response: dict[str, Any],
    code: str,
    *,
    candidate_count_lower_bound: int = 0,
    scanned: int = 0,
    matched: int = 0,
) -> dict[str, Any]:
    """Return no rows when scanner resource accounting is incomplete."""
    return {
        **base_response,
        "status": "search_resource_limit_exceeded",
        "error_code": code,
        "retryable": True,
        "stats": {
            "total": candidate_count_lower_bound,
            "scanned": scanned,
            "matched": matched,
            "not_matched": max(scanned - matched, 0),
            "returned": 0,
            "mapped": 0,
            "unmapped": 0,
            "truncated": False,
            "total_is_lower_bound": True,
            "scan_complete": False,
        },
        "completion_scope": "resource_limited",
        "proof_eligible": False,
        "issue_eligible": False,
        "highlight_eligible": False,
        "next_step": "narrow_query_or_use_a_smaller_model",
    }


def _is_deadline_exceeded(started_at: float) -> bool:
    return time.monotonic() - started_at > MAX_A4_SEARCH_WALL_TIME_SECONDS


def _execute_search(
    request: SearchRequest,
    filters: InterpretedFilters,
    evidence_refs: list[dict[str, Any]],
    base_response: dict[str, Any],
    *,
    partial_execution: bool,
) -> dict[str, Any]:
    try:
        if os.path.getsize(request.ifc_source_path) > MAX_A4_IFC_BYTES:
            return _resource_limit_response(base_response, "ifc_source_too_large")
    except OSError:
        return _resource_limit_response(base_response, "ifc_source_metadata_unavailable")

    started_at = time.monotonic()
    mapping: dict[str, str] = {}
    if request.element_mapping_path:
        if os.path.exists(request.element_mapping_path):
            try:
                if os.path.getsize(request.element_mapping_path) > MAX_A4_MAPPING_BYTES:
                    return _resource_limit_response(base_response, "mapping_source_too_large")
            except OSError:
                return _resource_limit_response(base_response, "mapping_source_metadata_unavailable")
            mapping, mapping_metadata = load_element_mapping(request.element_mapping_path)
            if is_fake_mapping(mapping_metadata):
                mapping = {}
                evidence_refs.append({"kind": "mapping", "status": "rejected_fake"})
            else:
                evidence_refs.append({"kind": "mapping", "status": "joined", "basename": os.path.basename(request.element_mapping_path)})
        else:
            evidence_refs.append({"kind": "mapping", "status": "path_missing"})
    if _is_deadline_exceeded(started_at):
        return _resource_limit_response(base_response, "scan_time_budget_exhausted")

    model = open_model(request.ifc_source_path)
    if _is_deadline_exceeded(started_at):
        return _resource_limit_response(base_response, "scan_time_budget_exhausted")
    classes = filters.ifc_classes or [
        "IfcDoor",
        "IfcWindow",
        "IfcWall",
        "IfcColumn",
        "IfcBeam",
        "IfcSlab",
        "IfcSpace",
        "IfcBuildingElementProxy",
    ]
    candidates: list[Any] = []
    seen_ids: set[int] = set()
    for ifc_class in classes:
        try:
            for element in model.by_type(ifc_class):
                if _is_deadline_exceeded(started_at):
                    return _resource_limit_response(
                        base_response,
                        "scan_time_budget_exhausted",
                        candidate_count_lower_bound=len(candidates),
                    )
                try:
                    element_id = element.id()
                except Exception:  # noqa: BLE001
                    continue
                if element_id in seen_ids:
                    continue
                if len(candidates) >= MAX_A4_SEARCH_CANDIDATES:
                    return _resource_limit_response(
                        base_response,
                        "candidate_budget_exhausted",
                        candidate_count_lower_bound=len(candidates) + 1,
                    )
                seen_ids.add(element_id)
                candidates.append(element)
        except Exception:  # noqa: BLE001
            continue

    limit = max(1, min(int(request.limit or 200), 1000))
    results: list[dict[str, Any]] = []
    matched = 0
    mapped = 0
    unmapped = 0
    scanned = 0
    for element in candidates:
        if _is_deadline_exceeded(started_at):
            return _resource_limit_response(
                base_response,
                "scan_time_budget_exhausted",
                candidate_count_lower_bound=len(candidates),
                scanned=scanned,
                matched=matched,
            )
        scanned += 1
        guid = getattr(element, "GlobalId", None)
        name = getattr(element, "Name", None)
        ifc_class = element.is_a()
        storey = _storey_name(element)
        properties = _psets_flat(element)
        traces: list[str] = []
        matches = True

        if filters.ifc_classes and ifc_class not in filters.ifc_classes:
            matches = False
            traces.append(f"class_mismatch:{ifc_class}")
        if matches and filters.storey_tokens:
            if _storey_match(storey, filters.storey_tokens):
                traces.append(f"storey_match:{storey}")
            else:
                matches = False
                traces.append(f"storey_mismatch:{storey}")
        if matches and filters.name_contains:
            normalized_name = (name or "").lower()
            for fragment in filters.name_contains:
                if fragment.lower() in normalized_name:
                    traces.append(f"name_contains:{fragment}")
                else:
                    matches = False
                    traces.append(f"name_miss:{fragment}")
                    break
        if matches and filters.property_filters:
            for predicate in filters.property_filters:
                predicate_matches, _actual, note = _prop_match(properties, predicate)
                traces.append(note)
                if not predicate_matches:
                    matches = False
                    break
        if not matches:
            continue

        matched += 1
        prim_path = mapping.get(guid) if guid else None
        if len(results) < limit:
            if prim_path:
                mapped += 1
            else:
                unmapped += 1
            results.append(
                {
                    "ifc_guid": guid,
                    "usd_prim_path": prim_path,
                    "mapping_observed": bool(prim_path),
                    "ifc_class": ifc_class,
                    "name": name,
                    "storey": storey,
                    "properties": {predicate.name: properties.get(predicate.name) for predicate in filters.property_filters}
                    if filters.property_filters
                    else {},
                    # This is a query-predicate result, never a compliance
                    # verdict.  Keep the wire value explicit for every UI.
                    "match_status": "matched_query",
                    "confidence": filters.confidence if filters.confidence is not None else 1.0,
                    "confidence_basis": filters.confidence_basis or "deterministic_grammar",
                    "evidence_refs": traces,
                    "action_eligible": False,
                    "proof_eligible": False,
                    "issue_eligible": False,
                    "highlight_eligible": False,
                }
            )

    truncated = matched > len(results)
    proof_count = 0
    if not partial_execution and not truncated:
        for row in results:
            proof = _issue_row_proof(request, filters, base_response, row)
            if proof is None:
                continue
            row["evidence_proof"] = proof["evidence_proof"]
            row["proof_expires_at"] = proof["expires_at"]
            row["proof_eligible"] = True
            row["issue_eligible"] = True
            row["action_eligible"] = True
            proof_count += 1
    return {
        **base_response,
        "status": "ok",
        "results": results,
        "stats": {
            "total": len(candidates),
            "scanned": scanned,
            "matched": matched,
            "not_matched": scanned - matched,
            "returned": len(results),
            "mapped": mapped,
            "unmapped": unmapped,
            "truncated": truncated,
            "total_is_lower_bound": False,
            "scan_complete": True,
        },
        "completion_scope": "partial_table_only" if partial_execution else ("complete_table" if not truncated else "truncated_table"),
        "partial_execution_confirmed": partial_execution,
        "partial_confirmation_available": False,
        "partial_fallback_id": None,
        "degraded_to_deterministic": partial_execution,
        "proof_eligible": proof_count > 0,
        "issue_eligible": proof_count > 0,
        "highlight_eligible": False,
        "next_step": None if results else "broaden_filters_or_check_model_content",
    }


def run_model_search(request: SearchRequest) -> dict[str, Any]:
    if not request.ifc_source_path or not os.path.exists(request.ifc_source_path):
        raise FileNotFoundError("ifc_source_path not found")

    resolution = _resolve_filters(request)
    filters = resolution.filters
    evidence_refs: list[dict[str, Any]] = list(resolution.evidence) + [
        {"kind": "ifc_source", "path_basename": os.path.basename(request.ifc_source_path)},
    ]
    if request.model_version_id:
        evidence_refs.append({"kind": "model_version_id", "value": request.model_version_id})
    query_id = _new_query_id()
    base_response = _base_response(request, filters, evidence_refs, query_id=query_id)

    if resolution.semantic_error_code:
        return {
            **base_response,
            "status": "semantic_error",
            "error_code": resolution.semantic_error_code,
            "retryable": resolution.semantic_retryable,
            "next_step": "retry_semantic_interpretation_or_use_deterministic_mode",
        }
    if not filters.usable:
        return {
            **base_response,
            "status": "uninterpreted",
            "error_code": "unsupported_or_invalid_query",
            "retryable": False,
            "next_step": "rewrite_query_using_supported_grammar",
        }
    if not filters.complete:
        binding = _partial_binding(request)
        if resolution.partial_candidate and binding:
            try:
                partial_fallback_id, expires_at = _PARTIAL_FALLBACKS.mint(
                    request=request,
                    filters=filters,
                    evidence_refs=evidence_refs,
                    query_id=query_id,
                    binding=binding,
                )
            except PartialFallbackUnavailable:
                return {
                    **base_response,
                    "status": "partial_fallback_unavailable",
                    "error_code": "partial_confirmation_capacity_unavailable",
                    "retryable": True,
                    "partial_execution_confirmed": False,
                    "partial_confirmation_available": False,
                    "partial_fallback_id": None,
                    "degraded_to_deterministic": True,
                    "next_step": "retry_authenticated_query_later",
                }
            return {
                **base_response,
                "status": "partial_fallback_confirmation_required",
                "error_code": None,
                "partial_execution_confirmed": False,
                "partial_confirmation_available": True,
                "partial_fallback_id": partial_fallback_id,
                "partial_fallback_expires_at": expires_at,
                "degraded_to_deterministic": True,
                "next_step": "confirm_exact_partial_filters",
            }
        # Exact, bound partial confirmation can only be minted by the coordinator
        # after it has authenticated the session/principal/artifact/revision.  A
        # direct search response must not pretend it is confirmable on its own.
        return {
            **base_response,
            "status": "partial_fallback_requires_trusted_context",
            "error_code": None,
            "partial_execution_confirmed": False,
            "partial_confirmation_available": False,
            "partial_fallback_id": None,
            "degraded_to_deterministic": resolution.partial_candidate,
            "next_step": "run_through_authenticated_session_confirmation",
        }

    return _execute_search(request, filters, evidence_refs, base_response, partial_execution=False)


def confirm_partial_fallback(partial_fallback_id: str, trusted_a4_context: dict[str, Any]) -> dict[str, Any]:
    """Consume a short-lived bound partial candidate and run only that candidate."""
    binding = _partial_binding_from_context(
        trusted_a4_context,
        trusted_a4_context.get("model_version_id") if isinstance(trusted_a4_context, dict) else None,
    )
    if binding is None:
        raise PartialFallbackUnavailable("partial fallback unavailable")
    record = _PARTIAL_FALLBACKS.consume(partial_fallback_id, binding)
    request = copy.deepcopy(record.request)
    request.trusted_a4_context = copy.deepcopy(trusted_a4_context)
    request.retry_of_query_id = record.query_id
    if not request.ifc_source_path or not os.path.exists(request.ifc_source_path):
        raise FileNotFoundError("ifc_source_path not found")
    evidence_refs = copy.deepcopy(record.evidence_refs)
    evidence_refs.append({"kind": "partial_confirmation", "mode": "exact_bound_candidate"})
    base_response = _base_response(request, record.filters, evidence_refs)
    return _execute_search(request, record.filters, evidence_refs, base_response, partial_execution=True)
