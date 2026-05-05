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
        result, output_warnings = _write_mock_outputs(resolved_settings, job["job_id"], request_payload)
        warning = post_conversion_result(resolved_settings, request_payload["model_version_id"], result)
        warnings = ["dev-only mock conversion result; no real converter was executed.", *output_warnings]
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


def _write_mock_outputs(settings: Settings, job_id: str, request_payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
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
            "elements": [
                {
                    "ifc_guid": "0BTBFw6f90Nfh9rP1dlXr7",
                    "ifc_class": "IfcWall",
                    "name": "Mock IFC Element",
                    "revit_element_id": "551956",
                }
            ],
            "summary": {"element_count": 1, "guid_count": 1},
        },
    )
    _write_json_if_missing(
        destination_dir / "usd_index.json",
        {
            "mock": True,
            "prims": [
                {
                    "path": "/World",
                    "name": "World",
                    "type": "Xform",
                    "ifc_class": "IfcWall",
                    "identifier_candidates": [
                        {"source": "path", "key": "revit_element_id", "value": "551956"},
                    ],
                }
            ],
            "prim_count": 1,
        },
    )
    warnings = []
    mapping_warning = _write_mock_mapping_if_allowed(
        destination_dir / "element_mapping.json",
        {
            "mock": True,
            "project_id": project_id,
            "model_version_id": model_version_id,
            "source_artifact_id": request_payload["source_artifact_id"],
            "usdc_artifact_id": "artifact_usdc_demo_001",
            "mapping_version": "mock",
            "allow_fake_mapping": True,
            "items": [
                {
                    "mock": True,
                    "ifc_guid": "0BTBFw6f90Nfh9rP1dlXr7",
                    "ifc_class": "IfcWall",
                    "name": "Mock IFC Element",
                    "revit_element_id": "551956",
                    "usd_prim_path": "/World",
                    "usd_prim_type": "Xform",
                    "mapping_method": "fake_for_smoke_test",
                    "mapping_confidence": 0.01,
                }
            ],
            "unmapped_ifc_guids": [],
            "unmapped_usd_prims": [],
            "summary": {
                "mapped_count": 1,
                "unmapped_ifc_count": 0,
                "unmapped_usd_count": 0,
                "fake_mapping_count": 1,
            },
        },
    )
    if mapping_warning:
        warnings.append(mapping_warning)
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
    }, warnings


def _write_text_if_missing(path, content: str) -> None:
    if path.is_file():
        return
    path.write_text(content, encoding="utf-8")


def _write_json_if_missing(path, payload: dict[str, Any]) -> None:
    if path.is_file():
        return
    _write_json(path, payload)


def _write_mock_mapping_if_allowed(path, payload: dict[str, Any]) -> str | None:
    if path.is_file() and not _is_mock_mapping_file(path):
        return "real element_mapping.json already exists; dev mock left it unchanged."
    _write_json(path, payload)
    return None


def _is_mock_mapping_file(path) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(payload, dict):
        return False
    if payload.get("mock") is True or payload.get("allow_fake_mapping") is True:
        return True
    summary = payload.get("summary")
    if isinstance(summary, dict) and int(summary.get("fake_mapping_count") or 0) > 0:
        return True
    return any(
        isinstance(item, dict) and (item.get("mock") is True or item.get("mapping_method") == "fake_for_smoke_test")
        for item in payload.get("items") or []
    )


def _write_json(path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


app = create_app()
