"""B-scheme（local-coordinator-ifc-ready-intake-boundary T8 §9.1）。

repo-root pytest 目標，取代已刪 `_worker`/`_bim-control` 在 verify 的覆蓋。
驗證凍結契約與外部平台 test-only doubles（非 runtime profile，design D4）：
契約可解析且必填欄位齊、fakes 行為正確、**metadata-only guard 強制禁
內嵌模型本體**（雲地分離鐵律於測試強制）。default verify 不再依賴兩 mock 服務。
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

from fakes import (  # noqa: E402
    CloudBimControlApi,
    MetadataOnlyViolation,
    auth_headers,
    build_ifc_ready_payload,
    example_callback,
)


def _contract(name: str) -> dict:
    return json.loads((ROOT / "tests" / "contracts" / name).read_text(encoding="utf-8"))


def test_ifc_ready_contract_parses_with_required_fields():
    ifc = _contract("ifc_ready_payload.json")
    assert ifc["example"]["event"] == "ifc_ready"
    assert set(ifc["required_fields"]).issubset(ifc["example"].keys())


def test_conversion_result_callback_contract_metadata_only():
    cb = _contract("conversion_result_callback.json")
    ready = cb["events"]["conversion_result_ready"]
    assert set(ready["required_fields"]).issubset(ready["example"].keys())
    # metadata-only：example 僅含 *_ref，無 .usdc 本體
    blob = json.dumps(ready["example"]).lower()
    assert "usdc_ref" in blob
    assert "pxr-usdc" not in blob and "content_base64" not in blob


def test_external_ifc_worker_client_double_builds_spec_payload():
    payload = build_ifc_ready_payload(tenant_id="t_override")
    assert payload["event"] == "ifc_ready"
    assert payload["tenant_id"] == "t_override"
    headers = auth_headers()
    assert "X-Correlation-Id" in headers and "X-Idempotency-Key" in headers


def test_cloud_bim_control_double_records_callbacks_and_filters():
    api = CloudBimControlApi()
    api.record_callback(example_callback("conversion_result_ready"))
    api.record_callback(example_callback("conversion_failed"))
    assert len(api.get_callbacks()) == 2
    assert api.last_callback()["event"] == "conversion_failed"
    assert len(api.get_callbacks("conversion_result_ready")) == 1


def test_metadata_only_guard_rejects_embedded_model_body():
    api = CloudBimControlApi()
    bad = example_callback("conversion_result_ready")
    bad["artifacts"]["usdc_body"] = "PXR-USDC" + "A" * 5000
    with pytest.raises(MetadataOnlyViolation):
        api.record_callback(bad)


def test_control_plane_read_doubles_answer_locally():
    api = CloudBimControlApi()
    api.seed_model_version("ext_mv_demo_001", artifacts=[{"artifact_id": "a1"}], issues=[{"issue_id": "i1"}])
    assert api.get_model_version_artifacts("ext_mv_demo_001")[0]["artifact_id"] == "a1"
    assert api.get_review_issues("ext_mv_demo_001")[0]["issue_id"] == "i1"
