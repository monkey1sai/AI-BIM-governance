import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def test_conversion_result_is_stored_and_reloaded(case_dir: Path):
    client = TestClient(create_app(data_root=case_dir / "data"))
    payload = {
        "job_id": "conv_test_001",
        "status": "succeeded",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "usdc_url": "http://localhost:8005/objects/projects/project_demo_001/versions/version_demo_001/model.usdc",
        "mapping_url": "http://localhost:8005/objects/projects/project_demo_001/versions/version_demo_001/element_mapping.json",
    }

    post_response = client.post("/api/model-versions/version_demo_001/conversion-result", json=payload)

    assert post_response.status_code == 200
    stored = post_response.json()
    assert stored["conversion_status"] == "succeeded"
    assert stored["updated_at"]

    get_response = client.get("/api/model-versions/version_demo_001/conversion-result")
    assert get_response.status_code == 200
    assert get_response.json()["usdc_url"] == payload["usdc_url"]
    assert get_response.json()["mapping_url"] == payload["mapping_url"]

    artifacts_response = client.get("/api/model-versions/version_demo_001/artifacts")
    assert artifacts_response.status_code == 200
    usdc_artifacts = [
        item
        for item in artifacts_response.json()["items"]
        if item["artifact_id"] == "artifact_usdc_demo_001"
    ]
    assert usdc_artifacts
    assert usdc_artifacts[0]["status"] == "ready"
    assert usdc_artifacts[0]["url"] == payload["usdc_url"]


def test_streaming_conversion_callback_updates_ready_artifacts(case_dir: Path):
    client = TestClient(create_app(data_root=case_dir / "data"))
    payload = {
        "event_type": "streaming_conversion_result",
        "authority": "bim-streaming-server",
        "correlation_id": "corr_stream_001",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "conversion_job_id": "stream_conv_001",
        "status": "succeeded",
        "result": {
            "conversion_job_id": "stream_conv_001",
            "authority": "bim-streaming-server",
            "status": "succeeded",
            "ready": True,
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "ifc_artifact_id": "artifact_ifc_stream_001",
            "model": {
                "status": "ready",
                "format": "usdc",
                "url": "http://127.0.0.1:49100/artifacts/stream_conv_001/model.usdc",
            },
            "artifacts": {
                "model_usdc": {
                    "artifact_id": "artifact_stream_usdc_001",
                    "role": "model_usdc",
                    "format": "usdc",
                    "url": "http://127.0.0.1:49100/artifacts/stream_conv_001/model.usdc",
                },
                "element_mapping": {
                    "artifact_id": "artifact_stream_mapping_001",
                    "role": "element_mapping",
                    "format": "json",
                    "url": "http://127.0.0.1:49100/artifacts/stream_conv_001/element_mapping.json",
                },
            },
            "quality_metrics": {"coverage_ratio": 1.0, "coverage_status": "pass"},
            "lineage": {
                "source_rvt_artifact_id": "artifact_rvt_stream_001",
                "ifc_artifact_id": "artifact_ifc_stream_001",
                "usdc_artifact_id": "artifact_stream_usdc_001",
                "mapping_artifact_id": "artifact_stream_mapping_001",
            },
        },
    }

    response = client.post("/api/streaming-conversion-results", json=payload)

    assert response.status_code == 200
    stored = response.json()
    assert stored["conversion_status"] == "succeeded"
    assert stored["usdc_url"] == payload["result"]["artifacts"]["model_usdc"]["url"]
    assert stored["mapping_url"] == payload["result"]["artifacts"]["element_mapping"]["url"]
    assert stored["conversion_authority"] == "bim-streaming-server"

    artifacts = client.get("/api/model-versions/version_demo_001/artifacts").json()["items"]
    stream_usdc = next(item for item in artifacts if item["artifact_id"] == "artifact_stream_usdc_001")
    assert stream_usdc["status"] == "ready"
    assert stream_usdc["conversion_authority"] == "bim-streaming-server"
    assert stream_usdc["conversion_job_id"] == "stream_conv_001"

    groups = client.get("/api/model-versions/version_demo_001/artifact-groups").json()["items"]
    group = next(item for item in groups if item["artifact_group_id"] == "ag_stream_conv_001")
    assert group["ready_status"] == "ready"
    assert group["mapping"]["url"] == payload["result"]["artifacts"]["element_mapping"]["url"]


def test_conversion_result_uses_original_filename_for_source_artifact_name(case_dir: Path):
    client = TestClient(create_app(data_root=case_dir / "data"))
    original_filename = "許良宇圖書館建築_2026.ifc"
    payload = {
        "job_id": "conv_test_001",
        "status": "succeeded",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "source_artifact_id": "artifact_src_test_001",
        "source_url": "http://localhost:8005/objects/source.ifc",
        "usdc_url": "http://localhost:8005/objects/model.usdc",
        "mapping_url": "http://localhost:8005/objects/element_mapping.json",
        "original_filename": original_filename,
    }

    response = client.post("/api/model-versions/version_demo_001/conversion-result", json=payload)

    assert response.status_code == 200
    artifacts = client.get("/api/model-versions/version_demo_001/artifacts").json()["items"]
    source = next(item for item in artifacts if item["artifact_id"] == "artifact_src_test_001")
    assert source["name"] == original_filename


def test_conversion_result_source_artifact_name_falls_back_without_original_filename(case_dir: Path):
    client = TestClient(create_app(data_root=case_dir / "data"))
    payload = {
        "job_id": "conv_test_001",
        "status": "succeeded",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "source_artifact_id": "artifact_src_test_001",
        "source_url": "http://localhost:8005/objects/source.ifc",
        "usdc_url": "http://localhost:8005/objects/model.usdc",
        "mapping_url": "http://localhost:8005/objects/element_mapping.json",
    }

    response = client.post("/api/model-versions/version_demo_001/conversion-result", json=payload)

    assert response.status_code == 200
    artifacts = client.get("/api/model-versions/version_demo_001/artifacts").json()["items"]
    source = next(item for item in artifacts if item["artifact_id"] == "artifact_src_test_001")
    assert source["name"] == "原始 IFC"
