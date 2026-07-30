import json
import sys
import threading
import time
from pathlib import Path

import pytest
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

import conversion_authority as conversion_authority_module  # noqa: E402
from conversion_authority import (  # noqa: E402
    ConversionAuthorityError,
    ConversionAuthoritySettings,
    _ifc_artifact,
    create_conversion_api_app,
)
from struct_log import create_logger as create_struct_logger  # noqa: E402


class FakeSuccessfulConverter:
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        mapping_path = output_dir / "element_mapping.json"
        entity_index_path = output_dir / "entity_index.json"
        metadata_path = output_dir / "metadata.json"
        model_path.write_bytes(b"PXR-USDC-fake-openable\n")
        mapping_path.write_text(
            '{"mapping_provenance": "converter_verified", "mock": false, "allow_fake_mapping": false, "summary": {"mapped_count": 2, "fake_mapping_count": 0}, "items": []}',
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


class FakeIdentityConverter(FakeSuccessfulConverter):
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        result = super().convert(job=job, ifc_ready_event=ifc_ready_event, output_dir=output_dir)
        extra_docs = {
            "pset_index_path": ("pset_index.json", {"items": [{"entity_id": "ifc:GUID_A", "psets": {}}]}),
            "spatial_index_path": ("spatial_index.json", {"items": [{"entity_id": "ifc:GUID_A", "relationships": []}]}),
            "bbox_index_path": ("bbox_index.json", {"items": [{"entity_id": "ifc:GUID_A", "bbox_local": [0, 0, 0, 1, 1, 1]}]}),
            "quality_metrics_path": ("quality_metrics.json", {"mapping_fidelity": "guid_exact"}),
            "geo_reference_path": ("geo_reference.json", {"available": False, "warnings": ["geo_reference_missing"]}),
        }
        for key, (filename, body) in extra_docs.items():
            path = output_dir / filename
            path.write_text(json.dumps(body), encoding="utf-8")
            result[key] = path
        result["quality_metrics"] = {
            **result["quality_metrics"],
            "materialization_strategy": "ifcopenshell_openusd_identity",
            "identity_authoring_profile": "ifcopenshell_openusd_identity",
            "mapping_fidelity": "guid_exact",
            "semantic_mapping_fidelity": "guid_exact",
            "warnings": ["geo_reference_missing"],
        }
        return result


class FakePlaceholderConverter(FakeSuccessfulConverter):
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        result = super().convert(job=job, ifc_ready_event=ifc_ready_event, output_dir=output_dir)
        Path(result["model_path"]).write_bytes(b"worker adapter usdc placeholder")
        return result


class FakeFailedConverter:
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        raise ConversionAuthorityError("converter_failed", "fixture converter failed")


class FakeMissingMappingProvenanceConverter(FakeSuccessfulConverter):
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        result = super().convert(job=job, ifc_ready_event=ifc_ready_event, output_dir=output_dir)
        mapping_path = Path(result["mapping_path"])
        mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
        del mapping["mapping_provenance"]
        mapping_path.write_text(json.dumps(mapping), encoding="utf-8")
        return result


class ConcurrencyTrackingConverter(FakeSuccessfulConverter):
    """2026-07-06 conversion-kit-port-race: 記錄 convert() 同時在跑的併發峰值。

    真實環境裡每個 ifc-ready job 各自的 Kit subprocess 都會嘗試監聽同一個預設
    port（omni.services.transport.server.http 的 8011），沒有序列化保護時，
    多個幾乎同時進來的 job 會讓 Kit 互搶這個 port，輸家直接 crash（exit 1）。
    這支 fake 用 sleep 撐開時間窗，讓「兩個 convert() 同時在跑」在測試裡穩定可觀察。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.active = 0
        self.max_active = 0

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        with self._lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(0.05)
            return super().convert(job=job, ifc_ready_event=ifc_ready_event, output_dir=output_dir)
        finally:
            with self._lock:
                self.active -= 1


class SameJobBlockingConverter(FakeSuccessfulConverter):
    """Hold the first conversion open so a second caller observes `running`."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.calls = 0
        self.entered = threading.Event()
        self.release = threading.Event()

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        with self._lock:
            self.calls += 1
        self.entered.set()
        if not self.release.wait(timeout=5):
            raise RuntimeError("same-job conversion fixture timed out")
        return super().convert(job=job, ifc_ready_event=ifc_ready_event, output_dir=output_dir)


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


def capture_structured_records(monkeypatch):
    records: list[dict] = []
    logger_creations: list[str] = []

    def create_test_logger(service: str, **kwargs):
        logger_creations.append(service)
        return create_struct_logger(
            service,
            component=str(kwargs.get("component") or "conversion_authority"),
            in_memory_only=True,
            record_sink=records.append,
        )

    monkeypatch.setattr(
        conversion_authority_module,
        "create_logger",
        create_test_logger,
        raising=False,
    )
    return records, logger_creations


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


def test_identity_conversion_result_exposes_additive_artifact_refs_without_sidecar_bodies(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeIdentityConverter())

    response = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(conversion_profile="ifcopenshell_openusd_identity"),
    )
    conversion_job_id = response.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    artifacts = result["artifacts"]
    for key, filename in {
        "pset_index": "pset_index.json",
        "spatial_index": "spatial_index.json",
        "bbox_index": "bbox_index.json",
        "quality_metrics": "quality_metrics.json",
        "geo_reference": "geo_reference.json",
    }.items():
        assert artifacts[key]["role"] == key
        assert artifacts[key]["format"] in {"json", "usda"}
        assert artifacts[key]["url"].endswith(f"/{filename}")
    assert result["quality_metrics"]["mapping_fidelity"] == "guid_exact"
    assert result["quality_metrics"]["identity_authoring_profile"] == "ifcopenshell_openusd_identity"

    job = client.get(f"/api/conversions/{conversion_job_id}").json()
    callback_json = json.dumps(job["callback_payload"], ensure_ascii=False)
    assert "pset_index" in callback_json
    assert '"psets":' not in callback_json
    assert '"relationships":' not in callback_json
    assert '"bbox_local":' not in callback_json
    assert "geo_reference_missing" in callback_json


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


def test_persisted_ready_result_downgrades_when_required_artifact_is_missing(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    initial = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert initial["ready"] is True

    model_path = tmp_path / "artifacts" / conversion_job_id / "model.usdc"
    assert model_path.is_file()
    model_path.unlink()

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["ready"] is False
    assert result["status"] == "failed"
    assert result["model"]["status"] == "failed"
    assert result["error"]["code"] == "artifact_missing"
    assert result["error"]["missing_artifacts"][0]["role"] == "model_usdc"

    detail = client.get(f"/api/conversions/{conversion_job_id}").json()
    assert detail["status"] == "failed"
    assert detail["stage"] == "artifact_missing"
    assert detail["callback_payload"]["status"] == "failed"
    assert detail["callback_payload"]["result"]["ready"] is False

    ready_list = client.get("/api/conversions?model_version_id=version_demo_001&status=succeeded&ready=true").json()
    assert ready_list["count"] == 0


def test_persisted_ready_result_downgrades_when_model_usdc_bytes_change(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    initial = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    original_checksum = initial["artifacts"]["model_usdc"]["checksum_sha256"]
    assert len(original_checksum) == 64

    model_path = tmp_path / "artifacts" / conversion_job_id / "model.usdc"
    model_path.write_bytes(model_path.read_bytes() + b"\nmutated-after-publication")

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["ready"] is False
    assert result["status"] == "failed"
    assert result["error"]["code"] == "artifact_integrity_violation"
    assert result["error"]["missing_artifacts"][0]["reason"] == "artifact_checksum_mismatch"
    assert client.get(f"/api/conversions/{conversion_job_id}").json()["stage"] == "artifact_integrity_violation"

    ready_list = client.get("/api/conversions?model_version_id=version_demo_001&status=succeeded&ready=true").json()
    assert ready_list["count"] == 0


def test_persisted_ready_result_without_model_checksum_fails_closed(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    job_path = tmp_path / "jobs" / f"{conversion_job_id}.json"
    job = json.loads(job_path.read_text(encoding="utf-8"))
    del job["result"]["artifacts"]["model_usdc"]["checksum_sha256"]
    job_path.write_text(json.dumps(job), encoding="utf-8")

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["ready"] is False
    assert result["error"]["code"] == "artifact_integrity_violation"
    assert result["error"]["missing_artifacts"][0]["reason"] == "artifact_checksum_missing"


def test_persisted_ready_result_downgrades_when_requested_sidecar_is_missing_from_metadata(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    job_path = tmp_path / "jobs" / f"{conversion_job_id}.json"
    job = json.loads(job_path.read_text(encoding="utf-8"))
    del job["result"]["artifacts"]["element_mapping"]
    job_path.write_text(json.dumps(job), encoding="utf-8")

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["ready"] is False
    assert result["error"]["code"] == "artifact_missing"
    assert result["error"]["missing_artifacts"][0]["role"] == "element_mapping"
    assert result["error"]["missing_artifacts"][0]["reason"] == "artifact_path_missing"


def test_persisted_ready_result_downgrades_when_artifact_url_is_not_per_job_serveable(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    outside = tmp_path / "outside-model.usdc"
    outside.write_bytes(b"PXR-USDC-real-outside\n")
    job_path = tmp_path / "jobs" / f"{conversion_job_id}.json"
    job = json.loads(job_path.read_text(encoding="utf-8"))
    model = job["result"]["artifacts"]["model_usdc"]
    model["path"] = str(outside)
    model["url"] = "http://testserver/artifacts/outside-model.usdc"
    job["result"]["model"]["url"] = model["url"]
    job["result"]["usdc_url"] = model["url"]
    job_path.write_text(json.dumps(job), encoding="utf-8")

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["ready"] is False
    assert result["error"]["code"] == "artifact_missing"
    assert result["error"]["missing_artifacts"][0]["role"] == "model_usdc"
    assert result["error"]["missing_artifacts"][0]["reason"] == "artifact_unserveable"


def test_placeholder_usdc_fails_without_ready_result(tmp_path: Path):
    client = make_client(tmp_path, converter=FakePlaceholderConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    assert result["error"]["code"] == "placeholder_usdc"
    assert result["model"]["status"] != "ready"


def test_missing_mapping_provenance_fails_without_ready_result(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeMissingMappingProvenanceConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    assert result["error"]["code"] == "mapping_provenance_invalid"


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


def test_concurrent_idempotent_create_across_store_instances_is_atomic(tmp_path: Path, monkeypatch):
    settings = ConversionAuthoritySettings(
        service_root=tmp_path,
        artifacts_root=tmp_path / "artifacts",
        jobs_dir=tmp_path / "jobs",
        public_artifacts_url="http://testserver/artifacts",
        bim_control_callback_url=None,
    )
    stores = [
        conversion_authority_module.StreamingConversionStore(settings=settings, converter=FakeSuccessfulConverter())
        for _ in range(2)
    ]
    original_find = conversion_authority_module.StreamingConversionStore._find_job_by_idempotency_key

    def delayed_empty_lookup(store, idempotency_key):
        found = original_find(store, idempotency_key)
        if found is None:
            time.sleep(0.05)
        return found

    monkeypatch.setattr(
        conversion_authority_module.StreamingConversionStore,
        "_find_job_by_idempotency_key",
        delayed_empty_lookup,
    )
    start = threading.Barrier(2)
    results: list[dict] = []

    def create(store) -> None:
        start.wait(timeout=5)
        results.append(
            store.create_conversion_job(
                ifc_ready_payload(
                    event_id="evt_atomic_create",
                    idempotency_key="idem_atomic_create",
                )
            )
        )

    threads = [threading.Thread(target=create, args=(store,)) for store in stores]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert all(not thread.is_alive() for thread in threads)
    assert len(results) == 2
    assert len({result["conversion_job_id"] for result in results}) == 1
    assert sum(bool(result.get("idempotent_replay")) for result in results) == 1
    assert job_file_count(tmp_path) == 1


def test_ifc_ready_root_trace_is_persisted_projected_and_replayed(tmp_path: Path, monkeypatch):
    records, logger_creations = capture_structured_records(monkeypatch)
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)
    root_trace = "ifcready_1779687625000_064c6813"
    payload = ifc_ready_payload(event_id="evt_trace_001", idempotency_key="idem_trace_001")

    first = client.post(
        "/api/conversions/ifc-to-usdc",
        json=payload,
        headers={"X-Trace-Id": root_trace},
    )
    replay = client.post(
        "/api/conversions/ifc-to-usdc",
        json=payload,
        headers={"X-Trace-Id": "ifcready_1779687625001_064c6814"},
    )

    assert first.status_code == 202
    assert first.json()["trace_id"] == root_trace
    conversion_job_id = first.json()["conversion_job_id"]
    persisted = json.loads((tmp_path / "jobs" / f"{conversion_job_id}.json").read_text(encoding="utf-8"))
    assert persisted["trace_id"] == root_trace
    assert replay.status_code == 202
    assert replay.json()["trace_id"] == root_trace
    assert client.get(f"/api/conversions/{conversion_job_id}").json()["trace_id"] == root_trace
    assert client.get(f"/api/conversions/{conversion_job_id}/result").json()["trace_id"] == root_trace
    assert logger_creations == ["streaming-server"]
    assert sum(record["event_type"] == "env_snapshot" for record in records) == 1
    inbound = [record for record in records if record["event_type"] == "network"]
    assert inbound
    assert all(record["trace_id"] == root_trace for record in inbound)


def test_missing_trace_header_falls_back_to_generated_conversion_job_id(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())

    assert response.status_code == 202
    body = response.json()
    assert body["trace_id"] == body["conversion_job_id"]
    persisted = json.loads(
        (tmp_path / "jobs" / f"{body['conversion_job_id']}.json").read_text(encoding="utf-8")
    )
    assert persisted["trace_id"] == body["conversion_job_id"]
    assert client.get(f"/api/conversions/{body['conversion_job_id']}/result").json()["trace_id"] == body["conversion_job_id"]


@pytest.mark.parametrize(
    "trace_id",
    [
        "ifcready_bad value",
        "ifcready_bad\x7fvalue",
        "ifcready_" + "a" * 192,
        "rev_1779687625000_064c6813",
        "ifcready_ifcready_1779687625000_064c6813",
    ],
)
def test_invalid_trace_header_returns_400_without_creating_job(tmp_path: Path, trace_id: str):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(),
        headers={"X-Trace-Id": trace_id},
    )

    assert response.status_code == 400
    assert job_file_count(tmp_path) == 0


def test_conversion_lifecycle_records_keep_persisted_trace_on_success_and_failure(tmp_path: Path, monkeypatch):
    records, logger_creations = capture_structured_records(monkeypatch)
    success_trace = "ifcready_1779687625000_success01"
    failed_trace = "ifcready_1779687625000_failure01"
    success_client = make_client(tmp_path / "success", converter=FakeSuccessfulConverter())
    failed_client = make_client(tmp_path / "failed", converter=FakeFailedConverter())

    success = success_client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(event_id="evt_lifecycle_success", idempotency_key="idem_lifecycle_success"),
        headers={"X-Trace-Id": success_trace},
    )
    failed = failed_client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(event_id="evt_lifecycle_failed", idempotency_key="idem_lifecycle_failed"),
        headers={"X-Trace-Id": failed_trace},
    )

    assert success.status_code == 202
    assert failed.status_code == 202
    success_job_id = success.json()["conversion_job_id"]
    failed_job_id = failed.json()["conversion_job_id"]
    assert success_client.get(f"/api/conversions/{success_job_id}/result").json()["trace_id"] == success_trace
    assert failed_client.get(f"/api/conversions/{failed_job_id}/result").json()["trace_id"] == failed_trace
    assert logger_creations == ["streaming-server", "streaming-server"]
    lifecycle = [record for record in records if record["event_type"] == "lifecycle"]
    success_records = [record for record in lifecycle if record["trace_id"] == success_trace]
    failed_records = [record for record in lifecycle if record["trace_id"] == failed_trace]
    assert [record["data"]["status"] for record in success_records] == ["queued", "running", "succeeded"]
    assert [record["data"]["status"] for record in failed_records] == ["queued", "running", "failed"]
    assert all(record["data"]["subject_kind"] == "conversion_job" for record in lifecycle)


def test_minio_retrigger_with_new_presigned_url_and_cache_path_replays_existing_job(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    shared_artifact = {
        "artifact_id": "ifc_minio_model_v1",
        "format": "ifc",
        "filename": "model.ifc",
        "etag": "77e4fbad-e0f7-4946-9a49-fa84d941ddeb",
    }
    first = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(
            event_id="evt_minio_watch_001",
            correlation_id="minio-watch-f94841eb",
            idempotency_key="idem_minio_model_v1",
            ifc_artifact={
                **shared_artifact,
                "url": "http://minio.local/source/model.ifc?X-Amz-Date=20260709T074923Z&X-Amz-Signature=old",
                "local_path": "/workspace/storage/ifcready_old/source.ifc",
                "host_local_path": "D:/Users/deploy/AI-bim-geo/storage/ifcready_old/source.ifc",
            },
        ),
    )
    replay = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(
            event_id="evt_minio_watch_002",
            correlation_id="minio-watch-f94841eb",
            idempotency_key="idem_minio_model_v1",
            ifc_artifact={
                **shared_artifact,
                "url": "http://minio.local/source/model.ifc?X-Amz-Date=20260709T081100Z&X-Amz-Signature=new",
                "local_path": "/workspace/storage/ifcready_new/source.ifc",
                "host_local_path": "D:/Users/deploy/AI-bim-geo/storage/ifcready_new/source.ifc",
            },
        ),
    )

    assert first.status_code == 202
    assert replay.status_code == 202
    assert replay.json()["conversion_job_id"] == first.json()["conversion_job_id"]
    assert replay.json()["idempotent_replay"] is True
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


# --- conversion-kit-port-race:併發 ifc-ready job 不得同時真的跑 Kit 轉檔 ---
# 2026-07-06 實測(job ifcready_1783310901113_82ba35bc):bim-review-coordinator 的
# ConversionDispatchQueue 只序列化「送出 POST /api/conversions/ifc-to-usdc」這個
# dispatch 動作；這支 API 立刻回 202、真正轉檔用 FastAPI BackgroundTasks 丟到背景
# 執行，不同 request 的 background task 之間沒有互斥。結果是幾乎同時進來的多個
# ifc-ready job，其 Kit CAD 轉檔 subprocess 會真的同時啟動，互搶 Kit 內建 HTTP
# 服務的預設 port（8011），輸家直接 crash、該筆轉檔失敗。


def test_concurrent_conversion_requests_do_not_run_kit_conversion_in_parallel(tmp_path: Path):
    converter = ConcurrencyTrackingConverter()
    client = make_client(tmp_path, converter=converter)

    def post_job(idx: int) -> None:
        client.post(
            "/api/conversions/ifc-to-usdc",
            json=ifc_ready_payload(
                event_id=f"evt_concurrent_{idx}",
                idempotency_key=f"idem_concurrent_{idx}",
                ifc_artifact={
                    "artifact_id": f"artifact_concurrent_{idx}",
                    "format": "ifc",
                    "filename": f"concurrent-{idx}.ifc",
                    "url": f"edge-local://fixtures/concurrent-{idx}.ifc",
                },
            ),
        )

    threads = [threading.Thread(target=post_job, args=(idx,)) for idx in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert converter.max_active == 1


def test_concurrent_completion_of_same_job_runs_converter_once(tmp_path: Path):
    converter = SameJobBlockingConverter()
    settings = ConversionAuthoritySettings(
        service_root=tmp_path,
        artifacts_root=tmp_path / "artifacts",
        jobs_dir=tmp_path / "jobs",
        public_artifacts_url="http://testserver/artifacts",
        bim_control_callback_url=None,
    )
    first_store = conversion_authority_module.StreamingConversionStore(settings=settings, converter=converter)
    second_store = conversion_authority_module.StreamingConversionStore(settings=settings, converter=converter)
    job = first_store.create_conversion_job(ifc_ready_payload(event_id="evt_same_job_concurrency"))
    job_id = job["conversion_job_id"]
    results: list[dict] = []

    first = threading.Thread(target=lambda: results.append(first_store.complete_conversion_job(job_id)))
    first.start()
    assert converter.entered.wait(timeout=5)

    second = threading.Thread(target=lambda: results.append(second_store.complete_conversion_job(job_id)))
    second.start()
    time.sleep(0.05)
    converter.release.set()
    first.join(timeout=5)
    second.join(timeout=5)

    assert not first.is_alive()
    assert not second.is_alive()
    assert converter.calls == 1
    assert len(results) == 2
    assert {result["status"] for result in results} == {"succeeded"}


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
