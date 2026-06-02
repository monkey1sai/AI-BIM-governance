"""A2 model-version diff 引擎 — 用多級鍵對齊兩份 IFC 的 IfcElement，分類變更。

CPU-only：對齊用 GlobalId/Tag/type+name+loc；moved 用 placement 平移；
property_changed 用 pset hash。geometry_changed 為 p1（需 tessellation，MVP 不計算）。
"""
from __future__ import annotations

import os
from typing import Any

import ifcopenshell

from . import keys as K
from .models import DiffItem, DiffResult


def open_model(path: str) -> Any:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return ifcopenshell.open(path)


def _guid_map(elements: list) -> dict:
    out: dict[str, Any] = {}
    for e in elements:
        g = getattr(e, "GlobalId", None)
        if g:
            out.setdefault(g, e)
    return out


def run_diff(base: Any, target: Any, move_tol: float = 1.0) -> DiffResult:
    base_els = base.by_type("IfcElement")
    tgt_els = target.by_type("IfcElement")
    matched_base: set[int] = set()
    matched_tgt: set[int] = set()
    pairs: list[tuple[Any, Any, str]] = []

    # 第一級：GlobalId
    bg, tg = _guid_map(base_els), _guid_map(tgt_els)
    for guid, be in bg.items():
        te = tg.get(guid)
        if te is not None:
            pairs.append((be, te, "guid"))
            matched_base.add(be.id())
            matched_tgt.add(te.id())

    # 第二級：Tag（source element id）
    def _tagmap(els, matched):
        out: dict[str, Any] = {}
        for e in els:
            if e.id() in matched:
                continue
            t = K.tag_of(e)
            if t:
                out.setdefault(t, e)
        return out

    bt, tt = _tagmap(base_els, matched_base), _tagmap(tgt_els, matched_tgt)
    for tag, be in bt.items():
        te = tt.get(tag)
        if te is not None and be.id() not in matched_base and te.id() not in matched_tgt:
            pairs.append((be, te, "tag"))
            matched_base.add(be.id())
            matched_tgt.add(te.id())

    # 第三級：type+name+loc hash
    def _keymap(els, matched):
        out: dict[str, list] = {}
        for e in els:
            if e.id() in matched:
                continue
            out.setdefault(K.type_name_loc_key(e), []).append(e)
        return out

    bk, tk = _keymap(base_els, matched_base), _keymap(tgt_els, matched_tgt)
    for key, bes in bk.items():
        tes = tk.get(key)
        if not tes:
            continue
        for be, te in zip(bes, tes):
            if be.id() in matched_base or te.id() in matched_tgt:
                continue
            pairs.append((be, te, "type_name_loc"))
            matched_base.add(be.id())
            matched_tgt.add(te.id())

    items: list[DiffItem] = []

    # 已配對 → 分類 moved / property_changed
    for be, te, how in pairs:
        guid = getattr(te, "GlobalId", None) or getattr(be, "GlobalId", None)
        bp, tp = K.placement_xyz(be), K.placement_xyz(te)
        if bp and tp:
            delta = max(abs(bp[0] - tp[0]), abs(bp[1] - tp[1]), abs(bp[2] - tp[2]))
            if delta > move_tol:
                items.append(DiffItem(
                    change_type="moved", ifc_guid=guid, ifc_type=te.is_a(), ifc_name=getattr(te, "Name", None),
                    change_summary=f"matched by {how}; moved Δ={round(delta, 3)}",
                    evidence={"match": how, "base_xyz": bp, "target_xyz": tp},
                ))
        bh, th = K.pset_hash(be), K.pset_hash(te)
        if bh and th and bh != th:
            items.append(DiffItem(
                change_type="property_changed", ifc_guid=guid, ifc_type=te.is_a(), ifc_name=getattr(te, "Name", None),
                change_summary=f"matched by {how}; property_sets changed",
                evidence={"match": how, "base_pset_hash": bh[:12], "target_pset_hash": th[:12]},
            ))

    # 未配對 → removed / added
    for e in base_els:
        if e.id() not in matched_base:
            items.append(DiffItem(
                change_type="removed", ifc_guid=getattr(e, "GlobalId", None), ifc_type=e.is_a(),
                ifc_name=getattr(e, "Name", None), change_summary="in base, not in target", evidence={},
            ))
    for e in tgt_els:
        if e.id() not in matched_tgt:
            items.append(DiffItem(
                change_type="added", ifc_guid=getattr(e, "GlobalId", None), ifc_type=e.is_a(),
                ifc_name=getattr(e, "Name", None), change_summary="in target, not in base", evidence={},
            ))

    counts: dict[str, int] = {}
    for it in items:
        counts[it.change_type] = counts.get(it.change_type, 0) + 1

    return DiffResult(
        base_count=len(base_els),
        target_count=len(tgt_els),
        matched=len(pairs),
        counts=counts,
        items=items,
        warnings=["geometry_changed 為 p1：MVP 未做幾何 tessellation 比對（僅 placement/pset）"],
    )


def run_diff_on_paths(base_path: str, target_path: str, move_tol: float = 1.0) -> DiffResult:
    return run_diff(open_model(base_path), open_model(target_path), move_tol=move_tol)
