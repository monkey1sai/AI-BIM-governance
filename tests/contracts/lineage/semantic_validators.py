"""Semantic validators for the ``rvt-ifc-usdc-lineage`` executable contracts.

Scope
-----
JSON Schema fixes the *shape* of the lineage contracts. This module fixes the
invariants that JSON Schema cannot express: the metric/count binding of
``openspec/changes/rvt-ifc-usdc-lineage/tasks.md`` task 4.4, the decimal
truncation rule, and the UUID36 <-> IFC GlobalId22 <-> stable USD element root
identity chain of task 2.2.

The module is deliberately stdlib-only. The CI job ``root contracts and fakes``
installs nothing but ``pytest`` and ``jsonschema``, and this file must remain
importable through ``importlib.util.spec_from_file_location`` because the
lineage contract test package intentionally ships no ``__init__.py``
(blueprint E-6).

Every ``validate_*`` entry point returns a ``list[str]`` of diagnostic codes.
An empty list means "no semantic contradiction found"; it is never an
endorsement of anything JSON Schema already rejected. Callers are expected to
run ``jsonschema.Draft202012Validator`` first: these validators assume a
schema-valid document and index required fields directly.

Two code vocabularies coexist on purpose, and each fixture's ``expect`` block
spells its own out:

* :func:`validate_alignment_report` emits UPPER_SNAKE codes. They are report
  bookkeeping diagnoses that never appear on the wire.
* :func:`validate_bundle_scenario`, :func:`validate_job_scenario` and
  :func:`validate_result_publication_scenario` emit lower_snake codes, because
  those are the same words the contracts already carry as wire enums
  (``integrity_diagnostics[].code``, ``diagnostics[].code``); the semantic
  layer must not invent a second spelling of a diagnosis the schema can
  already name.

Codes are emitted in a fixed evaluation order and de-duplicated while keeping
first occurrence, so a fixture's expected code list is deterministic.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_DOWN
from typing import Any, Iterable, Mapping, MutableSequence, Sequence

__all__ = [
    "IFC_GUID_CHARS",
    "RATIO_DECIMAL_PLACES",
    "USD_GUID_TOKEN_LENGTH",
    "CSV_REPORT_COLUMNS",
    "canonical_uuid36",
    "ifc_guid_compress",
    "ifc_guid_expand",
    "usd_safe_identifier",
    "usd_guid_token",
    "usd_element_root_path",
    "truncate_ratio",
    "validate_alignment_summary",
    "validate_alignment_report",
    "validate_bundle_scenario",
    "validate_result_publication_scenario",
    "validate_job_scenario",
]


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: IFC GlobalId base64 alphabet (ISO 10303-21 / IFC compressed GUID).
IFC_GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"

#: The first GlobalId character carries only 2 of the leading byte's 8 bits.
IFC_GUID_LEADING_CHARS = "0123"

#: tasks.md 4.4: decimal division truncated toward zero at the 10th decimal.
RATIO_DECIMAL_PLACES = 10

_RATIO_QUANTUM = Decimal(1).scaleb(-RATIO_DECIMAL_PLACES)

#: ``G_`` + 22 GlobalId characters, all of which sanitize to exactly one char.
USD_GUID_TOKEN_LENGTH = 24

#: Column order frozen by ``$defs/alignmentReportCsvContract``.
CSV_REPORT_COLUMNS = (
    "row_number",
    "rvt_element_id",
    "ifc_uuid36_raw",
    "ifc_uuid36",
    "ifc_global_id22",
    "usd_prim_path",
    "alignment_class",
    "reason_code",
)

#: difference_sets member -> authoritative counts member.
DIFFERENCE_SET_COUNT_KEYS = {
    "csv_only": "csv_only_count",
    "ifc_only": "ifc_only_count",
    "ifc_usdc_unmapped": "ifc_usdc_unmapped_count",
    "duplicate_rvt_ids": "duplicate_rvt_id_count",
    "duplicate_ifc_guids": "duplicate_ifc_guid_count",
    "invalid_rows": "invalid_row_count",
    "full_lineage_matched": "full_lineage_matched_count",
}

#: difference_sets member -> emitted code when the page is larger than the count.
_DIFFERENCE_SET_OVERFLOW_CODES = {
    "csv_only": "CSV_ONLY_SET_EXCEEDS_COUNT",
    "ifc_only": "IFC_ONLY_SET_EXCEEDS_COUNT",
    "ifc_usdc_unmapped": "IFC_USDC_UNMAPPED_SET_EXCEEDS_COUNT",
    "duplicate_rvt_ids": "DUPLICATE_RVT_ID_SET_EXCEEDS_COUNT",
    "duplicate_ifc_guids": "DUPLICATE_IFC_GUID_SET_EXCEEDS_COUNT",
    "invalid_rows": "INVALID_ROW_SET_EXCEEDS_COUNT",
    "full_lineage_matched": "FULL_LINEAGE_MATCHED_SET_EXCEEDS_COUNT",
}


# ---------------------------------------------------------------------------
# Identity helpers
# ---------------------------------------------------------------------------


def canonical_uuid36(value: str) -> str:
    """Return the derived canonical (lowercase, hyphenated) UUID36 form.

    ``spec.md``: "UUID 大小寫不影響 identity，系統 SHALL 另輸出 derived
    canonical ``ifc_uuid36``". The *source* string is never rewritten; this is
    the derived comparison key only.
    """
    text = str(value)
    _uuid36_hex(text)  # shape check
    return text.lower()


def _uuid36_hex(value: str) -> str:
    """Strip the four hyphens and validate the 8-4-4-4-12 UUID36 layout."""
    text = str(value)
    parts = text.split("-")
    if [len(part) for part in parts] != [8, 4, 4, 4, 12]:
        raise ValueError(f"not a UUID36 string: {text!r}")
    hexdigits = "".join(parts)
    if any(ch not in "0123456789abcdefABCDEF" for ch in hexdigits):
        raise ValueError(f"not a UUID36 string: {text!r}")
    return hexdigits.lower()


def _encode_base64(value: int, length: int) -> str:
    """Big-endian base64 encoding of ``value`` in ``length`` IFC GUID chars."""
    return "".join(
        IFC_GUID_CHARS[(value // (64 ** position)) % 64]
        for position in reversed(range(length))
    )


def _decode_base64(chunk: str) -> int:
    value = 0
    for char in chunk:
        value = value * 64 + IFC_GUID_CHARS.index(char)
    return value


def ifc_guid_compress(uuid36: str) -> str:
    """Compress a UUID36 string into its 22-character IFC ``GlobalId``.

    The 128-bit identity is split as 2 bits + 21 * 6 bits: the leading byte is
    written as two base64 characters (so the first character is always one of
    ``0123``) and the remaining fifteen bytes as five four-character groups of
    24 bits each.

    Case in the input is not identity-bearing; the derived canonical form is
    used. Raises ``ValueError`` for anything that is not a UUID36 string.
    """
    hexdigits = _uuid36_hex(uuid36)
    octets = [int(hexdigits[index:index + 2], 16) for index in range(0, 32, 2)]
    encoded = [_encode_base64(octets[0], 2)]
    for index in range(1, 16, 3):
        triple = (octets[index] << 16) | (octets[index + 1] << 8) | octets[index + 2]
        encoded.append(_encode_base64(triple, 4))
    return "".join(encoded)


def ifc_guid_expand(global_id22: str) -> str:
    """Expand a 22-character IFC ``GlobalId`` into the canonical UUID36 form.

    Exact inverse of :func:`ifc_guid_compress`. Raises ``ValueError`` when the
    input is not 22 characters over the IFC alphabet, or when the leading
    character encodes more than the 2 bits the format allows.
    """
    text = str(global_id22)
    if len(text) != 22:
        raise ValueError(f"IFC GlobalId must be 22 characters: {text!r}")
    if any(char not in IFC_GUID_CHARS for char in text):
        raise ValueError(f"IFC GlobalId carries a non-alphabet character: {text!r}")
    if text[0] not in IFC_GUID_LEADING_CHARS:
        raise ValueError(
            f"IFC GlobalId first character encodes only 2 bits, got {text[0]!r}"
        )
    octets = [_decode_base64(text[0:2])]
    for group in range(5):
        triple = _decode_base64(text[2 + 4 * group:6 + 4 * group])
        octets.extend((triple >> (8 * (2 - offset))) & 0xFF for offset in range(3))
    hexdigits = "".join(f"{octet:02x}" for octet in octets)
    return "-".join(
        (
            hexdigits[0:8],
            hexdigits[8:12],
            hexdigits[12:16],
            hexdigits[16:20],
            hexdigits[20:32],
        )
    )


def usd_safe_identifier(value: str, *, fallback: str) -> str:
    """Return a deterministic USD prim-name segment.

    Line-for-line mirror of ``usd_safe_identifier`` in
    ``bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/
    ezplus/bim_review_stream/messaging/ifc_openusd_identity_author.py`` (lines
    30-43). The contract tests must sanitize exactly the way the streaming
    authority does, or the lineage report would validate against a prim token
    the converter never authored.
    """
    raw = str(value or "")
    sanitized = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in raw)
    if not sanitized:
        sanitized = fallback
    if not (sanitized[0].isalpha() or sanitized[0] == "_"):
        sanitized = "_" + sanitized
    return sanitized


def usd_guid_token(global_id22: str) -> str:
    """Return the ``G_<encoded_guid>`` prim token for an IFC ``GlobalId``.

    Mirror of ``build_identity_root_path`` lines 48-51 of the same module. The
    leading-underscore strip matters: every GlobalId starts with ``0``-``3``,
    so :func:`usd_safe_identifier` always prepends ``_`` and the authority
    always strips it back off before prefixing ``G_``.
    """
    guid_body = usd_safe_identifier(global_id22, fallback="Shape")
    if guid_body.startswith("_"):
        guid_body = guid_body[1:] or "Shape"
    return f"G_{guid_body}"


def usd_element_root_path(ifc_class: str, global_id22: str) -> str:
    """Return ``/World/Elements/<IfcClass>/G_<encoded_guid>``.

    Mirror of ``build_identity_root_path`` lines 47-53.
    """
    class_token = usd_safe_identifier(ifc_class, fallback="Unclassified")
    return f"/World/Elements/{class_token}/{usd_guid_token(global_id22)}"


# ---------------------------------------------------------------------------
# Ratio arithmetic
# ---------------------------------------------------------------------------


def truncate_ratio(numerator: int, denominator: int) -> Decimal | None:
    """Decimal ratio truncated toward zero at the 10th decimal place.

    ``tasks.md`` 4.4 / ``design.md`` 10.1: denominator 0 yields ``None``
    (wire ``ratio: null`` with ``status: not_evaluable``); otherwise the
    quotient is computed in decimal arithmetic and truncated, never rounded.
    Returning ``Decimal`` keeps the comparison exact -- callers compare against
    ``Decimal(str(document_ratio))``.
    """
    if denominator == 0:
        return None
    quotient = Decimal(int(numerator)) / Decimal(int(denominator))
    return quotient.quantize(_RATIO_QUANTUM, rounding=ROUND_DOWN)


def _expected_status(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return "not_evaluable"
    return "complete" if numerator == denominator else "partial"


# ---------------------------------------------------------------------------
# Alignment summary invariants (tasks.md 4.4)
# ---------------------------------------------------------------------------

_METRIC_CODE_PREFIXES = {
    "ifc_usdc_coverage_ratio": "IFC_USDC",
    "rvt_ifc_alignment_ratio": "RVT_IFC",
    "rvt_ifc_usdc_lineage_ratio": "LINEAGE",
}


def validate_alignment_summary(
    metrics: Mapping[str, Mapping[str, Any]],
    counts: Mapping[str, int],
) -> list[str]:
    """Check the metric/count binding shared by report, manifest and cloud.

    ``spec.md`` requires producer, result-manifest validator and cloud
    publication validator to use *the same* semantics, so this helper is the
    single implementation behind :func:`validate_alignment_report` and
    :func:`validate_result_publication_scenario`.
    """
    codes: list[str] = []

    coverage = metrics["ifc_usdc_coverage_ratio"]
    alignment = metrics["rvt_ifc_alignment_ratio"]
    lineage = metrics["rvt_ifc_usdc_lineage_ratio"]

    eligible = counts["eligible_ifc_product_count"]
    csv_total = counts["csv_total_count"]
    csv_valid = counts["csv_valid_count"]
    csv_only = counts["csv_only_count"]
    ifc_only = counts["ifc_only_count"]
    unmapped = counts["ifc_usdc_unmapped_count"]
    full_lineage = counts["full_lineage_matched_count"]

    # 1. denominator / numerator binding (design.md 10.1).
    if coverage["denominator"] != eligible:
        codes.append("IFC_USDC_DENOMINATOR_MISMATCH")
    if coverage["numerator"] != eligible - unmapped:
        codes.append("IFC_USDC_NUMERATOR_MISMATCH")
    if alignment["denominator"] != csv_valid:
        codes.append("RVT_IFC_DENOMINATOR_MISMATCH")
    if alignment["numerator"] != csv_valid - csv_only:
        codes.append("RVT_IFC_NUMERATOR_MISMATCH")
    if lineage["denominator"] != csv_valid:
        codes.append("LINEAGE_DENOMINATOR_MISMATCH")
    if lineage["numerator"] != full_lineage:
        codes.append("LINEAGE_NUMERATOR_MISMATCH")

    # 2. CSV row accounting.
    non_valid_rows = csv_total - csv_valid
    if csv_valid > csv_total:
        codes.append("CSV_VALID_EXCEEDS_TOTAL")
    else:
        # The three diagnostic classes MAY overlap and are NOT required to sum;
        # each is only bounded by the non-valid row population. The bound is
        # meaningless once csv_valid already exceeds csv_total, which has its
        # own fail-closed code above.
        if counts["duplicate_rvt_id_count"] > non_valid_rows:
            codes.append("DUPLICATE_RVT_ID_COUNT_EXCEEDS_NON_VALID_ROWS")
        if counts["duplicate_ifc_guid_count"] > non_valid_rows:
            codes.append("DUPLICATE_IFC_GUID_COUNT_EXCEEDS_NON_VALID_ROWS")
        if counts["invalid_row_count"] > non_valid_rows:
            codes.append("INVALID_ROW_COUNT_EXCEEDS_NON_VALID_ROWS")

    # 3. IFC-only identity and the set-intersection band.
    matched_rvt_ifc = alignment["numerator"]
    if ifc_only != eligible - matched_rvt_ifc:
        codes.append("IFC_ONLY_COUNT_MISMATCH")

    lower_bound = max(0, matched_rvt_ifc + coverage["numerator"] - eligible)
    upper_bound = min(matched_rvt_ifc, coverage["numerator"])
    if full_lineage < lower_bound:
        codes.append("FULL_LINEAGE_BELOW_SET_INTERSECTION_LOWER_BOUND")
    if full_lineage > upper_bound:
        codes.append("FULL_LINEAGE_EXCEEDS_SET_INTERSECTION_UPPER_BOUND")

    # 4. Ratio truncation and status, per metric, in declaration order.
    for name, prefix in _METRIC_CODE_PREFIXES.items():
        metric = metrics[name]
        expected_ratio = truncate_ratio(metric["numerator"], metric["denominator"])
        observed_ratio = metric["ratio"]
        if expected_ratio is None:
            if observed_ratio is not None:
                codes.append(f"{prefix}_RATIO_TRUNCATION_MISMATCH")
        elif observed_ratio is None or Decimal(str(observed_ratio)) != expected_ratio:
            codes.append(f"{prefix}_RATIO_TRUNCATION_MISMATCH")

    for name, prefix in _METRIC_CODE_PREFIXES.items():
        metric = metrics[name]
        if metric["status"] != _expected_status(
            metric["numerator"], metric["denominator"]
        ):
            codes.append(f"{prefix}_STATUS_MISMATCH")

    return codes


# ---------------------------------------------------------------------------
# Alignment report (task 2.2)
# ---------------------------------------------------------------------------


def validate_alignment_report(document: Mapping[str, Any]) -> list[str]:
    """Validate one ``lineage-alignment-report/v1`` document.

    ``document`` is the whole envelope (``schema_version`` / ``document_type``
    / ``body``) and is assumed to already satisfy
    ``tests/contracts/lineage_alignment_report.json``. CSV-contract documents
    carry no numbers, so only the frozen column order is re-checked.
    """
    codes: list[str] = []
    document_type = document.get("document_type")
    body = document.get("body", {})

    if document_type == "alignment_report_csv_contract":
        if tuple(body.get("columns", ())) != CSV_REPORT_COLUMNS:
            codes.append("CSV_COLUMN_CONTRACT_MISMATCH")
        return _dedupe(codes)

    scope = body["scope"]
    counts = body["counts"]
    metrics = body["metrics"]
    difference_sets = body["difference_sets"]

    # scope is the human-facing restatement of the same eligible population.
    if scope["eligible_ifc_product_count"] != counts["eligible_ifc_product_count"]:
        codes.append("SCOPE_ELIGIBLE_COUNT_MISMATCH")

    codes.extend(validate_alignment_summary(metrics, counts))

    if body["warning_code_count"] != len(body["warning_codes"]):
        codes.append("WARNING_CODE_COUNT_MISMATCH")

    # counts stay authoritative; a published set may be a bounded page of it.
    for set_name, count_key in DIFFERENCE_SET_COUNT_KEYS.items():
        if len(difference_sets[set_name]) > counts[count_key]:
            codes.append(_DIFFERENCE_SET_OVERFLOW_CODES[set_name])

    codes.extend(_validate_identity_chain(difference_sets))
    codes.extend(_validate_set_disjointness(difference_sets))
    return _dedupe(codes)


def _validate_identity_chain(difference_sets: Mapping[str, Sequence[Mapping[str, Any]]]) -> list[str]:
    """UUID36 <-> GlobalId22 <-> stable USD element root, per enumerated item."""
    codes: list[str] = []

    for item in difference_sets["full_lineage_matched"]:
        codes.extend(_check_guid_roundtrip(item["ifc_uuid36"], item["ifc_global_id22"]))
        codes.extend(_check_prim_token(item["usd_prim_path"], item["ifc_global_id22"]))

    for item in difference_sets["csv_only"]:
        if item["ifc_uuid36"] != _safe_canonical(item["ifc_uuid36_raw"]):
            codes.append("UUID36_CANONICALIZATION_MISMATCH")
        if "ifc_global_id22" in item:
            codes.extend(
                _check_guid_roundtrip(item["ifc_uuid36"], item["ifc_global_id22"])
            )

    for item in difference_sets["ifc_only"]:
        codes.extend(_check_guid_roundtrip(item["ifc_uuid36"], item["ifc_global_id22"]))
        if "usd_prim_path" in item:
            codes.extend(_check_prim_token(item["usd_prim_path"], item["ifc_global_id22"]))

    for item in difference_sets["ifc_usdc_unmapped"]:
        codes.extend(_check_guid_roundtrip(item["ifc_uuid36"], item["ifc_global_id22"]))
        observed = item.get("observed_prim_path")
        if observed is not None:
            expected_root = usd_element_root_path(
                item["ifc_class"], item["ifc_global_id22"]
            )
            if not observed.startswith(expected_root + "/"):
                codes.append("OBSERVED_CHILD_PRIM_ROOT_MISMATCH")

    return codes


def _check_guid_roundtrip(ifc_uuid36: str, global_id22: str) -> list[str]:
    try:
        compressed = ifc_guid_compress(ifc_uuid36)
        expanded = ifc_guid_expand(global_id22)
    except ValueError:
        return ["GUID_ROUNDTRIP_FAILED"]
    if compressed != global_id22 or expanded != ifc_uuid36:
        return ["GUID_ROUNDTRIP_FAILED"]
    return []


def _check_prim_token(usd_prim_path: str, global_id22: str) -> list[str]:
    """Blueprint E-9/E-10: one-way prim token check plus the length guard.

    The token derivation is the streaming authority's, i.e. ``G_`` plus the
    sanitized GlobalId with the synthetic leading underscore stripped. Length
    is checked here rather than in the schema so the schema pattern stays
    ``G_[A-Za-z0-9_]+``.
    """
    codes: list[str] = []
    token = usd_prim_path.rsplit("/", 1)[-1]
    if len(token) != USD_GUID_TOKEN_LENGTH:
        codes.append("PRIM_TOKEN_LENGTH_INVALID")
    if token != usd_guid_token(global_id22):
        codes.append("PRIM_TOKEN_MISMATCH")
    return codes


def _validate_set_disjointness(
    difference_sets: Mapping[str, Sequence[Mapping[str, Any]]],
) -> list[str]:
    codes: list[str] = []
    matched = difference_sets["full_lineage_matched"]
    matched_rvt_ids = {item["rvt_element_id"] for item in matched}
    matched_global_ids = {item["ifc_global_id22"] for item in matched}

    if any(item["rvt_element_id"] in matched_rvt_ids for item in difference_sets["csv_only"]):
        codes.append("CSV_ONLY_AND_FULL_LINEAGE_OVERLAP")
    if any(
        item["ifc_global_id22"] in matched_global_ids
        for item in difference_sets["ifc_only"]
    ):
        codes.append("IFC_ONLY_AND_FULL_LINEAGE_OVERLAP")
    return codes


def _safe_canonical(value: str) -> str | None:
    try:
        return canonical_uuid36(value)
    except ValueError:
        return None


def _dedupe(codes: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered: MutableSequence[str] = []
    for code in codes:
        if code not in seen:
            seen.add(code)
            ordered.append(code)
    return list(ordered)


# ---------------------------------------------------------------------------
# Shared observation helpers for the wire-vocabulary validators
# ---------------------------------------------------------------------------

#: The three roles ``source-bundle-manifest/v1`` requires, in manifest order.
BUNDLE_REQUIRED_ROLES = ("source_rvt", "schedule_csv", "source_ifc")

#: ``attempt_outcome`` values a result may be selected from (spec.md matrix).
SELECTABLE_ATTEMPT_OUTCOMES = frozenset({"succeeded", "succeeded_with_warnings"})

#: ``ready_event_ledger`` kinds that are recoveries, never new logical jobs.
RESTART_EVENT_KINDS = frozenset({"streaming_restart", "coordinator_restart"})

#: ``transition`` values that move the active pointer onto a chosen result.
POINTER_MOVING_TRANSITIONS = frozenset({"promote", "rollback"})


def _parse_utc(text: str) -> datetime:
    """Parse one ``$defs/utcTimestamp`` value into an aware ``datetime``.

    Timestamps are compared as instants, never as strings: ``...:00Z`` and
    ``...:00.000Z`` are the same moment but sort in the wrong order
    lexicographically, which would make the publish-order diagnostics depend on
    how many fractional digits a producer happened to emit.
    """
    value = str(text)
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def _locator_authority(ref: str) -> str:
    """Return the MinIO authority (host part) of a ``minio://`` locator."""
    remainder = str(ref).split("://", 1)[-1]
    return remainder.split("/", 1)[0]


def _locator_version_id(ref: str) -> str | None:
    """Return the ``?versionId=`` value of a locator, or ``None`` when absent."""
    _, separator, query = str(ref).partition("?versionId=")
    if not separator:
        return None
    return query.split("&", 1)[0]


def _is_presigned(ref: str) -> bool:
    """True when the locator carries an ``X-Amz-`` style presign parameter."""
    lowered = str(ref).lower()
    return "?x-amz-" in lowered or "&x-amz-" in lowered


def _check_object_refs(artifacts: Sequence[Mapping[str, Any]]) -> list[str]:
    """Per-artifact locator / completeness diagnostics, in array order.

    Shared by the bundle manifest and the legacy preview: both enumerate MinIO
    objects with a flattened locator, and the same three observations apply.
    """
    codes: list[str] = []
    for artifact in artifacts:
        ref = artifact["ref"]
        if _is_presigned(ref):
            codes.append("presigned_locator_forbidden")
        if _locator_version_id(ref) != artifact["object_version_id"]:
            # A locator whose ?versionId= does not name the object version the
            # manifest claims is not pinned to immutable bytes at all.
            codes.append("unversioned_locator")
        if artifact["size_bytes"] == 0:
            codes.append("artifact_incomplete")
    return codes


def _check_required_roles(artifacts: Sequence[Mapping[str, Any]]) -> list[str]:
    """The three required roles must each appear exactly once."""
    codes: list[str] = []
    roles = [artifact["role"] for artifact in artifacts]
    if any(role not in roles for role in BUNDLE_REQUIRED_ROLES):
        codes.append("missing_required_role")
    if any(roles.count(role) > 1 for role in BUNDLE_REQUIRED_ROLES):
        codes.append("duplicate_role")
    return codes


def _check_single_authority(artifacts: Sequence[Mapping[str, Any]]) -> list[str]:
    """Every object of one bundle must live under one MinIO authority.

    A bundle split across two authorities cannot be conditionally created,
    versioned or retained as one immutable unit, so it is a contract violation
    rather than a per-object integrity problem.
    """
    authorities = {_locator_authority(artifact["ref"]) for artifact in artifacts}
    if len(authorities) > 1:
        return ["semantic_contract_violation"]
    return []


# ---------------------------------------------------------------------------
# Bundle manifest scenarios (task 2.1)
# ---------------------------------------------------------------------------


def validate_bundle_scenario(document: Mapping[str, Any]) -> list[str]:
    """Semantic invariants of ``model-version-bundle-manifest/v1`` (task 2.1).

    ``document`` is the whole envelope and is assumed to satisfy
    ``tests/contracts/model_version_bundle_manifest.json`` already. Emitted
    codes are drawn from the contract's own ``$defs/integrityDiagnosticCode``
    enum, so the semantic layer and the wire diagnostics speak one vocabulary.

    Implemented rules, by ``document_type``:

    ``source_bundle_manifest``
        1. ``missing_required_role`` / 2. ``duplicate_role`` -- the three
           required roles appear exactly once each.
        3. ``presigned_locator_forbidden`` / 4. ``unversioned_locator`` /
           5. ``artifact_incomplete`` -- per artifact, in array order: no
           presign parameters, ``?versionId=`` byte-equal to
           ``object_version_id``, non-zero ``size_bytes``.
        6. ``semantic_contract_violation`` -- all artifacts share one MinIO
           authority.
        7. ``manifest_published_before_artifacts`` -- ``published_at`` is not
           earlier than ``created_at`` (the manifest publishes last).

    ``legacy_unmanaged_preview``
        Rules 1-6 again, over ``candidate_metadata.candidate_artifacts``: a
        grouping that cannot show all three roles must not be presented as
        enrollable.

    ``source_bundle_validation_result``
        8. ``semantic_contract_violation`` -- ``conditional_create.attempted``
           and the reported ``outcome`` must agree about whether an attempt
           happened (``not_attempted`` iff ``attempted`` is false).
        9. ``manifest_digest_conflict`` -- a ``conflict_different_digest``
           outcome cannot also be a same-bytes ``replay``.
        10. ``immutable_bundle_overwrite_rejected`` -- a ``replay`` that
            reports ``created`` claims to have overwritten an immutable bundle.

    ``legacy_enrollment_confirmation`` carries no cross-field arithmetic the
    schema cannot already express, so it yields no semantic codes.

    Not implemented here, and deliberately so: ``artifact_not_found``,
    ``etag_mismatch``, ``sha256_mismatch`` and ``size_mismatch`` need a live
    object-store HEAD and cannot be decided from the document alone.
    """
    codes: list[str] = []
    document_type = document.get("document_type")
    body = document.get("body", {})

    if document_type == "source_bundle_manifest":
        artifacts = body["artifacts"]
        codes.extend(_check_required_roles(artifacts))
        codes.extend(_check_object_refs(artifacts))
        codes.extend(_check_single_authority(artifacts))
        if _parse_utc(body["published_at"]) < _parse_utc(body["created_at"]):
            codes.append("manifest_published_before_artifacts")

    elif document_type == "legacy_unmanaged_preview":
        candidates = body["candidate_metadata"]["candidate_artifacts"]
        codes.extend(_check_required_roles(candidates))
        codes.extend(_check_object_refs(candidates))
        codes.extend(_check_single_authority(candidates))

    elif document_type == "source_bundle_validation_result":
        conditional_create = body["conditional_create"]
        attempted = conditional_create["attempted"]
        outcome = conditional_create["outcome"]
        replay = body["replay"]

        if attempted != (outcome != "not_attempted"):
            codes.append("semantic_contract_violation")
        if outcome == "conflict_different_digest" and replay:
            codes.append("manifest_digest_conflict")
        if replay and outcome == "created":
            codes.append("immutable_bundle_overwrite_rejected")

    return _dedupe(codes)


# ---------------------------------------------------------------------------
# Pipeline job / attempt scenarios (task 2.3, job half)
# ---------------------------------------------------------------------------


def validate_job_scenario(document: Mapping[str, Any]) -> list[str]:
    """Semantic invariants of ``pipeline-job-attempt/v1`` (task 2.3).

    Implemented rules, by ``document_type``:

    ``pipeline_job``
        1. ``restart_created_second_logical_job`` -- a ``streaming_restart`` or
           ``coordinator_restart`` ledger entry may never set
           ``created_new_logical_job``; a restart recovers the same logical
           job, at any ledger position.
        2. ``duplicate_logical_job_for_source_bundle`` -- among the remaining
           kinds only the *first* ledger entry may create the logical job; a
           replayed ready event that creates a second one duplicates the job
           for one ``source_bundle_id``.
        3. ``semantic_invalid_source_retried_same_job`` -- a job that reached
           the terminal ``manual_correction_required`` state must carry neither
           an in-flight attempt nor a ``retry`` ledger entry; the fix is a new
           source bundle and a new job.

    ``admission_record``
        4. ``lease_loss_consumed_attempt`` -- a non-``ADMITTED`` record whose
           ``blocker_codes`` contain ``lease_lost`` must not move the attempt
           counter: losing the Kit lease returns the job to admission, it does
           not burn a failed attempt.
        5. ``waiting_capacity_consumed_attempt`` -- the same counter rule for
           every other non-``ADMITTED`` reason.

    ``result_compare``
        6. ``compare_cross_job_rejected`` -- both sides and the enclosing body
           must name one ``pipeline_job_id``; a cross-job compare fails closed.

    ``activation_audit_entry``
        7. ``promote_target_not_selectable`` -- ``promote`` / ``rollback`` may
           only target evidence that is ``AVAILABLE`` with a selectable
           outcome. The schema deliberately lets the audit entry record a
           violating transition (audit is append-only evidence of what
           happened), so the binding is enforced here.
        8. ``auto_promotion_of_subsequent_result`` -- a ``promote`` raised by a
           ``system`` actor with no ``authorization_decision_ref`` is an
           automatic replacement of the active pointer; a later successful
           result may only reach ``candidate``.

    ``active_result_pointer`` and ``retention_policy`` are fully constrained by
    the schema and yield no semantic codes.
    """
    codes: list[str] = []
    document_type = document.get("document_type")
    body = document.get("body", {})

    if document_type == "pipeline_job":
        ledger = body["ready_event_ledger"]
        for index, entry in enumerate(ledger):
            if not entry["created_new_logical_job"]:
                continue
            if entry["event_kind"] in RESTART_EVENT_KINDS:
                codes.append("restart_created_second_logical_job")
            elif index > 0:
                codes.append("duplicate_logical_job_for_source_bundle")

        if body["job_state"] == "manual_correction_required":
            retried = body["in_flight_attempt_id"] is not None or any(
                entry["event_kind"] == "retry" for entry in ledger
            )
            if retried:
                codes.append("semantic_invalid_source_retried_same_job")

    elif document_type == "admission_record":
        consumed = body["attempt_counter_after"] != body["attempt_counter_before"]
        if body["admission_status"] != "ADMITTED" and consumed:
            if "lease_lost" in body["blocker_codes"]:
                codes.append("lease_loss_consumed_attempt")
            else:
                codes.append("waiting_capacity_consumed_attempt")

    elif document_type == "result_compare":
        job_ids = {
            body["pipeline_job_id"],
            body["left"]["pipeline_job_id"],
            body["right"]["pipeline_job_id"],
        }
        if len(job_ids) > 1:
            codes.append("compare_cross_job_rejected")

    elif document_type == "activation_audit_entry":
        transition = body["transition"]
        evidence = body.get("target_result_evidence")
        if transition in POINTER_MOVING_TRANSITIONS and evidence is not None:
            not_available = evidence["publication_state"] != "AVAILABLE"
            not_selectable = (
                evidence["attempt_outcome"] not in SELECTABLE_ATTEMPT_OUTCOMES
            )
            if not_available or not_selectable:
                codes.append("promote_target_not_selectable")

        if (
            transition == "promote"
            and body["actor"]["actor_kind"] == "system"
            and body["authorization_decision_ref"] is None
        ):
            codes.append("auto_promotion_of_subsequent_result")

    return _dedupe(codes)


# ---------------------------------------------------------------------------
# Result manifest / publication scenarios (task 2.3, result half)
# ---------------------------------------------------------------------------


def validate_result_publication_scenario(document: Mapping[str, Any]) -> list[str]:
    """Semantic invariants of ``result-manifest-document/v1`` (task 2.3/2.5).

    Implemented rules, by ``document_type``:

    ``result_manifest``
        1. ``manifest_published_before_artifacts`` -- the manifest's
           ``published_at`` must not precede any artifact's ``published_at``.
           A manifest published first can be read while the objects it names
           are still uploading.
        2. ``alignment_summary_denominator_mismatch`` -- the embedded summary's
           three denominators must bind to the counts exactly the way the
           alignment report binds them. The check delegates to
           :func:`validate_alignment_summary` and collapses its three
           ``*_DENOMINATOR_MISMATCH`` codes into the one wire-level code, so
           producer, result manifest and cloud publication cannot drift apart
           (``spec.md`` requires one implementation of the binding).

    ``result_publication_outcome``
        3. ``second_formal_result_for_attempt`` -- a non-null
           ``prior_result_id`` must equal ``result_id``. A resumed publication
           continues the same formal result; a different id means the attempt
           grew a second one. This is diagnosed first and on its own: once the
           prior result is a *different* result, the digest comparison below is
           comparing two documents and can say nothing about idempotence.
        4. ``non_idempotent_replay_reported_as_created`` -- re-publishing the
           same result with the same manifest digest must report
           ``replay_same_digest``, never ``created``.
        5. ``manifest_digest_conflict`` -- a digest that differs from the prior
           digest must be reported as ``conflict_different_digest``; claiming
           ``replay_same_digest`` (or ``created``) would overwrite an immutable
           formal result.

    ``local_cache_observation`` is fully constrained by the schema's
    ``formal_availability`` / ``rebuild_from_minio_possible`` consts and yields
    no semantic codes.
    """
    codes: list[str] = []
    document_type = document.get("document_type")
    body = document.get("body", {})

    if document_type == "result_manifest":
        manifest_published_at = _parse_utc(body["published_at"])
        artifact_times = [
            _parse_utc(artifact["published_at"])
            for artifact in body["artifacts"]
            if artifact.get("published_at") is not None
        ]
        if any(published > manifest_published_at for published in artifact_times):
            codes.append("manifest_published_before_artifacts")

        summary = body["alignment_summary"]
        binding_codes = validate_alignment_summary(
            summary["metrics"], summary["counts"]
        )
        if any(code.endswith("_DENOMINATOR_MISMATCH") for code in binding_codes):
            codes.append("alignment_summary_denominator_mismatch")

    elif document_type == "result_publication_outcome":
        result_id = body["result_id"]
        prior_result_id = body["prior_result_id"]
        digest = body["result_manifest_digest"]
        prior_digest = body["prior_result_manifest_digest"]
        outcome = body["conditional_create"].get("outcome")

        if prior_result_id is not None and prior_result_id != result_id:
            codes.append("second_formal_result_for_attempt")
        elif prior_digest is not None:
            if prior_digest == digest:
                if outcome == "created":
                    codes.append("non_idempotent_replay_reported_as_created")
            elif outcome != "conflict_different_digest":
                codes.append("manifest_digest_conflict")

    return _dedupe(codes)
