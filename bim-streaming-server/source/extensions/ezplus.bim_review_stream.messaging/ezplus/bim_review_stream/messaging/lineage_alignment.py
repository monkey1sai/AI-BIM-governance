"""schedule.csv ↔ IFC ↔ USDC lineage alignment report.

Contract: ``tests/contracts/lineage_alignment_report.json``
(``lineage-alignment-report/v1``). Invariants: ``validate_alignment_report`` in
``tests/contracts/lineage/semantic_validators.py``; the coordinator applies the
same rules when it reads the report back.

Identity chain, exact matches only (no name, ordinal or geometry fallback):

    schedule.csv ID (Revit element, kept verbatim)
      + IfcGUID (UUID36)  →  IFC GlobalId22  →  /World/Elements/<IfcClass>/G_<guid>

A row is valid when its ID is non-empty and unique in the file and its IfcGUID is
a UUID36 whose 128-bit value is unique in the file. Every occurrence of a
duplicated ID or GUID is invalid. ``row_number`` is the 1-based position among
non-blank data rows. The eligible IFC population is ``eligible_ifc_products``,
the same set behind ``source_ifc_entity_count``.
"""

from __future__ import annotations

from collections import Counter
import csv
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, ROUND_DOWN
import io
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Callable, Iterable, Mapping, Sequence

from conversion_authority import eligible_ifc_products
from ifc_openusd_identity_author import build_identity_root_path, usd_safe_identifier

REPORT_DOCUMENT_SCHEMA_VERSION = "lineage-alignment-report/v1"
REPORT_BODY_SCHEMA_VERSION = "alignment-report/v1"
REPORT_JSON_FILENAME = "alignment_report.json"
REPORT_CSV_FILENAME = "alignment_report.csv"
CSV_COLUMNS = (
    "row_number",
    "rvt_element_id",
    "ifc_uuid36_raw",
    "ifc_uuid36",
    "ifc_global_id22",
    "usd_prim_path",
    "alignment_class",
    "reason_code",
)
IFC_GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"
RVT_ELEMENT_ID_MAX_LENGTH = 200
MAX_WARNING_CODES = 64

_UUID36 = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_GLOBAL_ID22 = re.compile(r"^[0-3][0-9A-Za-z_$]{21}$")
_CHILD_PRIM_PATH = re.compile(
    r"^/World/Elements/[A-Za-z_][A-Za-z0-9_]*/G_[A-Za-z0-9_]+(?:/[A-Za-z_][A-Za-z0-9_]*)+$"
)
_IDENTIFIER_MAX_LENGTH = 200
_RATIO_QUANTUM = Decimal(1).scaleb(-10)
_MAPPED = "mapped"


class ScheduleCsvError(ValueError):
    """schedule.csv cannot be read as a table with ``ID`` and ``IfcGUID`` columns."""


class AlignmentReportError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ReportIdentity:
    source_bundle_id: str
    pipeline_job_id: str
    attempt_id: str
    result_id: str


@dataclass(frozen=True)
class ScheduleRow:
    row_number: int
    rvt_element_id: str
    ifc_guid: str


@dataclass(frozen=True)
class AlignmentOutcome:
    document: dict[str, Any]
    csv_rows: list[dict[str, Any]]
    #: GlobalId22 → {"rvt_element_id", "ifc_uuid36", "status", "expected_root"} per eligible product.
    products: dict[str, dict[str, Any]]
    schedule_present: bool


# ── identity helpers ─────────────────────────────────────────────────────────


def _uuid_hex(value: str) -> str:
    if not _UUID36.fullmatch(str(value)):
        raise ValueError(f"not a UUID36 string: {value!r}")
    return str(value).replace("-", "").lower()


def _encode(value: int, length: int) -> str:
    return "".join(IFC_GUID_CHARS[(value >> (6 * position)) & 0x3F] for position in reversed(range(length)))


def ifc_guid_compress(uuid36: str) -> str:
    """UUID36 (any case) → 22-character IFC GlobalId."""
    octets = bytes.fromhex(_uuid_hex(uuid36))
    groups = [_encode(octets[0], 2)]
    for index in range(1, 16, 3):
        groups.append(_encode(int.from_bytes(octets[index:index + 3], "big"), 4))
    return "".join(groups)


def ifc_guid_expand(global_id22: str) -> str:
    """22-character IFC GlobalId → canonical lowercase UUID36."""
    text = str(global_id22)
    if not _GLOBAL_ID22.fullmatch(text):
        raise ValueError(f"not an IFC GlobalId: {text!r}")
    value = 0
    for char in text:
        value = (value << 6) | IFC_GUID_CHARS.index(char)
    hexdigits = value.to_bytes(16, "big").hex()
    return "-".join((hexdigits[0:8], hexdigits[8:12], hexdigits[12:16], hexdigits[16:20], hexdigits[20:32]))


def _expand_or_none(global_id22: Any) -> str | None:
    try:
        return ifc_guid_expand(str(global_id22))
    except ValueError:
        return None


# ── schedule.csv ─────────────────────────────────────────────────────────────


def read_schedule_csv(path: Path | str) -> list[ScheduleRow]:
    try:
        text = Path(path).read_bytes().decode("utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise ScheduleCsvError(f"schedule.csv is not readable UTF-8: {exc}") from exc
    try:
        records = list(csv.reader(io.StringIO(text, newline="")))
    except csv.Error as exc:
        raise ScheduleCsvError(f"schedule.csv is not valid CSV: {exc}") from exc
    if not records:
        raise ScheduleCsvError("schedule.csv is empty.")
    header = [cell.strip() for cell in records[0]]
    if "ID" not in header or "IfcGUID" not in header:
        raise ScheduleCsvError("schedule.csv must have ID and IfcGUID columns.")
    id_index, guid_index = header.index("ID"), header.index("IfcGUID")
    rows: list[ScheduleRow] = []
    for cells in records[1:]:
        if not any(cell.strip() for cell in cells):
            continue
        rows.append(ScheduleRow(
            row_number=len(rows) + 1,
            rvt_element_id=cells[id_index] if id_index < len(cells) else "",
            ifc_guid=cells[guid_index] if guid_index < len(cells) else "",
        ))
    return rows


# ── alignment ────────────────────────────────────────────────────────────────


def _metric(numerator: int, denominator: int, scope: str) -> dict[str, Any]:
    if denominator == 0:
        ratio, status = None, "not_evaluable"
    else:
        quotient = (Decimal(numerator) / Decimal(denominator)).quantize(_RATIO_QUANTUM, rounding=ROUND_DOWN)
        ratio, status = float(quotient), ("complete" if numerator == denominator else "partial")
    return {"numerator": numerator, "denominator": denominator, "ratio": ratio, "status": status,
            "denominator_scope": scope}


def _check_identity(identity: ReportIdentity) -> None:
    for name in ("source_bundle_id", "pipeline_job_id", "attempt_id", "result_id"):
        value = getattr(identity, name)
        if not isinstance(value, str) or not 1 <= len(value) <= _IDENTIFIER_MAX_LENGTH:
            raise AlignmentReportError("alignment_identity_invalid", f"Report {name} is not a valid identifier.")
    if ":" in identity.result_id:
        raise AlignmentReportError("alignment_identity_invalid", "Report result_id must not contain ':'.")


def _product_mapping(
    global_id: str,
    ifc_class: str,
    paths: Sequence[str],
    prim_exists: Callable[[str], bool],
) -> tuple[str, str, str | None]:
    """Return (status, expected_root, observed_child_path) for one eligible product."""
    expected = build_identity_root_path(ifc_class, global_id).path
    if expected in paths and prim_exists(expected):
        return _MAPPED, expected, None
    child = next((path for path in paths if path.startswith(expected + "/")), None)
    if child is not None and _CHILD_PRIM_PATH.fullmatch(child):
        return "unstable_child_prim_target", expected, child
    if any(path != expected for path in paths):
        return "prim_token_mismatch", expected, None
    return "prim_not_found", expected, None


def build_alignment_report(
    *,
    identity: ReportIdentity,
    schedule_rows: Sequence[ScheduleRow] | None,
    eligible_products: Mapping[str, str],
    mapping_paths: Mapping[str, Sequence[str]],
    prim_exists: Callable[[str], bool],
    generated_at: str,
    warning_codes: Iterable[str] = (),
) -> AlignmentOutcome:
    _check_identity(identity)
    warnings = set(warning_codes)
    rows = list(schedule_rows or ())

    # 1. Schedule rows: validity, duplicates, reason codes.
    canonical = {row.row_number: row.ifc_guid.lower() for row in rows if _UUID36.fullmatch(row.ifc_guid)}
    id_counts = Counter(row.rvt_element_id for row in rows if row.rvt_element_id.strip())
    guid_counts = Counter(canonical.values())
    row_reason: dict[int, str] = {}
    for row in rows:
        if not row.rvt_element_id.strip():
            reason = "missing_id"
        elif len(row.rvt_element_id) > RVT_ELEMENT_ID_MAX_LENGTH:
            reason = "missing_id"
            warnings.add("RVT_ELEMENT_ID_TOO_LONG")
        elif not row.ifc_guid.strip():
            reason = "missing_guid"
        elif row.row_number not in canonical:
            reason = "invalid_guid_format"
            if _GLOBAL_ID22.fullmatch(row.ifc_guid.strip()):
                warnings.add("SCHEDULE_IFCGUID_GLOBALID22_FORMAT")
        elif id_counts[row.rvt_element_id] > 1:
            reason = "duplicate_id"
        elif guid_counts[canonical[row.row_number]] > 1:
            reason = "duplicate_guid"
        else:
            continue
        row_reason[row.row_number] = reason
    valid_rows = [row for row in rows if row.row_number not in row_reason]

    invalid_rows = []
    for row in rows:
        reason = row_reason.get(row.row_number)
        if reason is None:
            continue
        item: dict[str, Any] = {"row_number": row.row_number, "reason_code": reason}
        if reason != "missing_id":
            item["rvt_element_id"] = row.rvt_element_id
        if reason != "missing_guid" and row.row_number in canonical:
            item["ifc_uuid36_raw"] = row.ifc_guid
        invalid_rows.append(item)
    duplicate_rvt_ids = [
        {"rvt_element_id": value, "occurrence_count": count}
        for value, count in id_counts.items()
        if count > 1 and len(value) <= RVT_ELEMENT_ID_MAX_LENGTH
    ]
    duplicate_ifc_guids = [
        {"ifc_uuid36": value, "occurrence_count": count} for value, count in guid_counts.items() if count > 1
    ]

    # 2. Eligible IFC products and their USD mapping.
    products: dict[str, dict[str, Any]] = {}
    for global_id, ifc_class in eligible_products.items():
        class_token = usd_safe_identifier(ifc_class, fallback="Unclassified")
        paths = [path for path in mapping_paths.get(global_id, ()) if isinstance(path, str)]
        status, expected, observed = _product_mapping(global_id, class_token, paths, prim_exists)
        uuid36 = _expand_or_none(global_id)
        if uuid36 is None:
            warnings.add("IFC_GLOBALID_NOT_EXPANDABLE")
        products[global_id] = {"ifc_class": class_token, "ifc_uuid36": uuid36, "status": status,
                               "expected_root": expected, "observed_prim_path": observed,
                               "rvt_element_id": None}

    # 3. Valid rows → IFC products.
    csv_only = []
    row_product: dict[int, str] = {}
    for row in valid_rows:
        uuid36 = canonical[row.row_number]
        global_id = ifc_guid_compress(uuid36)
        if ifc_guid_expand(global_id) != uuid36:
            csv_only.append({"rvt_element_id": row.rvt_element_id, "ifc_uuid36_raw": row.ifc_guid,
                             "ifc_uuid36": uuid36, "reason_code": "guid_roundtrip_failed"})
        elif global_id not in products:
            csv_only.append({"rvt_element_id": row.rvt_element_id, "ifc_uuid36_raw": row.ifc_guid,
                             "ifc_uuid36": uuid36, "ifc_global_id22": global_id,
                             "reason_code": "ifc_product_not_found"})
        else:
            row_product[row.row_number] = global_id
            products[global_id]["rvt_element_id"] = row.rvt_element_id

    matched_products = set(row_product.values())
    ifc_only = []
    unmapped = []
    for global_id, product in products.items():
        if product["ifc_uuid36"] is None:
            continue
        identity_fields = {"ifc_global_id22": global_id, "ifc_uuid36": product["ifc_uuid36"],
                           "ifc_class": product["ifc_class"]}
        if global_id not in matched_products:
            item = dict(identity_fields)
            if product["status"] == _MAPPED:
                item["usd_prim_path"] = product["expected_root"]
            ifc_only.append(item)
        if product["status"] != _MAPPED:
            item = {**identity_fields, "reason_code": product["status"]}
            if product["observed_prim_path"] is not None:
                item["observed_prim_path"] = product["observed_prim_path"]
            unmapped.append(item)
    full_lineage = [
        {"rvt_element_id": row.rvt_element_id, "ifc_uuid36": products[row_product[row.row_number]]["ifc_uuid36"],
         "ifc_global_id22": row_product[row.row_number],
         "usd_prim_path": products[row_product[row.row_number]]["expected_root"]}
        for row in valid_rows
        if row.row_number in row_product and products[row_product[row.row_number]]["status"] == _MAPPED
    ]

    # 4. Counts and metrics (validate_alignment_summary bindings).
    eligible = len(products)
    unmapped_count = sum(1 for product in products.values() if product["status"] != _MAPPED)
    counts = {
        "csv_total_count": len(rows),
        "csv_valid_count": len(valid_rows),
        "eligible_ifc_product_count": eligible,
        "duplicate_rvt_id_count": len(duplicate_rvt_ids),
        "duplicate_ifc_guid_count": len(duplicate_ifc_guids),
        "invalid_row_count": len(invalid_rows),
        "csv_only_count": len(csv_only),
        "ifc_only_count": eligible - len(matched_products),
        "ifc_usdc_unmapped_count": unmapped_count,
        "full_lineage_matched_count": len(full_lineage),
    }
    metrics = {
        "ifc_usdc_coverage_ratio": _metric(eligible - unmapped_count, eligible, "eligible_ifc_product_count"),
        "rvt_ifc_alignment_ratio": _metric(len(matched_products), len(valid_rows), "csv_valid_count"),
        "rvt_ifc_usdc_lineage_ratio": _metric(len(full_lineage), len(valid_rows), "csv_valid_count"),
    }
    for condition, code in (
        (invalid_rows, "SCHEDULE_ROWS_INVALID"),
        (duplicate_rvt_ids, "SCHEDULE_DUPLICATE_RVT_IDS"),
        (duplicate_ifc_guids, "SCHEDULE_DUPLICATE_IFC_GUIDS"),
        (csv_only, "RVT_IFC_UNMATCHED_ROWS"),
        (counts["ifc_only_count"], "IFC_PRODUCTS_WITHOUT_SCHEDULE_ROW"),
        (unmapped_count, "IFC_USDC_UNMAPPED"),
        (any(item["reason_code"] == "unstable_child_prim_target" for item in unmapped),
         "UNSTABLE_CHILD_PRIM_TARGET"),
    ):
        if condition:
            warnings.add(code)
    codes = sorted(warnings)[:MAX_WARNING_CODES]

    document = {
        "schema_version": REPORT_DOCUMENT_SCHEMA_VERSION,
        "document_type": "alignment_report_json",
        "body": {
            "report_schema_version": REPORT_BODY_SCHEMA_VERSION,
            "source_bundle_id": identity.source_bundle_id,
            "pipeline_job_id": identity.pipeline_job_id,
            "attempt_id": identity.attempt_id,
            "result_id": identity.result_id,
            "generated_at": generated_at,
            "scope": {
                "eligible_ifc_product_selector": "IfcProduct",
                "eligible_ifc_product_count": eligible,
                "legacy_alias": {"source_ifc_entity_count_is_alias_of": "eligible_ifc_product_count"},
            },
            "metrics": metrics,
            "counts": counts,
            "difference_sets": {
                "csv_only": csv_only,
                "ifc_only": ifc_only,
                "ifc_usdc_unmapped": unmapped,
                "duplicate_rvt_ids": duplicate_rvt_ids,
                "duplicate_ifc_guids": duplicate_ifc_guids,
                "invalid_rows": invalid_rows,
                "full_lineage_matched": full_lineage,
            },
            "warning_codes": codes,
            "warning_code_count": len(codes),
        },
    }
    _check_invariants(counts, metrics)

    csv_rows = _csv_rows(rows, row_reason, canonical, csv_only, row_product, products,
                         duplicate_rvt_ids, duplicate_ifc_guids, ifc_only, unmapped, matched_products)
    return AlignmentOutcome(document=document, csv_rows=csv_rows, products=products,
                            schedule_present=schedule_rows is not None)


def _check_invariants(counts: Mapping[str, int], metrics: Mapping[str, Mapping[str, Any]]) -> None:
    """Fail closed if the producer ever breaks the bindings the readers enforce."""
    eligible = counts["eligible_ifc_product_count"]
    matched = metrics["rvt_ifc_alignment_ratio"]["numerator"]
    coverage = metrics["ifc_usdc_coverage_ratio"]["numerator"]
    full = counts["full_lineage_matched_count"]
    non_valid = counts["csv_total_count"] - counts["csv_valid_count"]
    holds = (
        matched == counts["csv_valid_count"] - counts["csv_only_count"]
        and counts["ifc_only_count"] == eligible - matched
        and coverage == eligible - counts["ifc_usdc_unmapped_count"]
        and max(0, matched + coverage - eligible) <= full <= min(matched, coverage)
        and non_valid >= 0
        and max(counts["duplicate_rvt_id_count"], counts["duplicate_ifc_guid_count"],
                counts["invalid_row_count"]) <= non_valid
    )
    if not holds:
        raise AlignmentReportError("alignment_invariant_violation", "Alignment counts are inconsistent.")


def _csv_rows(rows, row_reason, canonical, csv_only, row_product, products,
              duplicate_rvt_ids, duplicate_ifc_guids, ifc_only, unmapped, matched_products):
    csv_only_items = iter(csv_only)
    lines: list[dict[str, Any]] = []
    for row in rows:
        line = {"row_number": row.row_number, "rvt_element_id": row.rvt_element_id,
                "ifc_uuid36_raw": row.ifc_guid if row.row_number in canonical else "",
                "ifc_uuid36": canonical.get(row.row_number, ""), "ifc_global_id22": "",
                "usd_prim_path": "", "alignment_class": "", "reason_code": ""}
        if row.row_number in canonical:
            line["ifc_global_id22"] = ifc_guid_compress(canonical[row.row_number])
        reason = row_reason.get(row.row_number)
        if reason is not None:
            if reason == "missing_id":
                line["rvt_element_id"] = ""
            line.update(alignment_class="invalid_row", reason_code=reason)
        elif row.row_number in row_product:
            product = products[row_product[row.row_number]]
            if product["status"] == _MAPPED:
                line.update(alignment_class="full_lineage_matched", usd_prim_path=product["expected_root"])
            else:
                line.update(alignment_class="ifc_usdc_unmapped", reason_code=product["status"],
                            usd_prim_path=product["observed_prim_path"] or "")
        else:
            item = next(csv_only_items)
            line.update(alignment_class="csv_only", reason_code=item["reason_code"],
                        ifc_global_id22=item.get("ifc_global_id22", ""))
        lines.append(line)
    blank = {column: "" for column in CSV_COLUMNS}
    for group in duplicate_rvt_ids:
        lines.append({**blank, "rvt_element_id": group["rvt_element_id"],
                      "alignment_class": "duplicate_rvt_id", "reason_code": "duplicate_id"})
    for group in duplicate_ifc_guids:
        lines.append({**blank, "ifc_uuid36": group["ifc_uuid36"],
                      "ifc_global_id22": ifc_guid_compress(group["ifc_uuid36"]),
                      "alignment_class": "duplicate_ifc_guid", "reason_code": "duplicate_guid"})
    for item in ifc_only:
        lines.append({**blank, "ifc_uuid36": item["ifc_uuid36"], "ifc_global_id22": item["ifc_global_id22"],
                      "usd_prim_path": item.get("usd_prim_path", ""), "alignment_class": "ifc_only"})
    for item in unmapped:
        if item["ifc_global_id22"] in matched_products:
            continue
        lines.append({**blank, "ifc_uuid36": item["ifc_uuid36"], "ifc_global_id22": item["ifc_global_id22"],
                      "usd_prim_path": item.get("observed_prim_path", ""),
                      "alignment_class": "ifc_usdc_unmapped", "reason_code": item["reason_code"]})
    return lines


def _spreadsheet_safe(value: Any) -> str:
    """Keep spreadsheets from evaluating free-text IDs as formulas (CSV injection)."""
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "@", "\t", "\r") or (text[:1] == "-" and not re.fullmatch(r"-\d+", text)):
        return "'" + text
    return text


def render_alignment_csv(outcome: AlignmentOutcome) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for line in outcome.csv_rows:
        writer.writerow([_spreadsheet_safe(line.get(column)) for column in CSV_COLUMNS])
    return buffer.getvalue()


def annotate_mapping(document: Mapping[str, Any], outcome: AlignmentOutcome) -> dict[str, Any]:
    """Return a copy of element_mapping.json with additive lineage fields per item."""
    annotated = dict(document)
    items = []
    missing_schedule = [] if outcome.schedule_present else ["schedule_csv_missing"]
    for item in document.get("items") or ():
        if not isinstance(item, Mapping):
            items.append(item)
            continue
        global_id = item.get("ifc_guid")
        product = outcome.products.get(global_id) if isinstance(global_id, str) else None
        if product is None:
            status, rvt_element_id, uuid36 = "not_eligible_ifc_product", None, _expand_or_none(global_id)
        else:
            rvt_element_id, uuid36 = product["rvt_element_id"], product["ifc_uuid36"]
            path = item.get("usd_prim_path")
            if path == product["expected_root"] and product["status"] == _MAPPED:
                status = "full_lineage_matched" if rvt_element_id is not None else "no_schedule_row"
            elif isinstance(path, str) and path.startswith(product["expected_root"] + "/"):
                status = "unstable_child_prim_target"
            elif path == product["expected_root"]:
                status = "prim_not_found"
            else:
                status = "prim_token_mismatch"
        diagnostics = [] if status == "full_lineage_matched" else [status]
        if status == "no_schedule_row":
            diagnostics += missing_schedule
        items.append({**item, "rvt_element_id": rvt_element_id, "ifc_uuid36": uuid36,
                      "mapping_status": status, "diagnostics": diagnostics})
    annotated["items"] = items
    return annotated


# ── files ────────────────────────────────────────────────────────────────────


def utc_timestamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _load_eligible_products(ifc_path: Path) -> dict[str, str]:
    try:
        import ifcopenshell

        products = eligible_ifc_products(ifcopenshell.open(str(ifc_path)))
    except Exception as exc:  # noqa: BLE001
        raise AlignmentReportError("alignment_ifc_unreadable", f"Source IFC could not be read: {exc}") from exc
    if products is None:
        raise AlignmentReportError("alignment_ifc_unreadable", "Source IFC products could not be enumerated.")
    return products


def _load_mapping(mapping_path: Path) -> dict[str, Any]:
    try:
        document = json.loads(Path(mapping_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise AlignmentReportError("alignment_mapping_unreadable", f"element_mapping.json is unreadable: {exc}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("items"), list):
        raise AlignmentReportError("alignment_mapping_unreadable", "element_mapping.json has no items list.")
    return document


def _mapping_paths(document: Mapping[str, Any]) -> dict[str, list[str]]:
    paths: dict[str, list[str]] = {}
    for item in document.get("items") or ():
        if isinstance(item, Mapping) and isinstance(item.get("ifc_guid"), str) \
                and isinstance(item.get("usd_prim_path"), str):
            paths.setdefault(item["ifc_guid"], []).append(item["usd_prim_path"])
    return paths


def _usd_prim_lookup(model_path: Path) -> Callable[[str], bool]:
    try:
        from pxr import Sdf, Usd

        layer = Sdf.Layer.FindOrOpen(str(model_path))
        stage = Usd.Stage.Open(layer, load=Usd.Stage.LoadNone) if layer is not None else None
    except Exception as exc:  # noqa: BLE001
        raise AlignmentReportError("alignment_usd_unreadable", f"model.usdc could not be opened: {exc}") from exc
    if stage is None:
        raise AlignmentReportError("alignment_usd_unreadable", "model.usdc could not be opened.")

    def exists(path: str) -> bool:
        try:
            return bool(Sdf.Path.IsValidPathString(path)) and stage.GetPrimAtPath(path).IsValid()
        except Exception:  # noqa: BLE001
            return False

    return exists


def write_alignment_report(
    *,
    identity: ReportIdentity,
    ifc_path: Path,
    model_path: Path,
    mapping_path: Path,
    schedule_path: Path | None,
    output_dir: Path,
    generated_at: str | None = None,
    schedule_warning: str | None = None,
) -> dict[str, Any]:
    """Compute the report, write JSON/CSV next to the model and annotate the mapping.

    Must run before anything records the mapping digest (conversion validation).
    ``schedule_warning`` replaces ``SCHEDULE_CSV_MISSING`` when a schedule was
    supplied but could not be used.
    """
    warnings: list[str] = []
    schedule_rows: list[ScheduleRow] | None = None
    if schedule_path is None:
        warnings.append(schedule_warning or "SCHEDULE_CSV_MISSING")
    else:
        try:
            schedule_rows = read_schedule_csv(schedule_path)
        except ScheduleCsvError:
            warnings.append("SCHEDULE_CSV_UNREADABLE")
            schedule_rows = []
    products = _load_eligible_products(Path(ifc_path))
    mapping_document = _load_mapping(Path(mapping_path))
    outcome = build_alignment_report(
        identity=identity,
        schedule_rows=schedule_rows,
        eligible_products=products,
        mapping_paths=_mapping_paths(mapping_document),
        prim_exists=_usd_prim_lookup(Path(model_path)),
        generated_at=generated_at or utc_timestamp(),
        warning_codes=warnings,
    )
    output_dir = Path(output_dir)
    json_path = output_dir / REPORT_JSON_FILENAME
    csv_path = output_dir / REPORT_CSV_FILENAME
    _atomic_write(json_path, json.dumps(outcome.document, ensure_ascii=False, indent=2) + "\n")
    _atomic_write(csv_path, render_alignment_csv(outcome))
    _atomic_write(Path(mapping_path), json.dumps(annotate_mapping(mapping_document, outcome), ensure_ascii=False))
    body = outcome.document["body"]
    return {
        "alignment_report_json_path": json_path,
        "alignment_report_csv_path": csv_path,
        "lineage_alignment": {
            "status": "generated",
            "report_schema_version": REPORT_DOCUMENT_SCHEMA_VERSION,
            "metrics": body["metrics"],
            "counts": body["counts"],
            "warning_codes": body["warning_codes"],
            "schedule_csv": {
                "present": schedule_path is not None,
                "filename": Path(schedule_path).name if schedule_path is not None else None,
            },
        },
    }
