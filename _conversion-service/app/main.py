from fastapi import BackgroundTasks, FastAPI, HTTPException

from .job_store import JobStore
from .models import ConversionRequest
from .orchestrator import run_conversion_job
from .settings import Settings


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

    return app


app = create_app()
