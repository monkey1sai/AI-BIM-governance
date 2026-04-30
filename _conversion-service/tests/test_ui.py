import json
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
    assert "轉檔服務 Demo UI" in response.text
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

    mapping_path = (
        settings.fake_storage_root
        / "static"
        / "projects"
        / "project_demo_001"
        / "versions"
        / "version_demo_001"
        / "element_mapping.json"
    )
    mapping = json.loads(mapping_path.read_text(encoding="utf-8"))

    assert mapping["mock"] is True
    assert mapping["items"][0]["mapping_method"] == "fake_for_smoke_test"
    assert mapping["items"][0]["mapping_confidence"] == 0.01
    assert mapping["summary"]["fake_mapping_count"] == 1


def test_dev_mock_conversion_result_does_not_overwrite_real_mapping(tmp_path: Path):
    settings = make_settings(tmp_path)
    mapping_path = (
        settings.fake_storage_root
        / "static"
        / "projects"
        / "project_demo_001"
        / "versions"
        / "version_demo_001"
        / "element_mapping.json"
    )
    mapping_path.parent.mkdir(parents=True)
    real_mapping = {
        "mock": False,
        "items": [
            {
                "ifc_guid": "19nzyxtx5CXwVzdF_4phxj",
                "ifc_class": "IfcColumn",
                "revit_element_id": "401627",
                "usd_prim_path": "/model/IFCCOLUMN/tn__75x120cm401627",
                "mapping_method": "path_revit_element_id",
                "mapping_confidence": 0.7,
            }
        ],
        "summary": {"mapped_count": 1, "fake_mapping_count": 0},
    }
    mapping_path.write_text(json.dumps(real_mapping, indent=2), encoding="utf-8")

    client = TestClient(create_app(settings=settings, run_background=False))

    response = client.post("/api/dev/mock-conversion-result")

    assert response.status_code == 200
    body = response.json()
    assert any("real element_mapping.json already exists" in warning for warning in body["warnings"])
    assert json.loads(mapping_path.read_text(encoding="utf-8")) == real_mapping
