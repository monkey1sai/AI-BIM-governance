"""Deterministic and validated semantic-query interpretation for A4.

The model may propose normalized filters, but only this module decides whether
they cover every constraint-bearing part of the original query.  Incomplete or
unsafe candidates are useful to display, never to execute.
"""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Optional


CLASS_ALIASES: dict[str, str] = {
    "防火門": "IfcDoor",
    "防火门": "IfcDoor",
    "門": "IfcDoor",
    "门": "IfcDoor",
    "door": "IfcDoor",
    "firedoor": "IfcDoor",
    "fire door": "IfcDoor",
    "柱": "IfcColumn",
    "column": "IfcColumn",
    "牆": "IfcWall",
    "墙": "IfcWall",
    "wall": "IfcWall",
    "梁": "IfcBeam",
    "beam": "IfcBeam",
    "樓板": "IfcSlab",
    "楼板": "IfcSlab",
    "slab": "IfcSlab",
    "窗": "IfcWindow",
    "window": "IfcWindow",
    "空間": "IfcSpace",
    "空间": "IfcSpace",
    "space": "IfcSpace",
    "ifcdoor": "IfcDoor",
    "ifccolumn": "IfcColumn",
    "ifcwall": "IfcWall",
    "ifcbeam": "IfcBeam",
    "ifcslab": "IfcSlab",
    "ifcwindow": "IfcWindow",
    "ifcspace": "IfcSpace",
}
SUPPORTED_IFC_CLASSES = frozenset({*CLASS_ALIASES.values(), "IfcBuildingElementProxy"})

CN_FLOOR = {
    "一": "1",
    "二": "2",
    "三": "3",
    "四": "4",
    "五": "5",
    "六": "6",
    "七": "7",
    "八": "8",
    "九": "9",
    "十": "10",
}

PROP_COMPARE_RE = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?P<op><=|>=|==|=|<|>)\s*(?P<value>-?\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
STOREY_RE = re.compile(
    r"(?P<num>\d+)\s*[Ff樓层]|[Ff][Ll]?\s*(?P<fl>\d+)|Level\s*(?P<lv>\d+)|(?P<cn>[一二三四五六七八九十])\s*[樓层楼]",
    re.IGNORECASE,
)
PROXIMITY_RE = re.compile(
    r"(?:\b(?:within|near|distance|proximity)\b|附近|距離|邻近|鄰近|靠近|接近)",
    re.IGNORECASE,
)
UNSAFE_CONSTRUCT_RE = re.compile(
    r"(?:\b(?:not|except|without|exclude|excluding)\b|不含|排除|除外|之外|不是|非\s*\w+)",
    re.IGNORECASE,
)
BOOLEAN_OR_RE = re.compile(r"(?:\b(?:or|either)\b|或)", re.IGNORECASE)
_STOPWORD_RE = re.compile(
    r"(?:找|尋找|查找|搜尋|搜索|查詢|請|幫我|哪些|哪一些|所有|全部|其中|的|且|和|與|与|或|請問|\b(?:and|or)\b)",
    re.IGNORECASE,
)
_SAFE_STOREY_TOKEN_RE = re.compile(r"^(?:\d{1,3}|\d{1,3}[Ff]|[Ff][Ll]?\d{1,3}|level\s*\d{1,3})$", re.IGNORECASE)
_PROPERTY_SEMANTIC_RE = re.compile(r"(?:firerating|rating|防火|耐火|時效|时效|小時|小时|分鐘|分钟)", re.IGNORECASE)
_PUNCTUATION_RE = re.compile(r"[\s,，。.!！？?：:；;|/\\#*@~`'\"()（）\[\]{}]+")


@dataclass
class PropertyFilter:
    name: str
    op: str
    value: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class InterpretedFilters:
    raw_query: str
    ifc_classes: list[str] = field(default_factory=list)
    storey_tokens: list[str] = field(default_factory=list)
    property_filters: list[PropertyFilter] = field(default_factory=list)
    name_contains: list[str] = field(default_factory=list)
    unmatched_fragments: list[str] = field(default_factory=list)
    interpretable: bool = False
    notes: list[str] = field(default_factory=list)
    interpret_source: str = "deterministic"  # deterministic | llm | hybrid
    confidence: Optional[float] = None
    confidence_basis: Optional[str] = None
    schema_valid: bool = True
    usable: bool = False
    complete: bool = False
    unresolved_terms: list[str] = field(default_factory=list)
    validation_errors: list[str] = field(default_factory=list)
    consumed_spans: list[dict[str, Any]] = field(default_factory=list)

    def refresh_validation(self) -> None:
        self.usable = self.schema_valid and bool(
            self.ifc_classes or self.storey_tokens or self.property_filters or self.name_contains
        )
        self.interpretable = self.usable
        self.complete = self.usable and not self.unresolved_terms

    def to_dict(self) -> dict[str, Any]:
        confidence = self.confidence
        basis = self.confidence_basis
        if confidence is None and self.interpretable:
            confidence = 1.0 if self.interpret_source == "deterministic" else 0.75
        if basis is None and self.interpretable:
            basis = "deterministic_grammar" if self.interpret_source == "deterministic" else "llm_structured_json"
        return {
            "raw_query": self.raw_query,
            "ifc_classes": list(self.ifc_classes),
            "storey_tokens": list(self.storey_tokens),
            "property_filters": [prop.to_dict() for prop in self.property_filters],
            "name_contains": list(self.name_contains),
            "unmatched_fragments": list(self.unmatched_fragments),
            "interpretable": self.interpretable,
            "notes": list(self.notes),
            "interpret_source": self.interpret_source,
            "confidence": confidence,
            "confidence_basis": basis,
            "schema_valid": self.schema_valid,
            "usable": self.usable,
            "complete": self.complete,
            "unresolved_terms": list(self.unresolved_terms),
            "validation_errors": list(self.validation_errors),
            "consumed_spans": list(self.consumed_spans),
        }


_ALLOWED_OPS = {"<", "<=", ">", ">=", "=="}
_SPAN_FIELDS = {"ifc_classes", "storey_tokens", "property_filters", "name_contains"}


def _append_unique(target: list[str], value: str) -> None:
    if value and value not in target:
        target.append(value)


def _mark_invalid(out: InterpretedFilters, code: str) -> None:
    out.schema_valid = False
    _append_unique(out.validation_errors, code)


def _storey_numbers(text: str) -> set[str]:
    values: set[str] = set()
    for match in STOREY_RE.finditer(text):
        value = match.group("num") or match.group("fl") or match.group("lv")
        if match.group("cn"):
            value = CN_FLOOR.get(match.group("cn"), value)
        if value:
            values.add(str(value))
    return values


def _validate_property_constraints(out: InterpretedFilters) -> None:
    by_name: dict[str, list[PropertyFilter]] = {}
    for prop in out.property_filters:
        if not math.isfinite(prop.value):
            _mark_invalid(out, "invalid_property_value")
            return
        by_name.setdefault(prop.name, []).append(prop)
    for props in by_name.values():
        equals = {prop.value for prop in props if prop.op == "=="}
        if len(equals) > 1:
            _mark_invalid(out, "contradictory_property_filters")
            return
        lower: Optional[tuple[float, bool]] = None
        upper: Optional[tuple[float, bool]] = None
        for prop in props:
            if prop.op in {">", ">="}:
                candidate = (prop.value, prop.op == ">=")
                if lower is None or candidate[0] > lower[0] or (candidate[0] == lower[0] and not candidate[1]):
                    lower = candidate
            elif prop.op in {"<", "<="}:
                candidate = (prop.value, prop.op == "<=")
                if upper is None or candidate[0] < upper[0] or (candidate[0] == upper[0] and not candidate[1]):
                    upper = candidate
        if lower and upper and (lower[0] > upper[0] or (lower[0] == upper[0] and not (lower[1] and upper[1]))):
            _mark_invalid(out, "contradictory_property_filters")
            return
        if equals:
            equal = next(iter(equals))
            if (lower and (equal < lower[0] or (equal == lower[0] and not lower[1]))) or (
                upper and (equal > upper[0] or (equal == upper[0] and not upper[1]))
            ):
                _mark_invalid(out, "contradictory_property_filters")
                return


def _unsafe_terms(raw_query: str) -> list[str]:
    return [match.group(0).strip() for match in UNSAFE_CONSTRUCT_RE.finditer(raw_query or "") if match.group(0).strip()]


def _boolean_ambiguities(
    raw_query: str, ifc_classes: list[str], storey_tokens: Optional[list[str]] = None
) -> list[str]:
    terms = [match.group(0).strip() for match in BOOLEAN_OR_RE.finditer(raw_query or "") if match.group(0).strip()]
    if len(ifc_classes) > 1:
        terms.append("multiple_ifc_class_boolean_semantics")
    distinct_storeys = {re.sub(r"\D", "", token) for token in (storey_tokens or []) if re.sub(r"\D", "", token)}
    if len(distinct_storeys) > 1:
        terms.append("multiple_storey_boolean_semantics")
    return terms


def _remove_stopwords(text: str) -> str:
    result = _STOPWORD_RE.sub(" ", text)
    return _PUNCTUATION_RE.sub(" ", result).strip()


def _alias_pattern(alias: str) -> str:
    escaped = re.escape(alias)
    if re.fullmatch(r"[A-Za-z0-9 ]+", alias):
        return rf"\b{escaped}\b"
    return escaped


def _alias_matches(text: str, alias: str) -> list[re.Match[str]]:
    return list(re.finditer(_alias_pattern(alias), text, re.IGNORECASE))


def _class_matches_fragment(fragment: str, ifc_class: str) -> bool:
    lowered = fragment.lower()
    explicit = {match.group(0).lower() for match in re.finditer(r"\bIfc[A-Za-z0-9]+\b", fragment, re.IGNORECASE)}
    if explicit:
        return explicit == {ifc_class.lower()}
    aliases = {mapped for alias, mapped in CLASS_ALIASES.items() if _alias_matches(fragment, alias)}
    return aliases == {ifc_class}


def _property_matches_fragment(fragment: str, predicate: PropertyFilter) -> bool:
    for match in PROP_COMPARE_RE.finditer(fragment):
        name = match.group("name")
        op = "==" if match.group("op") == "=" else match.group("op")
        value = float(match.group("value"))
        if (
            match.start() == 0
            and match.end() == len(fragment)
            and predicate.name == name
            and predicate.op == op
            and predicate.value == value
        ):
            return True
    if predicate.name != "FireRating" or not _PROPERTY_SEMANTIC_RE.search(fragment):
        return False
    # A semantic phrase is accepted only as a complete, recognized clause.  A
    # model cannot hide unsupported text by stretching its consumed span.
    normalized = _PUNCTUATION_RE.sub(" ", fragment).strip()
    if not re.fullmatch(
        r"(?:防火(?:時效|时效)?|耐火(?:時效|时效)?|firerating|rating)\s*"
        r"(?:不到|小於|小于|低於|低于|less\s+than|under|不少於|不低於|不低于|超過|大於|大于|高於|高于|more\s+than|over)\s*"
        r"(?:一\s*小時|一\s*小时|60\s*(?:分鐘|分钟|min))",
        normalized,
        re.IGNORECASE,
    ):
        return False
    if not re.search(r"(?:一\s*小時|一\s*小时|60\s*(?:分鐘|分钟|min))", fragment, re.IGNORECASE):
        return False
    if re.search(r"(?:不到|小於|小于|低於|低于|less\s+than|under)", fragment, re.IGNORECASE):
        return predicate.op in {"<", "<="} and predicate.value == 60
    if re.search(r"(?:不少於|不低於|不低于|超過|大於|大于|高於|高于|more\s+than|over)", fragment, re.IGNORECASE):
        return predicate.op in {">", ">="} and predicate.value == 60
    return False


def _anchored_spans(raw_query: str) -> list[tuple[int, int, str]]:
    """Find server-recognized field anchors; a span cannot claim another field."""
    anchors: list[tuple[int, int, str]] = []
    for match in STOREY_RE.finditer(raw_query):
        anchors.append((match.start(), match.end(), "storey_tokens"))
    for match in PROP_COMPARE_RE.finditer(raw_query):
        anchors.append((match.start(), match.end(), "property_filters"))
    for alias in sorted(CLASS_ALIASES, key=len, reverse=True):
        for match in _alias_matches(raw_query, alias):
            anchors.append((match.start(), match.end(), "ifc_classes"))
    return anchors


def _overlaps(left: tuple[int, int], right: tuple[int, int]) -> bool:
    return left[0] < right[1] and right[0] < left[1]


def _has_exact_field_anchor(
    span: tuple[int, int], field: str, anchors: list[tuple[int, int, str]]
) -> bool:
    return any(start == span[0] and end == span[1] and anchor_field == field for start, end, anchor_field in anchors)


def _validate_consumed_spans(out: InterpretedFilters, raw_spans: Any) -> None:
    """Validate model spans against server segmentation and normalized filters."""
    raw = out.raw_query
    if not isinstance(raw_spans, list):
        _mark_invalid(out, "consumed_spans_not_list")
        return
    anchors = _anchored_spans(raw)
    field_values: dict[str, list[Any]] = {
        "ifc_classes": out.ifc_classes,
        "storey_tokens": out.storey_tokens,
        "property_filters": out.property_filters,
        "name_contains": out.name_contains,
    }
    bound_indexes: dict[str, set[int]] = {field: set() for field in _SPAN_FIELDS}
    accepted: list[tuple[int, int, str, int]] = []
    for item in raw_spans:
        if not isinstance(item, dict):
            _mark_invalid(out, "consumed_span_not_object")
            continue
        if set(item) != {"start", "end", "field", "filter_index"}:
            _mark_invalid(out, "invalid_consumed_span_shape")
            continue
        start, end, field, filter_index = item.get("start"), item.get("end"), item.get("field"), item.get("filter_index")
        if (
            isinstance(start, bool)
            or isinstance(end, bool)
            or isinstance(filter_index, bool)
            or not isinstance(start, int)
            or not isinstance(end, int)
            or not isinstance(filter_index, int)
        ):
            _mark_invalid(out, "invalid_consumed_span_range")
            continue
        if (
            field not in _SPAN_FIELDS
            or start < 0
            or end > len(raw)
            or end <= start
            or filter_index < 0
            or filter_index >= len(field_values.get(field, []))
            or filter_index in bound_indexes[field]
        ):
            _mark_invalid(out, "invalid_consumed_span_range")
            continue
        span = (start, end)
        if any(_overlaps(span, previous[:2]) for previous in accepted):
            _mark_invalid(out, "overlapping_consumed_spans")
            continue
        fragment = raw[start:end]
        if not _remove_stopwords(fragment):
            _mark_invalid(out, "empty_consumed_span")
            continue
        if any(_overlaps(span, anchor[:2]) and anchor[2] != field for anchor in anchors):
            _mark_invalid(out, "consumed_span_field_mismatch")
            continue
        if field in {"ifc_classes", "storey_tokens"} and not _has_exact_field_anchor(span, field, anchors):
            _mark_invalid(out, "consumed_span_not_exact_field_anchor")
            continue
        if field == "property_filters" and not (
            _has_exact_field_anchor(span, field, anchors)
            or _property_matches_fragment(fragment, field_values[field][filter_index])
        ):
            _mark_invalid(out, "consumed_span_not_exact_field_anchor")
            continue
        selected = field_values[field][filter_index]
        if field == "ifc_classes":
            field_matches = _class_matches_fragment(fragment, selected)
        elif field == "storey_tokens":
            field_matches = bool(_storey_numbers(fragment) & {re.sub(r"\D", "", selected)})
        elif field == "property_filters":
            field_matches = _property_matches_fragment(fragment, selected)
        else:
            field_matches = _remove_stopwords(fragment).casefold() == selected.casefold()
        if not field_matches:
            _mark_invalid(out, "consumed_span_filter_mismatch")
            continue
        accepted.append((start, end, field, filter_index))
        bound_indexes[field].add(filter_index)
        out.consumed_spans.append({"start": start, "end": end, "field": field, "filter_index": filter_index})

    for field, values in field_values.items():
        if set(range(len(values))) != bound_indexes[field]:
            _mark_invalid(out, "unbound_normalized_filter")

    remaining = list(raw)
    for start, end, _field, _filter_index in accepted:
        for index in range(start, end):
            remaining[index] = " "
    unresolved = _remove_stopwords("".join(remaining))
    if unresolved:
        _append_unique(out.unresolved_terms, unresolved[:120])
    for match in PROXIMITY_RE.finditer(raw):
        _append_unique(out.unresolved_terms, match.group(0).strip())
    for unsafe in _unsafe_terms(raw):
        _append_unique(out.unresolved_terms, unsafe)
    for ambiguity in _boolean_ambiguities(raw, out.ifc_classes, out.storey_tokens):
        _append_unique(out.unresolved_terms, ambiguity)


def filters_from_structured_dict(raw_query: str, data: dict[str, Any], *, source: str = "llm") -> InterpretedFilters:
    """Sanitize LLM structured JSON and compute coverage server-side.

    ``consumed_spans`` is not a self-reported completion flag: its ranges,
    field assignment, and remaining query text are independently validated here.
    """
    out = InterpretedFilters(raw_query=(raw_query or "").strip(), interpret_source=source)
    if not isinstance(data, dict):
        _mark_invalid(out, "structured_filters_not_object")
        out.refresh_validation()
        return out

    allowed_keys = {"ifc_classes", "storey_tokens", "property_filters", "name_contains", "consumed_spans"}
    if any(key not in allowed_keys for key in data):
        _mark_invalid(out, "unexpected_filter_fields")

    def list_value(name: str) -> list[Any]:
        value = data.get(name, [])
        if value is None:
            return []
        if not isinstance(value, list):
            _mark_invalid(out, f"{name}_not_list")
            return []
        return value

    for item in list_value("ifc_classes"):
        if not isinstance(item, str):
            _mark_invalid(out, "ifc_class_not_string")
            continue
        name = item.strip()
        if name in SUPPORTED_IFC_CLASSES:
            if name not in out.ifc_classes:
                out.ifc_classes.append(name)
        else:
            _mark_invalid(out, "invalid_ifc_class")

    for item in list_value("storey_tokens"):
        if not isinstance(item, str):
            _mark_invalid(out, "storey_token_not_string")
            continue
        token = item.strip()
        canonical = re.sub(r"\D", "", token)
        if _SAFE_STOREY_TOKEN_RE.match(token) and canonical:
            if canonical not in out.storey_tokens:
                out.storey_tokens.append(canonical)
        else:
            _mark_invalid(out, "invalid_storey_token")

    for item in list_value("property_filters"):
        if not isinstance(item, dict):
            _mark_invalid(out, "property_filter_not_object")
            continue
        if set(item) != {"name", "op", "value"}:
            _mark_invalid(out, "invalid_property_filter_shape")
            continue
        name = item.get("name")
        op = item.get("op")
        value = item.get("value")
        if not isinstance(name, str) or not re.match(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$", name):
            _mark_invalid(out, "invalid_property_name")
            continue
        if op == "=":
            op = "=="
        if not isinstance(op, str) or op not in _ALLOWED_OPS:
            _mark_invalid(out, "invalid_property_operator")
            continue
        if isinstance(value, bool):
            _mark_invalid(out, "invalid_property_value")
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            _mark_invalid(out, "invalid_property_value")
            continue
        if not math.isfinite(number):
            _mark_invalid(out, "invalid_property_value")
            continue
        out.property_filters.append(PropertyFilter(name=name, op=op, value=number))

    for item in list_value("name_contains"):
        if not isinstance(item, str):
            _mark_invalid(out, "name_contains_not_string")
            continue
        fragment = item.strip()
        if fragment and len(fragment) <= 64 and fragment not in out.name_contains:
            out.name_contains.append(fragment)
        else:
            _mark_invalid(out, "invalid_name_contains")

    _validate_property_constraints(out)
    _validate_consumed_spans(out, data.get("consumed_spans"))
    out.refresh_validation()
    if out.usable:
        out.notes.append(f"mode:{source}_filter_v2")
        out.confidence = 0.75 if source == "llm" else 1.0
        out.confidence_basis = "llm_structured_json" if source == "llm" else "deterministic_grammar"
    else:
        out.notes.append("uninterpreted_structured_filters")
    return out


def interpret_query(query: str) -> InterpretedFilters:
    raw = (query or "").strip()
    out = InterpretedFilters(raw_query=raw)
    if not raw:
        out.notes.append("empty_query")
        out.refresh_validation()
        return out

    working = raw
    for token in ("且", "和", "與", "与", "找", "尋找", "查找", "搜尋", "搜索", "所有", "全部"):
        working = working.replace(token, " ")
    working = re.sub(r"\band\b", " ", working, flags=re.IGNORECASE)

    for match in PROP_COMPARE_RE.finditer(working):
        op = "==" if match.group("op") == "=" else match.group("op")
        out.property_filters.append(
            PropertyFilter(name=match.group("name"), op=op, value=float(match.group("value")))
        )
    working = PROP_COMPARE_RE.sub(" ", working)

    for match in re.finditer(r"\bIfc[A-Za-z0-9]+\b", working):
        ifc_class = match.group(0)
        if ifc_class in SUPPORTED_IFC_CLASSES:
            if ifc_class not in out.ifc_classes:
                out.ifc_classes.append(ifc_class)
        else:
            _mark_invalid(out, "invalid_ifc_class")
    working = re.sub(r"\bIfc[A-Za-z0-9]+\b", " ", working)

    for match in STOREY_RE.finditer(working):
        value = match.group("num") or match.group("fl") or match.group("lv")
        if match.group("cn"):
            value = CN_FLOOR.get(match.group("cn"), value)
        if value:
            for token in (str(value), f"{value}F"):
                if token not in out.storey_tokens:
                    out.storey_tokens.append(token)
    working = STOREY_RE.sub(" ", working)

    for alias, ifc_class in sorted(CLASS_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
        pattern = _alias_pattern(alias)
        if re.search(pattern, working, flags=re.IGNORECASE):
            if ifc_class not in out.ifc_classes:
                out.ifc_classes.append(ifc_class)
            working = re.sub(pattern, " ", working, flags=re.IGNORECASE)

    residual = _remove_stopwords(working)
    if residual:
        if PROXIMITY_RE.search(residual):
            # Unsupported relation intent is not a literal element name.  Keep
            # it unresolved so deterministic/auto modes cannot silently scan a
            # stricter-looking but semantically different query.
            out.unmatched_fragments.append(residual)
        elif re.search(r"[A-Za-z\u4e00-\u9fff]", residual) and len(residual) <= 24 and not any(ch.isdigit() for ch in residual):
            out.name_contains.append(residual)
            out.notes.append("name_contains_from_residual")
        else:
            out.unmatched_fragments.append(residual)

    _validate_property_constraints(out)
    for match in PROXIMITY_RE.finditer(raw):
        _append_unique(out.unresolved_terms, match.group(0).strip())
    for unsafe in _unsafe_terms(raw):
        _append_unique(out.unresolved_terms, unsafe)
    for ambiguity in _boolean_ambiguities(raw, out.ifc_classes, out.storey_tokens):
        _append_unique(out.unresolved_terms, ambiguity)
    for fragment in out.unmatched_fragments:
        _append_unique(out.unresolved_terms, fragment)

    out.interpret_source = "deterministic"
    out.refresh_validation()
    if not out.usable:
        out.notes.extend(("uninterpreted_query", "next_step: use supported IFC, storey, or property filters"))
        out.confidence = None
        out.confidence_basis = None
    else:
        out.notes.append("mode:deterministic_filter_v2")
        out.confidence = 1.0
        out.confidence_basis = "deterministic_grammar"
    return out
