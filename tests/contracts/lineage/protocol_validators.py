"""Wire-protocol validators for the cloud lineage publication boundary.

Task 2.6 of ``openspec/changes/rvt-ifc-usdc-lineage/tasks.md``. Where 2.1-2.4
cover *document* shape, this module covers the *transport* contract that
carries those documents: HMAC signing over the raw body, the canonical
signature-timestamp header, the +/-300 second skew window, header/body event
binding, ACK classification, and the nine canonical HTTP/code/retryable
triples.

Canonical source of truth (all rule text below quotes it):
``openspec/changes/rvt-ifc-usdc-lineage/specs/cloud-lineage-publication/spec.md``.

Import budget follows ``tests/contracts/lineage/semantic_validators.py``: this
module imports **stdlib only** (``hmac``/``hashlib``/``re``/``datetime``), so
the ``root contracts and fakes`` CI job — which installs nothing but ``pytest``
and ``jsonschema`` — can run it. It is loaded by the test module through
``importlib.util.spec_from_file_location`` because the lineage contract
directory intentionally ships no ``__init__.py`` (blueprint E-6).

Two layers, deliberately kept separate
--------------------------------------

``validate_wire_timestamp`` is the **pattern layer**. It applies the schema's
``utcTimestamp`` regex through ``re.search``, byte-for-byte the way
``jsonschema`` applies it, so a test that uses this function proves something
about the shipped schema rather than about a stricter local re-implementation.

``parse_calendar_strict`` is the **semantic layer**. It owns what a regex
cannot decide (2026-02-30 is well-formed and does not exist) and, because it
anchors with ``\\A``/``\\Z``, it also closes the one hole the pattern layer
leaves open: Python's ``$`` matches before a single trailing newline, so
``re.search`` — and therefore ``jsonschema`` — accepts ``"...Z\\n"``. Every
other gate in this module anchors with ``fullmatch`` for the same reason.

No real credential ever reaches this module. Secrets arrive as ``bytes``
supplied by the caller; tests pass a fixed dummy.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, NamedTuple, Sequence

# ---------------------------------------------------------------------------
# Headers (spec.md L152)
# ---------------------------------------------------------------------------

#: ``X-Lineage-Event-Id`` — must equal the request body's ``event_id``.
EVENT_ID_HEADER = "X-Lineage-Event-Id"
#: ``X-Lineage-Signature-Timestamp`` — canonical unsigned decimal Unix seconds.
SIGNATURE_TIMESTAMP_HEADER = "X-Lineage-Signature-Timestamp"
#: ``X-Lineage-Signature-Key-Id`` — selects the shared secret; never the secret.
SIGNATURE_KEY_ID_HEADER = "X-Lineage-Signature-Key-Id"
#: ``X-Lineage-Webhook-Signature`` — ``sha256=<lowercase-hex>``.
WEBHOOK_SIGNATURE_HEADER = "X-Lineage-Webhook-Signature"

#: "每個request SHALL 攜帶" — all four, verbatim, in spec order.
REQUIRED_REQUEST_HEADERS = (
    EVENT_ID_HEADER,
    SIGNATURE_TIMESTAMP_HEADER,
    SIGNATURE_KEY_ID_HEADER,
    WEBHOOK_SIGNATURE_HEADER,
)

# ---------------------------------------------------------------------------
# HMAC (spec.md L152)
# ---------------------------------------------------------------------------

#: ``sha256=<lowercase-hex>``.
SIGNATURE_PREFIX = "sha256="
#: The single ``"\n"`` between the timestamp header and the raw body.
SIGNATURE_SEPARATOR = b"\n"
#: "預設±300秒window".
DEFAULT_SKEW_SECONDS = 300

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

#: "SHALL 符合``^(?:0|[1-9][0-9]*)$``" (spec.md L152).
SIGNATURE_TIMESTAMP_PATTERN = r"^(?:0|[1-9][0-9]*)$"

#: The shared canonical UTC wire form (spec.md L47), copied verbatim from
#: ``$defs/utcTimestamp`` in both change schemas.
WIRE_TIMESTAMP_PATTERN = (
    r"^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,6})?Z$"
)

#: ``$defs/uuid`` from both change schemas.
UUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}"
    r"-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)

#: ``$defs/sha256`` — lowercase hex only.
SHA256_PATTERN = r"^[0-9a-f]{64}$"

#: ``publication_identity`` — canonical colon-join of three components.
PUBLICATION_IDENTITY_PATTERN = r"^[A-Za-z0-9._-]+:[^:]+:[^:]+$"

#: MySQL ``DATETIME`` cannot store a year below 1000; the wire pattern already
#: refuses ``0999`` and the semantic layer refuses it independently.
MIN_WIRE_YEAR = 1000
MAX_WIRE_YEAR = 9999

_SIGNATURE_TIMESTAMP_RE = re.compile(SIGNATURE_TIMESTAMP_PATTERN)
# Applied with ``re.search`` on purpose: this mirrors how ``jsonschema``
# evaluates ``pattern``. See the module docstring.
_WIRE_TIMESTAMP_RE = re.compile(WIRE_TIMESTAMP_PATTERN)
_UUID_RE = re.compile(UUID_PATTERN)
_SHA256_RE = re.compile(SHA256_PATTERN)
_PUBLICATION_IDENTITY_RE = re.compile(PUBLICATION_IDENTITY_PATTERN)

# Structural decomposition for the semantic parser. ``\A``/``\Z`` are absolute
# anchors: unlike ``$`` they do not tolerate a trailing newline.
_CALENDAR_RE = re.compile(
    r"\A(?P<year>[0-9]{4})-(?P<month>[0-9]{2})-(?P<day>[0-9]{2})"
    r"T(?P<hour>[0-9]{2}):(?P<minute>[0-9]{2}):(?P<second>[0-9]{2})"
    r"(?:\.(?P<fraction>[0-9]{1,6}))?Z\Z"
)

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
#: Largest epoch-seconds value that still lands inside ``datetime``'s range
#: (``9999-12-31T23:59:59Z``). ``1760000000000`` — milliseconds mistaken for
#: seconds — is well past it, which is how the "可解析範圍" half of the spec's
#: format-then-range gate bites.
#:
#: Floor division by a ``timedelta`` rather than ``int(total_seconds())``:
#: ``datetime.max`` carries 999999 microseconds, and ``total_seconds()`` returns
#: a float that rounds 253402300799.999999 up to 253402300800.0, which would
#: silently widen the range by one second.
MAX_EPOCH_SECONDS = (datetime.max.replace(tzinfo=timezone.utc) - _EPOCH) // timedelta(
    seconds=1
)
MIN_EPOCH_SECONDS = 0


# ---------------------------------------------------------------------------
# HMAC raw-body canonicalization
# ---------------------------------------------------------------------------


def canonical_signing_input(timestamp_header: str, raw_body_bytes: bytes) -> bytes:
    """Return ``exact_signature_timestamp_header + "\\n" + raw_request_body``.

    The timestamp contribution is the **exact header string**, not a reparsed
    or re-rendered integer: "Receiver MUST NOT normalize timestamp後再驗簽"
    (spec.md L152). The body contribution is the **raw bytes as sent**, not a
    re-serialization of the parsed document — two byte strings that happen to
    parse to the same JSON object have different signatures, which is the whole
    point of signing the wire form.
    """
    if not isinstance(timestamp_header, str):
        raise TypeError(
            f"{SIGNATURE_TIMESTAMP_HEADER} must be the exact header string, "
            f"got {type(timestamp_header).__name__}"
        )
    if isinstance(raw_body_bytes, str):
        raise TypeError(
            "raw_body_bytes must be the bytes that went on the wire, not str; "
            "encoding here would hide a sender/receiver encoding disagreement"
        )
    if not isinstance(raw_body_bytes, (bytes, bytearray, memoryview)):
        raise TypeError(
            f"raw_body_bytes must be bytes-like, got {type(raw_body_bytes).__name__}"
        )
    # ASCII, not UTF-8: a non-ASCII timestamp header can never be canonical, so
    # failing loudly here beats silently signing mojibake.
    return timestamp_header.encode("ascii") + SIGNATURE_SEPARATOR + bytes(raw_body_bytes)


def compute_signature(
    secret_bytes: bytes, raw_body_bytes: bytes, timestamp_header: str
) -> str:
    """Return the ``sha256=<lowercase-hex>`` header value for one request.

    ``HMAC-SHA256(secret, exact_signature_timestamp_header + "\\n" +
    raw_request_body)`` (spec.md L152).
    """
    if isinstance(secret_bytes, str):
        raise TypeError(
            "secret_bytes must be bytes; the key material's encoding is the "
            "caller's decision, never this module's"
        )
    if not isinstance(secret_bytes, (bytes, bytearray, memoryview)):
        raise TypeError(
            f"secret_bytes must be bytes-like, got {type(secret_bytes).__name__}"
        )
    digest = hmac.new(
        bytes(secret_bytes),
        canonical_signing_input(timestamp_header, raw_body_bytes),
        hashlib.sha256,
    ).hexdigest()
    return SIGNATURE_PREFIX + digest


def verify_signature(
    secret_bytes: bytes,
    raw_body_bytes: bytes,
    timestamp_header: str,
    provided_signature: Any,
) -> bool:
    """Constant-time check of a presented ``X-Lineage-Webhook-Signature``.

    "以constant-time comparison驗證raw bytes" (spec.md L152) — hence
    ``hmac.compare_digest`` rather than ``==``.
    """
    if not isinstance(provided_signature, str):
        return False
    expected = compute_signature(secret_bytes, raw_body_bytes, timestamp_header)
    return hmac.compare_digest(expected, provided_signature)


def raw_body_sha256(raw_body_bytes: bytes) -> str:
    """Lowercase SHA-256 of the raw body, as stored in the event ledger tuple."""
    if isinstance(raw_body_bytes, str):
        raise TypeError("raw_body_bytes must be bytes, not str")
    return hashlib.sha256(bytes(raw_body_bytes)).hexdigest()


def missing_required_headers(headers: Mapping[str, Any]) -> tuple[str, ...]:
    """Return the required headers that are absent or not non-empty strings.

    Header names are matched case-insensitively (HTTP field names are), but the
    canonical spelling in :data:`REQUIRED_REQUEST_HEADERS` is what gets
    reported.
    """
    if not isinstance(headers, Mapping):
        raise TypeError(f"headers must be a mapping, got {type(headers).__name__}")
    present = {
        str(name).lower(): value
        for name, value in headers.items()
        if isinstance(value, str) and value != ""
    }
    return tuple(
        name for name in REQUIRED_REQUEST_HEADERS if name.lower() not in present
    )


# ---------------------------------------------------------------------------
# Signature timestamp header
# ---------------------------------------------------------------------------


def validate_timestamp_header(value: Any) -> str | None:
    """Return ``None`` when canonical, else a ``lower_snake`` rejection code.

    Canonical means "UTC Unix epoch seconds的canonical ASCII unsigned base-10
    字串，且 SHALL 符合 ``^(?:0|[1-9][0-9]*)$``" (spec.md L152): no leading zero
    except the single ``0``, no sign, no fraction, no milliseconds, no RFC 3339.

    ``fullmatch`` rather than ``search``: ``"1760000000\\n"`` would otherwise
    pass, and ``int()`` would then happily strip the newline. For the same
    reason the regex — not ``str.isdigit`` or ``int()`` — is the gate:
    ``int("1_760_000_000")`` and ``"１７６０".isdigit()`` both succeed.

    Format is checked before range, and range before skew, because the spec
    orders them that way ("先驗證timestamp格式與可解析範圍，再以epoch seconds
    套用預設±300秒window").
    """
    if not isinstance(value, str):
        return "signature_timestamp_not_a_string"
    if _SIGNATURE_TIMESTAMP_RE.fullmatch(value) is None:
        return "signature_timestamp_not_canonical"
    seconds = int(value)
    if seconds > MAX_EPOCH_SECONDS:
        # Milliseconds-as-seconds lands here: format-valid, un-representable.
        return "signature_timestamp_out_of_range"
    return None


def parse_timestamp_header(value: Any) -> int:
    """Return the epoch seconds, raising ``ValueError`` with the reject code."""
    code = validate_timestamp_header(value)
    if code is not None:
        raise ValueError(code)
    return int(value)


def _as_epoch_seconds(value: Any) -> int:
    if isinstance(value, bool):
        raise TypeError("bool is not an epoch-seconds value")
    if isinstance(value, int):
        return value
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError(
                "naive datetime has no defined instant; pass an aware UTC datetime"
            )
        return int(value.timestamp())
    raise TypeError(
        f"expected int epoch seconds or an aware datetime, got {type(value).__name__}"
    )


def within_skew(
    header_ts: Any, now: Any, tolerance_seconds: int = DEFAULT_SKEW_SECONDS
) -> bool:
    """Return whether ``header_ts`` is inside the +/-``tolerance`` window.

    The window is **inclusive** at both edges: exactly +/-300 seconds is
    accepted, +/-301 is not. The spec says "預設±300秒window" without naming the
    boundary; inclusive is the reading that makes ``300`` the documented default
    rather than an unreachable value.
    """
    return abs(_as_epoch_seconds(header_ts) - _as_epoch_seconds(now)) <= int(
        tolerance_seconds
    )


# ---------------------------------------------------------------------------
# Wire timestamps: pattern layer and semantic layer
# ---------------------------------------------------------------------------


def validate_wire_timestamp(value: Any) -> str | None:
    """Pattern-layer gate for the four canonical wire timestamps.

    Applies ``$defs/utcTimestamp`` exactly as ``jsonschema`` does — ``re.search``
    with the shipped pattern — so callers learn what the *schema* accepts, not
    what a stricter local copy would accept. Known consequence: a single
    trailing newline slips through, because Python's ``$`` matches before it.
    :func:`parse_calendar_strict` is the compensating control.
    """
    if not isinstance(value, str):
        return "wire_timestamp_not_a_string"
    if _WIRE_TIMESTAMP_RE.search(value) is None:
        return "wire_timestamp_not_canonical"
    return None


def parse_calendar_strict(value: Any) -> datetime:
    """Semantic-layer parse of one canonical wire timestamp.

    Raises ``ValueError`` for anything a regex cannot decide or that the pattern
    layer must not be trusted alone for:

    * calendar-invalid dates (``2026-02-30``, ``2027-02-29``),
    * ``hour == 24``, ``minute == 60``, ``second == 60`` (leap second),
    * years outside ``1000-9999`` (MySQL ``DATETIME`` range),
    * more than six fractional digits — **rejected, never truncated**
      ("MUST NOT round／truncate", spec.md L47/L286),
    * trailing whitespace or newline, offsets, lowercase ``z``.

    Sub-second precision is right-zero-padded to microseconds, which is the one
    normalization the spec permits ("receiver只可右補零至microsecond").
    """
    if not isinstance(value, str):
        raise ValueError("wire_timestamp_not_a_string")
    match = _CALENDAR_RE.match(value)
    if match is None:
        raise ValueError("wire_timestamp_not_canonical")
    year = int(match.group("year"))
    month = int(match.group("month"))
    day = int(match.group("day"))
    hour = int(match.group("hour"))
    minute = int(match.group("minute"))
    second = int(match.group("second"))
    if not MIN_WIRE_YEAR <= year <= MAX_WIRE_YEAR:
        raise ValueError("wire_timestamp_year_out_of_range")
    if hour > 23:
        # 24:00:00 is a legal ISO 8601 end-of-day spelling and is still not a
        # value this contract accepts.
        raise ValueError("wire_timestamp_hour_out_of_range")
    if minute > 59:
        raise ValueError("wire_timestamp_minute_out_of_range")
    if second > 59:
        raise ValueError("wire_timestamp_leap_second")
    fraction = match.group("fraction") or ""
    microsecond = int(fraction.ljust(6, "0")) if fraction else 0
    try:
        return datetime(
            year, month, day, hour, minute, second, microsecond, tzinfo=timezone.utc
        )
    except ValueError as exc:  # 2026-02-30, 2026-04-31, ...
        raise ValueError("wire_timestamp_calendar_invalid") from exc


# ---------------------------------------------------------------------------
# Header/body event binding
# ---------------------------------------------------------------------------


def validate_event_id_binding(header_event_id: Any, body: Any) -> str | None:
    """Check ``X-Lineage-Event-Id`` against the body's ``event_id``.

    "要求header/body event IDs相符" (spec.md L152). The comparison is
    byte-exact: the UUID pattern permits either hex case, so a header and body
    that differ only in case are two different strings on the wire and are
    rejected rather than folded together.
    """
    if not isinstance(header_event_id, str):
        return "event_id_header_missing"
    if _UUID_RE.fullmatch(header_event_id) is None:
        return "event_id_header_not_a_uuid"
    if not isinstance(body, Mapping) or "event_id" not in body:
        return "event_id_body_missing"
    body_event_id = body["event_id"]
    if not isinstance(body_event_id, str):
        return "event_id_body_not_a_uuid"
    if _UUID_RE.fullmatch(body_event_id) is None:
        return "event_id_body_not_a_uuid"
    if header_event_id != body_event_id:
        return "event_id_header_body_mismatch"
    return None


# ---------------------------------------------------------------------------
# Canonical HTTP / code / retryable triples (spec.md L202)
# ---------------------------------------------------------------------------

#: "Canonical error三元組 SHALL 精確為" — nine triples, in spec.md L202 order.
#: ``openspec/changes/rvt-ifc-usdc-lineage/contracts/README.md`` L136-L146
#: restates the same nine as a table; the two agree.
HTTP_CODE_RETRYABLE_TRIPLES: tuple[tuple[int, str, bool], ...] = (
    (400, "INVALID_REQUEST", False),
    (422, "UNSUPPORTED_SCHEMA", False),
    (401, "HMAC_AUTH_FAILED", False),
    (403, "TENANT_BINDING_MISMATCH", False),
    (422, "PARENT_BINDING_NOT_FOUND", False),
    (409, "PUBLICATION_DIGEST_CONFLICT", False),
    (429, "RATE_LIMITED", True),
    (503, "TRANSIENT_UNAVAILABLE", True),
    (500, "INTERNAL_ERROR", True),
)

#: code -> HTTP status. This direction is a function; the reverse is not,
#: because 422 carries both ``UNSUPPORTED_SCHEMA`` and
#: ``PARENT_BINDING_NOT_FOUND``. Anything that classifies on status alone is
#: therefore wrong by construction.
STATUS_BY_CODE: dict[str, int] = {
    code: status for status, code, _ in HTTP_CODE_RETRYABLE_TRIPLES
}
#: code -> retryable. Not advisory: the response schema encodes the same split.
RETRYABLE_BY_CODE: dict[str, bool] = {
    code: retryable for _, code, retryable in HTTP_CODE_RETRYABLE_TRIPLES
}
#: HTTP status -> the codes it may legitimately carry.
CODES_BY_STATUS: dict[int, frozenset[str]] = {
    status: frozenset(
        code for other, code, _ in HTTP_CODE_RETRYABLE_TRIPLES if other == status
    )
    for status, _, _ in HTTP_CODE_RETRYABLE_TRIPLES
}
#: The six deterministic codes and the three transient ones.
DETERMINISTIC_ERROR_CODES = frozenset(
    code for code, retryable in RETRYABLE_BY_CODE.items() if not retryable
)
TRANSIENT_ERROR_CODES = frozenset(
    code for code, retryable in RETRYABLE_BY_CODE.items() if retryable
)


def validate_error_triple(status_code: Any, code: Any, retryable: Any) -> str | None:
    """Return ``None`` when the triple is canonical, else the reject code.

    Both cross-swaps are caught: a code paired with another triple's HTTP status
    (``error_code_contradicts_http_status``) and a code paired with the wrong
    ``retryable`` (``error_retryable_contradicts_code``). The retryable check
    runs first because it is the one the *response schema* also enforces; a
    body that fails it never reaches transport classification.
    """
    if not isinstance(code, str) or code not in STATUS_BY_CODE:
        return "error_code_unknown"
    if not isinstance(retryable, bool):
        return "error_retryable_not_a_boolean"
    if RETRYABLE_BY_CODE[code] != retryable:
        return "error_retryable_contradicts_code"
    if not isinstance(status_code, int) or isinstance(status_code, bool):
        return "error_status_not_an_integer"
    if STATUS_BY_CODE[code] != status_code:
        return "error_code_contradicts_http_status"
    return None


def is_retryable_transport_status(status_code: int) -> bool:
    """"Network errors、timeouts、``408``、``429``與``5xx`` SHALL 可retry"."""
    return status_code in (408, 429) or 500 <= status_code < 600


# ---------------------------------------------------------------------------
# ACK classification (spec.md L198-L200)
# ---------------------------------------------------------------------------

#: The success ACK "SHALL 精確包含" exactly these six members.
SUCCESS_ACK_MEMBERS = frozenset(
    {
        "registration_id",
        "event_id",
        "publication_identity",
        "manifest_digest",
        "stored_at",
        "replay",
    }
)
#: The sanitized error body: ``error`` required, ``event_id`` optional.
ERROR_BODY_MEMBERS = frozenset({"error", "event_id"})
ERROR_MEMBERS = frozenset({"code", "message", "retryable"})

OUTCOME_DELIVERED = "delivered"
OUTCOME_ERROR = "error"
OUTCOME_PROTOCOL_FAILURE = "protocol_failure"
OUTCOME_TRANSPORT_FAILURE = "transport_failure"


class AckClassification(NamedTuple):
    """What the sender may conclude from one response."""

    outcome: str
    detail: str
    delivered: bool
    retryable: bool | None


def _protocol_failure(detail: str) -> AckClassification:
    return AckClassification(OUTCOME_PROTOCOL_FAILURE, detail, False, False)


def validate_success_ack_shape(body: Any) -> str | None:
    """Structural check of a success ACK, independent of HTTP status."""
    if not isinstance(body, Mapping):
        return "ack_body_not_an_object"
    if set(body) != SUCCESS_ACK_MEMBERS:
        return "ack_body_member_set_mismatch"
    registration_id = body["registration_id"]
    if not isinstance(registration_id, str) or not 1 <= len(registration_id) <= 200:
        return "ack_registration_id_invalid"
    if not isinstance(body["event_id"], str) or _UUID_RE.fullmatch(
        body["event_id"]
    ) is None:
        return "ack_event_id_not_a_uuid"
    identity = body["publication_identity"]
    if (
        not isinstance(identity, str)
        or not 1 <= len(identity) <= 522
        or _PUBLICATION_IDENTITY_RE.fullmatch(identity) is None
    ):
        return "ack_publication_identity_not_canonical"
    if not isinstance(body["manifest_digest"], str) or _SHA256_RE.fullmatch(
        body["manifest_digest"]
    ) is None:
        return "ack_manifest_digest_not_sha256"
    if validate_wire_timestamp(body["stored_at"]) is not None:
        return "ack_stored_at_not_canonical"
    try:
        parse_calendar_strict(body["stored_at"])
    except ValueError:
        return "ack_stored_at_not_canonical"
    if not isinstance(body["replay"], bool):
        return "ack_replay_not_a_boolean"
    return None


def compare_ack_identity(body: Mapping[str, Any], expected: Mapping[str, Any]) -> str | None:
    """Byte-exact comparison of the ACK's identity fields against the sent event.

    "回傳的event/publication/digest values與送出的event完全一致時" (spec.md
    L200). Only the keys present in ``expected`` are compared, so a caller can
    assert on a subset.
    """
    for key, failure in (
        ("event_id", "ack_event_id_mismatch"),
        ("publication_identity", "ack_publication_identity_mismatch"),
        ("manifest_digest", "ack_manifest_digest_mismatch"),
    ):
        if key in expected and body.get(key) != expected[key]:
            return failure
    return None


def classify_error_body(status_code: int, body: Any) -> AckClassification:
    """Classify a sanitized error response against the canonical triples."""
    if not isinstance(body, Mapping):
        return _protocol_failure("error_body_not_an_object")
    if not set(body) <= ERROR_BODY_MEMBERS or "error" not in body:
        return _protocol_failure("error_body_member_set_mismatch")
    event_id_problem = validate_error_event_id(body)
    if event_id_problem is not None:
        return _protocol_failure(event_id_problem)
    error = body["error"]
    if not isinstance(error, Mapping) or set(error) != ERROR_MEMBERS:
        return _protocol_failure("error_member_set_mismatch")
    message = error["message"]
    if not isinstance(message, str) or not 1 <= len(message) <= 500:
        return _protocol_failure("error_message_invalid")
    problem = validate_error_triple(status_code, error["code"], error["retryable"])
    if problem is not None:
        return _protocol_failure(problem)
    return AckClassification(
        OUTCOME_ERROR, error["code"], False, RETRYABLE_BY_CODE[error["code"]]
    )


def classify_ack(
    status_code: Any, body: Any, *, expected: Mapping[str, Any] | None = None
) -> AckClassification:
    """Classify one response from the Cloud Ingest endpoint.

    "Sender SHALL 只在status為``200``或``201``、body符合response schema，且回傳的
    event/publication/digest values與送出的event完全一致時，將狀態標記為
    ``DELIVERED``。HTTP ``202``、empty/malformed body、unexpected 2xx與
    mismatched ACK SHALL 視為protocol failure" (spec.md L200).

    ``202`` gets its own detail string rather than being folded into
    ``unexpected_2xx``: the spec names it explicitly, and an operator reading
    ``unexpected_2xx`` would go looking for a bug that is really a receiver
    accepting asynchronously.
    """
    if not isinstance(status_code, int) or isinstance(status_code, bool):
        return _protocol_failure("status_code_not_an_integer")

    if status_code in (200, 201):
        problem = validate_success_ack_shape(body)
        if problem is not None:
            return _protocol_failure(problem)
        # 201 is the first commit, 200 is the exact replay; the flag and the
        # status carry the same fact and must not disagree.
        expected_replay = status_code == 200
        if body["replay"] is not expected_replay:
            return _protocol_failure("replay_flag_contradicts_status")
        if expected is not None:
            mismatch = compare_ack_identity(body, expected)
            if mismatch is not None:
                return _protocol_failure(mismatch)
        return AckClassification(
            OUTCOME_DELIVERED, "created" if status_code == 201 else "replay", True, None
        )

    if 200 <= status_code < 300:
        return _protocol_failure(
            "status_202_is_not_an_ack" if status_code == 202 else "unexpected_2xx"
        )

    if status_code in CODES_BY_STATUS:
        return classify_error_body(status_code, body)

    # 408, network-level failures and anything else off the canonical table:
    # a transport outcome, retryable per the transport rule, never DELIVERED.
    return AckClassification(
        OUTCOME_TRANSPORT_FAILURE,
        "unmapped_status",
        False,
        is_retryable_transport_status(status_code),
    )


# ---------------------------------------------------------------------------
# Pre-validation error bodies (spec.md L204)
# ---------------------------------------------------------------------------


def validate_error_event_id(payload: Any) -> str | None:
    """Enforce the pre-validation ``event_id`` rule on a sanitized error body.

    "當request的``event_id``缺失、格式錯誤，或因解析／驗證失敗而尚不可採信時,
    MAY 省略``event_id``。Receiver MUST NOT 捏造ID；若有提供，``event_id``
    SHALL 是從已解析request context取得的有效UUID" (spec.md L204).

    So: absent is fine, present-and-valid is fine, and everything else — null,
    empty string, a non-UUID, a UUID with a trailing newline — is a violation.
    ``fullmatch`` closes the newline hole the schema's ``$``-anchored pattern
    leaves open.
    """
    if not isinstance(payload, Mapping):
        return "error_body_not_an_object"
    if "event_id" not in payload:
        return None
    value = payload["event_id"]
    if not isinstance(value, str):
        return "error_event_id_not_a_string"
    if _UUID_RE.fullmatch(value) is None:
        return "error_event_id_not_a_uuid"
    return None


__all__: Sequence[str] = (
    "AckClassification",
    "CODES_BY_STATUS",
    "DEFAULT_SKEW_SECONDS",
    "DETERMINISTIC_ERROR_CODES",
    "ERROR_BODY_MEMBERS",
    "ERROR_MEMBERS",
    "EVENT_ID_HEADER",
    "HTTP_CODE_RETRYABLE_TRIPLES",
    "MAX_EPOCH_SECONDS",
    "MAX_WIRE_YEAR",
    "MIN_EPOCH_SECONDS",
    "MIN_WIRE_YEAR",
    "OUTCOME_DELIVERED",
    "OUTCOME_ERROR",
    "OUTCOME_PROTOCOL_FAILURE",
    "OUTCOME_TRANSPORT_FAILURE",
    "PUBLICATION_IDENTITY_PATTERN",
    "REQUIRED_REQUEST_HEADERS",
    "RETRYABLE_BY_CODE",
    "SHA256_PATTERN",
    "SIGNATURE_KEY_ID_HEADER",
    "SIGNATURE_PREFIX",
    "SIGNATURE_SEPARATOR",
    "SIGNATURE_TIMESTAMP_HEADER",
    "SIGNATURE_TIMESTAMP_PATTERN",
    "STATUS_BY_CODE",
    "SUCCESS_ACK_MEMBERS",
    "TRANSIENT_ERROR_CODES",
    "UUID_PATTERN",
    "WEBHOOK_SIGNATURE_HEADER",
    "WIRE_TIMESTAMP_PATTERN",
    "canonical_signing_input",
    "classify_ack",
    "classify_error_body",
    "compare_ack_identity",
    "compute_signature",
    "is_retryable_transport_status",
    "missing_required_headers",
    "parse_calendar_strict",
    "parse_timestamp_header",
    "raw_body_sha256",
    "validate_error_event_id",
    "validate_error_triple",
    "validate_event_id_binding",
    "validate_success_ack_shape",
    "validate_timestamp_header",
    "validate_wire_timestamp",
    "verify_signature",
    "within_skew",
)
