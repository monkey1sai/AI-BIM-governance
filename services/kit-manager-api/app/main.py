from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .kit_gateway import KitRuntimeGateway
from .kit_service import KitInstanceService
from .models import (
    CloseResponse,
    HealthResponse,
    KitInstanceState,
    OpenRequest,
    OpenResponse,
    UsdcListResponse,
)
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
        # 預設 ["*"]（未設 KIT_MANAGER_CORS_ORIGINS 時）以維持既有 dev 行為；
        # 可透過環境變數收緊白名單，見 settings.py 的 _parse_cors_origins（#26）。
        allow_origins=settings.cors_origins,
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

    # C1 契約生成切片：以下端點補宣告 response_model，讓 KitInstanceState /
    # UsdcArtifact / OpenResponse / CloseResponse 進 openapi.json components.schemas，
    # 前端型別由 openapi-typescript 生成（web-viewer-sample/scripts/generate-api-types.mjs），
    # 消滅手抄重複。回傳值原本就是同一批 pydantic model（kit_service.py），wire shape 不變。
    @app.get("/api/kit/instances/current", response_model=KitInstanceState)
    def current_instance():
        return service.get_state()

    @app.get("/api/usdc", response_model=UsdcListResponse)
    def list_usdc():
        return {"items": service.list_usdc()}

    @app.post("/api/kit/instances/current/open", response_model=OpenResponse)
    def open_selected(request: OpenRequest):
        try:
            return service.open_artifacts(request.artifact_ids, request.replace_existing)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Missing USDC artifact(s): {exc}") from exc

    @app.post("/api/kit/instances/current/close", response_model=CloseResponse)
    def close_instance():
        return service.close_instance()

    return app


app = create_app()
