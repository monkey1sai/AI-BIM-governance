from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


@pytest.fixture
def case_dir(tmp_path: Path) -> Path:
    return tmp_path


def make_client(case_dir: Path, run_background: bool = True) -> TestClient:
    settings = Settings(
        service_root=case_dir,
        objects_root=case_dir / "objects",
        jobs_dir=case_dir / "jobs",
        dev_storage_root=case_dir / "storage",
        fake_bim_control_url="http://127.0.0.1:1",
        public_objects_url="http://testserver/objects",
    )
    return TestClient(create_app(settings=settings, run_background=run_background))


def rvt_uploaded_payload(**overrides):
    payload = {
        "event_type": "rvt_uploaded",
        "event_id": f"evt_rvt_{uuid4().hex[:8]}",
        "correlation_id": "corr_rvt_demo_001",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "source_artifact": {
            "artifact_id": "artifact_rvt_demo_001",
            "format": "rvt",
            "filename": "demo-model.rvt",
            "url": "http://127.0.0.1:8001/uploads/demo-model.rvt",
            "checksum_sha256": "sha256-rvt-demo",
        },
        "requested_outputs": ["ifc"],
        "callback_url": "http://127.0.0.1:8001/api/rvt-export-results",
        "handoff_target_url": "http://127.0.0.1:49100/api/conversions/ifc-to-usdc",
        "options": {
            "export_mode": "external_revit",
            "auto_process": True,
        },
    }
    payload.update(overrides)
    return payload


def test_rvt_uploaded_event_creates_queued_export_job(case_dir: Path):
    client = make_client(case_dir, run_background=False)

    response = client.post("/api/rvt-exports", json=rvt_uploaded_payload())

    assert response.status_code == 202
    body = response.json()
    assert body["export_job_id"].startswith("rvt_export_")
    assert body["status"] == "queued"
    assert body["queue_state"] == "queued"
    assert body["target_format"] == "ifc"
    assert body["correlation_id"] == "corr_rvt_demo_001"
    assert body["source_rvt_artifact_id"] == "artifact_rvt_demo_001"
    assert body["callback_url"] == "http://127.0.0.1:8001/api/rvt-export-results"
    assert body["handoff_target_url"] == "http://127.0.0.1:49100/api/conversions/ifc-to-usdc"


def test_fake_fixture_mode_records_ifc_ready_handoff_without_usdc(case_dir: Path):
    client = make_client(case_dir)
    payload = rvt_uploaded_payload(
        options={
            "export_mode": "fake_fixture",
            "auto_process": True,
            "fixture_ifc_url": "http://testserver/objects/fixtures/demo-model.ifc",
        }
    )

    response = client.post("/api/rvt-exports", json=payload)

    assert response.status_code == 202
    job = client.get(f"/api/rvt-exports/{response.json()['export_job_id']}").json()
    assert job["status"] == "ifc_ready"
    assert job["queue_state"] == "ifc_ready"
    assert job["export_mode"] == "fake_fixture"
    assert job["ifc_artifact"]["format"] == "ifc"
    assert job["ifc_artifact"]["url"] == "http://testserver/objects/fixtures/demo-model.ifc"
    assert job["ifc_artifact"]["source_rvt_artifact_id"] == "artifact_rvt_demo_001"
    assert job["ifc_ready_event"]["event_type"] == "ifc_ready"
    assert job["ifc_ready_event"]["correlation_id"] == "corr_rvt_demo_001"
    assert job["ifc_ready_event"]["ifc_artifact"]["artifact_id"] == job["ifc_artifact"]["artifact_id"]
    assert job["lineage"]["source_rvt_artifact_id"] == "artifact_rvt_demo_001"
    assert job["lineage"]["ifc_artifact_id"] == job["ifc_artifact"]["artifact_id"]
    assert job["lineage"]["real_revit_export"] is False
    assert "usdc_url" not in job
    assert "model.usdc" not in str(job)


def test_real_revit_mode_without_prerequisite_is_blocked_and_does_not_emit_ifc_ready(case_dir: Path):
    client = make_client(case_dir)

    response = client.post("/api/rvt-exports", json=rvt_uploaded_payload())

    assert response.status_code == 202
    job = client.get(f"/api/rvt-exports/{response.json()['export_job_id']}").json()
    assert job["status"] == "blocked"
    assert job["queue_state"] == "failed"
    assert job["stage"] == "blocked_missing_revit_runtime"
    assert job["blocked_reason"] == "revit_runtime_unavailable"
    assert job["ifc_artifact"] is None
    assert job["ifc_ready_event"] is None
    assert "usdc_url" not in job
    assert "model.usdc" not in str(job)
