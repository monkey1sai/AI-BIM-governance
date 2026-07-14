"""Deterministic query → filter interpretation for A4.

Honesty rules:
- Never invent IFC classes or properties not present in the grammar.
- Unknown fragments are reported, not silently ignored when they look like filters.
- Confidence is only emitted when the match is fully rule-based (always here).
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

# re used by filters_from_structured_dict


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

    def to_dict(self) -> dict[str, Any]:
        conf = self.confidence
        basis = self.confidence_basis
        if conf is None and self.interpretable:
            conf = 1.0 if self.interpret_source == "deterministic" else 0.75
        if basis is None and self.interpretable:
            basis = (
                "deterministic_grammar"
                if self.interpret_source == "deterministic"
                else "llm_structured_json"
            )
        return {
            "raw_query": self.raw_query,
            "ifc_classes": list(self.ifc_classes),
            "storey_tokens": list(self.storey_tokens),
            "property_filters": [p.to_dict() for p in self.property_filters],
            "name_contains": list(self.name_contains),
            "unmatched_fragments": list(self.unmatched_fragments),
            "interpretable": self.interpretable,
            "notes": list(self.notes),
            "interpret_source": self.interpret_source,
            "confidence": conf,
            "confidence_basis": basis,
        }


_ALLOWED_OPS = {"<", "<=", ">", ">=", "=="}
_ALLOWED_IFC_PREFIX = "Ifc"


def filters_from_structured_dict(raw_query: str, data: dict[str, Any], *, source: str = "llm") -> InterpretedFilters:
    """Sanitize LLM / external structured filter JSON into InterpretedFilters."""
    out = InterpretedFilters(raw_query=raw_query, interpret_source=source)
    classes: list[str] = []
    for item in data.get("ifc_classes") or []:
        if not isinstance(item, str):
            continue
        name = item.strip()
        if name.startswith(_ALLOWED_IFC_PREFIX) and name.isalnum() and len(name) < 64:
            if name not in classes:
                classes.append(name)
    out.ifc_classes = classes

    storeys: list[str] = []
    for item in data.get("storey_tokens") or []:
        if not isinstance(item, str):
            continue
        tok = item.strip()
        if tok and len(tok) <= 32 and tok not in storeys:
            storeys.append(tok)
    out.storey_tokens = storeys

    props: list[PropertyFilter] = []
    for item in data.get("property_filters") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        op = str(item.get("op") or "").strip()
        if op == "=":
            op = "=="
        if not name or op not in _ALLOWED_OPS:
            continue
        try:
            value = float(item.get("value"))
        except (TypeError, ValueError):
            continue
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$", name):
            continue
        props.append(PropertyFilter(name=name, op=op, value=value))
    out.property_filters = props

    names: list[str] = []
    for item in data.get("name_contains") or []:
        if not isinstance(item, str):
            continue
        frag = item.strip()
        if frag and len(frag) <= 64 and frag not in names:
            names.append(frag)
    out.name_contains = names

    for note in data.get("notes") or []:
        if isinstance(note, str) and note.strip():
            out.notes.append(note.strip()[:200])

    out.interpretable = bool(out.ifc_classes or out.storey_tokens or out.property_filters or out.name_contains)
    if out.interpretable:
        out.notes.append(f"mode:{source}_filter_v1")
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
        return out

    working = raw
    # Normalize common connectors so residual text stays clean.
    for token in ("且", "和", "與", "与", "and", "AND", "找", "尋找", "查找", "搜尋", "搜索", "所有", "全部"):
        working = working.replace(token, " ")

    # Property comparisons first (consume matched spans).
    for match in PROP_COMPARE_RE.finditer(working):
        op = match.group("op")
        if op == "=":
            op = "=="
        out.property_filters.append(
            PropertyFilter(
                name=match.group("name"),
                op=op,
                value=float(match.group("value")),
            )
        )
    working = PROP_COMPARE_RE.sub(" ", working)

    # Explicit Ifc* class tokens.
    for match in re.finditer(r"\bIfc[A-Za-z0-9]+\b", working):
        cls = match.group(0)
        if cls not in out.ifc_classes:
            out.ifc_classes.append(cls)
    working = re.sub(r"\bIfc[A-Za-z0-9]+\b", " ", working)

    # Storey tokens.
    for match in STOREY_RE.finditer(working):
        num = match.group("num") or match.group("fl") or match.group("lv")
        cn = match.group("cn")
        if cn:
            num = CN_FLOOR.get(cn, num)
        if num:
            token = str(num)
            if token not in out.storey_tokens:
                out.storey_tokens.append(token)
            # Also keep "4F" style for display equality checks.
            alt = f"{token}F"
            if alt not in out.storey_tokens:
                out.storey_tokens.append(alt)
    working = STOREY_RE.sub(" ", working)

    # Class aliases (longest first).
    lowered = working.lower()
    for alias, ifc_class in sorted(CLASS_ALIASES.items(), key=lambda kv: len(kv[0]), reverse=True):
        alias_l = alias.lower()
        if alias_l in lowered or alias in working:
            if ifc_class not in out.ifc_classes:
                out.ifc_classes.append(ifc_class)
            # Remove only non-overlapping simple occurrences.
            working = re.sub(re.escape(alias), " ", working, flags=re.IGNORECASE)
            lowered = working.lower()

    residual = re.sub(r"[\s,，。.!！？?：:；;|/\\#*@~`'\"]+", " ", working).strip()
    if residual:
        # Require at least one letter (Latin or CJK) before treating residual as name filter.
        has_word = bool(re.search(r"[A-Za-z\u4e00-\u9fff]", residual))
        if has_word and len(residual) <= 24 and not any(ch.isdigit() for ch in residual):
            out.name_contains.append(residual)
            out.notes.append(f"name_contains_from_residual:{residual}")
        else:
            out.unmatched_fragments.append(residual)

    out.interpret_source = "deterministic"
    out.interpretable = bool(
        out.ifc_classes or out.storey_tokens or out.property_filters or out.name_contains
    )
    if not out.interpretable:
        out.notes.append("uninterpreted_query")
        out.notes.append(
            "next_step: use examples like 「找 4F 防火門且 FireRating < 60」 or 「IfcDoor」"
        )
        out.confidence = None
        out.confidence_basis = None
    else:
        out.notes.append("mode:deterministic_filter_v1")
        out.confidence = 1.0
        out.confidence_basis = "deterministic_grammar"
    return out
