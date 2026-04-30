from datetime import UTC, datetime
from pathlib import Path
import json
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse

from .ui import render_ui


SERVICE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = SERVICE_ROOT.parent
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
DEMO_PROJECT_ID = "project_demo_001"
DEMO_MODEL_VERSION_ID = "version_demo_001"
DEMO_SESSION_ID = "review_session_001"
DEMO_SOURCE_ARTIFACT_ID = "artifact_ifc_demo_001"
DEMO_USDC_ARTIFACT_ID = "artifact_usdc_demo_001"


def _safe_id(value: str, label: str) -> str:
    if not SAFE_ID_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return value


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write_list(path: Path, payload: list[dict[str, Any]]) -> None:
    _write_json(path, {"items": payload})


def _read_list(path: Path) -> list[dict[str, Any]]:
    payload = _read_json(path, {"items": []})
    if isinstance(payload, list):
        return payload
    items = payload.get("items") if isinstance(payload, dict) else []
    return items if isinstance(items, list) else []


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _static_url(project_id: str, model_version_id: str, name: str) -> str:
    return f"http://127.0.0.1:8002/static/projects/{project_id}/versions/{model_version_id}/{name}"


def _demo_version_dir() -> Path:
    return WORKSPACE_ROOT / "_s3_storage" / "static" / "projects" / DEMO_PROJECT_ID / "versions" / DEMO_MODEL_VERSION_ID


def _seed_data(data_root: Path) -> None:
    data_root.mkdir(parents=True, exist_ok=True)
    _seed_if_missing(data_root / "projects.json", _demo_projects())
    _seed_if_missing(data_root / "model_versions.json", _demo_model_versions())
    _seed_if_missing(data_root / "artifacts.json", _build_seed_artifacts())
    _seed_if_missing(data_root / "review_issues.json", _demo_review_issues())
    _seed_if_missing(data_root / "annotations.json", [])


def _reset_seed_data(data_root: Path) -> None:
    data_root.mkdir(parents=True, exist_ok=True)
    _write_list(data_root / "projects.json", _demo_projects())
    _write_list(data_root / "model_versions.json", _demo_model_versions())
    _write_list(data_root / "artifacts.json", _build_seed_artifacts())
    _write_list(data_root / "review_issues.json", _demo_review_issues())
    _write_list(data_root / "annotations.json", [])


def _demo_projects() -> list[dict[str, Any]]:
    return [
        {
            "project_id": DEMO_PROJECT_ID,
            "name": "示範 BIM 審查專案",
            "status": "active",
            "created_at": "2026-04-29T10:00:00+08:00",
        }
    ]


def _demo_model_versions() -> list[dict[str, Any]]:
    return [
        {
            "project_id": DEMO_PROJECT_ID,
            "model_version_id": DEMO_MODEL_VERSION_ID,
            "name": "示範模型版本 001",
            "status": "active",
            "created_at": "2026-04-29T10:00:00+08:00",
        }
    ]


def _demo_review_issues() -> list[dict[str, Any]]:
    return [
        {
            "issue_id": "ISSUE-DEMO-001",
            "project_id": DEMO_PROJECT_ID,
            "model_version_id": DEMO_MODEL_VERSION_ID,
            "source": "mock_compliance",
            "severity": "error",
            "status": "open",
            "title": "示範：樓梯寬度不足",
            "description": "用來驗證 issue list 到 DataChannel highlightPrimsRequest 的假資料。",
            "ifc_guid": "2VJ3sK9L000fake001",
            "usd_prim_path": "/World",
            "evidence": {"rule": "smoke_test", "expected_result": "highlight request is emitted"},
            "created_at": "2026-04-29T10:00:00+08:00",
        }
    ]


def _seed_if_missing(path: Path, items: list[dict[str, Any]]) -> None:
    if not path.is_file():
        _write_list(path, items)


def _build_seed_artifacts() -> list[dict[str, Any]]:
    version_dir = _demo_version_dir()
    source_status = "ready" if (version_dir / "source.ifc").is_file() else "missing"
    usdc_status = "ready" if (version_dir / "model.usdc").is_file() else "missing"
    return [
        {
            "artifact_id": DEMO_SOURCE_ARTIFACT_ID,
            "project_id": DEMO_PROJECT_ID,
            "model_version_id": DEMO_MODEL_VERSION_ID,
            "artifact_type": "ifc",
            "name": "示範 BIM 原始 IFC",
            "url": _static_url(DEMO_PROJECT_ID, DEMO_MODEL_VERSION_ID, "source.ifc"),
            "mapping_url": None,
            "status": source_status,
            "updated_at": _now(),
        },
        {
            "artifact_id": DEMO_USDC_ARTIFACT_ID,
            "project_id": DEMO_PROJECT_ID,
            "model_version_id": DEMO_MODEL_VERSION_ID,
            "artifact_type": "usdc",
            "name": "示範 BIM 轉檔 USDC",
            "url": _static_url(DEMO_PROJECT_ID, DEMO_MODEL_VERSION_ID, "model.usdc"),
            "mapping_url": _static_url(DEMO_PROJECT_ID, DEMO_MODEL_VERSION_ID, "element_mapping.json"),
            "status": usdc_status,
            "updated_at": _now(),
        },
    ]


def _upsert(items: list[dict[str, Any]], key: str, value: str, item: dict[str, Any]) -> list[dict[str, Any]]:
    next_items = [existing for existing in items if existing.get(key) != value]
    next_items.append(item)
    return next_items


def _items_response(items: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {**extra, "items": items}


def create_app(data_root: Path | str | None = None) -> FastAPI:
    resolved_data_root = Path(data_root) if data_root is not None else SERVICE_ROOT / "data"
    results_root = resolved_data_root / "conversion_results"
    results_root.mkdir(parents=True, exist_ok=True)
    _seed_data(resolved_data_root)

    app = FastAPI(title="Fake BIM Control", version="0.1.0")

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "service": "_bim-control",
            "data_root": str(resolved_data_root),
        }

    @app.get("/ui", response_class=HTMLResponse)
    def ui():
        return render_ui()

    @app.post("/api/dev/reset-seed")
    def reset_seed():
        _reset_seed_data(resolved_data_root)
        return {
            "status": "ok",
            "message": "Demo seed data reset.",
            "project_id": DEMO_PROJECT_ID,
            "model_version_id": DEMO_MODEL_VERSION_ID,
        }

    @app.get("/api/projects")
    def list_projects():
        return _items_response(_read_list(resolved_data_root / "projects.json"))

    @app.get("/api/projects/{project_id}")
    def get_project(project_id: str):
        safe_project_id = _safe_id(project_id, "project_id")
        for project in _read_list(resolved_data_root / "projects.json"):
            if project.get("project_id") == safe_project_id:
                return project
        raise HTTPException(status_code=404, detail="Project not found.")

    @app.get("/api/projects/{project_id}/versions")
    def list_project_versions(project_id: str):
        safe_project_id = _safe_id(project_id, "project_id")
        versions = [
            version
            for version in _read_list(resolved_data_root / "model_versions.json")
            if version.get("project_id") == safe_project_id
        ]
        return _items_response(versions, project_id=safe_project_id)

    @app.get("/api/model-versions/{model_version_id}")
    def get_model_version(model_version_id: str):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        for version in _read_list(resolved_data_root / "model_versions.json"):
            if version.get("model_version_id") == safe_model_version_id:
                return version
        raise HTTPException(status_code=404, detail="Model version not found.")

    @app.get("/api/model-versions/{model_version_id}/artifacts")
    def list_model_version_artifacts(model_version_id: str):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        artifacts = [
            artifact
            for artifact in _read_list(resolved_data_root / "artifacts.json")
            if artifact.get("model_version_id") == safe_model_version_id
        ]
        return {
            "model_version_id": safe_model_version_id,
            "items": artifacts,
            "artifacts": artifacts,
        }

    @app.post("/api/model-versions/{model_version_id}/conversion-result")
    def store_conversion_result(model_version_id: str, payload: dict[str, Any]):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        stored = dict(payload)
        stored["model_version_id"] = safe_model_version_id
        stored["conversion_status"] = str(payload.get("status") or payload.get("conversion_status") or "unknown")
        stored["updated_at"] = _now()

        _write_json(results_root / f"{safe_model_version_id}.json", stored)
        _update_artifacts_from_conversion(resolved_data_root, safe_model_version_id, stored)
        return stored

    @app.get("/api/model-versions/{model_version_id}/conversion-result")
    def get_conversion_result(model_version_id: str):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        path = results_root / f"{safe_model_version_id}.json"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Conversion result not found.")
        return json.loads(path.read_text(encoding="utf-8"))

    @app.get("/api/model-versions/{model_version_id}/review-issues")
    def list_review_issues(model_version_id: str):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        issues = [
            issue
            for issue in _read_list(resolved_data_root / "review_issues.json")
            if issue.get("model_version_id") == safe_model_version_id
        ]
        return _items_response(issues, model_version_id=safe_model_version_id)

    @app.post("/api/model-versions/{model_version_id}/review-issues")
    def create_review_issue(model_version_id: str, payload: dict[str, Any]):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        issue_id = str(payload.get("issue_id") or f"issue_{int(datetime.now(UTC).timestamp())}")
        _safe_id(issue_id, "issue_id")
        issues_path = resolved_data_root / "review_issues.json"
        issue = {
            **payload,
            "issue_id": issue_id,
            "model_version_id": safe_model_version_id,
            "created_at": payload.get("created_at") or _now(),
        }
        _write_list(issues_path, _upsert(_read_list(issues_path), "issue_id", issue_id, issue))
        return issue

    @app.get("/api/review-sessions/{session_id}/annotations")
    def list_annotations(session_id: str):
        safe_session_id = _safe_id(session_id, "session_id")
        annotations = [
            annotation
            for annotation in _read_list(resolved_data_root / "annotations.json")
            if annotation.get("session_id") == safe_session_id
        ]
        return _items_response(annotations, session_id=safe_session_id)

    @app.post("/api/review-sessions/{session_id}/annotations")
    def create_annotation(session_id: str, payload: dict[str, Any]):
        safe_session_id = _safe_id(session_id, "session_id")
        annotation_id = str(payload.get("annotation_id") or f"ann_{int(datetime.now(UTC).timestamp())}")
        _safe_id(annotation_id, "annotation_id")
        annotations_path = resolved_data_root / "annotations.json"
        annotation = {
            **payload,
            "annotation_id": annotation_id,
            "session_id": safe_session_id,
            "created_at": payload.get("created_at") or _now(),
        }
        _write_list(
            annotations_path,
            _upsert(_read_list(annotations_path), "annotation_id", annotation_id, annotation),
        )
        return annotation

    return app


def _update_artifacts_from_conversion(data_root: Path, model_version_id: str, result: dict[str, Any]) -> None:
    artifacts_path = data_root / "artifacts.json"
    artifacts = _read_list(artifacts_path)
    project_id = str(result.get("project_id") or DEMO_PROJECT_ID)
    source_artifact_id = str(result.get("source_artifact_id") or DEMO_SOURCE_ARTIFACT_ID)
    usdc_artifact_id = str(result.get("usdc_artifact_id") or DEMO_USDC_ARTIFACT_ID)
    updated_at = _now()

    source_url = result.get("source_url")
    if source_url:
        artifacts = _upsert(
            artifacts,
            "artifact_id",
            source_artifact_id,
            {
                "artifact_id": source_artifact_id,
                "project_id": project_id,
                "model_version_id": model_version_id,
                "artifact_type": "ifc",
                "name": "原始 IFC",
                "url": source_url,
                "mapping_url": None,
                "status": "ready",
                "updated_at": updated_at,
            },
        )

    usdc_url = result.get("usdc_url")
    if usdc_url:
        artifacts = _upsert(
            artifacts,
            "artifact_id",
            usdc_artifact_id,
            {
                "artifact_id": usdc_artifact_id,
                "project_id": project_id,
                "model_version_id": model_version_id,
                "artifact_type": "usdc",
                "name": "已轉換 USDC",
                "url": usdc_url,
                "mapping_url": result.get("mapping_url"),
                "status": "ready" if result.get("status") == "succeeded" else str(result.get("status") or "unknown"),
                "updated_at": updated_at,
            },
        )

    _write_list(artifacts_path, artifacts)


app = create_app()
