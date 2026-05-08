import json
from pathlib import Path
import base64
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse

from .dev_sources import list_dev_ifc_sources, resolve_dev_ifc_source
from .models import ArtifactIntakeRequest, ConversionRequest, DevIfcSourceConversionRequest
from .settings import Settings
from .store import WorkerStore, safe_id
from .ui import render_worker_ui


def create_app(settings: Settings | None = None, run_background: bool = True) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    store = WorkerStore(resolved_settings)
    app = FastAPI(title="AI BIM Worker Facade", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:8001",
            "http://127.0.0.1:8004",
        ],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/", response_class=HTMLResponse)
    @app.get("/ui", response_class=HTMLResponse)
    def ui():
        return render_worker_ui()

    @app.get("/health")
    def health():
        source_root = list_dev_ifc_sources(resolved_settings.dev_storage_root)["root"]
        return {
            "status": "ok",
            "service": "_worker",
            "objects_root": str(resolved_settings.objects_root),
            "jobs_dir": str(resolved_settings.jobs_dir),
            "dev_ifc_source_root": source_root,
        }

    @app.post("/api/artifacts")
    def create_artifact(request: ArtifactIntakeRequest):
        try:
            return store.create_source_artifact(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/artifact-groups/{artifact_group_id}")
    def get_artifact_group(artifact_group_id: str):
        try:
            group = store.get_artifact_group(artifact_group_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if group is None:
            raise HTTPException(status_code=404, detail="Artifact group not found.")
        return group

    @app.get("/api/artifact-groups/{artifact_group_id}/readiness")
    def get_artifact_group_readiness(artifact_group_id: str):
        try:
            group = store.get_artifact_group(artifact_group_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if group is None:
            raise HTTPException(status_code=404, detail="Artifact group not found.")
        return {
            "artifact_group_id": artifact_group_id,
            "status": group.get("status"),
            "ready_status": group.get("ready_status"),
            "has_source": bool(group.get("source")),
            "has_derived": bool(group.get("derived")),
            "has_mapping": bool((group.get("mapping") or {}).get("ready")),
        }

    @app.post("/api/conversions")
    def create_conversion(request: ConversionRequest, background_tasks: BackgroundTasks):
        try:
            job = store.create_conversion_job(request.source_artifact_id, request.model_dump())
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Source artifact not found.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if run_background and request.options.auto_complete:
            background_tasks.add_task(_run_conversion_and_callback, store, resolved_settings, job["conversion_job_id"])
        return {
            "conversion_job_id": job["conversion_job_id"],
            "job_id": job["job_id"],
            "status": job["status"],
            "artifact_group_id": job["artifact_group_id"],
        }

    @app.get("/api/dev/ifc-sources")
    def list_ifc_sources():
        return list_dev_ifc_sources(resolved_settings.dev_storage_root)

    @app.post("/api/dev/ifc-sources/{source_id}/conversions")
    def create_conversion_from_ifc_source(
        source_id: str,
        request: DevIfcSourceConversionRequest,
        background_tasks: BackgroundTasks,
    ):
        try:
            source_path, source_item = resolve_dev_ifc_source(resolved_settings.dev_storage_root, source_id)
            source_artifact = store.create_source_artifact(
                ArtifactIntakeRequest(
                    tenant_id=request.tenant_id,
                    project_id=request.project_id,
                    model_version_id=request.model_version_id,
                    source_system=request.source_system,
                    uploaded_by=request.uploaded_by,
                    filename=source_item["filename"],
                    source_format="ifc",
                    artifact_group_id=request.artifact_group_id,
                    content_base64=base64.b64encode(source_path.read_bytes()).decode("ascii"),
                )
            )
            conversion_request = ConversionRequest(
                source_artifact_id=source_artifact["source_artifact_id"],
                target_format=request.target_format,
                generate_mapping=request.generate_mapping,
                options=request.options,
            )
            job = store.create_conversion_job(
                conversion_request.source_artifact_id,
                conversion_request.model_dump(),
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        if run_background and request.options.auto_complete:
            background_tasks.add_task(_run_conversion_and_callback, store, resolved_settings, job["conversion_job_id"])
        return {
            "source": source_item,
            "source_artifact_id": source_artifact["source_artifact_id"],
            "artifact_group_id": source_artifact["artifact_group_id"],
            "conversion_job_id": job["conversion_job_id"],
            "job_id": job["job_id"],
            "status": job["status"],
            "original_filename": source_artifact["original_filename"],
            "conversion_url": f"/api/conversions/{job['conversion_job_id']}",
            "result_url": f"/api/conversions/{job['conversion_job_id']}/result",
            "readiness_url": f"/api/artifact-groups/{source_artifact['artifact_group_id']}/readiness",
        }

    @app.get("/api/conversions/{conversion_job_id}")
    def get_conversion(conversion_job_id: str):
        try:
            job = store.get_conversion_job(conversion_job_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if job is None:
            raise HTTPException(status_code=404, detail="Conversion job not found.")
        return job

    @app.get("/api/conversions/{conversion_job_id}/result")
    def get_conversion_result(conversion_job_id: str):
        try:
            job = store.get_conversion_job(conversion_job_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if job is None:
            raise HTTPException(status_code=404, detail="Conversion job not found.")
        result = job.get("result")
        if not result:
            return {
                "conversion_job_id": conversion_job_id,
                "status": job.get("status", "unknown"),
                "ready": False,
            }
        return result

    @app.get("/objects/{object_path:path}")
    def get_object(object_path: str):
        try:
            safe_object_path = _safe_object_path(resolved_settings.objects_root, object_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not safe_object_path.is_file():
            raise HTTPException(status_code=404, detail="Object not found.")
        return FileResponse(safe_object_path)

    return app


def _run_conversion_and_callback(store: WorkerStore, settings: Settings, conversion_job_id: str) -> None:
    job = store.complete_conversion_job(conversion_job_id)
    result = dict(job["result"])
    warning = _post_bim_control_result(settings, result)
    if warning:
        warnings = list(job.get("warnings") or [])
        warnings.append(warning)
        job["warnings"] = warnings
        from .store import write_json

        write_json(Path(settings.jobs_dir) / f"{conversion_job_id}.json", job)


def _post_bim_control_result(settings: Settings, result: dict[str, Any]) -> str | None:
    model_version_id = safe_id(str(result["model_version_id"]), "model_version_id")
    url = f"{settings.fake_bim_control_url}/api/model-versions/{model_version_id}/conversion-result"
    body = json.dumps(result, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=3) as response:
            if response.status >= 400:
                return f"_bim-control returned HTTP {response.status}."
    except URLError as exc:
        return f"_bim-control callback failed: {exc}."
    return None


def _safe_object_path(objects_root: Path, object_path: str) -> Path:
    root = Path(objects_root).resolve()
    candidate = (root / object_path).resolve()
    if root != candidate and root not in candidate.parents:
        raise ValueError("Invalid object path.")
    return candidate


app = create_app()
