"""Execute interpreted A4 filters against an IFC model with evidence traces."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional

import ifcopenshell.util.element as ifc_el

from rule_engine import is_fake_mapping, load_element_mapping, open_model
from .interpreter import InterpretedFilters, PropertyFilter, interpret_query


@dataclass
class SearchRequest:
    ifc_source_path: str
    query: str
    model_version_id: Optional[str] = None
    element_mapping_path: Optional[str] = None
    limit: int = 200


def _storey_name(el: Any) -> Optional[str]:
    try:
        container = ifc_el.get_container(el)
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


def _psets_flat(el: Any) -> dict[str, Any]:
    raw = ifc_el.get_psets(el) or {}
    flat: dict[str, Any] = {}
    for _pset_name, bucket in raw.items():
        if not isinstance(bucket, dict):
            continue
        for key, value in bucket.items():
            if key == "id":
                continue
            flat[key] = value
    return flat


def _numeric(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip()
    # Accept "60", "60.0", "60 min", "R60"
    m = None
    import re

    m = re.search(r"-?\d+(?:\.\d+)?", text)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _prop_match(props: dict[str, Any], pf: PropertyFilter) -> tuple[bool, Any, str]:
    if pf.name not in props:
        return False, None, f"property_missing:{pf.name}"
    actual = props[pf.name]
    num = _numeric(actual)
    if num is None:
        return False, actual, f"property_not_numeric:{pf.name}"
    ok = {
        "<": num < pf.value,
        "<=": num <= pf.value,
        ">": num > pf.value,
        ">=": num >= pf.value,
        "==": num == pf.value,
    }.get(pf.op, False)
    return ok, actual, f"{pf.name}{pf.op}{pf.value} actual={actual}"


def _storey_match(storey: Optional[str], tokens: list[str]) -> bool:
    if not tokens:
        return True
    if not storey:
        return False
    s = storey.strip().lower()
    for token in tokens:
        t = token.strip().lower()
        if not t:
            continue
        if t in s or s in t:
            return True
        # 4 vs 4F vs FL4
        digits = "".join(ch for ch in t if ch.isdigit())
        if digits and digits in s:
            return True
    return False


def run_model_search(req: SearchRequest) -> dict[str, Any]:
    if not req.ifc_source_path or not os.path.exists(req.ifc_source_path):
        raise FileNotFoundError(f"ifc_source_path not found: {req.ifc_source_path}")

    filters: InterpretedFilters = interpret_query(req.query)
    evidence_refs: list[dict[str, Any]] = [
        {"kind": "interpreter", "version": "deterministic_filter_v1"},
        {"kind": "ifc_source", "path_basename": os.path.basename(req.ifc_source_path)},
    ]
    if req.model_version_id:
        evidence_refs.append({"kind": "model_version_id", "value": req.model_version_id})

    if not filters.interpretable:
        return {
            "status": "uninterpreted",
            "model_version_id": req.model_version_id,
            "interpreted_filters": filters.to_dict(),
            "results": [],
            "stats": {"total": 0, "matched": 0, "unmapped": 0, "scanned": 0},
            "evidence_refs": evidence_refs,
            "next_step": "rewrite_query_using_supported_grammar",
        }

    mapping: dict[str, str] = {}
    mapping_meta: dict = {}
    if req.element_mapping_path:
        if os.path.exists(req.element_mapping_path):
            mapping, mapping_meta = load_element_mapping(req.element_mapping_path)
            if is_fake_mapping(mapping_meta):
                mapping = {}
                evidence_refs.append({"kind": "mapping", "status": "rejected_fake"})
            else:
                evidence_refs.append(
                    {
                        "kind": "mapping",
                        "status": "joined",
                        "basename": os.path.basename(req.element_mapping_path),
                    }
                )
        else:
            evidence_refs.append({"kind": "mapping", "status": "path_missing"})

    model = open_model(req.ifc_source_path)
    classes = filters.ifc_classes or [
        # Safe default product types when only storey/property filters exist.
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
    for cls in classes:
        try:
            for el in model.by_type(cls):
                try:
                    eid = el.id()
                except Exception:  # noqa: BLE001
                    continue
                if eid in seen_ids:
                    continue
                seen_ids.add(eid)
                candidates.append(el)
        except Exception:  # noqa: BLE001
            continue

    limit = max(1, min(int(req.limit or 200), 1000))
    results: list[dict[str, Any]] = []
    matched = 0
    unmapped = 0

    for el in candidates:
        guid = getattr(el, "GlobalId", None)
        name = getattr(el, "Name", None)
        ifc_class = el.is_a()
        storey = _storey_name(el)
        props = _psets_flat(el)
        traces: list[str] = []
        ok = True

        if filters.ifc_classes and ifc_class not in filters.ifc_classes:
            # by_type already scoped; keep for multi-class sets.
            if not any(ifc_class == c or ifc_class.startswith(c) for c in filters.ifc_classes):
                ok = False
                traces.append(f"class_mismatch:{ifc_class}")

        if ok and filters.storey_tokens:
            if _storey_match(storey, filters.storey_tokens):
                traces.append(f"storey_match:{storey}")
            else:
                ok = False
                traces.append(f"storey_mismatch:{storey}")

        if ok and filters.name_contains:
            name_l = (name or "").lower()
            for frag in filters.name_contains:
                if frag.lower() in name_l:
                    traces.append(f"name_contains:{frag}")
                else:
                    ok = False
                    traces.append(f"name_miss:{frag}")
                    break

        if ok and filters.property_filters:
            for pf in filters.property_filters:
                prop_ok, actual, note = _prop_match(props, pf)
                traces.append(note)
                if not prop_ok:
                    ok = False
                    break

        if not ok:
            continue

        matched += 1
        prim = mapping.get(guid) if guid else None
        if guid and not prim:
            unmapped += 1
        results.append(
            {
                "ifc_guid": guid,
                "usd_prim_path": prim,
                "ifc_class": ifc_class,
                "name": name,
                "storey": storey,
                "properties": {pf.name: props.get(pf.name) for pf in filters.property_filters}
                if filters.property_filters
                else {},
                "match_status": "match",
                "confidence": 1.0,
                "confidence_basis": "deterministic_grammar",
                "evidence_refs": traces,
                "highlight_eligible": bool(prim),
            }
        )
        if len(results) >= limit:
            break

    return {
        "status": "ok",
        "model_version_id": req.model_version_id,
        "interpreted_filters": filters.to_dict(),
        "results": results,
        "stats": {
            "total": matched,
            "matched": len(results),
            "unmapped": unmapped,
            "scanned": len(candidates),
            "truncated": matched > len(results),
        },
        "evidence_refs": evidence_refs,
        "next_step": None if results else "broaden_filters_or_check_model_content",
    }
