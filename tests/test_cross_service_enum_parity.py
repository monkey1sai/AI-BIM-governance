"""跨服務 enum parity 守門（S3，2026-07-10）。

兩組手工鏡像、無 codegen 的 enum：
1. 轉檔 lifecycle（coordinator 投影語彙）：coordinator `ConversionLedgerStatus` ↔ 前端
   `CONVERSION_LIFECYCLE_STATUS_VALUES`——過去僅前端自測「鎖自己」，攔不到「後端加值、
   前端漏改」方向；本測試直接比對兩份源碼的值集相等。
2. streaming 轉檔權威 enum `CONVERSION_STATUSES`（queued/running/succeeded/…）與
   governance `CHANGE_TYPES`——鎖定權威值集不被縮減（§1.7 逐字 echo；值本身不改）。

源碼掃描式（regex 抽值集），不 import 任何 runtime。
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def _extract_quoted(text: str) -> list[str]:
    return re.findall(r'"([a-z_]+)"', text)


def test_conversion_lifecycle_parity_frontend_vs_coordinator():
    coord = (REPO / "bim-review-coordinator/src/services/conversionLedger.ts").read_text(encoding="utf-8")
    m = re.search(r'export type ConversionLedgerStatus = ([^;]+);', coord)
    assert m, "coordinator ConversionLedgerStatus union 不見了（改名/搬家須同步本測試）"
    coordinator_values = set(_extract_quoted(m.group(1)))

    fe = (REPO / "web-viewer-sample/src/console/coordinatorClient.ts").read_text(encoding="utf-8")
    fm = re.search(r'CONVERSION_LIFECYCLE_STATUS_VALUES = \[([^\]]+)\]', fe)
    assert fm, "前端 CONVERSION_LIFECYCLE_STATUS_VALUES 不見了"
    frontend_values = set(_extract_quoted(fm.group(1)))

    assert frontend_values == coordinator_values, (
        f"轉檔 lifecycle 值集漂移：前端 {sorted(frontend_values)} != coordinator {sorted(coordinator_values)}"
    )


def test_streaming_authority_statuses_not_shrunk():
    py = (REPO / "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py").read_text(encoding="utf-8")
    m = re.search(r'CONVERSION_STATUSES = \(([^)]+)\)', py)
    assert m, "streaming CONVERSION_STATUSES 不見了"
    values = set(_extract_quoted(m.group(1)))
    assert values >= {"queued", "running", "succeeded", "succeeded_with_warnings", "failed", "cancelled"}, (
        f"streaming 權威 enum 被縮減：{sorted(values)}（§1.7 值凍結）"
    )


def test_governance_change_types_not_shrunk():
    py = (REPO / "governance-service/diff_engine/models.py").read_text(encoding="utf-8")
    m = re.search(r'CHANGE_TYPES = \(([^)]+)\)', py)
    assert m, "governance CHANGE_TYPES 不見了"
    values = set(_extract_quoted(m.group(1)))
    assert values == {"added", "removed", "moved", "geometry_changed", "property_changed"}, (
        f"change_type 值集漂移：{sorted(values)}（§1.7 值凍結；R2 簽核引擎的對外語彙）"
    )
