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

    def to_dict(self) -> dict[str, Any]:
        return {
            "raw_query": self.raw_query,
            "ifc_classes": list(self.ifc_classes),
            "storey_tokens": list(self.storey_tokens),
            "property_filters": [p.to_dict() for p in self.property_filters],
            "name_contains": list(self.name_contains),
            "unmatched_fragments": list(self.unmatched_fragments),
            "interpretable": self.interpretable,
            "notes": list(self.notes),
            "confidence": 1.0 if self.interpretable else None,
            "confidence_basis": "deterministic_grammar" if self.interpretable else None,
        }


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

    out.interpretable = bool(
        out.ifc_classes or out.storey_tokens or out.property_filters or out.name_contains
    )
    if not out.interpretable:
        out.notes.append("uninterpreted_query")
        out.notes.append(
            "next_step: use examples like 「找 4F 防火門且 FireRating < 60」 or 「IfcDoor」"
        )
    else:
        out.notes.append("mode:deterministic_filter_v1")
    return out
