import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def test_conversion_result_is_stored_and_reloaded(tmp_path: Path):
    client = TestClient(create_app(data_root=tmp_path / "data"))
    payload = {
        "job_id": "conv_test_001",
        "status": "succeeded",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "usdc_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc",
        "mapping_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/element_mapping.json",
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
