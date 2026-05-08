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
