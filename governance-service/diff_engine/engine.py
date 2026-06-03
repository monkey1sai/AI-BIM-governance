"""A2 model-version diff 引擎 — 用多級鍵對齊兩份 IFC 的 IfcElement，分類變更。

CPU-only：對齊用 GlobalId/Tag/type+name+loc；moved 用 placement 平移；
property_changed 用 pset hash。geometry_changed 為 opt-in（預設關閉，需顯式
include_geometry=True 啟用，較重的 tessellation 比對）已實作（見 geometry.py）。

三級對齊皆維持型別一致性：第一級 GlobalId 全域唯一、第二級鍵為複合鍵
(is_a(), Tag)、第三級鍵為 type+Name+loc，避免跨型別構件誤配。
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


def run_diff(base: Any, target: Any, move_tol: float = 1.0, include_geometry: bool = False) -> DiffResult:
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

    # 第二級：Tag（source element id）— 複合鍵 (is_a(), tag) 帶型別護欄，
    # 避免跨型別共用 Tag 把「刪除+新增」誤判成同一構件（A2-001）。
    # A2-DUP-TAG（同型別重複 Tag 幻影配對）：先統計每個 (is_a, tag) 複合鍵在各側的出現次數，
    # 只有「base 與 target 該鍵各恰 1 個」時才以 Tag 配對。任一側該鍵 >1（歧義）時不以 Tag
    # 配對，落到第三級 type_name_loc 或 removed/added。先前以 setdefault 壓平只留第一個，
    # 同型別同 Tag 多構件會被丟掉並依插入序產生幻影 moved + 假 removed/added（非確定）。
    def _tag_buckets(els, matched):
        # 回傳 {(is_a, tag): [elements]}（保留所有同鍵構件以判斷歧義，不壓平）。
        out: dict[tuple[str, str], list] = {}
        for e in els:
            if e.id() in matched:
                continue
            t = K.tag_of(e)
            if t:
                out.setdefault((e.is_a(), t), []).append(e)
        return out

    bt, tt = _tag_buckets(base_els, matched_base), _tag_buckets(tgt_els, matched_tgt)
    for key, bes in bt.items():
        tes = tt.get(key)
        # 唯一性護欄：兩側該複合鍵皆恰 1 個才配對；任一側 >1 為歧義，留待後續級別處理。
        if not tes or len(bes) != 1 or len(tes) != 1:
            continue
        be, te = bes[0], tes[0]
        if be.id() not in matched_base and te.id() not in matched_tgt:
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

    # 同鍵簇內配對前以穩定次鍵（GlobalId，缺則 entity id）排序再 zip，
    # 讓 property_changed 等證據歸屬穩定可重現，不依 by_type 迭代序（A2-003）。
    def _stable_key(e):
        return (getattr(e, "GlobalId", None) or "", e.id())

    bk, tk = _keymap(base_els, matched_base), _keymap(tgt_els, matched_tgt)
    for key, bes in bk.items():
        tes = tk.get(key)
        if not tes:
            continue
        for be, te in zip(sorted(bes, key=_stable_key), sorted(tes, key=_stable_key)):
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
        if include_geometry:
            from .geometry import geometry_hash

            gbh, gth = geometry_hash(be), geometry_hash(te)
            if gbh and gth and gbh != gth:
                items.append(DiffItem(
                    change_type="geometry_changed", ifc_guid=guid, ifc_type=te.is_a(), ifc_name=getattr(te, "Name", None),
                    change_summary=f"matched by {how}; geometry changed",
                    evidence={"match": how, "base_geom_hash": gbh[:12], "target_geom_hash": gth[:12]},
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
        warnings=([] if include_geometry
                  else ["geometry_changed 未計算：include_geometry=false（僅 placement/pset）；設 include_geometry=true 啟用幾何 tessellation 比對（較重）"]),
    )


def run_diff_on_paths(base_path: str, target_path: str, move_tol: float = 1.0, include_geometry: bool = False) -> DiffResult:
    return run_diff(open_model(base_path), open_model(target_path), move_tol=move_tol, include_geometry=include_geometry)
