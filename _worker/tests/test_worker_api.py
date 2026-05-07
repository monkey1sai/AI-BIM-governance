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


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


def test_health_returns_ok_and_service_name(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "_worker"
    assert "objects_root" in body
    assert "jobs_dir" in body


# ---------------------------------------------------------------------------
# Artifact group GET endpoint
# ---------------------------------------------------------------------------


def test_get_artifact_group_returns_404_for_unknown_group(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/api/artifact-groups/ag_nonexistent")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_get_artifact_group_returns_400_for_invalid_id(tmp_path: Path):
    client = make_client(tmp_path)

    # Space (%20 URL-encoded) in artifact_group_id fails safe_id validation → 400
    response = client.get("/api/artifact-groups/bad%20id")

    assert response.status_code == 400


def test_get_artifact_group_returns_group_after_upload(tmp_path: Path):
    client = make_client(tmp_path)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    response = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["artifact_group_id"] == artifact["artifact_group_id"]
    assert body["status"] == "source_uploaded"
    assert body["ready_status"] == "missing_derived"


# ---------------------------------------------------------------------------
# Artifact group readiness endpoint
# ---------------------------------------------------------------------------


def test_readiness_returns_404_for_unknown_group(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/api/artifact-groups/ag_nonexistent/readiness")

    assert response.status_code == 404


def test_readiness_returns_400_for_invalid_group_id(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/api/artifact-groups/bad path here/readiness")

    assert response.status_code == 400


def test_readiness_after_upload_shows_missing_derived(tmp_path: Path):
    client = make_client(tmp_path)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    response = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")

    assert response.status_code == 200
    body = response.json()
    assert body["ready_status"] == "missing_derived"
    assert body["has_source"] is True
    assert body["has_derived"] is False
    assert body["has_mapping"] is False


def test_readiness_after_conversion_shows_all_ready(tmp_path: Path):
    client = make_client(tmp_path)
    artifact = client.post("/api/artifacts", json=source_payload()).json()
    client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "generate_mapping": True},
    )

    response = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")

    assert response.status_code == 200
    body = response.json()
    assert body["ready_status"] == "ready"
    assert body["has_source"] is True
    assert body["has_derived"] is True
    assert body["has_mapping"] is True


# ---------------------------------------------------------------------------
# Conversion endpoint error cases
# ---------------------------------------------------------------------------


def test_conversion_returns_404_for_unknown_source_artifact(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post(
        "/api/conversions",
        json={"source_artifact_id": "artifact_src_nonexistent"},
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_get_conversion_returns_404_for_unknown_job(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/api/conversions/conv_20240101120000_unknown12")

    assert response.status_code == 404


def test_get_conversion_result_returns_not_ready_for_queued_job(tmp_path: Path):
    client = make_client(tmp_path, run_background=False)
    artifact = client.post("/api/artifacts", json=source_payload()).json()
    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"]},
    ).json()

    result = client.get(f"/api/conversions/{created['conversion_job_id']}/result")

    assert result.status_code == 200
    assert result.json()["ready"] is False
    assert result.json()["status"] == "queued"


def test_conversion_without_mapping_omits_mapping_url(tmp_path: Path):
    client = make_client(tmp_path)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "generate_mapping": False},
    ).json()

    result = client.get(f"/api/conversions/{created['conversion_job_id']}/result")

    assert result.status_code == 200
    assert result.json()["mapping_url"] is None
    readiness = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")
    assert readiness.json()["has_mapping"] is False


# ---------------------------------------------------------------------------
# Object serve endpoint
# ---------------------------------------------------------------------------


def test_object_serve_returns_404_for_missing_file(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/objects/tenants/nonexistent/file.ifc")

    assert response.status_code == 404


def test_object_serve_blocks_path_traversal(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/objects/../../../etc/passwd")

    assert response.status_code in (400, 404)


def test_artifact_upload_with_source_url_reference(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post(
        "/api/artifacts",
        json={
            **source_payload(),
            "content_base64": None,
            "source_url": "http://upstream/model.ifc",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["lineage"]["source_url"] == "http://upstream/model.ifc"


def test_artifact_upload_with_rvt_format(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post(
        "/api/artifacts",
        json=source_payload(source_format="rvt", filename="building.rvt"),
    )

    assert response.status_code == 200
    assert response.json()["metadata"]["source_format"] == "rvt"


def test_artifact_upload_rejects_no_source(tmp_path: Path):
    client = make_client(tmp_path)
    payload = source_payload()
    payload.pop("content_base64")

    response = client.post("/api/artifacts", json=payload)

    assert response.status_code == 422


def test_localhost_cors_origin_is_accepted(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
