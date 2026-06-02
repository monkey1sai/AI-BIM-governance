"""把 rule_results 的 ``ifc_guid`` join 回轉檔產出的 ``element_mapping.json``。

誠實守則：
- ``ifc_guid`` 是主鍵；``usd_prim_path`` 是執行期定位索引，未對映時為 ``None``，
  **不捏造**。
- fake / mock / smoke mapping 一律不可當真實覆蓋率使用（對齊 repo 的
  fake-vs-real 隔離規約）。
"""
from __future__ import annotations

import json
from typing import Any

from .models import RuleResult


def load_element_mapping(path: str) -> tuple[dict[str, str], dict]:
    """回傳 ``(ifc_guid -> usd_prim_path, raw_meta)``。"""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    items = data.get("items")
    if items is None and isinstance(data.get("element_mapping"), dict):
        items = data["element_mapping"].get("items")
    items = items or []
    mapping: dict[str, str] = {}
    for item in items:
        guid = item.get("ifc_guid")
        prim = item.get("usd_prim_path")
        if guid and prim:
            mapping[guid] = prim
    return mapping, data


def is_fake_mapping(meta: dict) -> bool:
    """是否為 fake / smoke mapping（不得當真實 guid_exact 覆蓋率）。"""
    if meta.get("mock") or meta.get("allow_fake_mapping"):
        return True
    if (meta.get("fake_mapping_count") or 0) > 0:
        return True
    if meta.get("mapping_method") == "fake_for_smoke_test":
        return True
    return False


def join_usd_prim_paths(results: list[RuleResult], mapping: dict[str, str]) -> int:
    """把 mapping 套到 results；回傳成功對映的筆數。未對映者 usd_prim_path=None。"""
    joined = 0
    for r in results:
        prim = mapping.get(r.ifc_guid) if r.ifc_guid else None
        r.usd_prim_path = prim
        if prim:
            joined += 1
    return joined
