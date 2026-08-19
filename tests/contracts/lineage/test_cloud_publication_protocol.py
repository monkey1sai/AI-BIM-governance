"""Executable contract tests for the cloud lineage publication wire protocol.

Covers ``openspec/changes/rvt-ifc-usdc-lineage/tasks.md`` task 2.6. Where
``test_lineage_contracts.py`` (2.1-2.4) tests the five edge documents, this
module tests the transport that carries them across the edge/cloud boundary:

* HMAC-SHA256 over ``timestamp header + "\\n" + raw body``, signed on the raw
  bytes rather than a re-serialization;
* the canonical unsigned decimal Unix-seconds signature timestamp header, and
  the rejection of every non-canonical spelling;
* the +/-300 second skew window, applied only after format and range;
* header/body ``event_id`` binding;
* ``201``/``200`` ACK acceptance and ``202``/malformed/mismatched protocol
  failure;
* the four canonical wire timestamp paths, each proven to be rejected by
  ``pattern`` on a validator with **no** format plugin loaded;
* a table-driven timestamp validity corpus, split across the pattern layer and
  the calendar-strict semantic layer;
* the nine canonical HTTP/code/retryable triples plus status/code cross-swaps;
* the pre-validation error ``event_id`` rule;
* the MySQL 8.0.16+ reference DDL staying ``REFERENCE ONLY``.

Run with::

    .\\.venv\\Scripts\\python.exe -m pytest tests/contracts/lineage -q -p no:cacheprovider

CI job: ``root contracts and fakes`` in ``.github/workflows/ci.yml``, which
installs only ``pytest`` and ``jsonschema`` — so this module imports the
standard library plus those two and nothing else.

Structural notes, inherited from ``test_lineage_contracts.py``:

* ``protocol_validators.py`` is loaded through
  ``importlib.util.spec_from_file_location`` because the lineage contract
  directory intentionally ships no ``__init__.py`` (blueprint E-6).
* Validators are built **without** a ``format_checker``. ``format: date-time``
  stays an annotation; every timestamp rejection is carried by ``pattern``.
  :func:`test_format_annotation_is_inert_without_a_plugin` proves the premise
  rather than assuming it.
* Anything under ``openspec/changes/`` is guarded with ``skipif`` so the suite
  degrades to skips, never to false reds, after the change is archived (E-12).

No real credential appears here. The HMAC vectors use a fixed dummy secret
string that exists only in the fixture.
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE = Path(__file__).resolve().parent            # tests/contracts/lineage
_CONTRACTS_DIR = _HERE.parent                      # tests/contracts
_REPO_ROOT = _CONTRACTS_DIR.parent.parent          # repository root
_PROTOCOL_FIXTURES_DIR = _HERE / "fixtures" / "protocol"
_PROTOCOL_VALIDATORS_PATH = _HERE / "protocol_validators.py"

_CHANGE_DIR = _REPO_ROOT / "openspec" / "changes" / "rvt-ifc-usdc-lineage"
_CHANGE_CONTRACTS_DIR = _CHANGE_DIR / "contracts"
_EXAMPLES_DIR = _CHANGE_CONTRACTS_DIR / "examples"
_CLOUD_REQUEST_SCHEMA_PATH = (
    _CHANGE_CONTRACTS_DIR / "cloud-lineage-publication-request-v1.schema.json"
)
_CLOUD_RESPONSE_SCHEMA_PATH = (
    _CHANGE_CONTRACTS_DIR / "cloud-lineage-publication-response-v1.schema.json"
)
_MYSQL_REFERENCE_PATH = (
    _CHANGE_CONTRACTS_DIR / "cloud-lineage-publication-mysql8-reference.sql"
)


# ---------------------------------------------------------------------------
# protocol_validators.py, loaded without a package (blueprint E-6)
# ---------------------------------------------------------------------------


def _load_protocol_validators():
    spec = importlib.util.spec_from_file_location(
        "lineage_protocol_validators", _PROTOCOL_VALIDATORS_PATH
    )
    if spec is None or spec.loader is None:
        raise ImportError(
            f"cannot build a module spec for {_PROTOCOL_VALIDATORS_PATH}; "
            "the lineage contract directory ships no __init__.py on purpose, "
            "so the file must be loadable by path"
        )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


pv = _load_protocol_validators()


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


_HMAC_VECTORS = _read_json(_PROTOCOL_FIXTURES_DIR / "hmac-signing-vectors.json")
_ACK_CASES = _read_json(_PROTOCOL_FIXTURES_DIR / "ack-classification-cases.json")

#: Test-only dummy. The real secret lives in
#: ``CLOUD_LINEAGE_PUBLICATION_HMAC_SECRET`` on the coordinator host and is
#: never committed, logged or echoed (spec.md L154).
DUMMY_SECRET = _HMAC_VECTORS["secret_utf8"].encode("utf-8")
_VECTORS_BY_NAME = {vector["name"]: vector for vector in _HMAC_VECTORS["vectors"]}

requires_change_contracts = pytest.mark.skipif(
    not (_CLOUD_REQUEST_SCHEMA_PATH.exists() and _CLOUD_RESPONSE_SCHEMA_PATH.exists()),
    reason=f"change contracts not present under {_CHANGE_CONTRACTS_DIR}",
)
requires_mysql_reference = pytest.mark.skipif(
    not _MYSQL_REFERENCE_PATH.exists(),
    reason=f"change reference DDL not present: {_MYSQL_REFERENCE_PATH}",
)

_SCHEMA_VALIDATOR_CACHE: dict[str, Draft202012Validator] = {}

_SCHEMA_PATHS = {
    "request": _CLOUD_REQUEST_SCHEMA_PATH,
    "response": _CLOUD_RESPONSE_SCHEMA_PATH,
}


def change_validator(kind: str) -> Draft202012Validator:
    """Return a cached, **format-plugin-free** validator for a change schema."""
    if kind not in _SCHEMA_VALIDATOR_CACHE:
        schema = _read_json(_SCHEMA_PATHS[kind])
        Draft202012Validator.check_schema(schema)
        # No ``format_checker=``. This is the whole premise of task 2.6.
        _SCHEMA_VALIDATOR_CACHE[kind] = Draft202012Validator(schema)
    return _SCHEMA_VALIDATOR_CACHE[kind]


def example(name: str) -> Any:
    return _read_json(_EXAMPLES_DIR / name)


def _iter_leaf_errors(errors) -> Iterator[ValidationError]:
    """Flatten a jsonschema error tree down to its leaves.

    ``oneOf`` nests the real cause inside ``context``; a test that only looks
    at the top-level error learns that "the union failed" and nothing else.
    """
    for error in errors:
        if error.context:
            yield from _iter_leaf_errors(error.context)
        else:
            yield error


def _pointer(error: ValidationError) -> str:
    """RFC 6901 pointer for an error's instance path (root is ``""``)."""
    return "".join(f"/{part}" for part in error.absolute_path)


def _set_at(document: Any, pointer_parts: tuple[str, ...], value: Any) -> None:
    target = document
    for part in pointer_parts[:-1]:
        target = target[part]
    target[pointer_parts[-1]] = value


# ===========================================================================
# 1. HMAC raw-body canonicalization (spec.md L152)
# ===========================================================================


def test_signature_matches_the_independently_generated_golden_vector():
    """``HMAC-SHA256(secret, timestamp + "\\n" + raw body)``, hex, ``sha256=``.

    The golden in ``fixtures/protocol/hmac-signing-vectors.json`` was produced
    by a literal transcription of spec.md L152, not by the function under test,
    so a silent change to the concatenation order or the separator fails here.
    """
    vector = _VECTORS_BY_NAME["canonical_body"]
    actual = pv.compute_signature(
        DUMMY_SECRET,
        vector["raw_body_utf8"].encode("utf-8"),
        vector["signature_timestamp"],
    )
    assert actual == vector["signature"]
    assert actual.startswith("sha256=")
    hexdigest = actual[len("sha256=") :]
    assert len(hexdigest) == 64
    assert hexdigest == hexdigest.lower()


@pytest.mark.parametrize("name", sorted(_VECTORS_BY_NAME))
def test_every_hmac_golden_vector_reproduces(name: str):
    vector = _VECTORS_BY_NAME[name]
    assert (
        pv.compute_signature(
            DUMMY_SECRET,
            vector["raw_body_utf8"].encode("utf-8"),
            vector["signature_timestamp"],
        )
        == vector["signature"]
    )


def test_canonical_signing_input_is_timestamp_newline_raw_body():
    assert (
        pv.canonical_signing_input("1760000000", b'{"a":1}')
        == b'1760000000\n{"a":1}'
    )


def test_signature_is_over_raw_bytes_not_a_reparsed_document():
    """Three byte strings, one JSON document, three different signatures.

    "Sender先serialize一次body，再以同一raw bytes簽名與傳送" — if either side
    re-serialized the parsed document before signing, these would collide and
    a proxy could reorder members without invalidating the signature.
    """
    names = ("canonical_body", "reordered_keys_same_json", "respaced_same_json")
    documents = [json.loads(_VECTORS_BY_NAME[n]["raw_body_utf8"]) for n in names]
    assert documents[0] == documents[1] == documents[2], (
        "the fixture bodies must parse to the same document, otherwise this "
        "test proves nothing about raw-body signing"
    )
    raw = [_VECTORS_BY_NAME[n]["raw_body_utf8"].encode("utf-8") for n in names]
    assert len({bytes(value) for value in raw}) == 3
    signatures = {
        pv.compute_signature(DUMMY_SECRET, value, "1760000000") for value in raw
    }
    assert len(signatures) == 3


def test_signature_rejects_a_body_tampered_after_signing():
    canonical = _VECTORS_BY_NAME["canonical_body"]
    tampered = _VECTORS_BY_NAME["tampered_body"]
    assert pv.verify_signature(
        DUMMY_SECRET,
        canonical["raw_body_utf8"].encode("utf-8"),
        canonical["signature_timestamp"],
        canonical["signature"],
    )
    assert not pv.verify_signature(
        DUMMY_SECRET,
        tampered["raw_body_utf8"].encode("utf-8"),
        canonical["signature_timestamp"],
        canonical["signature"],
    )


def test_signature_covers_the_timestamp_header():
    """Advancing the header by one second must change the signature."""
    first = _VECTORS_BY_NAME["canonical_body"]
    second = _VECTORS_BY_NAME["canonical_body_next_second"]
    assert first["raw_body_utf8"] == second["raw_body_utf8"]
    assert first["signature"] != second["signature"]
    assert not pv.verify_signature(
        DUMMY_SECRET,
        second["raw_body_utf8"].encode("utf-8"),
        second["signature_timestamp"],
        first["signature"],
    )


def test_receiver_must_not_normalize_the_timestamp_before_verifying():
    """"Receiver MUST NOT normalize timestamp後再驗簽" (spec.md L152, L176).

    A receiver that "helpfully" stripped the leading zero from
    ``01760000000`` and re-signed would accept a header the format gate has
    already refused. Two independent guards: the signatures differ, and
    :func:`validate_timestamp_header` rejects the non-canonical spelling before
    any signature work happens.
    """
    canonical = _VECTORS_BY_NAME["canonical_body"]
    leading_zero = _VECTORS_BY_NAME["canonical_body_leading_zero_timestamp"]
    assert canonical["raw_body_utf8"] == leading_zero["raw_body_utf8"]
    assert canonical["signature"] != leading_zero["signature"]
    assert int(leading_zero["signature_timestamp"]) == int(
        canonical["signature_timestamp"]
    ), "the two headers denote the same instant; only the spelling differs"
    assert (
        pv.validate_timestamp_header(leading_zero["signature_timestamp"])
        == "signature_timestamp_not_canonical"
    )


def test_signature_comparison_is_constant_time():
    """"以constant-time comparison驗證raw bytes" (spec.md L152).

    Timing cannot be asserted from a unit test, so the guard is structural:
    ``verify_signature`` must route through ``hmac.compare_digest`` rather than
    ``==``, which leaks a prefix-length oracle.
    """
    source = inspect.getsource(pv.verify_signature)
    # The docstring names ``hmac.compare_digest`` too, so it has to come out
    # before the check — otherwise the test passes on its own prose.
    body = source.replace(pv.verify_signature.__doc__ or "", "")
    assert "hmac.compare_digest(" in body, (
        "verify_signature no longer routes through hmac.compare_digest; a plain "
        "== on the hex digest leaks a prefix-length timing oracle"
    )
    assert " == " not in body and " != " not in body, (
        "verify_signature compares with an operator somewhere; the signature "
        "comparison must be constant-time end to end"
    )
    canonical = _VECTORS_BY_NAME["canonical_body"]
    almost = canonical["signature"][:-1] + ("0" if canonical["signature"][-1] != "0" else "1")
    assert not pv.verify_signature(
        DUMMY_SECRET,
        canonical["raw_body_utf8"].encode("utf-8"),
        canonical["signature_timestamp"],
        almost,
    )


@pytest.mark.parametrize(
    "provided",
    [
        None,
        b"sha256=deadbeef",
        1760000000,
        "",
        "deadbeef",
    ],
    ids=["none", "bytes", "int", "empty", "unprefixed_hex"],
)
def test_signature_verification_rejects_non_string_or_unprefixed_values(provided: Any):
    canonical = _VECTORS_BY_NAME["canonical_body"]
    assert not pv.verify_signature(
        DUMMY_SECRET,
        canonical["raw_body_utf8"].encode("utf-8"),
        canonical["signature_timestamp"],
        provided,
    )


@pytest.mark.parametrize(
    "secret,raw_body,timestamp",
    [
        ("test-secret-0000", b"{}", "1760000000"),
        (b"test-secret-0000", "{}", "1760000000"),
        (b"test-secret-0000", b"{}", 1760000000),
    ],
    ids=["str_secret", "str_body", "int_timestamp"],
)
def test_signing_refuses_to_guess_an_encoding(secret: Any, raw_body: Any, timestamp: Any):
    """A silent ``str`` -> ``bytes`` guess is how sender and receiver drift apart."""
    with pytest.raises(TypeError):
        pv.compute_signature(secret, raw_body, timestamp)


def test_required_request_headers_are_the_four_named_by_the_spec():
    assert pv.REQUIRED_REQUEST_HEADERS == (
        "X-Lineage-Event-Id",
        "X-Lineage-Signature-Timestamp",
        "X-Lineage-Signature-Key-Id",
        "X-Lineage-Webhook-Signature",
    )


def test_missing_required_headers_is_reported_case_insensitively():
    complete = {
        "x-lineage-event-id": "11111111-1111-4111-8111-111111111111",
        "X-Lineage-Signature-Timestamp": "1760000000",
        "x-lineage-signature-key-id": "key-2026-07",
        "X-Lineage-Webhook-Signature": "sha256=" + "0" * 64,
    }
    assert pv.missing_required_headers(complete) == ()
    without_key_id = {k: v for k, v in complete.items() if "key-id" not in k.lower()}
    assert pv.missing_required_headers(without_key_id) == (
        "X-Lineage-Signature-Key-Id",
    )
    blank = dict(complete, **{"X-Lineage-Webhook-Signature": ""})
    assert pv.missing_required_headers(blank) == ("X-Lineage-Webhook-Signature",)


def test_raw_body_sha256_is_lowercase_hex():
    digest = pv.raw_body_sha256(b'{"a":1}')
    assert len(digest) == 64 and digest == digest.lower()
    assert digest != pv.raw_body_sha256(b'{"a": 1}')


# ===========================================================================
# 2. Header/body event binding (spec.md L152)
# ===========================================================================

_UUID_A = "11111111-1111-4111-8111-111111111111"
_UUID_B = "22222222-2222-4222-8222-222222222222"

_EVENT_BINDING_CASES = (
    ("match", _UUID_A, {"event_id": _UUID_A}, None),
    ("mismatch", _UUID_A, {"event_id": _UUID_B}, "event_id_header_body_mismatch"),
    (
        "case_differs",
        "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        {"event_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"},
        "event_id_header_body_mismatch",
    ),
    ("header_absent", None, {"event_id": _UUID_A}, "event_id_header_missing"),
    ("header_empty", "", {"event_id": _UUID_A}, "event_id_header_not_a_uuid"),
    ("header_not_uuid", "event-7", {"event_id": _UUID_A}, "event_id_header_not_a_uuid"),
    (
        "header_trailing_newline",
        _UUID_A + "\n",
        {"event_id": _UUID_A},
        "event_id_header_not_a_uuid",
    ),
    ("body_absent", _UUID_A, {}, "event_id_body_missing"),
    ("body_not_a_mapping", _UUID_A, [], "event_id_body_missing"),
    ("body_null", _UUID_A, {"event_id": None}, "event_id_body_not_a_uuid"),
    ("body_not_uuid", _UUID_A, {"event_id": "event-7"}, "event_id_body_not_a_uuid"),
)


@pytest.mark.parametrize(
    "header,body,expected",
    [case[1:] for case in _EVENT_BINDING_CASES],
    ids=[case[0] for case in _EVENT_BINDING_CASES],
)
def test_event_id_header_must_match_the_body(header: Any, body: Any, expected: Any):
    assert pv.validate_event_id_binding(header, body) == expected


@requires_change_contracts
def test_event_id_binding_uses_the_shipped_published_example():
    document = example("valid-lineage-result-published.json")
    assert pv.validate_event_id_binding(document["event_id"], document) is None
    assert (
        pv.validate_event_id_binding(_UUID_B, document)
        == "event_id_header_body_mismatch"
    )


# ===========================================================================
# 3. Canonical signature timestamp header (spec.md L152, L172-L176)
# ===========================================================================

_TIMESTAMP_HEADER_CASES = (
    # (id, header value, expected reject code or None)
    ("zero", "0", None),
    ("one", "1", None),
    ("typical", "1760000000", None),
    ("max_representable", "253402300799", None),
    ("leading_zero", "01760000000", "signature_timestamp_not_canonical"),
    ("double_zero", "00", "signature_timestamp_not_canonical"),
    ("plus_sign", "+1760000000", "signature_timestamp_not_canonical"),
    ("minus_sign", "-1760000000", "signature_timestamp_not_canonical"),
    ("fraction", "1760000000.0", "signature_timestamp_not_canonical"),
    ("trailing_dot", "1760000000.", "signature_timestamp_not_canonical"),
    ("rfc3339", "2026-07-16T08:15:30Z", "signature_timestamp_not_canonical"),
    ("empty", "", "signature_timestamp_not_canonical"),
    ("leading_space", " 1760000000", "signature_timestamp_not_canonical"),
    ("trailing_space", "1760000000 ", "signature_timestamp_not_canonical"),
    # ``$`` matches before a trailing newline; ``fullmatch`` does not, and
    # ``int("1760000000\n")`` would have swallowed it.
    ("trailing_newline", "1760000000\n", "signature_timestamp_not_canonical"),
    # ``int()`` accepts underscore separators.
    ("underscores", "1_760_000_000", "signature_timestamp_not_canonical"),
    # ``str.isdigit()`` is True for both of these.
    ("fullwidth_digits", "１７６０００００００", "signature_timestamp_not_canonical"),
    ("arabic_indic_digits", "١٧٦٠٠٠٠٠٠٠", "signature_timestamp_not_canonical"),
    ("hex", "0x68c9c500", "signature_timestamp_not_canonical"),
    ("scientific", "1e9", "signature_timestamp_not_canonical"),
    # Format-valid, un-representable: milliseconds mistaken for seconds.
    ("milliseconds", "1760000000000", "signature_timestamp_out_of_range"),
    ("one_past_max", "253402300800", "signature_timestamp_out_of_range"),
    ("int_not_str", 1760000000, "signature_timestamp_not_a_string"),
    ("none", None, "signature_timestamp_not_a_string"),
    ("bool", True, "signature_timestamp_not_a_string"),
    ("bytes", b"1760000000", "signature_timestamp_not_a_string"),
)


@pytest.mark.parametrize(
    "value,expected",
    [case[1:] for case in _TIMESTAMP_HEADER_CASES],
    ids=[case[0] for case in _TIMESTAMP_HEADER_CASES],
)
def test_signature_timestamp_header_validity(value: Any, expected: Any):
    assert pv.validate_timestamp_header(value) == expected


def test_signature_timestamp_pattern_is_the_spec_regex_verbatim():
    assert pv.SIGNATURE_TIMESTAMP_PATTERN == r"^(?:0|[1-9][0-9]*)$"


def test_parse_timestamp_header_raises_with_the_reject_code():
    assert pv.parse_timestamp_header("1760000000") == 1760000000
    with pytest.raises(ValueError, match="signature_timestamp_not_canonical"):
        pv.parse_timestamp_header("01760000000")
    with pytest.raises(ValueError, match="signature_timestamp_out_of_range"):
        pv.parse_timestamp_header("1760000000000")


# ===========================================================================
# 4. +/-300 second skew window (spec.md L152)
# ===========================================================================

_NOW = 1760000000

_SKEW_CASES = (
    ("same_second", _NOW, True),
    ("one_second_early", _NOW - 1, True),
    ("one_second_late", _NOW + 1, True),
    ("exactly_minus_300", _NOW - 300, True),
    ("exactly_plus_300", _NOW + 300, True),
    ("minus_301", _NOW - 301, False),
    ("plus_301", _NOW + 301, False),
    ("an_hour_early", _NOW - 3600, False),
)


@pytest.mark.parametrize(
    "header_ts,expected",
    [case[1:] for case in _SKEW_CASES],
    ids=[case[0] for case in _SKEW_CASES],
)
def test_default_skew_window_is_plus_minus_300_seconds(header_ts: int, expected: bool):
    assert pv.within_skew(header_ts, _NOW) is expected
    assert pv.within_skew(header_ts, _NOW, pv.DEFAULT_SKEW_SECONDS) is expected


def test_default_skew_constant_is_300():
    assert pv.DEFAULT_SKEW_SECONDS == 300


def test_skew_window_is_inclusive_at_both_edges():
    """Documented reading of "預設±300秒window": 300 in, 301 out.

    Recorded explicitly because the spec does not name the boundary, and an
    exclusive reading would make the documented default unreachable.
    """
    assert pv.within_skew(_NOW + 300, _NOW) is True
    assert pv.within_skew(_NOW - 300, _NOW) is True
    assert pv.within_skew(_NOW + 301, _NOW) is False
    assert pv.within_skew(_NOW - 301, _NOW) is False


def test_skew_accepts_an_aware_datetime_for_now():
    now = datetime(2025, 10, 9, 8, 53, 20, tzinfo=timezone.utc)
    assert int(now.timestamp()) == _NOW
    assert pv.within_skew(_NOW + 299, now) is True
    assert pv.within_skew(_NOW + 301, now) is False


def test_skew_refuses_a_naive_datetime():
    with pytest.raises(ValueError):
        pv.within_skew(_NOW, datetime(2025, 10, 9, 7, 33, 20))


def test_format_and_range_are_checked_before_skew():
    """Ordering is normative: "先驗證timestamp格式與可解析範圍，再...套用±300秒".

    ``01760000000`` denotes an instant inside the window. A receiver that ran
    the skew check first — or that parsed with ``int()`` before validating —
    would accept a header the format gate exists to refuse.
    """
    assert (
        pv.validate_timestamp_header("01760000000")
        == "signature_timestamp_not_canonical"
    )
    assert pv.within_skew(int("01760000000"), _NOW) is True, (
        "sanity: the malformed header really is inside the window, so only the "
        "format gate can be what rejects it"
    )


# ===========================================================================
# 5. Wire timestamps: pattern layer, then calendar-strict semantic layer
# ===========================================================================

# (id, value, pattern reject code or None, calendar-parseable)
_WIRE_TIMESTAMP_CASES = (
    ("no_fraction", "2026-07-16T08:15:30Z", None, True),
    ("one_fraction_digit", "2026-07-16T08:15:30.1Z", None, True),
    ("six_fraction_digits", "2026-07-16T08:15:30.123456Z", None, True),
    ("six_zero_fraction_digits", "2026-07-16T08:15:30.000000Z", None, True),
    ("min_year", "1000-01-01T00:00:00Z", None, True),
    ("max_instant", "9999-12-31T23:59:59.999999Z", None, True),
    ("leap_day_in_leap_year", "2028-02-29T00:00:00Z", None, True),
    ("lowercase_z", "2026-07-16T08:15:30z", "wire_timestamp_not_canonical", False),
    ("year_0999", "0999-07-16T08:15:30.000Z", "wire_timestamp_not_canonical", False),
    ("hour_24", "2026-07-16T24:00:00Z", "wire_timestamp_not_canonical", False),
    ("minute_60", "2026-07-16T08:60:30Z", "wire_timestamp_not_canonical", False),
    ("second_60_leap", "2026-07-16T08:15:60Z", "wire_timestamp_not_canonical", False),
    (
        "seven_fraction_digits",
        "2026-07-16T08:15:30.1234567Z",
        "wire_timestamp_not_canonical",
        False,
    ),
    ("offset", "2026-07-16T16:15:30+08:00", "wire_timestamp_not_canonical", False),
    (
        "offset_with_fraction",
        "2026-07-16T17:19:30.000+08:00",
        "wire_timestamp_not_canonical",
        False,
    ),
    ("zero_offset", "2026-07-16T08:15:30+00:00", "wire_timestamp_not_canonical", False),
    ("no_zone", "2026-07-16T08:15:30", "wire_timestamp_not_canonical", False),
    ("space_separator", "2026-07-16 08:15:30Z", "wire_timestamp_not_canonical", False),
    ("month_13", "2026-13-01T00:00:00Z", "wire_timestamp_not_canonical", False),
    ("month_00", "2026-00-01T00:00:00Z", "wire_timestamp_not_canonical", False),
    ("day_00", "2026-07-00T00:00:00Z", "wire_timestamp_not_canonical", False),
    ("day_32", "2026-07-32T00:00:00Z", "wire_timestamp_not_canonical", False),
    ("empty_fraction", "2026-07-16T08:15:30.Z", "wire_timestamp_not_canonical", False),
    ("empty", "", "wire_timestamp_not_canonical", False),
    ("not_a_string", None, "wire_timestamp_not_a_string", False),
    # Pattern-valid, calendar-invalid: only the semantic parser can reject.
    ("feb_30", "2026-02-30T00:00:00Z", None, False),
    ("feb_29_non_leap", "2027-02-29T00:00:00Z", None, False),
    ("april_31", "2026-04-31T00:00:00Z", None, False),
    ("november_31", "2026-11-31T00:00:00Z", None, False),
    # Pattern-valid because ``$`` tolerates one trailing newline. Known gap;
    # see test_wire_timestamp_pattern_tolerates_one_trailing_newline.
    ("trailing_newline", "2026-07-16T08:15:30Z\n", None, False),
)


@pytest.mark.parametrize(
    "value,pattern_code,calendar_ok",
    [case[1:] for case in _WIRE_TIMESTAMP_CASES],
    ids=[case[0] for case in _WIRE_TIMESTAMP_CASES],
)
def test_wire_timestamp_validity_table(
    value: Any, pattern_code: Any, calendar_ok: bool
):
    """One table, two layers: what ``pattern`` decides and what it cannot."""
    assert pv.validate_wire_timestamp(value) == pattern_code
    if calendar_ok:
        parsed = pv.parse_calendar_strict(value)
        assert parsed.tzinfo == timezone.utc
    else:
        with pytest.raises(ValueError):
            pv.parse_calendar_strict(value)


@requires_change_contracts
@pytest.mark.parametrize(
    "value,pattern_code,calendar_ok",
    [case[1:] for case in _WIRE_TIMESTAMP_CASES if isinstance(case[1], str)],
    ids=[case[0] for case in _WIRE_TIMESTAMP_CASES if isinstance(case[1], str)],
)
def test_wire_timestamp_table_agrees_with_the_shipped_schema(
    value: str, pattern_code: Any, calendar_ok: bool
):
    """The local pattern copy must decide exactly what the shipped one decides.

    Without this, the table above could drift into testing a private regex.
    ``calendar_ok`` is deliberately unused here: the schema has no opinion on
    2026-02-30, which is precisely why the semantic layer exists.
    """
    schema = _read_json(_CLOUD_REQUEST_SCHEMA_PATH)
    validator = Draft202012Validator(schema["$defs"]["utcTimestamp"])
    assert validator.is_valid(value) is (pattern_code is None)


def test_wire_timestamp_pattern_is_the_spec_regex_verbatim():
    assert pv.WIRE_TIMESTAMP_PATTERN == (
        r"^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
        r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,6})?Z$"
    )


@requires_change_contracts
@pytest.mark.parametrize("kind", ["request", "response"])
def test_shared_utc_timestamp_def_matches_the_local_copy(kind: str):
    """Both change schemas must keep ``pattern`` and ``format`` side by side."""
    definition = _read_json(_SCHEMA_PATHS[kind])["$defs"]["utcTimestamp"]
    assert definition["pattern"] == pv.WIRE_TIMESTAMP_PATTERN
    assert definition["format"] == "date-time"
    assert definition["type"] == "string"


@requires_change_contracts
@pytest.mark.parametrize(
    "def_name,local_pattern",
    [
        ("uuid", "UUID_PATTERN"),
        ("sha256", "SHA256_PATTERN"),
    ],
)
def test_shared_identity_defs_match_the_local_copies(def_name: str, local_pattern: str):
    for kind in ("request", "response"):
        definition = _read_json(_SCHEMA_PATHS[kind])["$defs"][def_name]
        assert definition["pattern"] == getattr(pv, local_pattern)


def test_parse_calendar_strict_rejects_rather_than_truncating_precision():
    """"MUST NOT round／truncate" (spec.md L47, L286).

    Seven fractional digits are not "six digits plus noise"; silently dropping
    the seventh would let two distinct wire values collapse onto one stored
    microsecond, which is exactly what the health-history tie-break rule
    depends on not happening.
    """
    with pytest.raises(ValueError):
        pv.parse_calendar_strict("2026-07-16T08:15:30.1234567Z")
    assert pv.parse_calendar_strict("2026-07-16T08:15:30.123456Z").microsecond == 123456


_CALENDAR_REJECT_CODES = (
    ("hour_24", "2026-07-16T24:00:00Z", "wire_timestamp_hour_out_of_range"),
    ("minute_60", "2026-07-16T08:60:30Z", "wire_timestamp_minute_out_of_range"),
    ("second_60", "2026-07-16T08:15:60Z", "wire_timestamp_leap_second"),
    ("year_0999", "0999-07-16T08:15:30Z", "wire_timestamp_year_out_of_range"),
    ("feb_30", "2026-02-30T00:00:00Z", "wire_timestamp_calendar_invalid"),
    ("feb_29_non_leap", "2027-02-29T00:00:00Z", "wire_timestamp_calendar_invalid"),
    (
        "seven_fraction_digits",
        "2026-07-16T08:15:30.1234567Z",
        "wire_timestamp_not_canonical",
    ),
    ("offset", "2026-07-16T16:15:30+08:00", "wire_timestamp_not_canonical"),
    ("trailing_newline", "2026-07-16T08:15:30Z\n", "wire_timestamp_not_canonical"),
    ("not_a_string", None, "wire_timestamp_not_a_string"),
)


@pytest.mark.parametrize(
    "value,code",
    [case[1:] for case in _CALENDAR_REJECT_CODES],
    ids=[case[0] for case in _CALENDAR_REJECT_CODES],
)
def test_parse_calendar_strict_names_the_reason_it_rejected(value: Any, code: str):
    """Each semantic rejection carries its own diagnostic, not a generic one.

    ``datetime(...)`` would raise for hour 24 and for seven fractional digits
    all by itself, so the explicit guards look redundant — until an operator has
    to read the failure. Pinning the codes keeps the guards load-bearing and
    stops them being deleted as dead weight.
    """
    with pytest.raises(ValueError) as excinfo:
        pv.parse_calendar_strict(value)
    assert str(excinfo.value) == code


def test_parse_calendar_strict_right_pads_to_microseconds():
    """The one normalization the spec allows: "receiver只可右補零至microsecond"."""
    assert pv.parse_calendar_strict("2026-07-16T08:15:30.1Z").microsecond == 100000
    assert pv.parse_calendar_strict("2026-07-16T08:15:30.000001Z").microsecond == 1
    assert pv.parse_calendar_strict("2026-07-16T08:15:30Z").microsecond == 0


def test_wire_timestamp_pattern_tolerates_one_trailing_newline():
    """Known gap in the shipped ``pattern``, with its compensating control.

    Python's ``$`` matches at the end of the string *or* just before a final
    newline, and ``jsonschema`` applies ``pattern`` with ``re.search``. So
    ``"2026-07-16T08:15:30Z\\n"`` is schema-valid. Recorded here rather than
    silently "fixed" in a local copy, because the fix belongs in the schema
    (``\\Z`` instead of ``$``) and is a contract change.

    Compensating control: every semantic-layer gate in ``protocol_validators``
    anchors absolutely, so the value never reaches a domain mutation.
    """
    leaky = "2026-07-16T08:15:30Z\n"
    assert pv.validate_wire_timestamp(leaky) is None
    with pytest.raises(ValueError):
        pv.parse_calendar_strict(leaky)
    assert (
        pv.validate_error_event_id({"event_id": _UUID_A + "\n"})
        == "error_event_id_not_a_uuid"
    )


@requires_change_contracts
def test_trailing_newline_gap_is_a_property_of_the_shipped_schema():
    schema = _read_json(_CLOUD_REQUEST_SCHEMA_PATH)
    assert Draft202012Validator(schema["$defs"]["utcTimestamp"]).is_valid(
        "2026-07-16T08:15:30Z\n"
    ), (
        "the shipped pattern no longer tolerates a trailing newline; that is an "
        "improvement, but this test and the local pattern copy must be updated "
        "together"
    )


# ===========================================================================
# 6. The four wire timestamp paths, proven by ``pattern`` alone
# ===========================================================================

# (id, example file, schema kind, RFC 6901 pointer, pointer parts)
_OFFSET_FIXTURES = (
    (
        "request_occurred_at",
        "invalid-offset-occurred-at.json",
        "request",
        "/occurred_at",
        ("occurred_at",),
    ),
    (
        "published_payload_published_at",
        "invalid-offset-published-at.json",
        "request",
        "/payload/published_at",
        ("payload", "published_at"),
    ),
    (
        "health_payload_observed_at",
        "invalid-offset-health-observed-at.json",
        "request",
        "/payload/observed_at",
        ("payload", "observed_at"),
    ),
    (
        "success_ack_stored_at",
        "invalid-offset-ack-stored-at.json",
        "response",
        "/stored_at",
        ("stored_at",),
    ),
)

_CANONICAL_REPAIR = "2026-07-16T08:15:30.000Z"


def test_the_spec_names_exactly_four_wire_timestamp_paths():
    assert len(_OFFSET_FIXTURES) == 4
    assert {case[3] for case in _OFFSET_FIXTURES} == {
        "/occurred_at",
        "/payload/published_at",
        "/payload/observed_at",
        "/stored_at",
    }


@requires_change_contracts
@pytest.mark.parametrize(
    "filename,kind,pointer,parts",
    [case[1:] for case in _OFFSET_FIXTURES],
    ids=[case[0] for case in _OFFSET_FIXTURES],
)
def test_offset_is_rejected_by_pattern_without_a_format_plugin(
    filename: str, kind: str, pointer: str, parts: tuple[str, ...]
):
    """Each of the four paths, rejected by ``pattern``, on a bare validator.

    ``format: date-time`` is an annotation unless a format plugin is installed,
    and this project deliberately installs none
    (:func:`test_format_annotation_is_inert_without_a_plugin` proves it). So
    the assertion is not merely "the document is invalid" but "the leaf that
    rejected it is a ``pattern`` leaf at this exact instance pointer".
    """
    path = _EXAMPLES_DIR / filename
    if not path.exists():
        pytest.skip(f"change example not present: {path}")
    validator = change_validator(kind)
    assert validator.format_checker is None, (
        "a format plugin has been attached; the four-path proof would then no "
        "longer show that pattern alone carries the rejection"
    )
    document = _read_json(path)
    errors = list(validator.iter_errors(document))
    assert errors, f"{filename} was accepted; the offset timestamp went through"
    pattern_leaves = [
        leaf
        for leaf in _iter_leaf_errors(errors)
        if leaf.validator == "pattern" and _pointer(leaf) == pointer
    ]
    assert pattern_leaves, (
        f"{filename}: no pattern leaf at {pointer}; got "
        f"{sorted({(_pointer(leaf), leaf.validator) for leaf in _iter_leaf_errors(errors)})}"
    )
    assert pattern_leaves[0].validator_value == pv.WIRE_TIMESTAMP_PATTERN
    # And the local pattern-layer helper agrees with the schema, on the same value.
    assert (
        pv.validate_wire_timestamp(pattern_leaves[0].instance)
        == "wire_timestamp_not_canonical"
    )


@requires_change_contracts
@pytest.mark.parametrize(
    "filename,kind,pointer,parts",
    [case[1:] for case in _OFFSET_FIXTURES],
    ids=[case[0] for case in _OFFSET_FIXTURES],
)
def test_offset_fixtures_isolate_exactly_one_timestamp(
    filename: str, kind: str, pointer: str, parts: tuple[str, ...]
):
    """Positive control: repair that one field and the document is valid.

    Without this, a fixture that happened to carry a second, unrelated defect
    would still make the test above pass while proving nothing about the
    timestamp.
    """
    path = _EXAMPLES_DIR / filename
    if not path.exists():
        pytest.skip(f"change example not present: {path}")
    document = _read_json(path)
    _set_at(document, parts, _CANONICAL_REPAIR)
    remaining = list(change_validator(kind).iter_errors(document))
    assert not remaining, (
        f"{filename} still fails after repairing {pointer}: "
        f"{[(_pointer(e), e.validator) for e in remaining]}"
    )


def test_format_annotation_is_inert_without_a_plugin():
    """The premise the four-path proof rests on.

    A ``format: date-time`` schema with no format checker accepts an offset
    timestamp. Everything that rejects offsets on this boundary must therefore
    be ``pattern``.
    """
    format_only = Draft202012Validator({"type": "string", "format": "date-time"})
    assert format_only.format_checker is None
    assert format_only.is_valid("2026-07-16T16:15:31+08:00")
    assert format_only.is_valid("2026-07-16T08:15:30z")
    pattern_too = Draft202012Validator(
        {"type": "string", "format": "date-time", "pattern": pv.WIRE_TIMESTAMP_PATTERN}
    )
    assert not pattern_too.is_valid("2026-07-16T16:15:31+08:00")


@requires_change_contracts
@pytest.mark.parametrize(
    "filename,pointer,parts",
    [
        ("invalid-leap-second-health-observed-at.json", "/payload/observed_at", ("payload", "observed_at")),
        ("invalid-submicrosecond-health-observed-at.json", "/payload/observed_at", ("payload", "observed_at")),
        ("invalid-out-of-range-health-observed-at.json", "/payload/observed_at", ("payload", "observed_at")),
    ],
)
def test_other_non_canonical_health_timestamps_are_also_pattern_rejections(
    filename: str, pointer: str, parts: tuple[str, ...]
):
    """Leap second, seven fractional digits and year 0999, from the shipped corpus."""
    path = _EXAMPLES_DIR / filename
    if not path.exists():
        pytest.skip(f"change example not present: {path}")
    errors = list(change_validator("request").iter_errors(_read_json(path)))
    assert [
        leaf
        for leaf in _iter_leaf_errors(errors)
        if leaf.validator == "pattern" and _pointer(leaf) == pointer
    ]


# ===========================================================================
# 7. ACK classification (spec.md L198-L200, L228-L232)
# ===========================================================================


@pytest.mark.parametrize(
    "case", _ACK_CASES["cases"], ids=[case["name"] for case in _ACK_CASES["cases"]]
)
def test_ack_classification_table(case: dict):
    expected_identity = _ACK_CASES["sent_event"] if case.get("match_sent_event") else None
    result = pv.classify_ack(
        case["status_code"], case["body"], expected=expected_identity
    )
    assert result.outcome == case["outcome"], f"{case['name']}: {result}"
    assert result.detail == case["detail"], f"{case['name']}: {result}"
    assert result.delivered is case["delivered"], f"{case['name']}: {result}"
    if "retryable" in case:
        assert result.retryable is case["retryable"], f"{case['name']}: {result}"


def test_only_200_and_201_can_be_delivered():
    delivered = {
        case["status_code"] for case in _ACK_CASES["cases"] if case["delivered"]
    }
    assert delivered == {200, 201}


def test_the_ack_case_table_covers_the_named_protocol_failures():
    """"``202``、empty body、malformed body、mismatched ACK" — all four present."""
    details = {case["detail"] for case in _ACK_CASES["cases"]}
    assert "status_202_is_not_an_ack" in details
    assert "ack_body_not_an_object" in details
    assert "ack_body_member_set_mismatch" in details
    assert {
        "ack_event_id_mismatch",
        "ack_publication_identity_mismatch",
        "ack_manifest_digest_mismatch",
    } <= details


@requires_change_contracts
def test_shipped_ack_examples_agree_with_the_classifier():
    """The classifier and the response schema must not disagree on any example."""
    validator = change_validator("response")

    created = example("valid-created-ack.json")
    assert validator.is_valid(created)
    assert pv.classify_ack(201, created).outcome == pv.OUTCOME_DELIVERED
    # The same body under 202 is a protocol failure, schema-valid or not.
    assert pv.classify_ack(202, created).detail == "status_202_is_not_an_ack"

    incomplete = example("invalid-incomplete-ack.json")
    assert not validator.is_valid(incomplete)
    assert pv.classify_ack(201, incomplete).outcome == pv.OUTCOME_PROTOCOL_FAILURE

    offset_ack = example("invalid-offset-ack-stored-at.json")
    assert not validator.is_valid(offset_ack)
    assert pv.classify_ack(201, offset_ack).detail == "ack_stored_at_not_canonical"


@requires_change_contracts
def test_success_ack_members_are_exactly_the_six_the_schema_requires():
    schema = _read_json(_CLOUD_RESPONSE_SCHEMA_PATH)
    ack = schema["$defs"]["successAck"]
    assert set(ack["required"]) == pv.SUCCESS_ACK_MEMBERS
    assert set(ack["properties"]) == pv.SUCCESS_ACK_MEMBERS
    assert ack["additionalProperties"] is False


def test_replay_flag_and_status_must_agree():
    body = dict(_ACK_CASES["cases"][0]["body"])
    body["replay"] = False
    assert pv.classify_ack(201, body).outcome == pv.OUTCOME_DELIVERED
    assert pv.classify_ack(200, body).detail == "replay_flag_contradicts_status"
    body["replay"] = True
    assert pv.classify_ack(200, body).outcome == pv.OUTCOME_DELIVERED
    assert pv.classify_ack(201, body).detail == "replay_flag_contradicts_status"


def test_a_matching_ack_for_the_wrong_event_is_never_delivered():
    """"mismatched ACK SHALL 視為protocol failure" — schema validity is not enough."""
    body = dict(_ACK_CASES["cases"][0]["body"])
    assert pv.classify_ack(201, body, expected=_ACK_CASES["sent_event"]).delivered
    for key, replacement in (
        ("event_id", _UUID_B),
        ("publication_identity", "edge-tpe-02:model-version-20260715-001:result-0007"),
        ("manifest_digest", "b" * 64),
    ):
        wrong = dict(body, **{key: replacement})
        result = pv.classify_ack(201, wrong, expected=_ACK_CASES["sent_event"])
        assert result.outcome == pv.OUTCOME_PROTOCOL_FAILURE
        assert result.delivered is False


# ===========================================================================
# 8. The nine canonical HTTP / code / retryable triples (spec.md L202)
# ===========================================================================

#: Transcribed from spec.md L202, in the order the sentence lists them:
#: "400/`INVALID_REQUEST`/false、422/`UNSUPPORTED_SCHEMA`/false、
#:  401/`HMAC_AUTH_FAILED`/false、403/`TENANT_BINDING_MISMATCH`/false、
#:  422/`PARENT_BINDING_NOT_FOUND`/false、409/`PUBLICATION_DIGEST_CONFLICT`/false、
#:  429/`RATE_LIMITED`/true、503/`TRANSIENT_UNAVAILABLE`/true、
#:  500/`INTERNAL_ERROR`/true".
_SPEC_TRIPLES = (
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


def test_canonical_triples_are_exactly_the_nine_from_the_spec():
    assert pv.HTTP_CODE_RETRYABLE_TRIPLES == _SPEC_TRIPLES
    assert len(_SPEC_TRIPLES) == 9
    assert len({code for _, code, _ in _SPEC_TRIPLES}) == 9


@pytest.mark.parametrize(
    "status,code,retryable", _SPEC_TRIPLES, ids=[t[1] for t in _SPEC_TRIPLES]
)
def test_each_canonical_triple_is_accepted(status: int, code: str, retryable: bool):
    assert pv.validate_error_triple(status, code, retryable) is None
    assert pv.STATUS_BY_CODE[code] == status
    assert pv.RETRYABLE_BY_CODE[code] is retryable


def test_code_to_status_is_a_function_but_status_to_code_is_not():
    """422 carries two codes, so status alone can never identify the error.

    Recorded as a test because it is the one shape in the table that a
    status-keyed lookup would silently get wrong, and because it bounds what
    the cross-swap tests below can detect at all.
    """
    assert len(pv.STATUS_BY_CODE) == 9
    assert pv.CODES_BY_STATUS[422] == frozenset(
        {"UNSUPPORTED_SCHEMA", "PARENT_BINDING_NOT_FOUND"}
    )
    for status, codes in pv.CODES_BY_STATUS.items():
        if status != 422:
            assert len(codes) == 1, f"HTTP {status} unexpectedly carries {codes}"


def test_swapping_the_two_422_codes_is_undetectable_from_transport_alone():
    """Documented limit of the triple table, not a defect in it.

    Both 422 codes are individually canonical, so a receiver that returned
    ``PARENT_BINDING_NOT_FOUND`` where ``UNSUPPORTED_SCHEMA`` belonged would
    pass every transport-level check. Distinguishing them needs the request
    context, which the sender does not have from the response.
    """
    assert pv.validate_error_triple(422, "UNSUPPORTED_SCHEMA", False) is None
    assert pv.validate_error_triple(422, "PARENT_BINDING_NOT_FOUND", False) is None


def test_retryable_partition_is_six_deterministic_and_three_transient():
    assert pv.DETERMINISTIC_ERROR_CODES == frozenset(
        {
            "INVALID_REQUEST",
            "UNSUPPORTED_SCHEMA",
            "HMAC_AUTH_FAILED",
            "TENANT_BINDING_MISMATCH",
            "PARENT_BINDING_NOT_FOUND",
            "PUBLICATION_DIGEST_CONFLICT",
        }
    )
    assert pv.TRANSIENT_ERROR_CODES == frozenset(
        {"RATE_LIMITED", "TRANSIENT_UNAVAILABLE", "INTERNAL_ERROR"}
    )
    assert pv.DETERMINISTIC_ERROR_CODES.isdisjoint(pv.TRANSIENT_ERROR_CODES)


# (id, status, code, retryable, expected reject code)
_CROSS_SWAP_CASES = (
    # --- status/code cross-swaps: both halves canonical, paired wrongly ---
    (
        "transient_code_on_400",
        400,
        "TRANSIENT_UNAVAILABLE",
        True,
        "error_code_contradicts_http_status",
    ),
    (
        "deterministic_code_on_503",
        503,
        "INVALID_REQUEST",
        False,
        "error_code_contradicts_http_status",
    ),
    (
        "conflict_code_on_401",
        401,
        "PUBLICATION_DIGEST_CONFLICT",
        False,
        "error_code_contradicts_http_status",
    ),
    (
        "auth_code_on_409",
        409,
        "HMAC_AUTH_FAILED",
        False,
        "error_code_contradicts_http_status",
    ),
    (
        "rate_limited_on_500",
        500,
        "RATE_LIMITED",
        True,
        "error_code_contradicts_http_status",
    ),
    (
        "unsupported_schema_on_400",
        400,
        "UNSUPPORTED_SCHEMA",
        False,
        "error_code_contradicts_http_status",
    ),
    # --- retryable contradictions (also caught by the response schema) ---
    (
        "transient_code_not_retryable",
        503,
        "TRANSIENT_UNAVAILABLE",
        False,
        "error_retryable_contradicts_code",
    ),
    (
        "deterministic_code_retryable",
        409,
        "PUBLICATION_DIGEST_CONFLICT",
        True,
        "error_retryable_contradicts_code",
    ),
    (
        "rate_limited_not_retryable",
        429,
        "RATE_LIMITED",
        False,
        "error_retryable_contradicts_code",
    ),
    (
        "unsupported_schema_retryable",
        422,
        "UNSUPPORTED_SCHEMA",
        True,
        "error_retryable_contradicts_code",
    ),
    # --- malformed halves ---
    ("unknown_code", 400, "NOT_A_CANONICAL_CODE", False, "error_code_unknown"),
    ("code_not_a_string", 400, 400, False, "error_code_unknown"),
    (
        "retryable_not_a_boolean",
        429,
        "RATE_LIMITED",
        "true",
        "error_retryable_not_a_boolean",
    ),
    (
        "status_not_an_integer",
        "429",
        "RATE_LIMITED",
        True,
        "error_status_not_an_integer",
    ),
)


@pytest.mark.parametrize(
    "status,code,retryable,expected",
    [case[1:] for case in _CROSS_SWAP_CASES],
    ids=[case[0] for case in _CROSS_SWAP_CASES],
)
def test_cross_swapped_triples_are_rejected(
    status: Any, code: Any, retryable: Any, expected: str
):
    assert pv.validate_error_triple(status, code, retryable) == expected


def test_at_least_two_status_code_cross_swaps_are_covered():
    """tasks.md 2.6 asks for "至少兩個 status/code cross-swap"; count them."""
    swaps = [
        case
        for case in _CROSS_SWAP_CASES
        if case[4] == "error_code_contradicts_http_status"
    ]
    assert len(swaps) >= 2
    # Each swap must reuse a canonical status and a canonical code, otherwise
    # it degenerates into an "unknown code" test.
    canonical_statuses = {status for status, _, _ in _SPEC_TRIPLES}
    canonical_codes = {code for _, code, _ in _SPEC_TRIPLES}
    for _, status, code, _, _ in swaps:
        assert status in canonical_statuses
        assert code in canonical_codes
        assert pv.STATUS_BY_CODE[code] != status


@requires_change_contracts
def test_response_schema_enumerates_exactly_the_nine_codes():
    schema = _read_json(_CLOUD_RESPONSE_SCHEMA_PATH)
    error = schema["$defs"]["errorResponse"]["properties"]["error"]
    assert set(error["properties"]["code"]["enum"]) == set(pv.STATUS_BY_CODE)
    assert set(error["required"]) == pv.ERROR_MEMBERS
    assert error["additionalProperties"] is False


@requires_change_contracts
def test_response_schema_retryable_partition_matches_the_triples():
    """The schema's two if/then blocks and the triple table must not drift."""
    schema = _read_json(_CLOUD_RESPONSE_SCHEMA_PATH)
    error = schema["$defs"]["errorResponse"]["properties"]["error"]
    partitions: dict[bool, frozenset[str]] = {}
    for block in error["allOf"]:
        codes = frozenset(block["if"]["properties"]["code"]["enum"])
        pinned = block["then"]["properties"]["retryable"]["const"]
        partitions[pinned] = codes
    assert partitions[False] == pv.DETERMINISTIC_ERROR_CODES
    assert partitions[True] == pv.TRANSIENT_ERROR_CODES


@requires_change_contracts
@pytest.mark.parametrize(
    "filename,valid",
    [
        ("valid-transient-error.json", True),
        ("valid-conflict-error.json", True),
        ("valid-auth-error-without-event-id.json", True),
        ("invalid-nonretryable-transient-error.json", False),
        ("invalid-retryable-deterministic-error.json", False),
    ],
)
def test_shipped_error_examples_match_the_schema_and_the_triples(
    filename: str, valid: bool
):
    path = _EXAMPLES_DIR / filename
    if not path.exists():
        pytest.skip(f"change example not present: {path}")
    body = _read_json(path)
    assert change_validator("response").is_valid(body) is valid
    error = body["error"]
    problem = pv.validate_error_triple(
        pv.STATUS_BY_CODE.get(error["code"], -1), error["code"], error["retryable"]
    )
    assert (problem is None) is valid


def test_transport_retry_rule_covers_timeouts_and_5xx():
    """"Network errors、timeouts、408、429與5xx SHALL 可retry" (spec.md L202)."""
    for status in (408, 429, 500, 502, 503, 504, 599):
        assert pv.is_retryable_transport_status(status) is True
    for status in (400, 401, 403, 409, 418, 422, 451):
        assert pv.is_retryable_transport_status(status) is False


# ===========================================================================
# 9. Pre-validation error bodies (spec.md L204)
# ===========================================================================

_ERROR_EVENT_ID_CASES = (
    ("absent", {"error": {"code": "INVALID_REQUEST", "message": "m", "retryable": False}}, None),
    ("valid_lowercase", {"event_id": _UUID_A, "error": {}}, None),
    ("valid_uppercase", {"event_id": "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE", "error": {}}, None),
    ("valid_variant_b", {"event_id": "11111111-1111-4111-b111-111111111111", "error": {}}, None),
    ("null", {"event_id": None, "error": {}}, "error_event_id_not_a_string"),
    ("integer", {"event_id": 42, "error": {}}, "error_event_id_not_a_string"),
    ("empty_string", {"event_id": "", "error": {}}, "error_event_id_not_a_uuid"),
    ("not_a_uuid", {"event_id": "not-a-uuid", "error": {}}, "error_event_id_not_a_uuid"),
    ("nil_uuid", {"event_id": "00000000-0000-0000-0000-000000000000", "error": {}}, "error_event_id_not_a_uuid"),
    ("version_9", {"event_id": "11111111-1111-9111-8111-111111111111", "error": {}}, "error_event_id_not_a_uuid"),
    ("variant_c", {"event_id": "11111111-1111-4111-c111-111111111111", "error": {}}, "error_event_id_not_a_uuid"),
    ("braced", {"event_id": "{11111111-1111-4111-8111-111111111111}", "error": {}}, "error_event_id_not_a_uuid"),
    ("unhyphenated", {"event_id": "11111111111141118111111111111111", "error": {}}, "error_event_id_not_a_uuid"),
    ("trailing_newline", {"event_id": _UUID_A + "\n", "error": {}}, "error_event_id_not_a_uuid"),
    ("not_a_mapping", ["error"], "error_body_not_an_object"),
    ("none_body", None, "error_body_not_an_object"),
)


@pytest.mark.parametrize(
    "payload,expected",
    [case[1:] for case in _ERROR_EVENT_ID_CASES],
    ids=[case[0] for case in _ERROR_EVENT_ID_CASES],
)
def test_pre_validation_error_event_id_rule(payload: Any, expected: Any):
    """"MAY 省略``event_id``...若有提供，SHALL 是...有效UUID" (spec.md L204)."""
    assert pv.validate_error_event_id(payload) == expected


@requires_change_contracts
def test_error_without_event_id_is_schema_valid():
    body = example("valid-auth-error-without-event-id.json")
    assert "event_id" not in body
    assert change_validator("response").is_valid(body)
    assert pv.validate_error_event_id(body) is None
    assert pv.classify_ack(401, body).outcome == pv.OUTCOME_ERROR


@requires_change_contracts
def test_error_with_malformed_event_id_is_rejected_by_pattern():
    body = example("invalid-error-event-id.json")
    errors = list(change_validator("response").iter_errors(body))
    assert errors
    pattern_leaves = [
        leaf
        for leaf in _iter_leaf_errors(errors)
        if leaf.validator == "pattern" and _pointer(leaf) == "/event_id"
    ]
    assert pattern_leaves
    assert pattern_leaves[0].validator_value == pv.UUID_PATTERN
    assert pv.validate_error_event_id(body) == "error_event_id_not_a_uuid"
    assert pv.classify_ack(400, body).outcome == pv.OUTCOME_PROTOCOL_FAILURE


def test_receiver_must_not_invent_an_event_id():
    """"Receiver MUST NOT 捏造ID" — omission is correct, a placeholder is not."""
    omitted = {"error": {"code": "INVALID_REQUEST", "message": "m", "retryable": False}}
    assert pv.validate_error_event_id(omitted) is None
    for invented in ("00000000-0000-0000-0000-000000000000", "unknown", ""):
        assert (
            pv.validate_error_event_id(dict(omitted, event_id=invented))
            == "error_event_id_not_a_uuid"
        )


# ===========================================================================
# 10. Reference DDL stays REFERENCE ONLY (spec.md L328, tasks.md 2.6)
# ===========================================================================

#: Directories that are never worth walking for this check: dependency trees,
#: build output and runtime state, none of which can wire up a migration.
_SCAN_PRUNE = frozenset(
    {
        "node_modules",
        "__pycache__",
        "site-packages",
        "venv",
        "env",
        "dist",
        "build",
        "out",
        "target",
        "vendor",
        "coverage",
        "htmlcov",
        "artifacts",
        "storage",
        "logs",
        "tmp",
        "temp",
    }
)
#: Every dot-directory is pruned as well — ``.git``, ``.venv``, ``.pytest_cache``
#: and, importantly, ``.gitnexus``, whose generated index files list every path
#: in the repository and would otherwise read as a "reference" to the DDL.
#: ``.github`` is the exception and is deliberately walked: a CI workflow step
#: is exactly where this repository could start executing the reference DDL.
_SCAN_KEEP_DOT_DIRS = frozenset({".github"})
#: Text-ish files only, and only small ones; a reference to a SQL file is a
#: line of source or config, never a megabyte of generated output.
_SCAN_SUFFIXES = frozenset(
    {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".json",
        ".yml",
        ".yaml",
        ".toml",
        ".ini",
        ".cfg",
        ".md",
        ".sql",
        ".sh",
        ".ps1",
        ".psm1",
        ".bat",
        ".txt",
        ".html",
        ".env",
    }
)
_SCAN_MAX_BYTES = 1_048_576
#: Directory names that would mean this repository runs schema migrations.
_MIGRATION_DIR_NAMES = frozenset(
    {"migrations", "migration", "alembic", "flyway", "liquibase", "db_migrate"}
)


def _walk_repo() -> Iterator[tuple[Path, list[str], list[str]]]:
    for dirpath, dirnames, filenames in os.walk(_REPO_ROOT):
        dirnames[:] = [
            name
            for name in dirnames
            if name not in _SCAN_PRUNE
            and (not name.startswith(".") or name in _SCAN_KEEP_DOT_DIRS)
        ]
        yield Path(dirpath), dirnames, filenames


@requires_mysql_reference
def test_mysql_reference_is_not_a_migration():
    """The DDL must stay an inert mapping aid, prominently marked as such.

    Three separate claims, because they can fail independently:

    1. the ``REFERENCE ONLY`` banner is on the **first** line ("保持醒目"),
       together with the do-not-execute wording and the 8.0.16+ prerequisite;
    2. this repository contains no migration-runner directory at all;
    3. every file that names the DDL does so from inside the change directory
       (or from this test directory), i.e. nothing wires it into a runner.
    """
    text = _MYSQL_REFERENCE_PATH.read_text(encoding="utf-8")
    lines = text.splitlines()
    banner = lines[0]
    assert "REFERENCE ONLY" in banner, f"first line is not the banner: {banner!r}"
    assert "NOT A MIGRATION" in banner
    assert "DO NOT EXECUTE" in banner.upper()
    assert "8.0.16" in text, "the CHECK-enforcement prerequisite must stay stated"
    assert "CREATE TABLE" in text, "sanity: this file really is the reference DDL"

    offending_dirs: list[str] = []
    mentions: list[str] = []
    needle = _MYSQL_REFERENCE_PATH.name
    for dirpath, dirnames, filenames in _walk_repo():
        for name in dirnames:
            if name.lower() in _MIGRATION_DIR_NAMES:
                offending_dirs.append(str((dirpath / name).relative_to(_REPO_ROOT)))
        for filename in filenames:
            path = dirpath / filename
            if path.suffix.lower() not in _SCAN_SUFFIXES:
                continue
            try:
                if path.stat().st_size > _SCAN_MAX_BYTES:
                    continue
                content = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if needle in content:
                mentions.append(str(path.relative_to(_REPO_ROOT)).replace("\\", "/"))

    assert not offending_dirs, (
        "this repository must not own database migrations; found "
        f"{offending_dirs}"
    )
    allowed_prefixes = (
        "openspec/changes/rvt-ifc-usdc-lineage/",
        "openspec/archive/",
        "tests/contracts/lineage/",
    )
    stray = [
        mention
        for mention in mentions
        if not mention.startswith(allowed_prefixes)
    ]
    assert not stray, (
        f"{needle} is referenced from outside the change and its contract "
        f"tests: {stray}. A reference from anywhere else is how a REFERENCE "
        "ONLY artifact quietly becomes a migration."
    )
    assert mentions, "sanity: the DDL should at least be named by its own change"


@requires_mysql_reference
def test_mysql_reference_declares_its_physical_adoption_prerequisites():
    """"16 KiB InnoDB page與``ROW_FORMAT=DYNAMIC``" and the 2,952-byte ACK key."""
    text = _MYSQL_REFERENCE_PATH.read_text(encoding="utf-8")
    assert "innodb_page_size" in text
    assert "ROW_FORMAT" in text and "DYNAMIC" in text
    assert "2,952" in text or "2952" in text


@requires_mysql_reference
def test_mysql_reference_contains_no_executable_data_statements():
    """A mapping aid declares structure; it does not move or destroy data."""
    upper = _MYSQL_REFERENCE_PATH.read_text(encoding="utf-8").upper()
    for forbidden in ("INSERT INTO", "DELETE FROM", "DROP DATABASE", "TRUNCATE "):
        assert forbidden not in upper, f"reference DDL contains {forbidden!r}"
