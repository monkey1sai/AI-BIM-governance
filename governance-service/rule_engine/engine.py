"""Governance rule engine — 對 ifcopenshell model 套用宣告式規則集。

規則集是宣告式 DSL（YAML / JSON 皆可）：每條 rule 指定 ``target_ifc_type``、
``severity``、``predicate``。引擎逐型別枚舉構件、套 predicate、收集
pass/fail/error 並計分。**不依賴 ifctester / IDS**（host 未安裝；IDS 匯入
為後續 p1 項目）。
"""
from __future__ import annotations

import json
import os
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
            data = yaml.safe_load(fh) if False else json.load(fh)
        else:
            data = yaml.safe_load(fh)
    if not isinstance(data, dict) or not isinstance(data.get("rules"), list):
        raise ValueError(f"invalid rule set at {path}: missing 'rules' list")
    return data


def open_model(ifc_path: str) -> Any:
    """以 ifcopenshell 解析真實 IFC（CPU-only，不需 GPU / Kit）。"""
    if not os.path.exists(ifc_path):
        raise FileNotFoundError(ifc_path)
    return ifcopenshell.open(ifc_path)


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
    denom = passed + failed
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
