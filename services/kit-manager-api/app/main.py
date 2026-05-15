from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .kit_gateway import KitRuntimeGateway
from .kit_service import KitInstanceService
from .models import HealthResponse, OpenRequest
from .settings import Settings
from .usdc_repository import UsdcRepository


def create_app() -> FastAPI:
    settings = Settings.from_env()
    repository = UsdcRepository(settings.storage_root)
    gateway = KitRuntimeGateway(settings.kit_control_url)
    service = KitInstanceService(settings.kit_instance_id, repository, gateway)

    app = FastAPI(title="AI-BIM Kit Manager API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthResponse)
    def health():
        return HealthResponse(
            status="ok",
            runtime_mode=settings.runtime_mode,
            host_local_runtime_allowed=settings.host_local_runtime_allowed,
            kit_instance_id=settings.kit_instance_id,
            kit_control_url=settings.kit_control_url,
        )

    @app.get("/api/kit/instances/current")
    def current_instance():
        return service.get_state()

    @app.get("/api/usdc")
    def list_usdc():
        return {"items": service.list_usdc()}

    @app.post("/api/kit/instances/current/open")
    def open_selected(request: OpenRequest):
        try:
            return service.open_artifacts(request.artifact_ids, request.replace_existing)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Missing USDC artifact(s): {exc}") from exc

    @app.post("/api/kit/instances/current/close")
    def close_instance():
        return service.close_instance()

    return app


app = create_app()
