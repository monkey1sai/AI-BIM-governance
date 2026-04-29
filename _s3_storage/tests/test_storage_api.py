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
