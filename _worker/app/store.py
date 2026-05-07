from datetime import UTC, datetime
from pathlib import Path
import base64
import hashlib
import json
import re
from typing import Any, Mapping
from uuid import uuid4

from .models import ArtifactIntakeRequest
from .settings import Settings


SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def safe_id(value: str, label: str) -> str:
    if not SAFE_ID_RE.fullmatch(value):
        raise ValueError(f"Invalid {label}: {value}")
    return value


def safe_filename(value: str) -> str:
    cleaned = SAFE_FILENAME_RE.sub("_", Path(value).name).strip("._")
    return cleaned or "source.ifc"


def write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


class WorkerStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        Path(self.settings.objects_root).mkdir(parents=True, exist_ok=True)
        Path(self.settings.jobs_dir).mkdir(parents=True, exist_ok=True)

    def create_source_artifact(self, request: ArtifactIntakeRequest) -> dict[str, Any]:
        tenant_id = safe_id(request.tenant_id, "tenant_id")
        project_id = safe_id(request.project_id, "project_id")
        model_version_id = safe_id(request.model_version_id, "model_version_id")
        source_system = safe_id(request.source_system, "source_system")
        artifact_group_id = safe_id(request.artifact_group_id or f"ag_{uuid4().hex[:12]}", "artifact_group_id")
        source_artifact_id = f"artifact_src_{uuid4().hex[:12]}"
        filename = safe_filename(request.filename)
        content = self._content_bytes(request)
        sha256 = hashlib.sha256(content).hexdigest()
        object_key = (
            Path("tenants")
            / tenant_id
            / "projects"
            / project_id
            / "versions"
            / model_version_id
            / "artifact-groups"
            / artifact_group_id
            / "source"
            / source_system
            / source_artifact_id
            / "original"
            / f"{sha256[:8]}_{filename}"
        )
        object_path = Path(self.settings.objects_root) / object_key
        object_path.parent.mkdir(parents=True, exist_ok=True)
        object_path.write_bytes(content)

        now = utc_now()
        metadata = {
            "artifact_id": source_artifact_id,
            "parent_artifact_id": None,
            "artifact_group_id": artifact_group_id,
            "tenant_id": tenant_id,
            "project_id": project_id,
            "model_version_id": model_version_id,
            "source_system": source_system,
            "source_format": request.source_format,
            "sha256": sha256,
            "version_no": 1,
            "uploaded_by": request.uploaded_by,
            "conversion_job_id": None,
            "created_at": now,
            "lineage": {
                "source_url": request.source_url,
                "signed_upload_url": request.signed_upload_url,
                "object_key": object_key.as_posix(),
            },
        }
        write_json(object_path.parent.parent / "metadata.json", metadata)
        self._upsert_source_index(source_artifact_id, metadata, object_key)
        self._upsert_group(artifact_group_id, self._source_group_payload(metadata, object_key))
        return {
            "source_artifact_id": source_artifact_id,
            "artifact_group_id": artifact_group_id,
            "tenant_id": tenant_id,
            "project_id": project_id,
            "model_version_id": model_version_id,
            "sha256": sha256,
            "object_key": object_key.as_posix(),
            "object_url": self.object_url(object_key.as_posix()),
            "status": "uploaded",
            "metadata": metadata,
        }

    def create_conversion_job(self, source_artifact_id: str, request: Mapping[str, Any]) -> dict[str, Any]:
        source = self.get_source_artifact(source_artifact_id)
        if source is None:
            raise KeyError(source_artifact_id)
        now = utc_now()
        conversion_job_id = f"conv_{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"
        job = {
            "conversion_job_id": conversion_job_id,
            "job_id": conversion_job_id,
            "status": "queued",
            "stage": "queued",
            "target_format": request.get("target_format", "usdc"),
            "generate_mapping": bool(request.get("generate_mapping", True)),
            "created_at": now,
            "updated_at": now,
            "source_artifact_id": source_artifact_id,
            "artifact_group_id": source["metadata"]["artifact_group_id"],
            "tenant_id": source["metadata"]["tenant_id"],
            "project_id": source["metadata"]["project_id"],
            "model_version_id": source["metadata"]["model_version_id"],
            "lineage": {
                "source_artifact_id": source_artifact_id,
                "source_object_key": source["object_key"],
            },
            "warnings": [],
        }
        write_json(self._job_path(conversion_job_id), job)
        return job

    def get_conversion_job(self, conversion_job_id: str) -> dict[str, Any] | None:
        safe_id(conversion_job_id, "conversion_job_id")
        return read_json(self._job_path(conversion_job_id), None)

    def complete_conversion_job(self, conversion_job_id: str) -> dict[str, Any]:
        job = self.get_conversion_job(conversion_job_id)
        if job is None:
            raise KeyError(conversion_job_id)
        self._update_job(conversion_job_id, status="running", stage="writing_derived_outputs")
        source = self.get_source_artifact(job["source_artifact_id"])
        if source is None:
            raise KeyError(job["source_artifact_id"])

        group_id = job["artifact_group_id"]
        derived_root = (
            Path("tenants")
            / job["tenant_id"]
            / "projects"
            / job["project_id"]
            / "versions"
            / job["model_version_id"]
            / "artifact-groups"
            / group_id
            / "derived"
            / conversion_job_id
            / "usdc"
        )
        root_path = Path(self.settings.objects_root) / derived_root
        root_path.mkdir(parents=True, exist_ok=True)
        files = {
            "model.usdc": "# worker adapter USDC placeholder\n",
            "ifc_index.json": json.dumps(
                {
                    "source_artifact_id": job["source_artifact_id"],
                    "summary": {"element_count": 1, "guid_count": 1},
                    "elements": [{"ifc_guid": "0BTBFw6f90Nfh9rP1dlXr7", "ifc_class": "IfcWall"}],
                },
                ensure_ascii=False,
                indent=2,
            ),
            "usd_index.json": json.dumps(
                {
                    "prim_count": 1,
                    "prims": [{"path": "/World", "type": "Xform", "ifc_class": "IfcWall"}],
                },
                ensure_ascii=False,
                indent=2,
            ),
            "element_mapping.json": json.dumps(
                {
                    "mock": True,
                    "mapping_method": "worker_adapter_smoke",
                    "items": [
                        {
                            "ifc_guid": "0BTBFw6f90Nfh9rP1dlXr7",
                            "ifc_class": "IfcWall",
                            "usd_prim_path": "/World",
                            "mapping_method": "worker_adapter_smoke",
                            "mapping_confidence": 0.1,
                        }
                    ],
                    "summary": {"mapped_count": 1, "unmapped_ifc_count": 0, "unmapped_usd_count": 0, "fake_mapping_count": 1},
                },
                ensure_ascii=False,
                indent=2,
            ),
        }
        for name, content in files.items():
            (root_path / name).write_text(content, encoding="utf-8")

        now = utc_now()
        usdc_artifact_id = f"artifact_usdc_{conversion_job_id.removeprefix('conv_')}"
        metadata = {
            "artifact_id": usdc_artifact_id,
            "parent_artifact_id": job["source_artifact_id"],
            "artifact_group_id": group_id,
            "tenant_id": job["tenant_id"],
            "project_id": job["project_id"],
            "model_version_id": job["model_version_id"],
            "source_system": source["metadata"]["source_system"],
            "source_format": source["metadata"]["source_format"],
            "sha256": source["metadata"]["sha256"],
            "version_no": 1,
            "uploaded_by": source["metadata"]["uploaded_by"],
            "conversion_job_id": conversion_job_id,
            "created_at": now,
            "lineage": {
                "source_artifact_id": job["source_artifact_id"],
                "source_object_key": source["object_key"],
                "derived_object_prefix": derived_root.as_posix(),
            },
        }
        write_json(root_path / "metadata.json", metadata)

        result = {
            "conversion_job_id": conversion_job_id,
            "job_id": conversion_job_id,
            "status": "succeeded",
            "artifact_group_id": group_id,
            "tenant_id": job["tenant_id"],
            "project_id": job["project_id"],
            "model_version_id": job["model_version_id"],
            "source_artifact_id": job["source_artifact_id"],
            "usdc_artifact_id": usdc_artifact_id,
            "derived_artifact_ids": {
                "model_usdc": usdc_artifact_id,
                "ifc_index": f"artifact_ifc_index_{conversion_job_id.removeprefix('conv_')}",
                "usd_index": f"artifact_usd_index_{conversion_job_id.removeprefix('conv_')}",
                "element_mapping": f"artifact_mapping_{conversion_job_id.removeprefix('conv_')}",
            },
            "source_url": source["object_url"],
            "usdc_url": self.object_url((derived_root / "model.usdc").as_posix()),
            "ifc_index_url": self.object_url((derived_root / "ifc_index.json").as_posix()),
            "usd_index_url": self.object_url((derived_root / "usd_index.json").as_posix()),
            "mapping_url": self.object_url((derived_root / "element_mapping.json").as_posix()) if job["generate_mapping"] else None,
            "metadata_url": self.object_url((derived_root / "metadata.json").as_posix()),
            "lineage": metadata["lineage"],
        }
        self._upsert_group(group_id, self._derived_group_payload(source, result, metadata, derived_root))
        return self._update_job(conversion_job_id, status="succeeded", stage="done", result=result)

    def get_source_artifact(self, source_artifact_id: str) -> dict[str, Any] | None:
        safe_id(source_artifact_id, "source_artifact_id")
        index = read_json(Path(self.settings.objects_root) / "_index" / "source_artifacts.json", {"items": []})
        for item in index.get("items", []):
            if item.get("source_artifact_id") == source_artifact_id:
                return item
        return None

    def get_artifact_group(self, artifact_group_id: str) -> dict[str, Any] | None:
        safe_id(artifact_group_id, "artifact_group_id")
        return read_json(self._group_path(artifact_group_id), None)

    def object_url(self, object_key: str) -> str:
        return f"{self.settings.public_objects_url}/{object_key.strip('/')}"

    def _content_bytes(self, request: ArtifactIntakeRequest) -> bytes:
        if request.content_base64:
            return base64.b64decode(request.content_base64)
        if request.content_text is not None:
            return request.content_text.encode("utf-8")
        reference = request.source_url or request.signed_upload_url or ""
        return json.dumps({"upload_reference": reference}, ensure_ascii=False).encode("utf-8")

    def _source_group_payload(self, metadata: dict[str, Any], object_key: Path) -> dict[str, Any]:
        return {
            "artifact_group_id": metadata["artifact_group_id"],
            "tenant_id": metadata["tenant_id"],
            "project_id": metadata["project_id"],
            "model_version_id": metadata["model_version_id"],
            "status": "source_uploaded",
            "ready_status": "missing_derived",
            "source": {
                "artifact_id": metadata["artifact_id"],
                "format": metadata["source_format"],
                "object_key": object_key.as_posix(),
                "url": self.object_url(object_key.as_posix()),
                "sha256": metadata["sha256"],
            },
            "derived": [],
            "mapping": None,
            "lineage": metadata["lineage"],
            "updated_at": utc_now(),
        }

    def _derived_group_payload(
        self,
        source: dict[str, Any],
        result: dict[str, Any],
        metadata: dict[str, Any],
        derived_root: Path,
    ) -> dict[str, Any]:
        return {
            "artifact_group_id": result["artifact_group_id"],
            "tenant_id": result["tenant_id"],
            "project_id": result["project_id"],
            "model_version_id": result["model_version_id"],
            "status": "ready",
            "ready_status": "ready" if result.get("mapping_url") else "missing_mapping",
            "source": {
                "artifact_id": source["source_artifact_id"],
                "format": source["metadata"]["source_format"],
                "object_key": source["object_key"],
                "url": source["object_url"],
                "sha256": source["metadata"]["sha256"],
            },
            "derived": [
                {
                    "artifact_id": result["usdc_artifact_id"],
                    "role": "derived",
                    "format": "usdc",
                    "object_key": (derived_root / "model.usdc").as_posix(),
                    "url": result["usdc_url"],
                    "conversion_job_id": result["conversion_job_id"],
                }
            ],
            "mapping": {
                "object_key": (derived_root / "element_mapping.json").as_posix(),
                "url": result.get("mapping_url"),
                "ready": bool(result.get("mapping_url")),
            },
            "indexes": {
                "ifc_index_url": result["ifc_index_url"],
                "usd_index_url": result["usd_index_url"],
            },
            "metadata": metadata,
            "lineage": result["lineage"],
            "updated_at": utc_now(),
        }

    def _upsert_source_index(self, source_artifact_id: str, metadata: dict[str, Any], object_key: Path) -> None:
        path = Path(self.settings.objects_root) / "_index" / "source_artifacts.json"
        payload = read_json(path, {"items": []})
        items = [item for item in payload.get("items", []) if item.get("source_artifact_id") != source_artifact_id]
        items.append(
            {
                "source_artifact_id": source_artifact_id,
                "artifact_group_id": metadata["artifact_group_id"],
                "object_key": object_key.as_posix(),
                "object_url": self.object_url(object_key.as_posix()),
                "metadata": metadata,
            }
        )
        write_json(path, {"items": items})

    def _upsert_group(self, artifact_group_id: str, payload: dict[str, Any]) -> None:
        write_json(self._group_path(artifact_group_id), payload)

    def _group_path(self, artifact_group_id: str) -> Path:
        safe_id(artifact_group_id, "artifact_group_id")
        return Path(self.settings.objects_root) / "_index" / "artifact_groups" / f"{artifact_group_id}.json"

    def _job_path(self, conversion_job_id: str) -> Path:
        safe_id(conversion_job_id, "conversion_job_id")
        return Path(self.settings.jobs_dir) / f"{conversion_job_id}.json"

    def _update_job(self, conversion_job_id: str, **updates: Any) -> dict[str, Any]:
        job = self.get_conversion_job(conversion_job_id)
        if job is None:
            raise KeyError(conversion_job_id)
        job.update(updates)
        job["updated_at"] = utc_now()
        write_json(self._job_path(conversion_job_id), job)
        return job
