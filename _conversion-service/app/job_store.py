from datetime import UTC, datetime
import json
from pathlib import Path
import re
from typing import Any, Mapping
from uuid import uuid4


SAFE_JOB_ID_RE = re.compile(r"^conv_[A-Za-z0-9_.-]+$")


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class JobStore:
    def __init__(self, jobs_dir: Path | str):
        self.jobs_dir = Path(jobs_dir)
        self.jobs_dir.mkdir(parents=True, exist_ok=True)

    def create_job(self, request: Mapping[str, Any]) -> dict[str, Any]:
        job_id = f"conv_{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"
        now = utc_now()
        job = {
            "job_id": job_id,
            "status": "queued",
            "stage": "queued",
            "created_at": now,
            "updated_at": now,
            "project_id": request["project_id"],
            "model_version_id": request["model_version_id"],
            "source_artifact_id": request["source_artifact_id"],
            "source_url": request["source_url"],
            "target_format": request.get("target_format", "usdc"),
            "options": dict(request.get("options") or {}),
            "warnings": [],
        }
        self._write(job)
        return job

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        path = self._job_path(job_id)
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def update_job(self, job_id: str, **updates: Any) -> dict[str, Any]:
        job = self.get_job(job_id)
        if job is None:
            raise KeyError(f"Job not found: {job_id}")
        job.update(updates)
        job["updated_at"] = utc_now()
        self._write(job)
        return job

    def _job_path(self, job_id: str) -> Path:
        if not SAFE_JOB_ID_RE.fullmatch(job_id):
            raise ValueError(f"Invalid job_id: {job_id}")
        return self.jobs_dir / f"{job_id}.json"

    def _write(self, job: Mapping[str, Any]) -> None:
        path = self._job_path(str(job["job_id"]))
        temp_path = path.with_suffix(path.suffix + ".tmp")
        temp_path.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(path)
