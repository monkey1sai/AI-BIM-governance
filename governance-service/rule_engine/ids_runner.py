"""A1 IDS-XML 規則匯入 — 用 ifctester 跑 buildingSMART IDS 並映射成 RuleRunResult。

ifctester（0.8.5，host 安裝）validate 後：每個 specification 有 applicable_entities，
每個 requirement 有 passed_entities → failed = applicable − passed。映射成與 YAML 引擎
一致的 RuleRunResult（帶真實 ifc_guid）。
"""
from __future__ import annotations

import os
from typing import Any

from .models import RuleResult, RuleRunResult


def open_ids(ids_path: str):
    from ifctester import ids

    return ids.open(ids_path)


def run_ids(model: Any, specs: Any, label: str = "ids") -> RuleRunResult:
    """對已開啟的 model 跑已載入的 IDS specs，回傳 RuleRunResult。"""
    specs.validate(model)
    results: list[RuleResult] = []
    target_summary: dict[str, int] = {}

    for spec in specs.specifications:
        applicable = list(getattr(spec, "applicable_entities", []) or [])
        code = getattr(spec, "name", None) or "IDS-SPEC"
        target_summary[code] = len(applicable)
        for req in spec.requirements:
            passed_ids = {e.id() for e in getattr(req, "passed_entities", []) or []}
            for el in applicable:
                ok = el.id() in passed_ids
                results.append(
                    RuleResult(
                        ifc_guid=getattr(el, "GlobalId", None),
                        ifc_type=el.is_a(),
                        ifc_name=getattr(el, "Name", None),
                        rule_code=code,
                        severity="required",
                        status="pass" if ok else "fail",
                        message="ok" if ok else f"IDS 要求未滿足：{type(req).__name__}",
                        evidence={"ids": True, "requirement": str(req)[:200]},
                    )
                )

    passed = sum(1 for r in results if r.status == "pass")
    failed = sum(1 for r in results if r.status == "fail")
    total = len(results)
    denom = passed + failed
    score = round(100.0 * passed / denom, 1) if denom else 100.0
    return RuleRunResult(
        rule_set=label,
        version="ids",
        target_summary=target_summary,
        total=total,
        passed=passed,
        failed=failed,
        errored=0,
        score=score,
        results=results,
        warnings=["規則來源：buildingSMART IDS（ifctester）"],
    )


def run_ids_file(model: Any, ids_path: str) -> RuleRunResult:
    if not os.path.exists(ids_path):
        raise FileNotFoundError(ids_path)
    return run_ids(model, open_ids(ids_path), label=os.path.basename(ids_path))
