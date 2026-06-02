"""Predicate evaluators for the governance rule engine.

每個 predicate 接收一個 ifcopenshell entity + predicate 設定，回傳
``(ok: bool, evidence: dict)``。evidence 會記錄「實際從模型讀到什麼」，
這正是紅隊 R2 要求的證據：rule-run 必須真的從真實模型萃取 Pset /
屬性 / 空間關係，而非僅枚舉元素。

依賴 ifcopenshell.util.element（host Python312 已內建，get_psets /
get_container 皆存在）。
"""
from __future__ import annotations

from typing import Any

import ifcopenshell.util.element as ifc_el

_EMPTY = (None, "")


def eval_property_required(el: Any, pred: dict) -> tuple[bool, dict]:
    """構件在指定 Pset（或任一 Pset）中必須有非空的某屬性。

    真的呼叫 ifcopenshell.util.element.get_psets() 解析屬性集合，
    evidence 記錄讀到的 Pset 清單與該屬性值。
    """
    psets = ifc_el.get_psets(el) or {}
    pset_name = pred.get("pset")
    prop = pred["property"]
    value = None
    pset_found = False
    if pset_name:
        bucket = psets.get(pset_name)
        if bucket is not None:
            pset_found = True
            value = bucket.get(prop)
    else:
        for bucket in psets.values():
            if prop in bucket:
                value = bucket.get(prop)
                pset_found = True
                break
    ok = value not in _EMPTY
    return ok, {
        "predicate": "property_required",
        "pset": pset_name,
        "property": prop,
        "value": value,
        "pset_found": pset_found,
        "psets_read": sorted(psets.keys()),
    }


def eval_attribute_required(el: Any, pred: dict) -> tuple[bool, dict]:
    """構件的某個 IFC 直接屬性（如 Name / Tag）必須非空。"""
    attr = pred["attribute"]
    value = getattr(el, attr, None)
    ok = value not in _EMPTY
    return ok, {"predicate": "attribute_required", "attribute": attr, "value": value}


def eval_spatial_contained(el: Any, pred: dict) -> tuple[bool, dict]:
    """構件必須被指派到空間結構（樓層 / 空間），即 IfcRelContainedInSpatialStructure。

    真的呼叫 ifcopenshell.util.element.get_container() 走訪空間關係。
    """
    container = ifc_el.get_container(el)
    ok = container is not None
    container_repr = None
    if container is not None:
        container_repr = f"{container.is_a()}:{getattr(container, 'Name', None) or ''}"
    return ok, {"predicate": "spatial_contained", "container": container_repr}


def eval_naming_convention(el: Any, pred: dict) -> tuple[bool, dict]:
    """構件 Name 必須符合給定的正規表達式（命名規則）。"""
    import re

    pattern = pred["pattern"]
    name = getattr(el, "Name", None)
    ok = bool(name) and re.match(pattern, name) is not None
    return ok, {"predicate": "naming_convention", "pattern": pattern, "name": name}


PREDICATES = {
    "property_required": eval_property_required,
    "attribute_required": eval_attribute_required,
    "spatial_contained": eval_spatial_contained,
    "naming_convention": eval_naming_convention,
}
