"""多級對齊鍵與比較訊號（CPU-only；本模組僅算對齊鍵與 pset hash，幾何
tessellation 不在此，由 geometry.py 負責）。

對齊優先序（roadmap A2 S1·W1）— 每級皆維持型別一致性，避免跨型別誤配：
1. IFC GlobalId（exact，全域唯一）
2. (ifc_type, Tag) 複合鍵（Revit ElementId 常存於 Tag，作 source element id；
   型別護欄避免跨型別共用 Tag 誤配，見 engine.py A2-001）
3. ifc_type + Name + 取整後的 placement 位置 hash
（幾何 signature 比對為 opt-in，預設關閉，需顯式 include_geometry=True 啟用，
 已實作於 geometry.py）

比較訊號：
- moved：placement 平移差（numpy 4x4 local placement translation）
- property_changed：property_sets hash（與幾何獨立，避免 hash 衝突誤判）
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

import ifcopenshell.util.element as ifc_el
import ifcopenshell.util.placement as ifc_pl


def placement_xyz(el: Any) -> Optional[tuple[float, float, float]]:
    """回傳 local placement 的世界平移 (x, y, z)（取整 3 位）；無 placement 回 None。"""
    try:
        if getattr(el, "ObjectPlacement", None) is None:
            return None
        m = ifc_pl.get_local_placement(el.ObjectPlacement)
        return (round(float(m[0][3]), 3), round(float(m[1][3]), 3), round(float(m[2][3]), 3))
    except Exception:
        return None


def tag_of(el: Any) -> Optional[str]:
    tag = getattr(el, "Tag", None)
    return str(tag) if tag not in (None, "") else None


def pset_hash(el: Any) -> Optional[str]:
    """property_sets 的穩定 hash（排除 ifcopenshell 內部 id）。與幾何獨立。"""
    try:
        psets = ifc_el.get_psets(el) or {}
        norm = {
            name: {k: v for k, v in props.items() if k != "id"}
            for name, props in psets.items()
        }
        blob = json.dumps(norm, sort_keys=True, default=str, ensure_ascii=False)
        return hashlib.sha1(blob.encode("utf-8")).hexdigest()
    except Exception:
        return None


def type_name_loc_key(el: Any) -> str:
    """第三級對齊鍵：型別 + 名稱 + 取整位置。"""
    return f"{el.is_a()}|{getattr(el, 'Name', None) or ''}|{placement_xyz(el)}"
