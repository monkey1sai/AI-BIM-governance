import sys
from pathlib import Path

from fastapi.testclient import TestClient

MODULE_DIR = (
    Path(__file__).resolve().parents[1]
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))

from conversion_authority import (  # noqa: E402
    ConversionAuthorityError,
    ConversionAuthoritySettings,
    _ifc_artifact,
    create_conversion_api_app,
)


class FakeSuccessfulConverter:
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        mapping_path = output_dir / "element_mapping.json"
        entity_index_path = output_dir / "entity_index.json"
        metadata_path = output_dir / "metadata.json"
        model_path.write_bytes(b"PXR-USDC-fake-openable\n")
        mapping_path.write_text(
            '{"mock": false, "summary": {"mapped_count": 2, "fake_mapping_count": 0}, "items": []}',
            encoding="utf-8",
        )
        entity_index_path.write_text('{"entities": []}', encoding="utf-8")
        metadata_path.write_text('{"source": "ifc_ready"}', encoding="utf-8")
        return {
            "model_path": model_path,
            "mapping_path": mapping_path,
            "entity_index_path": entity_index_path,
            "metadata_path": metadata_path,
            "quality_metrics": {
                "source_ifc_entity_count": 2,
                "mapped_count": 2,
                "unmapped_count": 0,
                "coverage_ratio": 1.0,
                "coverage_status": "pass",
                "materialization_strategy": "sidecar",
                "sidecar_carrier_count": 1,
                "minimum_coverage_baseline_locked": True,
                "hard_quality_gates": {
                    "usdc_openable": True,
                    "has_renderable_prims": True,
                    "placeholder_output": False,
                },
            },
        }


class FakePlaceholderConverter(FakeSuccessfulConverter):
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        result = super().convert(job=job, ifc_ready_event=ifc_ready_event, output_dir=output_dir)
        Path(result["model_path"]).write_bytes(b"worker adapter usdc placeholder")
        return result


class FakeFailedConverter:
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        raise ConversionAuthorityError("converter_failed", "fixture converter failed")


def make_client(tmp_path: Path, converter, run_background: bool = True, internal_conversion_token: str | None = None) -> TestClient:
    settings = ConversionAuthoritySettings(
        service_root=tmp_path,
        artifacts_root=tmp_path / "artifacts",
        jobs_dir=tmp_path / "jobs",
        public_artifacts_url="http://testserver/artifacts",
        bim_control_callback_url=None,
        internal_conversion_token=internal_conversion_token,
    )
    app = create_conversion_api_app(settings=settings, converter=converter, run_background=run_background)
    return TestClient(app)


def ifc_ready_payload(**overrides):
    payload = {
        "event_type": "ifc_ready",
        "event_id": "evt_ifc_demo_001",
        "correlation_id": "corr_rvt_demo_001",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "export_job_id": "rvt_export_demo_001",
        "source_rvt_artifact_id": "artifact_rvt_demo_001",
        # B-scheme T4: internal request from coordinator. ifc_artifact ref is an
        # edge-local reference (not the deleted `_worker`:8005); no callback_url
        # (coordinator polls /result; cloud callback is the T5 outbox).
        "ifc_artifact": {
            "artifact_id": "artifact_ifc_demo_001",
            "format": "ifc",
            "filename": "demo-model.ifc",
            "url": "edge-local://fixtures/demo-model.ifc",
        },
        "requested_outputs": ["usdc", "element_mapping", "entity_index", "metadata"],
    }
    payload.update(overrides)
    return payload


def job_file_count(tmp_path: Path) -> int:
    return len(list((tmp_path / "jobs").glob("stream_conv_*.json")))


def test_ifc_ready_creates_queued_streaming_conversion_job(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())

    assert response.status_code == 202
    body = response.json()
    assert body["conversion_job_id"].startswith("stream_conv_")
    assert body["status"] == "queued"
    assert body["authority"] == "bim-streaming-server"
    assert body["correlation_id"] == "corr_rvt_demo_001"


def test_b_scheme_request_does_not_require_retired_worker_ids(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)
    payload = ifc_ready_payload()
    payload.pop("export_job_id")
    payload.pop("source_rvt_artifact_id")

    response = client.post("/api/conversions/ifc-to-usdc", json=payload)

    assert response.status_code == 202
    body = response.json()
    assert body["export_job_id"] is None
    assert body["source_rvt_artifact_id"] is None
    assert body["conversion_job_id"].startswith("stream_conv_")


def test_conversion_success_result_owns_usdc_mapping_entity_index_and_callback_payload(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    result_response = client.get(f"/api/conversions/{conversion_job_id}/result")

    assert result_response.status_code == 200
    result = result_response.json()
    assert result["status"] == "succeeded"
    assert result["authority"] == "bim-streaming-server"
    assert result["model"]["status"] == "ready"
    assert result["artifacts"]["model_usdc"]["url"].endswith("/model.usdc")
    assert result["artifacts"]["element_mapping"]["url"].endswith("/element_mapping.json")
    assert result["artifacts"]["entity_index"]["url"].endswith("/entity_index.json")
    assert result["artifacts"]["metadata"]["url"].endswith("/metadata.json")
    assert result["quality_metrics"]["source_ifc_entity_count"] == 2
    assert result["quality_metrics"]["mapped_count"] == 2
    assert result["quality_metrics"]["unmapped_count"] == 0
    assert result["quality_metrics"]["coverage_ratio"] == 1.0
    assert result["quality_metrics"]["coverage_status"] == "pass"
    assert result["quality_metrics"]["materialization_strategy"] == "sidecar"
    assert result["quality_metrics"]["sidecar_carrier_count"] == 1
    assert result["quality_metrics"]["minimum_coverage_baseline_locked"] is True
    assert result["lineage"]["ifc_artifact_id"] == "artifact_ifc_demo_001"
    assert result["lineage"]["usdc_artifact_id"] == result["artifacts"]["model_usdc"]["artifact_id"]

    job = client.get(f"/api/conversions/{conversion_job_id}").json()
    assert job["callback_payload"]["event_type"] == "streaming_conversion_result"
    assert job["callback_payload"]["authority"] == "bim-streaming-server"
    assert job["callback_payload"]["result"]["model"]["status"] == "ready"


def test_lists_ready_conversion_results_for_model_version(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    first = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(
            event_id="evt_ifc_list_001",
            idempotency_key="idem_ifc_list_001",
            ifc_artifact={
                "artifact_id": "artifact_ifc_list_001",
                "format": "ifc",
                "filename": "first-model.ifc",
                "url": "edge-local://fixtures/first-model.ifc",
            },
        ),
    ).json()
    second = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(
            event_id="evt_ifc_list_002",
            idempotency_key="idem_ifc_list_002",
            ifc_artifact={
                "artifact_id": "artifact_ifc_list_002",
                "format": "ifc",
                "filename": "second-model.ifc",
                "url": "edge-local://fixtures/second-model.ifc",
            },
        ),
    ).json()
    client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(
            event_id="evt_ifc_list_other_001",
            idempotency_key="idem_ifc_list_other_001",
            model_version_id="version_other_001",
        ),
    )

    response = client.get("/api/conversions?model_version_id=version_demo_001&status=succeeded&ready=true")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert [item["conversion_job_id"] for item in body["items"]] == [
        second["conversion_job_id"],
        first["conversion_job_id"],
    ]
    assert body["items"][0]["source_ifc_filename"] == "second-model.ifc"
    assert body["items"][1]["source_ifc_filename"] == "first-model.ifc"


def test_placeholder_usdc_fails_without_ready_result(tmp_path: Path):
    client = make_client(tmp_path, converter=FakePlaceholderConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    assert result["error"]["code"] == "placeholder_usdc"
    assert result["model"]["status"] != "ready"


# --- harden-host-native-conversion-service CH-1（store 路徑：#10 全檔掃描 / #3 URL 形狀）---
# placeholder 偵測 SHALL 掃完整 model.usdc，不得只看前綴；publish store 與 adapter
# 共用 conversion_authority._PLACEHOLDER_MARKERS 單一 source（見 spec
# host-native-conversion-authority-service「Placeholder detection SHALL scan the
# full published artifact」）。


class FakePlaceholderBeyondPrefixConverter(FakeSuccessfulConverter):
    """placeholder 標記寫在 >4096 bytes offset：前面填約 5KB 合法 bytes，
    確保 store 只看前綴（舊 [:4096] 行為）會放行、全檔掃描才會擋。"""

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        result = super().convert(job=job, ifc_ready_event=ifc_ready_event, output_dir=output_dir)
        # 前 5KB 全是合法的非 placeholder bytes，placeholder 標記落在 4096 之後。
        model_path = Path(result["model_path"])
        model_path.write_bytes(b"PXR-USDC-real-prefix\n" + b"A" * 5000 + b"\nplaceholder\n")
        return result


def test_placeholder_marker_beyond_prefix_is_rejected_by_store(tmp_path: Path):
    """#10 store 路徑：placeholder 標記在 >4096 offset 時 publish gate 仍 raise。"""
    client = make_client(tmp_path, converter=FakePlaceholderBeyondPrefixConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    assert result["error"]["code"] == "placeholder_usdc"
    assert result["model"]["status"] != "ready"


def test_legitimate_usdc_passes_store_publish_gate(tmp_path: Path):
    """#10 store 路徑 regression：全檔皆無 placeholder 標記的真實 USDC 仍放行。"""
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "succeeded"
    assert result["ready"] is True
    assert result["model"]["status"] == "ready"


def test_success_result_artifact_url_uses_per_job_scoped_shape(tmp_path: Path):
    """#3 store 路徑：_artifact_url 產生的 URL 形狀為 /artifacts/{job_id}/{filename}，
    與 traversal-safe per-job route 對齊（見 spec scenario「Completed job artifact
    is retrievable」的 URL-shape 子句）。"""
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    model_url = result["artifacts"]["model_usdc"]["url"]
    assert model_url == f"http://testserver/artifacts/{conversion_job_id}/model.usdc"
    # 每個 sidecar 也都走同一 per-job scoped 形狀
    assert result["artifacts"]["element_mapping"]["url"] == (
        f"http://testserver/artifacts/{conversion_job_id}/element_mapping.json"
    )


# --- B-scheme（local-coordinator-ifc-ready-intake-boundary T4 §5.3）契約測試 ---
# bim-streaming-server 為 internal-only 轉檔引擎；唯一支援的 caller 是
# bim-review-coordinator（內部 conversion request）。非 ifc_ready 形狀拒絕；
# 無 callback_url 時不打已刪服務（coordinator 輪詢 /result，cloud outbox 屬 T5）。


def test_streaming_is_internal_only_rejects_non_ifc_ready(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.post(
        "/api/conversions/ifc-to-usdc",
        json={"event_type": "external_http_probe", "event_id": "evt_bad_001"},
    )

    assert response.status_code == 400
    assert job_file_count(tmp_path) == 0


def test_internal_conversion_requires_configured_token(tmp_path: Path):
    client = make_client(
        tmp_path,
        converter=FakeSuccessfulConverter(),
        run_background=False,
        internal_conversion_token="secret-token",
    )

    missing = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    invalid = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(),
        headers={"X-Internal-Conversion-Token": "wrong-token"},
    )

    assert missing.status_code == 401
    assert invalid.status_code == 403
    assert job_file_count(tmp_path) == 0

    valid = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(),
        headers={"X-Internal-Conversion-Token": "secret-token"},
    )
    assert valid.status_code == 202
    assert job_file_count(tmp_path) == 1


def test_duplicate_idempotency_key_replays_existing_job(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    first = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(event_id="evt_retry_001", idempotency_key="idem_ifc_demo_001"),
    )
    second = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(event_id="evt_retry_002", idempotency_key="idem_ifc_demo_001"),
    )

    assert first.status_code == 202
    assert second.status_code == 202
    assert second.json()["conversion_job_id"] == first.json()["conversion_job_id"]
    assert second.json()["idempotent_replay"] is True
    assert job_file_count(tmp_path) == 1


def test_conflicting_idempotency_key_returns_409_without_new_job(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    first = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(event_id="evt_conflict_001", idempotency_key="idem_conflict_001"),
    )
    conflict = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(
            event_id="evt_conflict_002",
            idempotency_key="idem_conflict_001",
            ifc_artifact={
                "artifact_id": "artifact_ifc_other_001",
                "format": "ifc",
                "filename": "other-model.ifc",
                "url": "edge-local://fixtures/other-model.ifc",
            },
        ),
    )

    assert first.status_code == 202
    assert conflict.status_code == 409
    assert job_file_count(tmp_path) == 1


def test_missing_ifc_artifact_returns_400_without_new_job(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)
    payload = ifc_ready_payload()
    payload.pop("ifc_artifact")

    response = client.post("/api/conversions/ifc-to-usdc", json=payload)

    assert response.status_code == 400
    assert job_file_count(tmp_path) == 0


def test_coordinator_internal_request_yields_job_status_result_and_skipped_callback(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    # coordinator → streaming internal conversion request（無 callback_url）
    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    assert create.status_code == 202
    conversion_job_id = create.json()["conversion_job_id"]
    assert create.json()["status"] == "queued"
    assert create.json()["authority"] == "bim-streaming-server"

    status = client.get(f"/api/conversions/{conversion_job_id}").json()
    assert status["conversion_job_id"] == conversion_job_id
    assert status["status"] == "succeeded"
    # B-scheme：無 callback_url → 不打已刪 `_bim-control`，標 skipped
    assert status["callback_delivery"]["status"] == "skipped"
    assert status["callback_delivery"]["target_url"] is None

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["status"] == "succeeded"
    assert result["authority"] == "bim-streaming-server"
    assert result["model"]["status"] == "ready"


def test_coordinator_internal_request_failed_yields_failed_and_skipped_callback(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeFailedConverter())

    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload(event_id="evt_ifc_fail_001"))
    assert create.status_code == 202
    conversion_job_id = create.json()["conversion_job_id"]
    assert create.json()["status"] == "queued"

    status = client.get(f"/api/conversions/{conversion_job_id}").json()
    assert status["conversion_job_id"] == conversion_job_id
    assert status["status"] == "failed"
    assert status["callback_delivery"]["status"] == "skipped"
    assert status["callback_delivery"]["target_url"] is None

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["status"] == "failed"
    assert result["authority"] == "bim-streaming-server"


# --- streaming-server-prefer-local-ifc-path:_ifc_artifact propagate local paths ----


def test_ifc_artifact_propagates_local_paths_when_present():
    event = {
        "ifc_artifact": {
            "artifact_id": "artifact_local_propagate_001",
            "format": "ifc",
            "filename": "source.ifc",
            "url": "edge-local://fixtures/source.ifc",
            "local_path": "/workspace/storage/ifc-cache/job_x/source.ifc",
            "host_local_path": "C:/host/storage/ifc-cache/job_x/source.ifc",
        }
    }

    artifact = _ifc_artifact(event)

    assert artifact["local_path"] == "/workspace/storage/ifc-cache/job_x/source.ifc"
    assert artifact["host_local_path"] == "C:/host/storage/ifc-cache/job_x/source.ifc"


def test_ifc_artifact_local_paths_default_to_none_when_absent():
    event = {
        "ifc_artifact": {
            "artifact_id": "artifact_local_propagate_002",
            "format": "ifc",
            "filename": "source.ifc",
            "url": "edge-local://fixtures/source.ifc",
        }
    }

    artifact = _ifc_artifact(event)

    assert artifact["local_path"] is None
    assert artifact["host_local_path"] is None
