import base64
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app
from app.settings import Settings


@pytest.fixture
def case_dir() -> Path:
    root = Path(__file__).resolve().parents[1] / "pytest-cache-files-worker"
    path = root / uuid4().hex
    path.mkdir(parents=True, exist_ok=False)
    return path


def make_client(case_dir: Path, run_background: bool = True) -> TestClient:
    settings = Settings(
        service_root=case_dir,
        objects_root=case_dir / "objects",
        jobs_dir=case_dir / "jobs",
        dev_storage_root=case_dir / "storage",
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


def test_source_artifact_upload_writes_versioned_object_layout(case_dir: Path):
    client = make_client(case_dir)

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


def test_object_download_allows_local_viewer_origin(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    response = client.get(
        artifact["object_url"].removeprefix("http://testserver"),
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_dev_ifc_sources_reports_missing_root_without_paths(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/dev/ifc-sources")

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["root"]["exists"] is False
    assert str(case_dir) not in response.text


def test_worker_demo_ui_loads_without_legacy_services(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/")

    assert response.status_code == 200
    assert "Worker 上傳建模與自動轉換" in response.text
    assert "/api/dev/ifc-sources" in response.text
    assert "8002" not in response.text
    assert "8003" not in response.text


def test_dev_ifc_sources_lists_recursive_ifc_only_without_absolute_paths(case_dir: Path):
    storage = case_dir / "storage"
    nested = storage / "nested"
    nested.mkdir(parents=True)
    (storage / "A.ifc").write_text("ISO-10303-21;", encoding="utf-8")
    (nested / "B.IFC").write_text("ISO-10303-21;", encoding="utf-8")
    (nested / "note.txt").write_text("not ifc", encoding="utf-8")
    client = make_client(case_dir)

    response = client.get("/api/dev/ifc-sources")

    assert response.status_code == 200
    body = response.json()
    assert [item["relative_path"] for item in body["items"]] == ["A.ifc", "nested/B.IFC"]
    assert all(item["source_id"] for item in body["items"])
    assert str(storage) not in response.text


def test_selected_dev_ifc_source_creates_artifact_and_conversion_job(case_dir: Path):
    storage = case_dir / "storage"
    storage.mkdir()
    (storage / "source.ifc").write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")
    client = make_client(case_dir)
    source = client.get("/api/dev/ifc-sources").json()["items"][0]

    response = client.post(
        f"/api/dev/ifc-sources/{source['source_id']}/conversions",
        json={
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "source_system": "dev_storage",
            "uploaded_by": "dev_user_001",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"]["relative_path"] == "source.ifc"
    assert body["source_artifact_id"].startswith("artifact_src_")
    assert body["artifact_group_id"].startswith("ag_")
    assert body["conversion_job_id"].startswith("conv_")
    result = client.get(body["result_url"])
    assert result.status_code == 200
    assert result.json()["status"] == "succeeded"


def test_selected_dev_ifc_source_rejects_stale_source_id(case_dir: Path):
    storage = case_dir / "storage"
    storage.mkdir()
    source_file = storage / "source.ifc"
    source_file.write_text("ISO-10303-21;\n", encoding="utf-8")
    client = make_client(case_dir)
    source_id = client.get("/api/dev/ifc-sources").json()["items"][0]["source_id"]
    source_file.write_text("ISO-10303-21;\nDATA;\n", encoding="utf-8")

    response = client.post(
        f"/api/dev/ifc-sources/{source_id}/conversions",
        json={
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "source_system": "dev_storage",
            "uploaded_by": "dev_user_001",
        },
    )

    assert response.status_code == 404
    assert "Unknown or stale" in response.json()["detail"]


def test_source_artifact_rejects_missing_lineage(case_dir: Path):
    client = make_client(case_dir)
    payload = source_payload()
    payload.pop("project_id")

    response = client.post("/api/artifacts", json=payload)

    assert response.status_code == 422


def test_conversion_can_remain_queued_without_background_runner(case_dir: Path):
    client = make_client(case_dir, run_background=False)
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


def test_conversion_result_contains_derived_urls_lineage_and_readiness(case_dir: Path):
    client = make_client(case_dir)
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


def test_callback_failure_is_recorded_as_job_warning(case_dir: Path):
    client = make_client(case_dir)
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
