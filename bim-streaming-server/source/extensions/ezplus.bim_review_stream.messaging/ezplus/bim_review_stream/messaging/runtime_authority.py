import ipaddress
import json
import os
import re
import secrets
from dataclasses import dataclass, field
from typing import Callable, Mapping, Optional
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


MUTATING_EVENTS = {
    "openStageRequest",
    "loadArtifactGroupRequest",
    "composeStageRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
    "highlightPrimsRequest",
    "clearHighlightRequest",
    "focusPrimRequest",
}

READONLY_EVENTS = {
    "loadingStateQuery",
    "getChildrenRequest",
}

STAGE_LOAD_EVENTS = {
    "openStageRequest",
    "loadArtifactGroupRequest",
}

HARNESS_ONLY_EVENTS = {"composeStageRequest"}

REJECTION_REASONS = {
    "spectator_readonly",
    "lease_invalid",
    "session_lifecycle_blocked",
    "unauthorized_source_client",
    "unsupported_command",
    "invalid_payload",
}

_SAFE_COMMAND_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SAFE_SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$")
_SAFE_SESSION_TRACE = re.compile(r"^(?:ifcready_|rev_)[A-Za-z0-9_-]{1,190}$")
_DEFAULT_TIMEOUT_SECONDS = 0.4
_MAX_RESPONSE_BYTES = 64 * 1024


Transport = Callable[
    [str, Mapping[str, str], bytes, float],
    tuple[int, bytes] | tuple[int, Mapping[str, str], bytes],
]


@dataclass(frozen=True)
class AuthorityDecision:
    authorized: bool
    reason: Optional[str] = None
    request_id: Optional[str] = None
    rejection_id: Optional[str] = None
    retryable: bool = False
    detail_code: Optional[str] = None
    trace_id: Optional[str] = None
    data: Mapping[str, object] = field(default_factory=dict)


@dataclass
class DataChannelTraceContext:
    _session_id: Optional[str] = field(default=None, init=False, repr=False)
    _trace_id: Optional[str] = field(default=None, init=False, repr=False)

    def bind_active_stage(self, session_id: str, trace_id: str) -> bool:
        if (
            not _SAFE_SESSION_ID.fullmatch(session_id)
            or len(trace_id) > 200
            or not _SAFE_SESSION_TRACE.fullmatch(trace_id)
        ):
            return False
        self._session_id = session_id
        self._trace_id = trace_id
        return True

    def active_stage(self) -> Optional[tuple[str, str]]:
        if self._session_id is None or self._trace_id is None:
            return None
        return self._session_id, self._trace_id

    def clear(self) -> None:
        self._session_id = None
        self._trace_id = None


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def payload_dict(value):
    value = _plain_value(value)
    return value if isinstance(value, dict) else {}


def _plain_value(value):
    get_dict = getattr(value, "get_dict", None)
    if callable(get_dict):
        value = get_dict()
    if isinstance(value, dict):
        return {str(key): _plain_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain_value(item) for item in value]
    return value


def _safe_request_id(payload: Mapping[str, object]) -> Optional[str]:
    value = payload.get("request_id")
    if isinstance(value, str) and _SAFE_COMMAND_ID.fullmatch(value):
        return value
    return None


def _safe_session_id(payload: Mapping[str, object]) -> Optional[str]:
    value = payload.get("session_id")
    if isinstance(value, str) and _SAFE_SESSION_ID.fullmatch(value):
        return value
    return None


def _safe_trace_id(payload: Mapping[str, object]) -> Optional[str]:
    value = payload.get("trace_id")
    if isinstance(value, str) and len(value) <= 200 and _SAFE_SESSION_TRACE.fullmatch(value):
        return value
    return None


def _rejection_id() -> str:
    return f"rejection_{secrets.token_hex(12)}"


def local_denial(payload, reason: str, detail_code: str) -> AuthorityDecision:
    request_payload = payload_dict(payload)
    request_id = _safe_request_id(request_payload)
    return AuthorityDecision(
        authorized=False,
        reason=reason,
        request_id=request_id,
        rejection_id=None if request_id else _rejection_id(),
        retryable=False,
        detail_code=detail_code,
    )


def authority_unavailable(payload) -> AuthorityDecision:
    request_payload = payload_dict(payload)
    request_id = _safe_request_id(request_payload)
    return AuthorityDecision(
        authorized=False,
        reason="lease_invalid",
        request_id=request_id,
        rejection_id=None if request_id else _rejection_id(),
        retryable=True,
        detail_code="authority_unavailable",
    )


def command_rejected_payload(
    rejected_event_type: str,
    payload,
    decision: AuthorityDecision,
    *,
    runtime_state: str = "unchanged",
) -> dict:
    request_payload = payload_dict(payload)
    result = {
        "rejected_event_type": rejected_event_type,
        "reason": decision.reason if decision.reason in REJECTION_REASONS else "lease_invalid",
        "retryable": bool(decision.retryable),
        "runtime_state": runtime_state if runtime_state in {"unchanged", "changed_unconfirmed"} else "unchanged",
    }
    request_id = decision.request_id or _safe_request_id(request_payload)
    if request_id:
        result["request_id"] = request_id
    else:
        result["rejection_id"] = decision.rejection_id or _rejection_id()
    session_id = _safe_session_id(request_payload)
    if session_id:
        result["session_id"] = session_id
    trace_id = decision.trace_id or _safe_trace_id(request_payload)
    if trace_id:
        result["trace_id"] = trace_id
    if isinstance(decision.detail_code, str) and 0 < len(decision.detail_code) <= 128:
        result["detail_code"] = decision.detail_code
    return result


def correlated_result(payload, result: Mapping[str, object]) -> dict:
    response = dict(result)
    request_payload = payload_dict(payload)
    request_id = _safe_request_id(request_payload)
    if request_id:
        response["request_id"] = request_id
    trace_id = _safe_trace_id(request_payload)
    if trace_id:
        response["trace_id"] = trace_id
    return response


class RuntimeAuthorityClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        internal_token: Optional[str] = None,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        transport: Optional[Transport] = None,
    ):
        self._base_url = (base_url if base_url is not None else os.environ.get(
            "COORDINATOR_INTERNAL_API_BASE", ""
        )).strip().rstrip("/")
        self._internal_token = (
            internal_token if internal_token is not None else os.environ.get("INTERNAL_API_AUTH_TOKEN", "")
        ).strip()
        self._timeout_seconds = min(0.5, max(0.3, float(timeout_seconds)))
        self._transport = transport or self._default_transport
        self._configuration_valid = _is_loopback_base(self._base_url) and bool(self._internal_token)

    @classmethod
    def from_env(cls, **kwargs):
        return cls(base_url=None, internal_token=None, **kwargs)

    @property
    def timeout_seconds(self) -> float:
        return self._timeout_seconds

    @property
    def configuration_valid(self) -> bool:
        return self._configuration_valid

    def authorize(self, event_type: str, payload) -> AuthorityDecision:
        request_payload = payload_dict(payload)
        if event_type not in MUTATING_EVENTS:
            return local_denial(request_payload, "unsupported_command", "event_not_in_mutator_catalog")
        if event_type in HARNESS_ONLY_EVENTS:
            return local_denial(request_payload, "unsupported_command", "harness_only_command")

        request_id = _safe_request_id(request_payload)
        session_id = _safe_session_id(request_payload)
        trace_id = _safe_trace_id(request_payload)
        source_client_id = request_payload.get("source_client_id")
        viewer_lease_token = request_payload.get("viewer_lease_token") or request_payload.get("lease_token")
        if (
            not request_id
            or not session_id
            or not trace_id
            or not isinstance(source_client_id, str)
            or not source_client_id
            or not isinstance(viewer_lease_token, str)
            or not viewer_lease_token
        ):
            return local_denial(request_payload, "invalid_payload", "runtime_authorization_payload_invalid")

        body = {
            "trace_id": trace_id,
            "source_client_id": source_client_id,
            "requested_event_type": event_type,
            "request_id": request_id,
            "command_context": _command_context(event_type, request_payload),
        }
        if event_type in STAGE_LOAD_EVENTS:
            for key in (
                "stage_binding_authorization_id",
                "binding_revision_id",
                "stage_composition",
            ):
                if key in request_payload:
                    body[key] = _plain_value(request_payload[key])

        response = self._request_json(
            f"/api/internal/review-sessions/{quote(session_id, safe='')}/runtime-command-authorizations",
            viewer_lease_token,
            body,
        )
        decision = _authorization_decision(request_payload, response)
        if (
            event_type in STAGE_LOAD_EVENTS
            and not decision.authorized
            and decision.detail_code == "authority_unavailable"
        ):
            self._fail_stage_before_mutation(
                session_id,
                viewer_lease_token,
                body,
            )
        return decision

    def verify_datachannel_trace(self, event_type: str, payload) -> Optional[str]:
        request_payload = payload_dict(payload)
        if event_type not in MUTATING_EVENTS | READONLY_EVENTS:
            return None
        session_id = _safe_session_id(request_payload)
        trace_id = _safe_trace_id(request_payload)
        if not session_id or not trace_id:
            return None

        response = self._request_json(
            f"/api/internal/review-sessions/{quote(session_id, safe='')}/datachannel-trace-verifications",
            "",
            {"trace_id": trace_id},
        )
        if (
            response is None
            or response.get("verified") is not True
            or response.get("session_id") != session_id
            or response.get("trace_id") != trace_id
        ):
            return None
        return trace_id

    def _fail_stage_before_mutation(
        self,
        session_id: str,
        viewer_lease_token: str,
        authorization_body: Mapping[str, object],
    ) -> None:
        # A lost/malformed authorization response must not strand the
        # coordinator transaction in `executing` for its long stage-load TTL.
        # The rollback is best-effort and carries the same exact tuple; the
        # coordinator accepts it from pending or that exact executing attempt.
        self._request_json(
            f"/api/internal/review-sessions/{quote(session_id, safe='')}/stage-binding-authorization-rollbacks",
            viewer_lease_token,
            authorization_body,
        )

    def confirm_stage(self, payload, outcome: str) -> AuthorityDecision:
        request_payload = payload_dict(payload)
        request_id = _safe_request_id(request_payload)
        session_id = _safe_session_id(request_payload)
        trace_id = _safe_trace_id(request_payload)
        viewer_lease_token = request_payload.get("viewer_lease_token") or request_payload.get("lease_token")
        authorization_id = request_payload.get("stage_binding_authorization_id")
        binding_revision_id = request_payload.get("binding_revision_id")
        if (
            not request_id
            or not session_id
            or not trace_id
            or not isinstance(viewer_lease_token, str)
            or not viewer_lease_token
            or not isinstance(authorization_id, str)
            or not authorization_id
            or not isinstance(binding_revision_id, str)
            or not binding_revision_id
            or outcome not in {"success", "failed"}
        ):
            return local_denial(request_payload, "invalid_payload", "stage_confirmation_payload_invalid")

        response = self._request_json(
            f"/api/internal/review-sessions/{quote(session_id, safe='')}/stage-binding-confirmations",
            viewer_lease_token,
            {
                "trace_id": trace_id,
                "stage_binding_authorization_id": authorization_id,
                "binding_revision_id": binding_revision_id,
                "request_id": request_id,
                "outcome": outcome,
            },
        )
        return _confirmation_decision(request_payload, response, outcome)

    def _request_json(self, path: str, viewer_lease_token: str, body: Mapping[str, object]):
        if not self._configuration_valid:
            return None
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Token": self._internal_token,
        }
        if viewer_lease_token:
            headers["X-Viewer-Lease-Token"] = viewer_lease_token
        request_trace_id = _safe_trace_id(body)
        if request_trace_id:
            headers["X-Trace-Id"] = request_trace_id
        encoded = json.dumps(body, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        try:
            transport_response = self._transport(
                f"{self._base_url}{path}",
                headers,
                encoded,
                self._timeout_seconds,
            )
            if len(transport_response) == 2:
                status, raw = transport_response
                response_headers: Mapping[str, str] = {}
            elif len(transport_response) == 3:
                status, response_headers, raw = transport_response
            else:
                return None
            if status != 200 or len(raw) > _MAX_RESPONSE_BYTES:
                return None
            if request_trace_id and _header_value(response_headers, "X-Trace-Id") != request_trace_id:
                return None
            decoded = json.loads(raw.decode("utf-8"))
        except Exception:
            return None
        return decoded if isinstance(decoded, dict) else None

    @staticmethod
    def _default_transport(
        url: str,
        headers: Mapping[str, str],
        body: bytes,
        timeout_seconds: float,
    ) -> tuple[int, Mapping[str, str], bytes]:
        opener = build_opener(ProxyHandler({}), _NoRedirectHandler())
        request = Request(url, data=body, headers=dict(headers), method="POST")
        with opener.open(request, timeout=timeout_seconds) as response:
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
            return int(response.status), dict(response.headers.items()), raw


def _command_context(event_type: str, payload: Mapping[str, object]) -> dict:
    fields = {
        "highlightPrimsRequest": ("mode", "items", "focus_first"),
        "focusPrimRequest": ("prim_path",),
        "clearHighlightRequest": (),
        "selectPrimsRequest": ("paths",),
        "makePrimsPickable": ("paths",),
        "resetStage": (),
        "openStageRequest": (),
        "loadArtifactGroupRequest": (),
    }.get(event_type, ())
    return {key: _plain_value(payload[key]) for key in fields if key in payload}


def _authorization_decision(payload, response) -> AuthorityDecision:
    if response is None or not isinstance(response.get("authorized"), bool):
        return authority_unavailable(payload)
    request_payload = payload_dict(payload)
    request_id = _safe_request_id(request_payload)
    trace_id = _safe_trace_id(request_payload)
    if not trace_id or response.get("trace_id") != trace_id:
        return authority_unavailable(payload)
    if response["authorized"] is True:
        if response.get("request_id") != request_id or response.get("retryable") is not False:
            return authority_unavailable(payload)
        return AuthorityDecision(True, request_id=request_id, trace_id=trace_id, data=dict(response))
    return _structured_denial(payload, response, expected_trace_id=trace_id)


def _confirmation_decision(payload, response, outcome: str) -> AuthorityDecision:
    if response is None or not isinstance(response.get("confirmed"), bool):
        return authority_unavailable(payload)
    request_payload = payload_dict(payload)
    request_id = _safe_request_id(request_payload)
    trace_id = _safe_trace_id(request_payload)
    if not trace_id or response.get("trace_id") != trace_id:
        return authority_unavailable(payload)
    if response["confirmed"] is True:
        binding_revision_id = request_payload.get("binding_revision_id")
        expected_status = "active" if outcome == "success" else "failed"
        if (
            response.get("request_id") != request_id
            or response.get("binding_revision_id") != binding_revision_id
            or response.get("transaction_status") != expected_status
            or not isinstance(response.get("idempotent_replay"), bool)
            or (
                outcome == "success"
                and response.get("active_binding_revision") != binding_revision_id
            )
        ):
            return authority_unavailable(payload)
        return AuthorityDecision(True, request_id=request_id, trace_id=trace_id, data=dict(response))
    return _structured_denial(payload, response, expected_trace_id=trace_id)


def _structured_denial(
    payload,
    response: Mapping[str, object],
    *,
    expected_trace_id: Optional[str] = None,
) -> AuthorityDecision:
    request_payload = payload_dict(payload)
    request_id = _safe_request_id(request_payload)
    reason = response.get("reason")
    response_request_id = response.get("request_id")
    response_rejection_id = response.get("rejection_id")
    retryable = response.get("retryable")
    if (
        reason not in REJECTION_REASONS
        or not isinstance(retryable, bool)
        or (request_id and response_request_id != request_id)
        or (not request_id and not isinstance(response_rejection_id, str))
        or (expected_trace_id is not None and response.get("trace_id") != expected_trace_id)
    ):
        return authority_unavailable(request_payload)
    detail_code = response.get("detail_code")
    return AuthorityDecision(
        authorized=False,
        reason=str(reason),
        request_id=request_id,
        rejection_id=None if request_id else str(response_rejection_id),
        retryable=retryable,
        detail_code=detail_code if isinstance(detail_code, str) else None,
        trace_id=expected_trace_id,
        data={},
    )


def _header_value(headers: Mapping[str, str], name: str) -> Optional[str]:
    expected = name.lower()
    for key, value in headers.items():
        if str(key).lower() == expected and isinstance(value, str):
            return value
    return None


def _is_loopback_base(base_url: str) -> bool:
    try:
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            return False
        if parsed.path not in {"", "/"}:
            return False
        host = parsed.hostname.lower()
        if host == "localhost":
            return True
        return ipaddress.ip_address(host).is_loopback
    except (ValueError, TypeError):
        return False
