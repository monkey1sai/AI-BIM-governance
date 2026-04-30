import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app
from app.settings import Settings


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        service_root=tmp_path,
        work_dir=tmp_path / "work",
        jobs_dir=tmp_path / "jobs",
        logs_dir=tmp_path / "logs",
        fake_storage_root=tmp_path / "storage",
        fake_storage_static_url="http://127.0.0.1:8002/static",
        fake_bim_control_url="http://127.0.0.1:1",
        bim_streaming_server_root=tmp_path / "bim-streaming-server",
    )


def test_demo_ui_is_served(tmp_path: Path):
    client = TestClient(create_app(settings=make_settings(tmp_path), run_background=False))

    response = client.get("/ui")

    assert response.status_code == 200
    assert "Conversion Service Demo UI" in response.text
    assert "/api/conversions" in response.text


def test_dev_mock_conversion_result_creates_succeeded_job(tmp_path: Path):
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings=settings, run_background=False))

    response = client.post("/api/dev/mock-conversion-result")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "succeeded"
    assert body["stage"] == "mock_done"
    assert body["result"]["mock"] is True
    assert body["result"]["usdc_url"].endswith("/projects/project_demo_001/versions/version_demo_001/model.usdc")
    assert (settings.fake_storage_root / "static" / "projects" / "project_demo_001" / "versions" / "version_demo_001" / "model.usdc").is_file()
