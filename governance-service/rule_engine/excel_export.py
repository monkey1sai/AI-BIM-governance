"""把 rule-run 結果匯出成 Excel（openpyxl，host 已內建）。

A1 第一階段先交付 rule-run -> Excel；BCF 匯出（issue -> .bcfzip）因 ifcopenshell
``bcf`` 模組未安裝 + LGPL 授權閘門，標 p15 後續，不在本切片實作。
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
