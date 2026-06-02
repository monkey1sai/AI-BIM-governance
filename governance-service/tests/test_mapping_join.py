"""mapping-join 驗證 — 合成 mapping（確定性）+ 真實 1-element smoke fixture（僅驗 shape）。

誠實守則（紅隊 R5）：1-element smoke fixture 只能驗 JSON「形狀」，
不可當真模型 guid_exact 覆蓋率；未對映 usd_prim_path 必為 None。
"""
from __future__ import annotations

import os

import pytest

from rule_engine import is_fake_mapping, join_usd_prim_paths, load_element_mapping
from rule_engine.models import RuleResult

SMOKE_MAPPING = (
    r"C:\Repos\active\iot\AI-BIM-governance\docs\evidence\author-ifc-openusd-identity-paths"
    r"\artifacts-success\stream_conv_20260602080050_a0cc1bdc\element_mapping.json"
)


def _result(guid: str) -> RuleResult:
    return RuleResult(
        ifc_guid=guid,
        ifc_type="IfcDoor",
        ifc_name="D",
        rule_code="X",
        severity="high",
        status="fail",
        message="m",
    )


def test_join_maps_guid_to_prim_path():
    results = [_result("GUID1"), _result("GUID2")]
    mapping = {"GUID1": "/World/Elements/IfcDoor/G_GUID1"}
    joined = join_usd_prim_paths(results, mapping)
    assert joined == 1
    assert results[0].usd_prim_path == "/World/Elements/IfcDoor/G_GUID1"
    # 未對映必為 None，不捏造
    assert results[1].usd_prim_path is None


def test_fake_mapping_is_detected():
    assert is_fake_mapping({"fake_mapping_count": 3})
    assert is_fake_mapping({"mock": True})
    assert is_fake_mapping({"allow_fake_mapping": True})
    assert is_fake_mapping({"mapping_method": "fake_for_smoke_test"})
    assert not is_fake_mapping({"mapping_method": "guid_exact", "fake_mapping_count": 0})


@pytest.mark.skipif(not os.path.exists(SMOKE_MAPPING), reason="smoke element_mapping.json not present")
def test_smoke_mapping_shape_only():
    """僅驗 JSON 形狀；不可作為真模型覆蓋率主張（R5）。"""
    mapping, meta = load_element_mapping(SMOKE_MAPPING)
    assert isinstance(mapping, dict)
    # 1-element smoke：若被標為 fake 一律不可當覆蓋率
    if is_fake_mapping(meta):
        pytest.skip("smoke fixture is fake mapping — shape only, not coverage")
