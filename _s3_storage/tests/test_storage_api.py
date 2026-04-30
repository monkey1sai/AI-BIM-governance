import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def test_static_source_ifc_is_served(tmp_path: Path):
    static_root = tmp_path / "static"
    source_path = static_root / "projects" / "project_demo_001" / "versions" / "version_demo_001" / "source.ifc"
    source_path.parent.mkdir(parents=True)
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    client = TestClient(create_app(static_root=static_root))

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    response = client.get("/static/projects/project_demo_001/versions/version_demo_001/source.ifc")
    assert response.status_code == 200
    assert "ISO-10303-21" in response.text


def test_static_mapping_allows_web_viewer_cors(tmp_path: Path):
    static_root = tmp_path / "static"
    mapping_path = static_root / "projects" / "project_demo_001" / "versions" / "version_demo_001" / "element_mapping.json"
    mapping_path.parent.mkdir(parents=True)
    mapping_path.write_text('{"items":[]}', encoding="utf-8")

    client = TestClient(create_app(static_root=static_root))

    response = client.get(
        "/static/projects/project_demo_001/versions/version_demo_001/element_mapping.json",
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
