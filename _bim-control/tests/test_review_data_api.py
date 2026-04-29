import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def test_seeded_project_artifacts_and_issues_are_queryable(tmp_path: Path):
    client = TestClient(create_app(data_root=tmp_path / "data"))

    projects = client.get("/api/projects")
    assert projects.status_code == 200
    assert projects.json()["items"][0]["project_id"] == "project_demo_001"

    versions = client.get("/api/projects/project_demo_001/versions")
    assert versions.status_code == 200
    assert versions.json()["items"][0]["model_version_id"] == "version_demo_001"

    artifacts = client.get("/api/model-versions/version_demo_001/artifacts")
    assert artifacts.status_code == 200
    assert artifacts.json()["items"]
    assert artifacts.json()["artifacts"]

    issues = client.get("/api/model-versions/version_demo_001/review-issues")
    assert issues.status_code == 200
    assert issues.json()["items"][0]["issue_id"] == "ISSUE-DEMO-001"


def test_annotation_can_be_saved_and_read_back(tmp_path: Path):
    client = TestClient(create_app(data_root=tmp_path / "data"))
    payload = {
        "annotation_id": "ann_test_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "author_id": "dev_user_001",
        "title": "Smoke annotation",
        "body": "E2E annotation persistence check",
        "usd_prim_path": "/World",
    }

    created = client.post("/api/review-sessions/review_session_001/annotations", json=payload)
    assert created.status_code == 200
    assert created.json()["session_id"] == "review_session_001"

    listed = client.get("/api/review-sessions/review_session_001/annotations")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["annotation_id"] == "ann_test_001"
