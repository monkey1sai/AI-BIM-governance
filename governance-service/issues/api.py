"""Governance issue tracking REST（APIRouter，掛入 governance-service app）。

issue 可手動建立，或由 A1 rule-run 失敗構件 / A2 diff 變更構件批次產生（來源綁定）。
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .store import ISSUE_STATUSES, IssueStore, TransitionError

_SERVICE_ROOT = os.path.dirname(os.path.dirname(__file__))
_DB_PATH = os.environ.get("GOV_DB_PATH", os.path.join(_SERVICE_ROOT, "storage", "governance.db"))

router = APIRouter()
_store = None

_DIFF_SEVERITY = {"removed": "high", "geometry_changed": "high", "moved": "medium", "property_changed": "low", "added": "low"}


def _get_store() -> IssueStore:
    global _store
    path = os.environ.get("GOV_DB_PATH", _DB_PATH)
    if _store is None or _store.db_path != path:
        _store = IssueStore(path)
    return _store


def _db_path() -> str:
    return os.environ.get("GOV_DB_PATH", _DB_PATH)


class IssueCreate(BaseModel):
    title: str
    description: Optional[str] = None
    severity: str = "medium"
    ifc_guid: Optional[str] = None
    usd_prim_path: Optional[str] = None
    model_version_id: Optional[str] = None
    assignee: Optional[str] = None


class TransitionBody(BaseModel):
    to_status: str
    note: Optional[str] = None


@router.post("/api/issues", status_code=201)
def create_issue(req: IssueCreate):
    return _get_store().create_issue(
        title=req.title, description=req.description, severity=req.severity, ifc_guid=req.ifc_guid,
        usd_prim_path=req.usd_prim_path, model_version_id=req.model_version_id, assignee=req.assignee,
    )


@router.get("/api/issues")
def list_issues(status: Optional[str] = Query(None), severity: Optional[str] = Query(None),
                model_version_id: Optional[str] = Query(None), kind: Optional[str] = Query(None)):
    return {"issues": _get_store().list_issues(status=status, severity=severity, model_version_id=model_version_id, kind=kind)}


@router.get("/api/issues/{issue_id}")
def get_issue(issue_id: str):
    issue = _get_store().get_issue(issue_id)
    if not issue or issue.get("source_type") == "a4_search":
        raise HTTPException(status_code=404, detail="issue not found")
    return {"issue": issue, "events": _get_store().get_events(issue_id)}


@router.post("/api/issues/{issue_id}/transition")
def transition_issue(issue_id: str, body: TransitionBody):
    store = _get_store()
    current = store.get_issue(issue_id)
    if current is None or current.get("source_type") == "a4_search":
        # Do not expose whether an A4 Issue exists through the generic,
        # non-session-authorized route.
        raise HTTPException(status_code=404, detail="issue not found")
    try:
        return store.transition(issue_id, body.to_status, body.note)
    except KeyError:
        raise HTTPException(status_code=404, detail="issue not found")
    except TransitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/issues/from-rule-run/{run_id}", status_code=201)
def issues_from_rule_run(run_id: str):
    from db import Store  # rule store（同 governance.db）

    rule_store = Store(_db_path())
    run = rule_store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="rule run not found")
    # rule-run issue 的版本綁定為 best-effort（可為 None）：rule-run 可能是對「尚未指派
    # model version」的臨時 IFC 檢核（console doRun 只傳 ifc_source_path/ids_path），仍以
    # source_type=rule_result + source_ref + run 提供溯源。此處刻意不對稱於 from-diff 的 422：
    # diff 天生是兩個 model_version 的比對，故 from-diff SHALL 要求 target 版本（缺則 422）。
    mv = run.get("model_version_id")
    failed = rule_store.get_results(run_id, "fail")
    items = [
        {
            "title": f"{r['rule_code']}: {r.get('ifc_type') or ''} {r.get('ifc_name') or ''}".strip(),
            "description": r.get("message"),
            "severity": r.get("severity", "medium"),
            "ifc_guid": r.get("ifc_guid"),
            "usd_prim_path": r.get("usd_prim_path"),
            "model_version_id": mv,
            "source_type": "rule_result",
            "source_ref": r.get("id"),
        }
        for r in failed
    ]
    result = _get_store().create_issues_batch(items)
    return {"created": len(result["created"]), "skipped": result["skipped"], "issue_ids": result["created"]}


@router.post("/api/issues/from-diff/{diff_id}", status_code=201)
def issues_from_diff(diff_id: str, change_type: Optional[str] = Query(None), limit: int = Query(200, ge=1, le=2000)):
    from diff_engine.store import DiffStore

    diff_store = DiffStore(_db_path())
    diff_row = diff_store.get_diff(diff_id)
    if not diff_row:
        raise HTTPException(status_code=404, detail="diff not found")
    # ISS-001/BCFUSD-1：diff item 代表 target 模型狀態，綁 target_model_version_id
    # （誠實鐵律：model_version_id 綁定所有 issue；缺版本綁定會讓 BCF 匯出與 diff-impact 統計斷裂）
    mv = diff_row.get("target_model_version_id")
    # diff API 宣告 target_model_version_id 為 optional；若該 diff 未帶版本，
    # 直接拒絕而非建出 model_version_id=None 的無版本溯源 issue（誠實鐵律：所有 issue 綁 model_version）。
    if not mv:
        raise HTTPException(
            status_code=422,
            detail="diff 缺 target_model_version_id，無法建立版本綁定的 issue",
        )
    items = diff_store.get_items(diff_id, change_type)[:limit]
    payload = [
        {
            "title": f"diff {it['change_type']}: {it.get('ifc_type') or ''}".strip(),
            "description": it.get("change_summary"),
            "severity": _DIFF_SEVERITY.get(it["change_type"], "medium"),
            "ifc_guid": it.get("ifc_guid"),
            "usd_prim_path": it.get("target_usd_prim_path") or it.get("base_usd_prim_path"),
            "model_version_id": mv,
            "source_type": "diff_item",
            "source_ref": it.get("id"),
        }
        for it in items
    ]
    result = _get_store().create_issues_batch(payload)
    return {"created": len(result["created"]), "skipped": result["skipped"], "issue_ids": result["created"]}
