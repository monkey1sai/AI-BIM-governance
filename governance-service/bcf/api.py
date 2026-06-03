"""BCF 匯出 REST（APIRouter）— issue → BCF 2.1 .bcfzip。"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from .bcf_writer import build_bcfzip

_SERVICE_ROOT = os.path.dirname(os.path.dirname(__file__))
_DB_PATH = os.environ.get("GOV_DB_PATH", os.path.join(_SERVICE_ROOT, "storage", "governance.db"))

router = APIRouter()


@router.get("/api/bcf/export")
def export_bcf(model_version_id: Optional[str] = Query(None), status: Optional[str] = Query(None)):
    """把正式 issue（kind=issue，有 ifc_guid）匯出為 BCF 2.1 .bcfzip。"""
    from issues.store import IssueStore

    store = IssueStore(os.environ.get("GOV_DB_PATH", _DB_PATH))
    issues = store.list_issues(model_version_id=model_version_id, status=status, kind="issue")
    data, count = build_bcfzip(issues)
    if count == 0:
        raise HTTPException(status_code=404, detail="no formal issue (kind=issue with ifc_guid) to export")
    return StreamingResponse(
        iter([data]),
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="governance-issues.bcfzip"'},
    )
