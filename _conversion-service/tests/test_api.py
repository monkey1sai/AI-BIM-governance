import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app
from app.settings import Settings


def test_post_conversion_queues_job_without_running_background(tmp_path: Path):
    settings = Settings(
        service_root=tmp_path,
        work_dir=tmp_path / "work",
        jobs_dir=tmp_path / "jobs",
        logs_dir=tmp_path / "logs",
        fake_storage_root=tmp_path / "storage",
        bim_streaming_server_root=tmp_path / "bim-streaming-server",
    )
    client = TestClient(create_app(settings=settings, run_background=False))

    response = client.post(
        "/api/conversions",
        json={
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "source_artifact_id": "artifact_ifc_demo_001",
            "source_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/source.ifc",
            "target_format": "usdc",
            "options": {"force": True, "generate_mapping": True, "allow_fake_mapping": False},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["job_id"].startswith("conv_")
    assert body["status"] == "queued"

    get_response = client.get(f"/api/conversions/{body['job_id']}")
    assert get_response.status_code == 200
    assert get_response.json()["stage"] == "queued"


def test_health_returns_ok(tmp_path: Path):
    settings = Settings(
        service_root=tmp_path,
        work_dir=tmp_path / "work",
        jobs_dir=tmp_path / "jobs",
        logs_dir=tmp_path / "logs",
        fake_storage_root=tmp_path / "storage",
        bim_streaming_server_root=tmp_path / "bim-streaming-server",
    )
    client = TestClient(create_app(settings=settings, run_background=False))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["service"] == "_conversion-service"
