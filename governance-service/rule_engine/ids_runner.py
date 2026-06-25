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


def _reset_ids_residual_state(specs: Any) -> None:
    """A1-IDS-REUSE-FALSEPASS：validate 前清掉 requirement facet 的殘留通過狀態，避免跨 model 洩漏。

    ifctester 0.8.5 的 `Specification.validate()` 會自行重設 spec 級 passed_entities /
    failed_entities / applicable_entities / status，但**不會重設 requirement facet 的
    `passed_entities`**（只累加）。加上 ifcopenshell 跨 model 重用 STEP `.id()`（兩個不同
    model 的構件常拿到相同 id），前一個 model 殘留在 facet.passed_entities 的 id 會讓本次
    model 的不合規構件（恰好 id 相同）被 `el.id() in passed_ids` 誤判 pass → score=100 假通過。

    因此每次 run_ids 進入點、validate 之前，只重置 ifctester 不會自行清理的 facet 級殘留
    （`passed_entities` 與 `failures`）。spec 級狀態交給 ifctester 的 validate 重設，避免在此
    覆寫破壞（也讓不經 ifctester validate 的測試 fake spec 行為不受影響）。屬性以型別探測，
    對沒有這些屬性的物件安全略過。
    """
    for spec in getattr(specs, "specifications", []) or []:
        for req in getattr(spec, "requirements", []) or []:
            # facet.passed_entities 是 ifctester 從不重置的殘留來源（核心修復點）。
            if isinstance(getattr(req, "passed_entities", None), set):
                req.passed_entities.clear()
            if isinstance(getattr(req, "failures", None), list):
                req.failures.clear()


def run_ids(model: Any, specs: Any, label: str = "ids") -> RuleRunResult:
    """對已開啟的 model 跑已載入的 IDS specs，回傳 RuleRunResult。"""
    # A1-IDS-REUSE-FALSEPASS：先清殘留再 validate，杜絕重用 specs 物件跨 model 的假通過。
    _reset_ids_residual_state(specs)
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
        # ids-002 + Required-IDS-零適用誤報：spec 經 validate 後 status 為 False，卻沒產生
        # 任何逐構件 result（兩種情況）時，補 specification 級 fail，誠實反映 spec 級違規，
        # 不得回 score=100 掩蓋失敗。與上方 prohibited(maxOccurs==0) 分支互斥（該分支已
        # `continue`，不會走到這裡），不會重複計數。
        if len(results) == produced_before and getattr(spec, "status", None) is False:
            if applicable:
                # (a) 有 applicable 構件但每條 requirement 都零通過（spec.status=False 卻無逐
                #     requirement 結果，例如無 facet 可比對）。此分支與 maxOccurs==0 的 prohibited
                #     分支互斥（那分支已 `continue`），這裡**不是** prohibited case，故不得標
                #     prohibited（否則誤導且污染下游以 evidence.prohibited 的判斷）：補 spec 級違規。
                for el in applicable:
                    results.append(
                        RuleResult(
                            ifc_guid=getattr(el, "GlobalId", None),
                            ifc_type=el.is_a(),
                            ifc_name=getattr(el, "Name", None),
                            rule_code=code,
                            severity="required",
                            status="fail",
                            message="IDS specification 級違規：spec.status=False 但無逐 requirement 結果",
                            evidence={"ids": True, "spec_status": False, "spec_level": True},
                        )
                    )
            else:
                # (b) Required-IDS-零適用誤報：非 prohibited 的 required spec（minOccurs!=0）
                #     找不到任何 applicable 構件 → ifctester 回 spec.status=False（required 構件
                #     缺席）。先前因 applicable 為空而完全不產 result → score=100 假通過。
                #     補一筆 spec 級 fail（無對應構件 guid），誠實反映「required 構件缺席」。
                results.append(
                    RuleResult(
                        ifc_guid=None,
                        ifc_type="(spec)",
                        ifc_name=code,
                        rule_code=code,
                        severity="required",
                        status="fail",
                        message="IDS required 違規：此 specification 找不到任何適用構件（required 構件缺席）",
                        evidence={"ids": True, "spec_status": False, "required_absent": True},
                    )
                )

    passed = sum(1 for r in results if r.status == "pass")
    failed = sum(1 for r in results if r.status == "fail")
    # ids-003：errored 由結果推導（語意正確、與 YAML 引擎一致），不結構性寫死。
    errored = sum(1 for r in results if r.status == "error")
    total = len(results)
    unique_elements = len({r.ifc_guid for r in results if r.ifc_guid})
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
        unique_elements=unique_elements,
        results=results,
        warnings=["規則來源：buildingSMART IDS（ifctester）"],
    )


def run_ids_file(model: Any, ids_path: str) -> RuleRunResult:
    if not os.path.exists(ids_path):
        raise FileNotFoundError(ids_path)
    return run_ids(model, open_ids(ids_path), label=os.path.basename(ids_path))
