import base64
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app
from app.settings import Settings


def make_client(tmp_path: Path, run_background: bool = True) -> TestClient:
    settings = Settings(
        service_root=tmp_path,
        objects_root=tmp_path / "objects",
        jobs_dir=tmp_path / "jobs",
        fake_bim_control_url="http://127.0.0.1:1",
        public_objects_url="http://testserver/objects",
    )
    return TestClient(create_app(settings=settings, run_background=run_background))


def source_payload(**overrides):
    payload = {
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "source_system": "revit",
        "uploaded_by": "dev_user_001",
        "filename": "source.ifc",
        "source_format": "ifc",
        "content_base64": base64.b64encode(b"ISO-10303-21;\nEND-ISO-10303-21;\n").decode("ascii"),
    }
    payload.update(overrides)
    return payload


def test_source_artifact_upload_writes_versioned_object_layout(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post("/api/artifacts", json=source_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["source_artifact_id"].startswith("artifact_src_")
    assert body["status"] == "uploaded"
    assert "tenants/tenant_demo_001/projects/project_demo_001/versions/version_demo_001/artifact-groups/" in body["object_key"]
    assert body["object_url"].startswith("http://testserver/objects/")

    object_response = client.get(body["object_url"].removeprefix("http://testserver"))
    assert object_response.status_code == 200
    assert b"ISO-10303-21" in object_response.content


def test_object_download_allows_local_viewer_origin(tmp_path: Path):
    client = make_client(tmp_path)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    response = client.get(
        artifact["object_url"].removeprefix("http://testserver"),
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_source_artifact_rejects_missing_lineage(tmp_path: Path):
    client = make_client(tmp_path)
    payload = source_payload()
    payload.pop("project_id")

    response = client.post("/api/artifacts", json=payload)

    assert response.status_code == 422


def test_conversion_can_remain_queued_without_background_runner(tmp_path: Path):
    client = make_client(tmp_path, run_background=False)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    response = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    result = client.get(f"/api/conversions/{body['conversion_job_id']}/result")
    assert result.status_code == 200
    assert result.json()["ready"] is False


def test_conversion_result_contains_derived_urls_lineage_and_readiness(tmp_path: Path):
    client = make_client(tmp_path)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )

    assert created.status_code == 200
    job_id = created.json()["conversion_job_id"]
    job = client.get(f"/api/conversions/{job_id}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"

    result = client.get(f"/api/conversions/{job_id}/result")
    assert result.status_code == 200
    body = result.json()
    assert body["status"] == "succeeded"
    assert body["usdc_url"].endswith("/model.usdc")
    assert body["mapping_url"].endswith("/element_mapping.json")
    assert body["lineage"]["source_artifact_id"] == artifact["source_artifact_id"]

    readiness = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")
    assert readiness.status_code == 200
    assert readiness.json()["ready_status"] == "ready"


def test_callback_failure_is_recorded_as_job_warning(tmp_path: Path):
    client = make_client(tmp_path)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )

    assert created.status_code == 200
    job = client.get(f"/api/conversions/{created.json()['conversion_job_id']}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"
    assert any("_bim-control callback failed" in warning for warning in job.json()["warnings"])
