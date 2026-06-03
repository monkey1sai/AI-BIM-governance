"""A2 model-version diff REST（APIRouter，掛入 governance-service app）。

獨立 router 模組，app.py 僅需一行 include_router，降低與其他 capability 的衝突面。
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

from .engine import open_model, run_diff

_SERVICE_ROOT = os.path.dirname(os.path.dirname(__file__))
_DB_PATH = os.environ.get("GOV_DB_PATH", os.path.join(_SERVICE_ROOT, "storage", "governance.db"))

router = APIRouter()
_store = None


def _get_store():
    # lazy + 尊重測試對 GOV_DB_PATH 的覆寫
    global _store
    path = os.environ.get("GOV_DB_PATH", _DB_PATH)
    if _store is None or _store.db_path != path:
        from .store import DiffStore

        _store = DiffStore(path)
    return _store


class DiffRequest(BaseModel):
    base_ifc_path: str
    target_ifc_path: str
    base_model_version_id: Optional[str] = None
    target_model_version_id: Optional[str] = None
    move_tol: float = 1.0
    include_geometry: bool = False


@router.post("/api/diffs", status_code=202)
def create_diff(req: DiffRequest, background: BackgroundTasks):
    for p in (req.base_ifc_path, req.target_ifc_path):
        if not os.path.exists(p):
            raise HTTPException(status_code=400, detail=f"ifc path not found: {p}")
    store = _get_store()
    diff_id = store.create_diff(req.base_model_version_id, req.target_model_version_id, req.base_ifc_path, req.target_ifc_path)
    background.add_task(_execute, diff_id, req.base_ifc_path, req.target_ifc_path, req.move_tol, req.include_geometry)
    return {"diff_id": diff_id, "status": "queued"}


def _execute(diff_id: str, base_path: str, target_path: str, move_tol: float, include_geometry: bool = False) -> None:
    store = _get_store()
    try:
        store.mark_running(diff_id)
        result = run_diff(open_model(base_path), open_model(target_path), move_tol=move_tol, include_geometry=include_geometry)
        store.complete_diff(diff_id, result)
    except Exception as exc:  # noqa: BLE001 - 誠實標記失敗，不假裝
        store.fail_diff(diff_id, str(exc))


@router.get("/api/diffs/{diff_id}")
def get_diff(diff_id: str):
    row = _get_store().get_diff(diff_id)
    if not row:
        raise HTTPException(status_code=404, detail="diff not found")
    import json

    summary = json.loads(row["summary_json"]) if row.get("summary_json") else None
    return {
        "diff_id": row["id"],
        "status": row["status"],
        "base_model_version_id": row["base_model_version_id"],
        "target_model_version_id": row["target_model_version_id"],
        "summary": summary,
    }


@router.get("/api/diffs/{diff_id}/items")
def get_diff_items(diff_id: str, change_type: Optional[str] = Query(None)):
    if not _get_store().get_diff(diff_id):
        raise HTTPException(status_code=404, detail="diff not found")
    return {"diff_id": diff_id, "change_type": change_type, "items": _get_store().get_items(diff_id, change_type)}


@router.post("/api/diffs/{diff_id}/apply-overlay")
def apply_overlay(diff_id: str):
    # 3D 顏色 overlay（綠/紅/橘/藍）走 Review-Room 主動拉 → client highlightPrimsRequest，
    # 非 server-push（退役）。本端點為 p15，誠實回 501。
    raise HTTPException(status_code=501, detail="3D overlay 為 p15：走 client highlightPrimsRequest，非後端 server-push")


@router.get("/api/diffs/{diff_id}/issue-impact")
def diff_issue_impact(diff_id: str):
    """issue impact：把本 diff 的變更構件與 base model version 的 issue 交叉比對。

    possibly_addressed 為**啟發式**（該構件在此版本有變更，可能已處理）；不自動轉 resolved。
    """
    store = _get_store()
    row = store.get_diff(diff_id)
    if not row:
        raise HTTPException(status_code=404, detail="diff not found")
    base_mv = row.get("base_model_version_id")
    items = store.get_items(diff_id)
    changed = {"removed", "moved", "geometry_changed", "property_changed"}
    changed_guids = {it["ifc_guid"] for it in items if it.get("ifc_guid") and it["change_type"] in changed}

    from issues.store import IssueStore

    issue_store = IssueStore(os.environ.get("GOV_DB_PATH", _DB_PATH))
    base_issues = issue_store.list_issues(model_version_id=base_mv, kind="issue") if base_mv else []
    possibly_addressed: list[str] = []
    still_open: list[str] = []
    for i in base_issues:
        if i["status"] in ("resolved", "rejected"):
            continue
        (possibly_addressed if i.get("ifc_guid") in changed_guids else still_open).append(i["id"])
    issue_guids = {i.get("ifc_guid") for i in base_issues}
    new_set = changed | {"added"}
    new_count = sum(1 for it in items if it.get("ifc_guid") and it["ifc_guid"] not in issue_guids and it["change_type"] in new_set)
    return {
        "diff_id": diff_id,
        "base_model_version_id": base_mv,
        "note": "possibly_addressed 為啟發式：該構件在此版本有變更，可能已處理；需人工確認再轉 resolved。",
        "possibly_addressed": {"count": len(possibly_addressed), "issue_ids": possibly_addressed},
        "still_open": {"count": len(still_open), "issue_ids": still_open},
        "new": {"count": new_count},
    }
