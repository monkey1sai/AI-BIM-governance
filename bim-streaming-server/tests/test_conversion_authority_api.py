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
    ConversionAuthoritySettings,
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


def make_client(tmp_path: Path, converter, run_background: bool = True) -> TestClient:
    settings = ConversionAuthoritySettings(
        service_root=tmp_path,
        artifacts_root=tmp_path / "artifacts",
        jobs_dir=tmp_path / "jobs",
        public_artifacts_url="http://testserver/artifacts",
        bim_control_callback_url="http://127.0.0.1:8001/api/streaming-conversion-results",
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
        "ifc_artifact": {
            "artifact_id": "artifact_ifc_demo_001",
            "format": "ifc",
            "filename": "demo-model.ifc",
            "url": "http://127.0.0.1:8005/objects/fixtures/demo-model.ifc",
        },
        "requested_outputs": ["usdc", "element_mapping", "entity_index", "metadata"],
        "callback_url": "http://127.0.0.1:8001/api/streaming-conversion-results",
    }
    payload.update(overrides)
    return payload


def test_ifc_ready_creates_queued_streaming_conversion_job(tmp_path: Path):
    client = make_client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())

    assert response.status_code == 202
    body = response.json()
    assert body["conversion_job_id"].startswith("stream_conv_")
    assert body["status"] == "queued"
    assert body["authority"] == "bim-streaming-server"
    assert body["correlation_id"] == "corr_rvt_demo_001"


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


def test_placeholder_usdc_fails_without_ready_result(tmp_path: Path):
    client = make_client(tmp_path, converter=FakePlaceholderConverter())

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = response.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    assert result["error"]["code"] == "placeholder_usdc"
    assert result["model"]["status"] != "ready"
