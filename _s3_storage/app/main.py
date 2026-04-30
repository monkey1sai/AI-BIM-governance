from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .ui import render_ui


SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEMO_FILES = ["source.ifc", "model.usdc", "ifc_index.json", "usd_index.json", "element_mapping.json"]
DEMO_BASE_PATH = Path("projects") / "project_demo_001" / "versions" / "version_demo_001"


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

    @app.get("/ui", response_class=HTMLResponse)
    def ui():
        return render_ui()

    @app.get("/api/dev/files")
    def list_files(request: Request):
        return {
            "root": str(resolved_static_root),
            "items": _scan_files(resolved_static_root, request),
        }

    @app.get("/api/dev/demo-files")
    def demo_files(request: Request):
        base = resolved_static_root / DEMO_BASE_PATH
        items = []
        for name in DEMO_FILES:
            path = base / name
            relative = (DEMO_BASE_PATH / name).as_posix()
            items.append(
                {
                    "path": relative,
                    "url": _static_url(request, relative),
                    "size_bytes": path.stat().st_size if path.is_file() else 0,
                    "exists": path.is_file(),
                }
            )
        return {"root": str(resolved_static_root), "items": items}

    app.mount("/static", StaticFiles(directory=resolved_static_root), name="static")
    return app


def _scan_files(static_root: Path, request: Request) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for path in sorted(static_root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(static_root).as_posix()
        items.append(
            {
                "path": relative,
                "url": _static_url(request, relative),
                "size_bytes": path.stat().st_size,
                "exists": True,
            }
        )
    return items


def _static_url(request: Request, relative_path: str) -> str:
    return f"{str(request.base_url).rstrip('/')}/static/{relative_path}"


app = create_app()
