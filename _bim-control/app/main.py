from datetime import UTC, datetime
from pathlib import Path
import json
import re
from typing import Any

from fastapi import FastAPI, HTTPException


SERVICE_ROOT = Path(__file__).resolve().parents[1]
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def _safe_id(value: str, label: str) -> str:
    if not SAFE_ID_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return value


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def create_app(data_root: Path | str | None = None) -> FastAPI:
    resolved_data_root = Path(data_root) if data_root is not None else SERVICE_ROOT / "data"
    results_root = resolved_data_root / "conversion_results"
    results_root.mkdir(parents=True, exist_ok=True)

    app = FastAPI(title="Fake BIM Control", version="0.1.0")

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "service": "_bim-control",
            "data_root": str(resolved_data_root),
        }

    @app.post("/api/model-versions/{model_version_id}/conversion-result")
    def store_conversion_result(model_version_id: str, payload: dict[str, Any]):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        stored = dict(payload)
        stored["model_version_id"] = safe_model_version_id
        stored["conversion_status"] = str(payload.get("status") or payload.get("conversion_status") or "unknown")
        stored["updated_at"] = datetime.now(UTC).isoformat()

        _write_json(results_root / f"{safe_model_version_id}.json", stored)
        return stored

    @app.get("/api/model-versions/{model_version_id}/conversion-result")
    def get_conversion_result(model_version_id: str):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        path = results_root / f"{safe_model_version_id}.json"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Conversion result not found.")
        return json.loads(path.read_text(encoding="utf-8"))

    return app


app = create_app()
