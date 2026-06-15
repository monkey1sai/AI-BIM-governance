"""Governance rule engine — 對 ifcopenshell model 套用宣告式規則集。

規則集是宣告式 DSL（YAML / JSON 皆可）：每條 rule 指定 ``target_ifc_type``、
``severity``、``predicate``。引擎逐型別枚舉構件、套 predicate、收集
pass/fail/error 並計分。YAML 引擎本身**不依賴 ifctester**；IDS-XML 規則來源
另由 ``ids_runner`` 提供（ifctester 已安裝）。
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

import ifcopenshell
import yaml

from .models import RuleResult, RuleRunResult
from .predicates import PREDICATES

# 跨 schema 型別別名：IFC4X3 把 IfcBuildingElement 改名為 IfcBuiltElement。
# 讓同一條規則能套用到 IFC2X3 / IFC4 / IFC4X3 而不必為每個 schema 改規則。
_TYPE_ALIASES: dict[str, list[str]] = {
    "IfcBuildingElement": ["IfcBuiltElement"],
    "IfcBuiltElement": ["IfcBuildingElement"],
}


def _resolve_elements(model: Any, target: str, code: str, warnings: list[str]) -> list[Any]:
    """以 target 型別（含跨 schema 別名）枚舉構件；皆不存在時警告並回傳空。"""
    for name in [target, *_TYPE_ALIASES.get(target, [])]:
        try:
            elements = model.by_type(name)
        except RuntimeError:
            continue
        if name != target:
            warnings.append(f"rule {code}: '{target}' 不在 schema，改用別名 '{name}'")
        return elements
    warnings.append(f"rule {code}: 型別 '{target}' 及其別名皆不在 schema {model.schema}")
    return []


def load_rule_set(path: str) -> dict:
    """讀取規則集（``.yaml`` 或 ``.json``）。"""
    with open(path, encoding="utf-8") as fh:
        if path.endswith(".json"):
            data = json.load(fh)
        else:
            data = yaml.safe_load(fh)
    if not isinstance(data, dict) or not isinstance(data.get("rules"), list):
        raise ValueError(f"invalid rule set at {path}: missing 'rules' list")
    return data


@lru_cache(maxsize=4)
def _open_model_cached(ifc_path: str, _token: tuple[int, int]) -> Any:
    """實際解析；快取鍵含 ``_token``（mtime_ns + size），故同路徑但檔案被原地覆寫
    （mtime/size 改變）會落到不同鍵 → 重新 parse，不回舊 model。``_token`` 由
    ``open_model`` 帶入，caller 不直接呼叫此函式。"""
    return ifcopenshell.open(ifc_path)


def open_model(ifc_path: str) -> Any:
    """以 ifcopenshell 解析真實 IFC（CPU-only，不需 GPU / Kit）。

    Important-1：per-process lru_cache（maxsize=4）。/failures 等端點對同一 rule-run
    的同一 IFC 反覆開檔補 name/type/storey（每次『載入更多』一次），大型真實 IFC 全量
    重解析成本高；快取讓同路徑後續呼叫直接命中、不重 parse。rule_engine 的所有 caller
    皆唯讀（run_rules 只 by_type/get_psets/讀屬性，不改 model；diff_engine 另有獨立、
    未快取的 open_model，需獨立 base/target 物件者不受影響），故共享 handle 安全。
    multi-worker 下為 per-worker 範圍（finding 已接受）。

    快取鍵 = (path, mtime_ns, size)：同路徑檔案被原地覆寫後 mtime/size 改變即自動失效、
    重新解析，不回 stale model（治理分數/語意/spatial/`/failures` 不殘留舊檔）。
    FileNotFoundError 在 stat 階段就拋、不進快取，缺檔不會毒化快取。
    """
    st = os.stat(ifc_path)  # 缺檔 → FileNotFoundError（不快取），保留原行為
    return _open_model_cached(ifc_path, (st.st_mtime_ns, st.st_size))


# 對外沿用 lru_cache 的內省/清除 API（測試與運維用）：實體快取在 _open_model_cached 上。
open_model.cache_clear = _open_model_cached.cache_clear  # type: ignore[attr-defined]
open_model.cache_info = _open_model_cached.cache_info  # type: ignore[attr-defined]


def run_rules(model: Any, rule_set: dict) -> RuleRunResult:
    """對已開啟的 model 套用規則集，回傳彙總結果。"""
    results: list[RuleResult] = []
    warnings: list[str] = []
    target_summary: dict[str, int] = {}

    for rule in rule_set["rules"]:
        code = rule["rule_code"]
        target = rule["target_ifc_type"]
        severity = rule.get("severity", "medium")
        pred = rule["predicate"]
        ptype = pred.get("type")
        fn = PREDICATES.get(ptype)
        if fn is None:
            warnings.append(f"unknown predicate '{ptype}' for rule {code}")
            continue
        elements = _resolve_elements(model, target, code, warnings)
        target_summary[code] = len(elements)
        for el in elements:
            try:
                ok, evidence = fn(el, pred)
                status = "pass" if ok else "fail"
                message = "ok" if ok else rule.get("message", f"{code} failed")
            except Exception as exc:  # noqa: BLE001 - 單一構件失敗不應中斷整個 run
                status, evidence, message = "error", {"error": str(exc)}, f"predicate error: {exc}"
            results.append(
                RuleResult(
                    ifc_guid=getattr(el, "GlobalId", None),
                    ifc_type=el.is_a(),
                    ifc_name=getattr(el, "Name", None),
                    rule_code=code,
                    severity=severity,
                    status=status,
                    message=message,
                    evidence=evidence,
                )
            )

    passed = sum(1 for r in results if r.status == "pass")
    failed = sum(1 for r in results if r.status == "fail")
    errored = sum(1 for r in results if r.status == "error")
    total = len(results)
    # 誠實計分（A1-RE-01）：errored（評估失敗 / 未取得）計入分母、視同未通過，
    # 全構件 error 時 score 為 0 而非假性滿分。errored == 0 時與舊式等價（真實
    # 模型 99.0 不受影響）；total == 0（無適用構件）時 vacuously 100.0。
    denom = passed + failed + errored
    score = round(100.0 * passed / denom, 1) if denom else 100.0
    return RuleRunResult(
        rule_set=str(rule_set.get("rule_set", "unnamed")),
        version=str(rule_set.get("version", "0")),
        target_summary=target_summary,
        total=total,
        passed=passed,
        failed=failed,
        errored=errored,
        score=score,
        results=results,
        warnings=warnings,
    )


def run_rules_on_path(ifc_path: str, rule_set_path: str) -> RuleRunResult:
    """便利函式：開檔 + 跑規則。"""
    model = open_model(ifc_path)
    rule_set = load_rule_set(rule_set_path)
    return run_rules(model, rule_set)
