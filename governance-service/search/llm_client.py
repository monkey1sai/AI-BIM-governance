"""OpenAI-compatible, server-only LLM client for A4 filter interpretation.

The client deliberately treats configuration as untrusted input.  It never
publishes a configured endpoint or credential and it performs no outbound call
unless the complete transport policy has been validated first.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import socket
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic, time
from typing import Any, Optional
from urllib.parse import urlparse


DEFAULT_BASE_URL = ""
DEFAULT_MODEL = "Ornith-1.0-35B"
MAX_TIMEOUT_S = 120.0
MAX_RESPONSE_BYTES = 1_048_576
RESPONSE_READ_CHUNK_BYTES = 64 * 1024
LLM_OBSERVATION_TTL_SECONDS = 60.0
SAFE_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")

SYSTEM_PROMPT = """你是 BIM/IFC 語意查詢解譯器。只把使用者問句轉成 JSON 過濾條件，禁止聊天。
硬性規則：
1. 只輸出一個 JSON 物件，不要 markdown 代碼塊、不要解釋文字。
2. schema:
{
  "ifc_classes": ["IfcDoor", ...],
  "storey_tokens": ["4F", "1", ...],
  "property_filters": [{"name":"FireRating","op":"<","value":60}],
  "name_contains": ["可選關鍵字"],
  "consumed_spans": [{"start":0,"end":2,"field":"ifc_classes","filter_index":0}]
}
3. op 只能是 <, <=, >, >=, ==。
4. ifc_classes 必須是合法 Ifc* 型別名（如 IfcDoor/IfcWall/IfcColumn/IfcBeam/IfcSlab/IfcWindow/IfcSpace）。
5. consumed_spans 必須精確指出每個 filter 消費的原問句字元範圍（end 為 exclusive）與該 field 的 filter_index；每一個 emitted filter 都必須剛好有一個 span，不可跳過或新增約束條件。
6. 不得捏造不存在的 IFC class 或亂填 property；不確定就留空陣列，且不可聲稱任何 span 已被消費。
7. 繁中樓層「四樓/4F/FL4」→ storey_tokens 含 "4" 與 "4F"；「防火門」→ IfcDoor；「牆」→ IfcWall；「柱」→ IfcColumn。
"""


class LlmError(RuntimeError):
    """A safe, public error class.  Its code never contains upstream content."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class CompletionResult:
    """Bounded metadata from a completed upstream call; no raw response body."""

    content: str
    served_model: Optional[str]
    finish_reason: str
    latency_ms: int


@dataclass(frozen=True)
class LlmConfig:
    base_url: str
    api_key: str
    model: str
    timeout_s: float
    enabled: bool
    config_error: Optional[str] = None
    transport_class: str = "unconfigured"
    profile: str = "production"

    @property
    def chat_url(self) -> str:
        return self.base_url.rstrip("/") + "/chat/completions"

    def public_status(self) -> dict[str, Any]:
        # A configured model is not proof that it served a request.  The status
        # deliberately exposes only an operational classification and safe keys.
        observation = _public_observation(self) if self.enabled and not self.config_error else None
        if self.config_error:
            state = "invalid"
            checked_at = None
            check_source = "config"
            freshness = "unknown"
            ttl_s = 0
            error_code = self.config_error
        elif observation is not None:
            state = observation["state"]
            checked_at = observation["checked_at"]
            check_source = "query_observation"
            freshness = observation["freshness"]
            ttl_s = observation["ttl_s"]
            error_code = observation["error_code"]
        elif self.enabled:
            # Configuration alone is not a bounded probe or observed query.
            state = "unknown"
            checked_at = None
            check_source = "config"
            freshness = "unknown"
            ttl_s = 0
            error_code = None
        else:
            state = "disabled"
            checked_at = None
            check_source = "config"
            freshness = "unknown"
            ttl_s = 0
            error_code = "llm_disabled"
        return {
            "enabled": self.enabled,
            "configured": bool(self.enabled and self.api_key and self.base_url),
            "state": state,
            "model": _safe_model_name(self.model),
            "checked_at": checked_at,
            "check_source": check_source,
            "freshness": freshness,
            "ttl_s": ttl_s,
            "transport_class": self.transport_class,
            "error_code": error_code,
        }


@dataclass(frozen=True)
class _LlmObservation:
    config_key: str
    state: str
    checked_at: str
    expires_at_monotonic: float
    error_code: Optional[str]


_OBSERVATION_LOCK = threading.Lock()
_LATEST_OBSERVATION: Optional[_LlmObservation] = None


def _observation_config_key(config: LlmConfig) -> str:
    credential_digest = hashlib.sha256(config.api_key.encode("utf-8")).hexdigest()
    material = "\0".join(
        (config.base_url, config.model, config.transport_class, config.profile, credential_digest)
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _record_observation(config: LlmConfig, *, state: str, error_code: Optional[str]) -> None:
    global _LATEST_OBSERVATION
    observed_at = time()
    checked_at = datetime.fromtimestamp(observed_at, timezone.utc).isoformat().replace("+00:00", "Z")
    observation = _LlmObservation(
        config_key=_observation_config_key(config),
        state=state,
        checked_at=checked_at,
        expires_at_monotonic=monotonic() + LLM_OBSERVATION_TTL_SECONDS,
        error_code=error_code,
    )
    with _OBSERVATION_LOCK:
        _LATEST_OBSERVATION = observation


def _public_observation(config: LlmConfig) -> Optional[dict[str, Any]]:
    with _OBSERVATION_LOCK:
        observation = _LATEST_OBSERVATION
    if observation is None or not hmac.compare_digest(observation.config_key, _observation_config_key(config)):
        return None
    remaining = observation.expires_at_monotonic - monotonic()
    if remaining <= 0:
        return {
            "state": "unknown",
            "checked_at": observation.checked_at,
            "freshness": "stale",
            "ttl_s": 0,
            "error_code": observation.error_code,
        }
    return {
        "state": observation.state,
        "checked_at": observation.checked_at,
        "freshness": "fresh",
        "ttl_s": max(1, int(math.ceil(remaining))),
        "error_code": observation.error_code,
    }

def _reset_observation_for_tests() -> None:
    global _LATEST_OBSERVATION
    with _OBSERVATION_LOCK:
        _LATEST_OBSERVATION = None


def _nonempty_alias_value(*names: str) -> tuple[str, bool]:
    """Return a canonical aliased value and whether nonempty aliases conflict."""
    values = [os.environ[name].strip() for name in names if os.environ.get(name, "").strip()]
    if not values:
        return "", False
    return values[0], len(set(values)) > 1


def _safe_model_name(value: Any) -> Optional[str]:
    """Keep diagnostics to a bounded identifier, never arbitrary upstream text."""
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    return candidate if SAFE_MODEL_RE.fullmatch(candidate) else None


def _parse_bool(raw: str) -> Optional[bool]:
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return None


def _aliased_bool(*names: str) -> tuple[Optional[bool], bool]:
    parsed: list[bool] = []
    invalid = False
    for name in names:
        raw = os.environ.get(name)
        if raw is None or not raw.strip():
            continue
        value = _parse_bool(raw)
        if value is None:
            invalid = True
        else:
            parsed.append(value)
    if invalid or len(set(parsed)) > 1:
        return None, True
    return (parsed[0] if parsed else None), False


def _loopback_host(host: Optional[str]) -> bool:
    if not host:
        return False
    normalized = host.strip().lower()
    return normalized in {"127.0.0.1", "::1"}


def _trusted_lab_http_host(host: Optional[str], http_allowlist: set[str]) -> bool:
    """Allow insecure lab HTTP only to an explicitly allowlisted literal LAN IP.

    A hostname allowlist alone is not a transport boundary: a later DNS answer
    could route the bearer credential to another destination.  Literal private
    or loopback IPs keep this non-production exception deterministic.
    """
    if not host:
        return False
    normalized = host.strip().lower()
    if normalized not in http_allowlist:
        return False
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    if (
        address.is_loopback
        or address.is_link_local
        or address.is_unspecified
        or address.is_multicast
        or address.is_reserved
    ):
        return False
    # trusted_lab_http is intentionally narrower than ipaddress.is_private:
    # only literal RFC1918 IPv4 addresses are accepted by this exception.
    return isinstance(address, ipaddress.IPv4Address) and any(
        address in network
        for network in (
            ipaddress.ip_network("10.0.0.0/8"),
            ipaddress.ip_network("172.16.0.0/12"),
            ipaddress.ip_network("192.168.0.0/16"),
        )
    )


def _classify_transport(
    base_url: str,
    *,
    profile: str,
    allow_insecure: bool,
    http_allowlist: set[str],
) -> tuple[str, bool]:
    """Classify and authorize an endpoint without ever attempting DNS/I/O."""
    if not base_url:
        return "unconfigured", False
    parsed = urlparse(base_url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        return "invalid", False
    scheme = parsed.scheme.lower()
    if scheme == "https":
        return "verified_https", True
    if scheme == "http" and _loopback_host(parsed.hostname):
        return "loopback_tunnel", True
    if (
        scheme == "http"
        and profile == "trusted_lab_http"
        and allow_insecure
        and _trusted_lab_http_host(parsed.hostname, http_allowlist)
    ):
        return "trusted_lab_http", True
    return "untrusted", False


def load_llm_config() -> LlmConfig:
    """Load explicit configuration and fail closed on aliases or transport policy."""
    base, base_conflict = _nonempty_alias_value("A4_LLM_BASE_URL", "ORNITH_API_BASE")
    api_key, key_conflict = _nonempty_alias_value("A4_LLM_API_KEY", "ORNITH_API_KEY")
    model, model_conflict = _nonempty_alias_value("A4_LLM_MODEL", "ORNITH_MODEL")
    timeout_raw, timeout_conflict = _nonempty_alias_value("A4_LLM_TIMEOUT_S", "ORNITH_TIMEOUT_S")
    profile_raw, profile_conflict = _nonempty_alias_value("A4_LLM_PROFILE", "ORNITH_PROFILE")
    transport_mode, transport_conflict = _nonempty_alias_value("A4_LLM_TRANSPORT_MODE", "ORNITH_TRANSPORT_MODE")
    enabled_value, enabled_conflict = _aliased_bool("A4_LLM_ENABLED", "ORNITH_ENABLED")
    allow_insecure, insecure_invalid = _aliased_bool("A4_LLM_ALLOW_INSECURE")

    profile = (profile_raw or "production").strip().lower()
    allowed_profiles = {"production", "local-dev", "trusted_lab_http"}
    profile_valid = profile in allowed_profiles
    model_valid = _safe_model_name(model) is not None if model else False
    allowed_transport_modes = {"verified_https", "loopback_tunnel", "trusted_lab_http"}
    transport_mode_valid = transport_mode in allowed_transport_modes if transport_mode else True
    requested_enabled = enabled_value is True

    timeout_s = MAX_TIMEOUT_S
    timeout_valid = True
    if timeout_raw:
        try:
            timeout_s = float(timeout_raw)
        except (TypeError, ValueError):
            timeout_valid = False
        else:
            timeout_valid = math.isfinite(timeout_s) and 0 < timeout_s <= MAX_TIMEOUT_S

    allowlist = {
        value.strip().lower()
        for value in (os.environ.get("A4_LLM_HTTP_ALLOWLIST") or "").split(",")
        if value.strip()
    }
    transport_class, transport_valid = _classify_transport(
        base.rstrip("/"),
        profile=profile,
        allow_insecure=allow_insecure is True,
        http_allowlist=allowlist,
    )

    malformed = any(
        (
            base_conflict,
            key_conflict,
            model_conflict,
            timeout_conflict,
            profile_conflict,
            transport_conflict,
            enabled_conflict,
            insecure_invalid,
            not profile_valid,
            bool(model and not model_valid),
            not timeout_valid,
            not transport_mode_valid,
            bool(transport_mode and transport_mode != transport_class),
        )
    )
    required_when_enabled = bool(
        base
        and api_key
        and model_valid
        and timeout_raw
        and profile_raw
        and transport_mode
        and transport_valid
        and transport_mode == transport_class
    )
    config_error = "llm_config_invalid" if malformed or (requested_enabled and not required_when_enabled) else None
    enabled = requested_enabled and config_error is None and required_when_enabled

    return LlmConfig(
        base_url=base.rstrip("/"),
        api_key=api_key,
        model=model or DEFAULT_MODEL,
        timeout_s=timeout_s if timeout_valid else MAX_TIMEOUT_S,
        enabled=enabled,
        config_error=config_error,
        transport_class=transport_class,
        profile=profile if profile_valid else "production",
    )


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Do not let an approved endpoint redirect query/credential elsewhere."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


def _open_request(request: urllib.request.Request, timeout: float):
    # Ignore ambient proxy configuration as well as redirects: both could route
    # an otherwise allowed endpoint through an unapproved transport path.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirectHandler()).open(request, timeout=timeout)


def _response_socket(response: Any) -> Optional[Any]:
    """Locate urllib's underlying socket without depending on one wrapper shape."""
    for path in (("fp", "raw", "_sock"), ("fp", "_sock"), ("raw", "_sock"), ("_sock",)):
        current = response
        try:
            for attribute in path:
                current = getattr(current, attribute)
        except AttributeError:
            continue
        if callable(getattr(current, "settimeout", None)):
            return current
    return None


def _set_remaining_read_timeout(response: Any, remaining: float) -> None:
    """Shrink a real urllib socket timeout to the request's remaining budget."""
    sock = _response_socket(response)
    if sock is not None:
        sock.settimeout(remaining)


def _read_bounded_response(response: Any, *, deadline: float) -> bytes:
    """Read an upstream response with a finite byte budget and total deadline."""
    headers = getattr(response, "headers", None)
    raw_content_length = headers.get("Content-Length") if hasattr(headers, "get") else None
    if raw_content_length is not None:
        try:
            content_length = int(str(raw_content_length).strip())
        except (TypeError, ValueError) as exc:
            raise LlmError("llm_response_invalid", "LLM response length is invalid") from exc
        if content_length < 0:
            raise LlmError("llm_response_invalid", "LLM response length is invalid")
        if content_length > MAX_RESPONSE_BYTES:
            raise LlmError("llm_response_too_large", "LLM response exceeds the A4 response limit")

    chunks: list[bytes] = []
    total = 0
    read_chunk = getattr(response, "read1", None)
    if not callable(read_chunk):
        read_chunk = response.read
    while True:
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise LlmError("llm_timeout", "LLM request timed out")
        # urlopen's timeout applies to each blocking socket operation, not the
        # complete response.  read1 limits a loop iteration to one underlying
        # read where available, while the socket timeout enforces the remaining
        # total budget for that operation.
        _set_remaining_read_timeout(response, remaining)
        chunk = read_chunk(RESPONSE_READ_CHUNK_BYTES)
        if monotonic() >= deadline:
            # A fake/custom response may not expose urllib's socket, and EOF can
            # still arrive just after the deadline.  Never accept late bytes or
            # late EOF as a successful completion.
            raise LlmError("llm_timeout", "LLM request timed out")
        if not chunk:
            break
        if not isinstance(chunk, bytes):
            raise LlmError("llm_response_invalid", "LLM response has invalid bytes")
        total += len(chunk)
        if total > MAX_RESPONSE_BYTES:
            raise LlmError("llm_response_too_large", "LLM response exceeds the A4 response limit")
        chunks.append(chunk)
    return b"".join(chunks)


def chat_completion(
    *,
    user_content: str,
    system_content: str = SYSTEM_PROMPT,
    config: Optional[LlmConfig] = None,
    temperature: float = 0.0,
    max_tokens: int = 512,
) -> CompletionResult:
    """Call the model once after policy validation and return terminal metadata."""
    cfg = config or load_llm_config()
    if cfg.config_error or cfg.transport_class not in {"verified_https", "loopback_tunnel", "trusted_lab_http"}:
        raise LlmError("llm_config_invalid", "A4 LLM configuration is invalid")
    if not cfg.enabled:
        raise LlmError("llm_disabled", "A4 LLM is disabled")
    if not cfg.api_key:
        raise LlmError("llm_key_missing", "A4 LLM API key is not configured")

    payload = {
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        cfg.chat_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg.api_key}",
            "Accept": "application/json",
        },
    )
    started = monotonic()
    try:
        with _open_request(req, timeout=cfg.timeout_s) as resp:
            raw = _read_bounded_response(resp, deadline=started + cfg.timeout_s).decode("utf-8", errors="replace")
    except LlmError as exc:
        _record_observation(cfg, state="unavailable", error_code=exc.code)
        raise
    except urllib.error.HTTPError as exc:
        if 300 <= exc.code < 400:
            error = LlmError("llm_redirect_rejected", "LLM redirect was rejected")
        else:
            error = LlmError("llm_http_error", "LLM HTTP request failed")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error from exc
    except (TimeoutError, socket.timeout) as exc:
        error = LlmError("llm_timeout", "LLM request timed out")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error from exc
    except (urllib.error.URLError, OSError) as exc:
        error = LlmError("llm_network_error", "LLM network request failed")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error from exc
    latency_ms = max(0, min(120_000, int((monotonic() - started) * 1000)))

    try:
        doc = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        error = LlmError("llm_bad_json", "LLM response is not JSON")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error from exc
    if not isinstance(doc, dict):
        error = LlmError("llm_bad_json", "LLM response has an invalid shape")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error

    choices = doc.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        error = LlmError("llm_empty", "LLM returned no choices")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error
    choice = choices[0]
    finish_reason = choice.get("finish_reason")
    if finish_reason != "stop":
        error = LlmError("llm_non_terminal", "LLM completion did not reach a terminal state")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error
    message = choice.get("message")
    if not isinstance(message, dict):
        error = LlmError("llm_empty_content", "LLM message content is empty")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        error = LlmError("llm_empty_content", "LLM message content is empty")
        _record_observation(cfg, state="unavailable", error_code=error.code)
        raise error
    served_model = _safe_model_name(doc.get("model"))
    _record_observation(cfg, state="available", error_code=None)
    return CompletionResult(
        content=content.strip(),
        served_model=served_model,
        finish_reason="stop",
        latency_ms=latency_ms,
    )


def extract_json_object(text: str) -> dict[str, Any]:
    """Parse model text into a JSON object and never leak parser internals."""
    cleaned = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        value = json.loads(cleaned)
    except (TypeError, json.JSONDecodeError):
        value = None
    if isinstance(value, dict):
        return value

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            value = json.loads(cleaned[start : end + 1])
        except (TypeError, json.JSONDecodeError) as exc:
            raise LlmError("llm_filter_parse", "Could not parse JSON filters from LLM output") from exc
        if isinstance(value, dict):
            return value
    raise LlmError("llm_filter_parse", "Could not parse JSON filters from LLM output")
