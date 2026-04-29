import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.job_store import JobStore


def test_job_store_writes_and_reloads_state(tmp_path: Path):
    store = JobStore(tmp_path)
    job = store.create_job(
        {
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "source_artifact_id": "artifact_ifc_demo_001",
            "source_url": "http://localhost:8002/static/source.ifc",
            "target_format": "usdc",
            "options": {"force": True},
        }
    )

    assert job["job_id"].startswith("conv_")
    assert job["status"] == "queued"
    assert job["stage"] == "queued"

    store.update_job(job["job_id"], status="running", stage="downloading_source")

    reloaded = JobStore(tmp_path).get_job(job["job_id"])
    assert reloaded["status"] == "running"
    assert reloaded["stage"] == "downloading_source"
