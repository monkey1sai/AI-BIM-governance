import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def test_demo_ui_is_served(tmp_path: Path):
    client = TestClient(create_app(data_root=tmp_path / "data"))

    response = client.get("/ui")

    assert response.status_code == 200
    assert "假 BIM 資料平台 Demo UI" in response.text
    assert "/api/model-versions/" in response.text


def test_dev_reset_seed_restores_demo_issue(tmp_path: Path):
    client = TestClient(create_app(data_root=tmp_path / "data"))

    created = client.post(
        "/api/model-versions/version_demo_001/review-issues",
        json={
            "issue_id": "ISSUE-TEMP-001",
            "project_id": "project_demo_001",
            "title": "Temporary issue",
        },
    )
    assert created.status_code == 200

    reset = client.post("/api/dev/reset-seed")

    assert reset.status_code == 200
    issues = client.get("/api/model-versions/version_demo_001/review-issues")
    assert issues.status_code == 200
    issue_ids = [item["issue_id"] for item in issues.json()["items"]]
    assert issue_ids == ["ISSUE-DEMO-001"]
