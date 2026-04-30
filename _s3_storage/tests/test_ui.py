import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def test_demo_ui_is_served(tmp_path: Path):
    client = TestClient(create_app(static_root=tmp_path / "static"))

    response = client.get("/ui")

    assert response.status_code == 200
    assert "Fake S3 Storage Demo UI" in response.text
    assert "/api/dev/files" in response.text


def test_dev_files_lists_static_files(tmp_path: Path):
    static_root = tmp_path / "static"
    demo_file = static_root / "projects" / "project_demo_001" / "versions" / "version_demo_001" / "model.usdc"
    demo_file.parent.mkdir(parents=True)
    demo_file.write_text("demo", encoding="utf-8")
    client = TestClient(create_app(static_root=static_root))

    response = client.get("/api/dev/files")

    assert response.status_code == 200
    body = response.json()
    assert body["root"] == str(static_root)
    assert body["items"][0]["path"] == "projects/project_demo_001/versions/version_demo_001/model.usdc"
    assert body["items"][0]["url"].endswith("/static/projects/project_demo_001/versions/version_demo_001/model.usdc")
