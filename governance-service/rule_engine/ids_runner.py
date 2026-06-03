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


def _spec_code(spec: Any, index: int) -> str:
    """為每個 IDS specification 產生穩定且唯一的彙總 key（ids-001）。

    一律附加迴圈索引：即使兩個 specification 帶相同 @identifier 或相同名稱，也保證
    在 target_summary 不互相覆寫（外部 review P2：重複 identifier 仍會覆寫低報）。
    """
    identifier = getattr(spec, "identifier", None)
    base = str(identifier) if identifier else (getattr(spec, "name", None) or "IDS-SPEC")
    return f"{base}#{index}"


def run_ids(model: Any, specs: Any, label: str = "ids") -> RuleRunResult:
    """對已開啟的 model 跑已載入的 IDS specs，回傳 RuleRunResult。"""
    specs.validate(model)
    results: list[RuleResult] = []
    target_summary: dict[str, int] = {}

    for index, spec in enumerate(specs.specifications):
        applicable = list(getattr(spec, "applicable_entities", []) or [])
        # ids-001：以穩定且唯一的 key 彙總，避免同名 / 未命名 specification 在
        # target_summary 互相覆寫而低報。優先用 IDS @identifier，否則名稱加索引。
        code = _spec_code(spec, index)
        target_summary[code] = len(applicable)
        # ids-002 + 外部 review P2：prohibited applicability（maxOccurs==0）構件存在即違規，
        # ifctester 對 prohibited 跳過 requirement 驗證（passed_entities 不填）。必須在
        # requirement 迴圈「前」攔截，否則每個 requirement × applicable 會吐重複 fail
        # （過度計數且語意錯）。偵測後跳過 requirement 迴圈；status False（有違規 applicable
        # 構件）時每個 applicable 補一筆 specification 級 fail。maxOccurs 取不到時（非 ifctester
        # 真物件）退回下方零-result fallback guard。
        if getattr(spec, "maxOccurs", None) == 0:
            if getattr(spec, "status", None) is False:
                for el in applicable:
                    results.append(
                        RuleResult(
                            ifc_guid=getattr(el, "GlobalId", None),
                            ifc_type=el.is_a(),
                            ifc_name=getattr(el, "Name", None),
                            rule_code=code,
                            severity="required",
                            status="fail",
                            message="IDS prohibited：此構件不應存在（specification 級違規）",
                            evidence={"ids": True, "spec_status": False, "prohibited": True},
                        )
                    )
            continue
        produced_before = len(results)
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
        # ids-002：prohibited applicability（maxOccurs=0）等 specification 級失敗在
        # 零-requirement 時不會產生任何逐構件 result，導致違規模型被當乾淨 pass。
        # 若 spec 經 validate 後 status 為 False 卻沒產生任何 result，為每個
        # applicable 構件補一筆 fail，誠實反映 specification 級違規。
        if (
            len(results) == produced_before
            and getattr(spec, "status", None) is False
            and applicable
        ):
            for el in applicable:
                results.append(
                    RuleResult(
                        ifc_guid=getattr(el, "GlobalId", None),
                        ifc_type=el.is_a(),
                        ifc_name=getattr(el, "Name", None),
                        rule_code=code,
                        severity="required",
                        status="fail",
                        message="IDS prohibited：此構件不應存在（specification 級違規）",
                        evidence={"ids": True, "spec_status": False, "prohibited": True},
                    )
                )

    passed = sum(1 for r in results if r.status == "pass")
    failed = sum(1 for r in results if r.status == "fail")
    # ids-003：errored 由結果推導（語意正確、與 YAML 引擎一致），不結構性寫死。
    errored = sum(1 for r in results if r.status == "error")
    total = len(results)
    denom = passed + failed + errored
    score = round(100.0 * passed / denom, 1) if denom else 100.0
    return RuleRunResult(
        rule_set=label,
        version="ids",
        target_summary=target_summary,
        total=total,
        passed=passed,
        failed=failed,
        errored=errored,
        score=score,
        results=results,
        warnings=["規則來源：buildingSMART IDS（ifctester）"],
    )


def run_ids_file(model: Any, ids_path: str) -> RuleRunResult:
    if not os.path.exists(ids_path):
        raise FileNotFoundError(ids_path)
    return run_ids(model, open_ids(ids_path), label=os.path.basename(ids_path))
