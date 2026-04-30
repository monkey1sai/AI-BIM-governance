import json
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import HTMLResponse

from .bim_control_client import post_conversion_result
from .job_store import JobStore
from .models import ConversionRequest
from .orchestrator import run_conversion_job
from .settings import Settings
from .ui import render_ui


def create_app(settings: Settings | None = None, run_background: bool = True) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    store = JobStore(resolved_settings.jobs_dir)
    app = FastAPI(title="IFC to USDC Conversion API", version="0.1.0")

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "service": "_conversion-service",
            "work_dir": str(resolved_settings.work_dir),
            "jobs_dir": str(resolved_settings.jobs_dir),
        }

    @app.get("/ui", response_class=HTMLResponse)
    def ui():
        return render_ui()

    @app.post("/api/conversions")
    def create_conversion(request: ConversionRequest, background_tasks: BackgroundTasks):
        request_payload = request.model_dump()
        job = store.create_job(request_payload)
        if run_background:
            background_tasks.add_task(run_conversion_job, job["job_id"], resolved_settings)
        return {"job_id": job["job_id"], "status": job["status"]}

    @app.get("/api/conversions/{job_id}")
    def get_conversion(job_id: str):
        try:
            job = store.get_job(job_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if job is None:
            raise HTTPException(status_code=404, detail="Conversion job not found.")
        return job

    @app.get("/api/conversions/{job_id}/result")
    def get_conversion_result(job_id: str):
        try:
            job = store.get_job(job_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if job is None:
            raise HTTPException(status_code=404, detail="Conversion job not found.")
        result = job.get("result")
        if not result:
            raise HTTPException(status_code=409, detail="Conversion result is not available yet.")
        return result

    @app.post("/api/dev/mock-conversion-result")
    def create_mock_conversion_result(payload: dict[str, Any] | None = None):
        request_payload = _mock_request_payload(payload or {})
        job = store.create_job(request_payload)
        result = _write_mock_outputs(resolved_settings, job["job_id"], request_payload)
        warning = post_conversion_result(resolved_settings, request_payload["model_version_id"], result)
        warnings = ["dev-only mock conversion result; no real converter was executed."]
        if warning:
            warnings.append(warning)
        return store.update_job(
            job["job_id"],
            status="succeeded",
            stage="mock_done",
            result=result,
            warnings=warnings,
        )

    return app


def _mock_request_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "project_id": str(payload.get("project_id") or "project_demo_001"),
        "model_version_id": str(payload.get("model_version_id") or "version_demo_001"),
        "source_artifact_id": str(payload.get("source_artifact_id") or "artifact_ifc_demo_001"),
        "source_url": str(
            payload.get("source_url")
            or "http://127.0.0.1:8002/static/projects/project_demo_001/versions/version_demo_001/source.ifc"
        ),
        "target_format": "usdc",
        "options": dict(payload.get("options") or {}),
    }


def _write_mock_outputs(settings: Settings, job_id: str, request_payload: dict[str, Any]) -> dict[str, Any]:
    project_id = request_payload["project_id"]
    model_version_id = request_payload["model_version_id"]
    destination_dir = settings.fake_storage_root / "static" / "projects" / project_id / "versions" / model_version_id
    destination_dir.mkdir(parents=True, exist_ok=True)
    _write_text_if_missing(destination_dir / "source.ifc", "ISO-10303-21;\nEND-ISO-10303-21;\n")
    _write_text_if_missing(destination_dir / "model.usdc", "# dev-only mock USDC placeholder\n")
    _write_json_if_missing(
        destination_dir / "ifc_index.json",
        {
            "mock": True,
            "items": [{"ifc_guid": "2VJ3sK9L000fake001", "name": "Mock IFC Element"}],
        },
    )
    _write_json_if_missing(
        destination_dir / "usd_index.json",
        {
            "mock": True,
            "items": [{"prim_path": "/World", "name": "World"}],
        },
    )
    _write_json_if_missing(
        destination_dir / "element_mapping.json",
        {
            "mock": True,
            "items": [
                {
                    "ifc_guid": "2VJ3sK9L000fake001",
                    "usd_prim_path": "/World",
                    "confidence": 1.0,
                }
            ],
        },
    )
    url_base = f"{settings.fake_storage_static_url}/projects/{project_id}/versions/{model_version_id}"
    return {
        "job_id": job_id,
        "status": "succeeded",
        "mock": True,
        "project_id": project_id,
        "model_version_id": model_version_id,
        "source_artifact_id": request_payload["source_artifact_id"],
        "usdc_artifact_id": "artifact_usdc_demo_001",
        "source_url": request_payload["source_url"],
        "usdc_url": f"{url_base}/model.usdc",
        "ifc_index_url": f"{url_base}/ifc_index.json",
        "usd_index_url": f"{url_base}/usd_index.json",
        "mapping_url": f"{url_base}/element_mapping.json",
    }


def _write_text_if_missing(path, content: str) -> None:
    if path.is_file():
        return
    path.write_text(content, encoding="utf-8")


def _write_json_if_missing(path, payload: dict[str, Any]) -> None:
    if path.is_file():
        return
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


app = create_app()
