"""Rule engine 驗證 — 合成模型（確定性）+ 真實 IFC（R2：真模型萃取證明）。

真實 IFC 走 main workspace 的 storage 絕對路徑（storage gitignored，不在 worktree），
對齊 E2E 驗證原則。
"""
from __future__ import annotations

import os

import pytest

from rule_engine import load_rule_set, open_model, run_rules

RULES_PATH = os.path.join(os.path.dirname(__file__), "..", "rules", "default-governance.yaml")
REAL_IFC = os.environ.get(
    "AI_BIM_GOV_TEST_IFC",
    r"C:\Repos\active\iot\AI-BIM-governance\storage\fixture-bytes.ifc",
)


def test_predicates_on_synthetic_model(synthetic_model):
    rs = load_rule_set(RULES_PATH)
    run = run_rules(synthetic_model, rs)

    # DOOR-FIRERATING-REQUIRED：2 門 → 1 pass（有 FireRating）/ 1 fail（缺）
    door = [r for r in run.results if r.rule_code == "DOOR-FIRERATING-REQUIRED"]
    assert len(door) == 2
    assert sorted(r.status for r in door) == ["fail", "pass"]

    # R2 證明：pass 的那扇門「真的」從模型讀到 Pset 值
    passed_door = next(r for r in door if r.status == "pass")
    assert passed_door.evidence["value"] == "EI60"
    assert "Pset_DoorCommon" in passed_door.evidence["psets_read"]

    # WALL-STOREY-ASSIGNED：2 牆 → 1 pass（在樓層）/ 1 fail（未指派）
    wall = [r for r in run.results if r.rule_code == "WALL-STOREY-ASSIGNED"]
    assert sorted(r.status for r in wall) == ["fail", "pass"]
    passed_wall = next(r for r in wall if r.status == "pass")
    assert passed_wall.evidence["container"] is not None

    # 每個 fail 都必須有真實、可在模型中解析的 ifc_guid（不可捏造）
    for r in run.failed_results():
        assert r.ifc_guid
        assert synthetic_model.by_guid(r.ifc_guid) is not None

    assert 0.0 <= run.score <= 100.0
    assert run.total == run.passed + run.failed + run.errored


def test_unknown_ifc_type_warns_not_crashes(synthetic_model):
    rs = {
        "rule_set": "edge",
        "version": "1",
        "rules": [
            {
                "rule_code": "BOGUS",
                "target_ifc_type": "IfcNotARealType",
                "severity": "low",
                "predicate": {"type": "attribute_required", "attribute": "Name"},
            }
        ],
    }
    run = run_rules(synthetic_model, rs)
    assert run.warnings  # 不認得的型別應警告而非崩潰
    assert run.total == 0


@pytest.mark.skipif(not os.path.exists(REAL_IFC), reason=f"real IFC fixture not present: {REAL_IFC}")
def test_engine_on_real_ifc():
    """R2：對真實 IFC（host-native CPU、無 GPU）證明真模型 Pset / 空間萃取。"""
    rs = load_rule_set(RULES_PATH)
    model = open_model(REAL_IFC)
    run = run_rules(model, rs)

    assert run.total > 0, "real model should yield evaluated elements"

    # 證明引擎真的對真實模型枚舉並萃取（非僅 parse）
    name_results = [r for r in run.results if r.rule_code == "ELEMENT-NAME-REQUIRED"]
    assert name_results, "real model should contain IfcBuildingElement instances"

    # 至少一條規則真的讀到 Pset（property_required 的 evidence 帶 psets_read）
    door_results = [r for r in run.results if r.rule_code == "DOOR-FIRERATING-REQUIRED"]
    if door_results:
        assert any("psets_read" in r.evidence for r in door_results)

    # 抽樣驗證 ifc_guid 真實可解析回模型
    sample = [r for r in run.results if r.ifc_guid][:50]
    assert sample
    for r in sample:
        assert model.by_guid(r.ifc_guid) is not None

    assert 0.0 <= run.score <= 100.0
