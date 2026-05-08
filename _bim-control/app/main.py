from datetime import UTC, datetime
from pathlib import Path
import json
import re
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .ui import render_ui


SERVICE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = SERVICE_ROOT.parent
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
DEMO_PROJECT_ID = "project_demo_001"
DEMO_MODEL_VERSION_ID = "version_demo_001"
DEMO_SESSION_ID = "review_session_001"
DEMO_SOURCE_ARTIFACT_ID = "artifact_ifc_demo_001"
DEMO_USDC_ARTIFACT_ID = "artifact_usdc_demo_001"
DEMO_ARTIFACT_GROUP_ID = "ag_demo_001"


class ReviewSessionRequestInput(BaseModel):
    requested_by: str = Field(min_length=1)
    tenant_id: str = Field(default="tenant_demo_001", min_length=1)
    project_id: str = Field(default=DEMO_PROJECT_ID, min_length=1)
    model_version_id: str = Field(min_length=1)
    artifact_group_ids: list[str] = Field(default_factory=list)
    selected_artifact_ids: list[str] = Field(default_factory=list)
    startup_policy: dict[str, Any] = Field(default_factory=dict)
    kit_profile: dict[str, Any] = Field(default_factory=dict)


class ReviewSessionRequestPatch(BaseModel):
    status: str | None = None
    session_id: str | None = None
    stream_config: dict[str, Any] | None = None
    artifact_bindings: list[dict[str, Any]] | None = None
    kit_instance_bindings: list[dict[str, Any]] | None = None
    lifecycle_event: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class ArtifactGroupInput(BaseModel):
    artifact_group_id: str = Field(min_length=1)
    tenant_id: str = Field(default="tenant_demo_001", min_length=1)
    project_id: str = Field(default=DEMO_PROJECT_ID, min_length=1)
    model_version_id: str = Field(min_length=1)
    status: str = "ready"
    ready_status: str = "ready"
    source: dict[str, Any] | None = None
    derived: list[dict[str, Any]] = Field(default_factory=list)
    mapping: dict[str, Any] | None = None
    parent_artifact_id: str | None = None
    source_system: str | None = None
    checksum: str | None = None
    version_no: int = 1
    conversion_lineage: dict[str, Any] = Field(default_factory=dict)


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


def _worker_object_url(*parts: str) -> str:
    path = "/".join(part.strip("/") for part in parts if part)
    return f"http://127.0.0.1:8005/objects/{path}"


def _seed_data(data_root: Path) -> None:
    data_root.mkdir(parents=True, exist_ok=True)
    _seed_if_missing(data_root / "projects.json", _demo_projects())
    _seed_if_missing(data_root / "model_versions.json", _demo_model_versions())
    _seed_if_missing(data_root / "artifacts.json", _build_seed_artifacts())
    _seed_if_missing(data_root / "artifact_groups.json", _build_seed_artifact_groups())
    _seed_if_missing(data_root / "review_issues.json", _demo_review_issues())
    _seed_if_missing(data_root / "annotations.json", [])
    _seed_if_missing(data_root / "review_session_requests.json", [])
    _seed_if_missing(data_root / "lifecycle_events.json", [])


def _reset_seed_data(data_root: Path) -> None:
    data_root.mkdir(parents=True, exist_ok=True)
    _write_list(data_root / "projects.json", _demo_projects())
    _write_list(data_root / "model_versions.json", _demo_model_versions())
    _write_list(data_root / "artifacts.json", _build_seed_artifacts())
    _write_list(data_root / "artifact_groups.json", _build_seed_artifact_groups())
    _write_list(data_root / "review_issues.json", _demo_review_issues())
    _write_list(data_root / "annotations.json", [])
    _write_list(data_root / "review_session_requests.json", [])
    _write_list(data_root / "lifecycle_events.json", [])


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
    return [
        {
            "artifact_id": DEMO_SOURCE_ARTIFACT_ID,
            "project_id": DEMO_PROJECT_ID,
            "model_version_id": DEMO_MODEL_VERSION_ID,
            "artifact_type": "ifc",
            "name": "示範 BIM 原始 IFC",
            "url": None,
            "mapping_url": None,
            "status": "missing",
            "updated_at": _now(),
        },
        {
            "artifact_id": DEMO_USDC_ARTIFACT_ID,
            "project_id": DEMO_PROJECT_ID,
            "model_version_id": DEMO_MODEL_VERSION_ID,
            "artifact_type": "usdc",
            "name": "示範 BIM 轉檔 USDC",
            "url": None,
            "mapping_url": None,
            "status": "missing",
            "updated_at": _now(),
        },
    ]


def _build_seed_artifact_groups() -> list[dict[str, Any]]:
    artifacts = _build_seed_artifacts()
    source = next((item for item in artifacts if item["artifact_id"] == DEMO_SOURCE_ARTIFACT_ID), None)
    derived = next((item for item in artifacts if item["artifact_id"] == DEMO_USDC_ARTIFACT_ID), None)
    has_ready_model = bool(derived and derived.get("status") == "ready" and derived.get("url"))
    has_ready_mapping = bool(derived and derived.get("mapping_url"))
    return [
        {
            "artifact_group_id": DEMO_ARTIFACT_GROUP_ID,
            "tenant_id": "tenant_demo_001",
            "project_id": DEMO_PROJECT_ID,
            "model_version_id": DEMO_MODEL_VERSION_ID,
            "status": "ready" if has_ready_model else "missing",
            "ready_status": "ready" if has_ready_model and has_ready_mapping else "blocked_conversion",
            "source": {
                "artifact_id": DEMO_SOURCE_ARTIFACT_ID,
                "format": "ifc",
                "url": source.get("url") if source else None,
                "sha256": None,
            },
            "derived": [
                {
                    "artifact_id": DEMO_USDC_ARTIFACT_ID,
                    "role": "derived",
                    "format": "usdc",
                    "url": derived.get("url") if derived else None,
                }
            ],
            "mapping": {
                "url": derived.get("mapping_url") if derived else None,
                "ready": has_ready_mapping,
            },
            "parent_artifact_id": DEMO_SOURCE_ARTIFACT_ID,
            "source_system": "demo_seed",
            "checksum": None,
            "version_no": 1,
            "conversion_lineage": {},
            "updated_at": _now(),
        }
    ]


def _upsert(items: list[dict[str, Any]], key: str, value: str, item: dict[str, Any]) -> list[dict[str, Any]]:
    next_items = [existing for existing in items if existing.get(key) != value]
    next_items.append(item)
    return next_items


def _items_response(items: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {**extra, "items": items}


def _new_review_request_id() -> str:
    timestamp_ms = int(datetime.now(UTC).timestamp() * 1000)
    return f"review_request_{timestamp_ms}_{uuid4().hex[:8]}"


def _find_by_id(items: list[dict[str, Any]], key: str, value: str) -> dict[str, Any] | None:
    return next((item for item in items if item.get(key) == value), None)


def _artifact_group_ready(group: dict[str, Any] | None) -> bool:
    if not group:
        return False
    if group.get("ready_status") == "ready":
        return True
    derived = group.get("derived") if isinstance(group.get("derived"), list) else []
    mapping = group.get("mapping") if isinstance(group.get("mapping"), dict) else {}
    return bool(derived and any(item.get("url") for item in derived if isinstance(item, dict)) and mapping.get("url"))


def _review_request_status(
    data_root: Path,
    artifact_group_ids: list[str],
    selected_artifact_ids: list[str],
) -> tuple[str, list[dict[str, Any]], list[str]]:
    groups = _read_list(data_root / "artifact_groups.json")
    artifacts = _read_list(data_root / "artifacts.json")
    selected_groups = [_find_by_id(groups, "artifact_group_id", group_id) for group_id in artifact_group_ids]
    if not artifact_group_ids and selected_artifact_ids:
        selected_artifacts = [
            artifact
            for artifact in artifacts
            if artifact.get("artifact_id") in selected_artifact_ids
        ]
        ready = all(artifact.get("status") == "ready" and artifact.get("url") for artifact in selected_artifacts)
        missing = [artifact_id for artifact_id in selected_artifact_ids if not _find_by_id(selected_artifacts, "artifact_id", artifact_id)]
        return ("created" if ready and not missing else "blocked_conversion", [], missing)

    missing_groups = [group_id for group_id, group in zip(artifact_group_ids, selected_groups) if group is None]
    ready = bool(selected_groups) and all(_artifact_group_ready(group) for group in selected_groups)
    return ("created" if ready and not missing_groups else "blocked_conversion", [group for group in selected_groups if group], missing_groups)


def _artifact_bindings_from_groups(groups: list[dict[str, Any]], routing_policy: str = "same_instance") -> list[dict[str, Any]]:
    bindings: list[dict[str, Any]] = []
    for group in groups:
        derived_items = group.get("derived") if isinstance(group.get("derived"), list) else []
        mapping = group.get("mapping") if isinstance(group.get("mapping"), dict) else {}
        for item in derived_items:
            if not isinstance(item, dict) or not item.get("url"):
                continue
            role = str(item.get("role") or "derived")
            bindings.append(
                {
                    "binding_id": f"binding_{len(bindings) + 1}",
                    "artifact_group_id": group.get("artifact_group_id"),
                    "model_version_id": group.get("model_version_id"),
                    "artifact_id": item.get("artifact_id"),
                    "artifact_role": role,
                    "url": item.get("url"),
                    "mapping_url": mapping.get("url") if mapping else item.get("mapping_url"),
                    "load_order": int(item.get("load_order") or len(bindings)),
                    "routing_policy": routing_policy,
                    "ready_status": group.get("ready_status") or "ready",
                }
            )
    bindings.sort(key=lambda item: item["load_order"])
    return bindings


def _artifact_bindings_from_selected_artifacts(
    artifacts: list[dict[str, Any]],
    selected_artifact_ids: list[str],
    model_version_id: str,
    routing_policy: str = "same_instance",
) -> list[dict[str, Any]]:
    selected = [
        artifact
        for artifact in artifacts
        if artifact.get("artifact_id") in selected_artifact_ids and artifact.get("status") == "ready" and artifact.get("url")
    ]
    return [
        {
            "binding_id": f"binding_{index + 1}",
            "artifact_group_id": artifact.get("artifact_group_id") or f"ag_{model_version_id}",
            "model_version_id": artifact.get("model_version_id") or model_version_id,
            "artifact_id": artifact.get("artifact_id"),
            "artifact_role": "derived" if artifact.get("artifact_type") == "usdc" else str(artifact.get("artifact_type") or "source"),
            "url": artifact.get("url"),
            "mapping_url": artifact.get("mapping_url"),
            "load_order": index,
            "routing_policy": routing_policy,
            "ready_status": "ready",
        }
        for index, artifact in enumerate(selected)
    ]


def _append_lifecycle_event(data_root: Path, request_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    events_path = data_root / "lifecycle_events.json"
    event = {
        "event_id": f"lifecycle_{int(datetime.now(UTC).timestamp() * 1000)}",
        "review_request_id": request_id,
        "type": event_type,
        "payload": payload,
        "created_at": _now(),
    }
    _write_list(events_path, [*_read_list(events_path), event])
    return event


def create_app(data_root: Path | str | None = None) -> FastAPI:
    resolved_data_root = Path(data_root) if data_root is not None else SERVICE_ROOT / "data"
    results_root = resolved_data_root / "conversion_results"
    results_root.mkdir(parents=True, exist_ok=True)
    _seed_data(resolved_data_root)

    app = FastAPI(title="Fake BIM Control", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "service": "_bim-control",
            "data_root": str(resolved_data_root),
        }

    @app.get("/", response_class=HTMLResponse)
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

    @app.get("/api/model-versions/{model_version_id}/artifact-groups")
    def list_model_version_artifact_groups(model_version_id: str):
        safe_model_version_id = _safe_id(model_version_id, "model_version_id")
        groups = [
            group
            for group in _read_list(resolved_data_root / "artifact_groups.json")
            if group.get("model_version_id") == safe_model_version_id
        ]
        return _items_response(groups, model_version_id=safe_model_version_id)

    @app.post("/api/artifact-groups")
    def upsert_artifact_group(payload: ArtifactGroupInput):
        safe_group_id = _safe_id(payload.artifact_group_id, "artifact_group_id")
        safe_model_version_id = _safe_id(payload.model_version_id, "model_version_id")
        groups_path = resolved_data_root / "artifact_groups.json"
        group = {
            **payload.model_dump(),
            "artifact_group_id": safe_group_id,
            "model_version_id": safe_model_version_id,
            "updated_at": _now(),
        }
        _write_list(groups_path, _upsert(_read_list(groups_path), "artifact_group_id", safe_group_id, group))
        return group

    @app.get("/api/artifact-groups/{artifact_group_id}")
    def get_artifact_group(artifact_group_id: str):
        safe_group_id = _safe_id(artifact_group_id, "artifact_group_id")
        group = _find_by_id(_read_list(resolved_data_root / "artifact_groups.json"), "artifact_group_id", safe_group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Artifact group not found.")
        return group

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

    @app.post("/api/review-session-requests")
    def create_review_session_request(payload: ReviewSessionRequestInput):
        request_id = _new_review_request_id()
        for group_id in payload.artifact_group_ids:
            _safe_id(group_id, "artifact_group_id")
        for artifact_id in payload.selected_artifact_ids:
            _safe_id(artifact_id, "artifact_id")
        status, ready_groups, missing_refs = _review_request_status(
            resolved_data_root,
            payload.artifact_group_ids,
            payload.selected_artifact_ids,
        )
        routing_policy = str(payload.startup_policy.get("routing_policy") or "same_instance")
        artifacts = _read_list(resolved_data_root / "artifacts.json")
        artifact_bindings = (
            _artifact_bindings_from_groups(ready_groups, routing_policy)
            if payload.artifact_group_ids
            else _artifact_bindings_from_selected_artifacts(
                artifacts,
                payload.selected_artifact_ids,
                payload.model_version_id,
                routing_policy,
            )
        )
        request_record = {
            "review_request_id": request_id,
            "requested_by": payload.requested_by,
            "tenant_id": payload.tenant_id,
            "project_id": payload.project_id,
            "model_version_id": payload.model_version_id,
            "artifact_group_ids": payload.artifact_group_ids,
            "selected_artifact_ids": payload.selected_artifact_ids,
            "startup_policy": payload.startup_policy,
            "kit_profile": payload.kit_profile,
            "status": status,
            "blocker": "conversion_readiness" if status == "blocked_conversion" else None,
            "missing_refs": missing_refs,
            "artifact_groups": ready_groups,
            "session_id": None,
            "artifact_bindings": artifact_bindings if status == "created" else [],
            "kit_instance_bindings": [],
            "created_at": _now(),
            "updated_at": _now(),
        }
        requests_path = resolved_data_root / "review_session_requests.json"
        _write_list(requests_path, [*_read_list(requests_path), request_record])
        _append_lifecycle_event(resolved_data_root, request_id, "reviewRequestCreated", {"status": status})
        return request_record

    @app.get("/api/review-session-requests/{review_request_id}")
    def get_review_session_request(review_request_id: str):
        safe_request_id = _safe_id(review_request_id, "review_request_id")
        request_record = _find_by_id(
            _read_list(resolved_data_root / "review_session_requests.json"),
            "review_request_id",
            safe_request_id,
        )
        if not request_record:
            raise HTTPException(status_code=404, detail="Review session request not found.")
        return request_record

    @app.patch("/api/review-session-requests/{review_request_id}")
    def patch_review_session_request(review_request_id: str, payload: ReviewSessionRequestPatch):
        safe_request_id = _safe_id(review_request_id, "review_request_id")
        requests_path = resolved_data_root / "review_session_requests.json"
        requests = _read_list(requests_path)
        existing = _find_by_id(requests, "review_request_id", safe_request_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Review session request not found.")
        updates = payload.model_dump(exclude_unset=True)
        allowed_statuses = {"created", "blocked_conversion", "queued_for_instance", "active", "failed", "closing", "closed"}
        if "status" in updates and updates["status"] not in allowed_statuses:
            raise HTTPException(status_code=400, detail="Invalid review request status.")
        lifecycle_event = updates.pop("lifecycle_event", None)
        patched = {**existing, **updates, "updated_at": _now()}
        _write_list(requests_path, _upsert(requests, "review_request_id", safe_request_id, patched))
        if lifecycle_event:
            event_type = str(lifecycle_event.get("type") or "reviewRequestPatched")
            _append_lifecycle_event(resolved_data_root, safe_request_id, event_type, lifecycle_event)
        return patched

    @app.get("/api/review-session-requests/{review_request_id}/lifecycle-events")
    def list_review_session_request_events(review_request_id: str):
        safe_request_id = _safe_id(review_request_id, "review_request_id")
        events = [
            event
            for event in _read_list(resolved_data_root / "lifecycle_events.json")
            if event.get("review_request_id") == safe_request_id
        ]
        return _items_response(events, review_request_id=safe_request_id)

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
    artifact_groups_path = data_root / "artifact_groups.json"
    artifacts = _read_list(artifacts_path)
    project_id = str(result.get("project_id") or DEMO_PROJECT_ID)
    tenant_id = str(result.get("tenant_id") or "tenant_demo_001")
    artifact_group_id = str(result.get("artifact_group_id") or DEMO_ARTIFACT_GROUP_ID)
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
                "name": str(result.get("original_filename") or "原始 IFC"),
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
    group = {
        "artifact_group_id": artifact_group_id,
        "tenant_id": tenant_id,
        "project_id": project_id,
        "model_version_id": model_version_id,
        "status": "ready" if result.get("status") == "succeeded" else str(result.get("status") or "unknown"),
        "ready_status": "ready" if usdc_url and result.get("mapping_url") else "blocked_conversion",
        "source": {
            "artifact_id": source_artifact_id,
            "format": "ifc",
            "url": source_url,
            "sha256": (result.get("lineage") or {}).get("sha256"),
        },
        "derived": [
            {
                "artifact_id": usdc_artifact_id,
                "role": "derived",
                "format": "usdc",
                "url": usdc_url,
                "conversion_job_id": result.get("conversion_job_id") or result.get("job_id"),
            }
        ]
        if usdc_url
        else [],
        "mapping": {
            "url": result.get("mapping_url"),
            "ready": bool(result.get("mapping_url")),
        },
        "parent_artifact_id": source_artifact_id,
        "source_system": (result.get("lineage") or {}).get("source_system") or "worker",
        "checksum": (result.get("lineage") or {}).get("sha256"),
        "version_no": 1,
        "conversion_lineage": result.get("lineage") or {},
        "updated_at": updated_at,
    }
    _write_list(
        artifact_groups_path,
        _upsert(_read_list(artifact_groups_path), "artifact_group_id", artifact_group_id, group),
    )


app = create_app()
