"""把 rule-run 結果匯出成 Excel（openpyxl，host 已內建）。

本檔僅負責 rule-run → Excel（失敗構件清單 + summary）。BCF 2.1 匯出已於
``bcf/`` 模組以 stdlib（zipfile + xml）實作（見 ``app.py`` 的 ``/api/bcf/export``）：
該模組執行期不 import GPLv3 ``bcf-client``；惟 ``ifctester`` 會在環境 transitive 安裝
``bcf-client``，匯出產物不含其程式碼。
"""
from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook

from .models import RuleRunResult

_FAILED_HEADERS = [
    "rule_code",
    "severity",
    "ifc_type",
    "ifc_name",
    "ifc_guid",
    "usd_prim_path",
    "message",
]


def build_workbook(run: RuleRunResult) -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "Failed Elements"
    ws.append(_FAILED_HEADERS)
    for r in run.failed_results():
        ws.append(
            [
                r.rule_code,
                r.severity,
                r.ifc_type,
                r.ifc_name or "",
                r.ifc_guid or "",
                r.usd_prim_path or "",
                r.message,
            ]
        )

    summary = wb.create_sheet("Summary")
    summary.append(["rule_set", run.rule_set])
    summary.append(["version", run.version])
    summary.append(["score", run.score])
    summary.append(["total", run.total])
    summary.append(["passed", run.passed])
    summary.append(["failed", run.failed])
    summary.append(["errored", run.errored])
    return wb


def workbook_bytes(run: RuleRunResult) -> bytes:
    bio = BytesIO()
    build_workbook(run).save(bio)
    return bio.getvalue()
