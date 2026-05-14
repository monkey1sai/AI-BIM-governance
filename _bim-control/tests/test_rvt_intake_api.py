import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def make_client(case_dir: Path) -> TestClient:
    return TestClient(create_app(data_root=case_dir / "data"))


def rvt_payload(**overrides):
    payload = {
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "filename": "library_2026.rvt",
        "url": "file://storage/project_demo_001/version_demo_001/library_2026.rvt",
        "checksum_sha256": "sha256-demo-rvt",
        "idempotency_key": "idem-rvt-library-2026",
        "correlation_id": "corr-rvt-library-2026",
        "requested_outputs": ["ifc"],
    }
    payload.update(overrides)
    return payload


def test_rvt_intake_creates_source_artifact_and_event(case_dir: Path):
    client = make_client(case_dir)

    response = client.post("/api/model-versions/version_demo_001/rvt-intake", json=rvt_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["intake_status"] == "accepted"
    assert body["correlation_id"] == "corr-rvt-library-2026"

    artifact = body["source_artifact"]
    assert artifact["artifact_id"].startswith("artifact_rvt_")
    assert artifact["artifact_type"] == "rvt"
    assert artifact["format"] == "rvt"
    assert artifact["filename"] == "library_2026.rvt"
    assert artifact["url"] == "file://storage/project_demo_001/version_demo_001/library_2026.rvt"
    assert artifact["checksum_sha256"] == "sha256-demo-rvt"
    assert artifact["status"] == "rvt_uploaded"

    event = body["rvt_uploaded_event"]
    assert event["event_type"] == "rvt_uploaded"
    assert event["event_id"].startswith("evt_rvt_")
    assert event["correlation_id"] == "corr-rvt-library-2026"
    assert event["project_id"] == "project_demo_001"
    assert event["model_version_id"] == "version_demo_001"
    assert event["source_artifact"]["artifact_id"] == artifact["artifact_id"]
    assert event["source_artifact"]["format"] == "rvt"
    assert event["requested_outputs"] == ["ifc"]

    artifacts = client.get("/api/model-versions/version_demo_001/artifacts").json()["items"]
    stored = next(item for item in artifacts if item["artifact_id"] == artifact["artifact_id"])
    assert stored["idempotency_key"] == "idem-rvt-library-2026"


def test_rvt_intake_duplicate_idempotency_key_returns_existing_artifact(case_dir: Path):
    client = make_client(case_dir)
    first = client.post("/api/model-versions/version_demo_001/rvt-intake", json=rvt_payload())
    second = client.post("/api/model-versions/version_demo_001/rvt-intake", json=rvt_payload())

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["idempotent_replay"] is True
    assert second.json()["source_artifact"]["artifact_id"] == first.json()["source_artifact"]["artifact_id"]
    assert second.json()["rvt_uploaded_event"]["event_id"] == first.json()["rvt_uploaded_event"]["event_id"]

    artifacts = client.get("/api/model-versions/version_demo_001/artifacts").json()["items"]
    matches = [item for item in artifacts if item.get("idempotency_key") == "idem-rvt-library-2026"]
    assert len(matches) == 1


def test_rvt_intake_duplicate_idempotency_key_rejects_conflicting_payload(case_dir: Path):
    client = make_client(case_dir)
    first = client.post("/api/model-versions/version_demo_001/rvt-intake", json=rvt_payload())
    conflict = client.post(
        "/api/model-versions/version_demo_001/rvt-intake",
        json=rvt_payload(checksum_sha256="sha256-other-rvt"),
    )

    assert first.status_code == 201
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "Conflicting RVT intake idempotency key."


def test_rvt_intake_without_bytes_or_reference_returns_blocked_state(case_dir: Path):
    client = make_client(case_dir)
    payload = rvt_payload(url=None)

    response = client.post("/api/model-versions/version_demo_001/rvt-intake", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["intake_status"] == "blocked"
    assert body["blocker"] == "missing_rvt_source"
    assert body["correlation_id"] == "corr-rvt-library-2026"
    assert body["rvt_uploaded_event"] is None
