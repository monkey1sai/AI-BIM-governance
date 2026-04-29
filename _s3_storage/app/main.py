from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles


SERVICE_ROOT = Path(__file__).resolve().parents[1]


def create_app(static_root: Path | str | None = None) -> FastAPI:
    resolved_static_root = Path(static_root) if static_root is not None else SERVICE_ROOT / "static"
    resolved_static_root.mkdir(parents=True, exist_ok=True)

    app = FastAPI(title="Fake S3 Storage", version="0.1.0")

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "service": "_s3_storage",
            "static_root": str(resolved_static_root),
        }

    app.mount("/static", StaticFiles(directory=resolved_static_root), name="static")
    return app


app = create_app()
