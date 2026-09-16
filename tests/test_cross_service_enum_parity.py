"""跨服務 enum parity 守門（S3，2026-07-10）。

Python 端值集凍結守門（無 codegen 的權威 enum）：
1. （已退役）coordinator `ConversionLedgerStatus` ↔ 前端 `CONVERSION_LIFECYCLE_STATUS_VALUES`
   的 regex 比對——此漂移現由 Coordinator Browser Contract 守門：前端型別自
   tests/contracts/coordinator-browser-api-v1.openapi.json 生成，
   bim-review-coordinator/tests/browser-contract-drift.test.ts 鎖住文件與生成物同源。
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
