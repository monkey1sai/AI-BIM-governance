"""Dataclasses for the governance rule engine.

純資料結構，不依賴 FastAPI / pydantic，方便 rule engine 在 pytest 中
獨立驗證（CPU-only，不需啟動服務）。
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class RuleResult:
    """單一構件對單一規則的檢核結果。

    ``ifc_guid`` 為 BCF/治理主鍵（即使 USD 尚未轉檔也必定存在）；
    ``usd_prim_path`` 為執行期定位索引，未對映時為 ``None``（誠實，不捏造）。
    """

    ifc_guid: Optional[str]
    ifc_type: str
    ifc_name: Optional[str]
    rule_code: str
    severity: str  # 'low' | 'medium' | 'high' | 'critical'
    status: str  # 'pass' | 'fail' | 'error'
    message: str
    evidence: dict[str, Any] = field(default_factory=dict)
    usd_prim_path: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RuleRunResult:
    """一次 rule-run 的彙總結果。"""

    rule_set: str
    version: str
    target_summary: dict[str, int]  # rule_code -> evaluated element count
    total: int
    passed: int
    failed: int
    errored: int
    score: float  # 0-100，pass / (pass+fail+errored)（errored 視同未通過，誠實計分）
    unique_elements: int = 0  # distinct ifc_guid count across all rule results
    results: list[RuleResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def failed_results(self) -> list[RuleResult]:
        return [r for r in self.results if r.status == "fail"]

    def summary_dict(self) -> dict[str, Any]:
        return {
            "rule_set": self.rule_set,
            "version": self.version,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "errored": self.errored,
            "score": self.score,
            "unique_elements": self.unique_elements,
            "target_summary": self.target_summary,
            "warnings": self.warnings,
        }
