from datetime import UTC, datetime
from dataclasses import replace
from pathlib import Path
import base64
import hashlib
import json
import re
import shutil
from time import perf_counter
from typing import Any, Mapping
from uuid import uuid4

from .converters import ConversionAdapter, ConversionAdapterError, IfcOpenShellUsdConverter
from .models import ArtifactIntakeRequest, RvtExportRequest
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


def completed_phase_timing(duration_seconds: float) -> dict[str, Any]:
    return {
        "status": "completed",
        "duration_seconds": duration_seconds,
    }


class WorkerStore:
    def __init__(self, settings: Settings, converter: ConversionAdapter | None = None):
        self.settings = settings
        self.converter = converter or IfcOpenShellUsdConverter()
        Path(self.settings.objects_root).mkdir(parents=True, exist_ok=True)
        Path(self.settings.jobs_dir).mkdir(parents=True, exist_ok=True)
        self._rvt_exports_dir().mkdir(parents=True, exist_ok=True)

    def create_source_artifact(self, request: ArtifactIntakeRequest) -> dict[str, Any]:
        tenant_id = safe_id(request.tenant_id, "tenant_id")
        project_id = safe_id(request.project_id, "project_id")
        model_version_id = safe_id(request.model_version_id, "model_version_id")
        source_system = safe_id(request.source_system, "source_system")
        artifact_group_id = safe_id(request.artifact_group_id or f"ag_{uuid4().hex[:12]}", "artifact_group_id")
        source_artifact_id = f"artifact_src_{uuid4().hex[:12]}"
        original_filename = request.filename
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
            "original_filename": original_filename,
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
            "original_filename": original_filename,
            "object_key": object_key.as_posix(),
            "object_url": self.object_url(object_key.as_posix()),
            "status": "uploaded",
            "metadata": metadata,
        }

    def create_conversion_job(self, source_artifact_id: str, request: Mapping[str, Any]) -> dict[str, Any]:
        source = self.get_source_artifact(source_artifact_id)
        if source is None:
            raise KeyError(source_artifact_id)
        materialization_strategy = str(request.get("materialization_strategy") or "sidecar").lower()
        if materialization_strategy not in {"sidecar", "usd_prim"}:
            raise ValueError(
                f"Unsupported materialization_strategy={materialization_strategy!r}; "
                "expected 'sidecar' or 'usd_prim'."
            )
        now = utc_now()
        conversion_job_id = f"conv_{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"
        job = {
            "conversion_job_id": conversion_job_id,
            "job_id": conversion_job_id,
            "status": "queued",
            "stage": "queued",
            "target_format": request.get("target_format", "usdc"),
            "generate_mapping": bool(request.get("generate_mapping", True)),
            "profile_source_entity_enumeration": bool(request.get("profile_source_entity_enumeration", False)),
            "materialization_strategy": materialization_strategy,
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

    def create_rvt_export_job(self, request: RvtExportRequest) -> dict[str, Any]:
        source = request.source_artifact
        existing = self._find_rvt_export_job(request.event_id)
        if existing is not None:
            replay = dict(existing)
            replay["idempotent_replay"] = True
            return replay

        tenant_id = safe_id(request.tenant_id, "tenant_id")
        project_id = safe_id(request.project_id, "project_id")
        model_version_id = safe_id(request.model_version_id, "model_version_id")
        event_id = safe_id(request.event_id, "event_id")
        correlation_id = safe_id(request.correlation_id, "correlation_id")
        source_rvt_artifact_id = safe_id(source.artifact_id, "source_rvt_artifact_id")
        now = utc_now()
        export_job_id = f"rvt_export_{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"
        export_mode = request.options.export_mode
        job = {
            "export_job_id": export_job_id,
            "job_id": export_job_id,
            "event_type": request.event_type,
            "event_id": event_id,
            "correlation_id": correlation_id,
            "tenant_id": tenant_id,
            "project_id": project_id,
            "model_version_id": model_version_id,
            "source_rvt_artifact_id": source_rvt_artifact_id,
            "target_format": "ifc",
            "requested_outputs": list(request.requested_outputs or ["ifc"]),
            "status": "queued",
            "queue_state": "queued",
            "stage": "queued",
            "export_mode": export_mode,
            "runtime_boundary": {
                "owner": "_worker",
                "role": "dockerized_rvt_to_ifc_bridge",
                "real_revit_export": "external_prerequisite",
                "ifc_to_usdc_authority": "bim-streaming-server",
            },
            "source_artifact": {
                "artifact_id": source_rvt_artifact_id,
                "format": "rvt",
                "filename": source.filename,
                "url": source.url,
                "file_url": source.file_url,
                "signed_upload_reference": source.signed_upload_reference,
                "checksum_sha256": source.checksum_sha256,
            },
            "callback_url": request.callback_url,
            "handoff_target_url": request.handoff_target_url
            or "http://127.0.0.1:49100/api/conversions/ifc-to-usdc",
            "options": request.options.model_dump(),
            "ifc_artifact": None,
            "ifc_ready_event": None,
            "handoff_delivery": None,
            "blocked_reason": None,
            "created_at": now,
            "updated_at": now,
            "lineage": {
                "source_rvt_artifact_id": source_rvt_artifact_id,
                "ifc_artifact_id": None,
                "export_mode": export_mode,
                "real_revit_export": False,
            },
        }
        write_json(self._rvt_export_job_path(export_job_id), job)
        return job

    def get_rvt_export_job(self, export_job_id: str) -> dict[str, Any] | None:
        safe_id(export_job_id, "export_job_id")
        return read_json(self._rvt_export_job_path(export_job_id), None)

    def complete_rvt_export_job(self, export_job_id: str) -> dict[str, Any]:
        job = self.get_rvt_export_job(export_job_id)
        if job is None:
            raise KeyError(export_job_id)
        if job.get("status") not in {"queued", "exporting_rvt_to_ifc"}:
            return job

        job = self._update_rvt_export_job(
            export_job_id,
            status="exporting_rvt_to_ifc",
            queue_state="exporting_rvt_to_ifc",
            stage="exporting_rvt_to_ifc",
        )
        if job.get("export_mode") == "fake_fixture":
            return self._complete_fake_fixture_rvt_export(job)
        return self._block_rvt_export_without_revit_runtime(job)

    def get_conversion_job(self, conversion_job_id: str) -> dict[str, Any] | None:
        safe_id(conversion_job_id, "conversion_job_id")
        return read_json(self._job_path(conversion_job_id), None)

    def complete_conversion_job(self, conversion_job_id: str) -> dict[str, Any]:
        job = self.get_conversion_job(conversion_job_id)
        if job is None:
            raise KeyError(conversion_job_id)
        self._update_job(conversion_job_id, status="running", stage="running_converter")
        source = self.get_source_artifact(job["source_artifact_id"])
        if source is None:
            raise KeyError(job["source_artifact_id"])
        if job.get("target_format") != "usdc" or source["metadata"].get("source_format") != "ifc":
            return self._fail_conversion_job(
                job,
                code="unsupported_conversion",
                message="Only IFC source artifacts can be converted to USDC by the current worker adapter.",
                stage="unsupported_conversion",
            )

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
        converter_output_dir = self._converter_output_dir(root_path, conversion_job_id)
        converter_output_dir.mkdir(parents=True, exist_ok=True)

        try:
            converter_job = dict(job)
            converter_job["phase_progress_path"] = str(Path(self.settings.jobs_dir) / f"{conversion_job_id}.phase.json")
            adapter_result = self.converter.convert(
                source_path=Path(self.settings.objects_root) / source["object_key"],
                output_dir=converter_output_dir,
                job=converter_job,
                generate_mapping=job["generate_mapping"],
            )
            self._assert_adapter_result(adapter_result, converter_output_dir, job["generate_mapping"])
            if converter_output_dir != root_path:
                adapter_result = self._publish_staged_adapter_outputs(
                    adapter_result,
                    root_path,
                    job["generate_mapping"],
                )
        except ConversionAdapterError as exc:
            self._cleanup_staging_dir(converter_output_dir, root_path)
            return self._fail_conversion_job(
                job,
                code=exc.__class__.__name__,
                message=str(exc),
                stage="conversion_failed",
            )
        except Exception as exc:
            self._cleanup_staging_dir(converter_output_dir, root_path)
            return self._fail_conversion_job(
                job,
                code=exc.__class__.__name__,
                message=str(exc),
                stage="conversion_failed",
            )

        publish_started = perf_counter()
        now = utc_now()
        usdc_artifact_id = f"artifact_usdc_{conversion_job_id.removeprefix('conv_')}"
        quality_metrics = self._normalize_quality_metrics(adapter_result.quality_metrics)
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

        mapping_url = self.object_url((derived_root / "element_mapping.json").as_posix()) if job["generate_mapping"] else None
        entity_index_url = (
            self.object_url((derived_root / "entity_index.json").as_posix())
            if adapter_result.entity_index_path is not None
            else None
        )
        phase_timings = dict(quality_metrics.get("phase_timings") or {})
        phase_timings["artifact_publish"] = completed_phase_timing(perf_counter() - publish_started)
        quality_metrics["phase_timings"] = phase_timings
        derived_artifact_ids: dict[str, str] = {
            "model_usdc": usdc_artifact_id,
            "ifc_index": f"artifact_ifc_index_{conversion_job_id.removeprefix('conv_')}",
            "usd_index": f"artifact_usd_index_{conversion_job_id.removeprefix('conv_')}",
            "element_mapping": f"artifact_mapping_{conversion_job_id.removeprefix('conv_')}",
        }
        if entity_index_url is not None:
            derived_artifact_ids["entity_index"] = (
                f"artifact_entity_index_{conversion_job_id.removeprefix('conv_')}"
            )
        result = {
            "conversion_job_id": conversion_job_id,
            "job_id": conversion_job_id,
            "status": "succeeded",
            "ready": True,
            "artifact_group_id": group_id,
            "tenant_id": job["tenant_id"],
            "project_id": job["project_id"],
            "model_version_id": job["model_version_id"],
            "source_artifact_id": job["source_artifact_id"],
            "usdc_artifact_id": usdc_artifact_id,
            "original_filename": source["metadata"].get("original_filename"),
            "derived_artifact_ids": derived_artifact_ids,
            "source_url": source["object_url"],
            "usdc_url": self.object_url((derived_root / "model.usdc").as_posix()),
            "ifc_index_url": self.object_url((derived_root / "ifc_index.json").as_posix()),
            "usd_index_url": self.object_url((derived_root / "usd_index.json").as_posix()),
            "mapping_url": mapping_url,
            "entity_index_url": entity_index_url,
            "metadata_url": self.object_url((derived_root / "metadata.json").as_posix()),
            "converter": adapter_result.converter,
            "quality_metrics": quality_metrics,
            "warnings": adapter_result.warnings,
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

    def get_artifact_lineage(self, artifact_id: str) -> dict[str, Any] | None:
        safe_artifact_id = safe_id(artifact_id, "artifact_id")
        source = self.get_source_artifact(safe_artifact_id)
        jobs = self._conversion_jobs()
        matched_job: dict[str, Any] | None = None
        matched_kind: str | None = None

        for job in reversed(jobs):
            result = job.get("result") or {}
            if result.get("status") != "succeeded":
                continue
            candidates = self._lineage_artifact_candidates(result)
            if safe_artifact_id in candidates:
                matched_job = job
                matched_kind = candidates[safe_artifact_id]
                break

        if matched_job is not None:
            return self._lineage_from_conversion_job(matched_job, safe_artifact_id, matched_kind or "unknown")

        if source is not None:
            return self._source_only_lineage(source, safe_artifact_id, jobs)

        return None

    def object_url(self, object_key: str) -> str:
        return f"{self.settings.public_objects_url}/{object_key.strip('/')}"

    def _complete_fake_fixture_rvt_export(self, job: Mapping[str, Any]) -> dict[str, Any]:
        options = job.get("options") or {}
        fixture_url = str(options.get("fixture_ifc_url") or "")
        if not fixture_url:
            return self._block_rvt_export_without_revit_runtime(job)

        suffix = str(job["export_job_id"]).removeprefix("rvt_export_")
        source = job.get("source_artifact") or {}
        source_filename = str(source.get("filename") or "model.rvt")
        ifc_artifact_id = safe_id(
            str(options.get("fixture_ifc_artifact_id") or f"artifact_ifc_fixture_{suffix}"),
            "ifc_artifact_id",
        )
        ifc_filename = f"{Path(source_filename).stem or 'model'}.ifc"
        ifc_artifact = {
            "artifact_id": ifc_artifact_id,
            "format": "ifc",
            "filename": ifc_filename,
            "url": fixture_url,
            "source_rvt_artifact_id": job["source_rvt_artifact_id"],
            "export_mode": "fake_fixture",
            "real_revit_export": False,
        }
        ifc_ready_event = {
            "event_type": "ifc_ready",
            "event_id": f"evt_ifc_{uuid4().hex[:12]}",
            "correlation_id": job["correlation_id"],
            "tenant_id": job["tenant_id"],
            "project_id": job["project_id"],
            "model_version_id": job["model_version_id"],
            "export_job_id": job["export_job_id"],
            "source_rvt_artifact_id": job["source_rvt_artifact_id"],
            "ifc_artifact": ifc_artifact,
            "conversion_authority": "bim-streaming-server",
            "requested_outputs": ["usdc", "element_mapping", "entity_index", "metadata"],
            "handoff_target_url": job["handoff_target_url"],
            "created_at": utc_now(),
        }
        lineage = dict(job.get("lineage") or {})
        lineage.update(
            {
                "source_rvt_artifact_id": job["source_rvt_artifact_id"],
                "ifc_artifact_id": ifc_artifact_id,
                "export_mode": "fake_fixture",
                "real_revit_export": False,
                "fixture_ifc_url": fixture_url,
            }
        )
        return self._update_rvt_export_job(
            job["export_job_id"],
            status="ifc_ready",
            queue_state="ifc_ready",
            stage="ifc_ready_pending_delivery",
            ifc_artifact=ifc_artifact,
            ifc_ready_event=ifc_ready_event,
            handoff_delivery={
                "status": "pending",
                "target_url": job["handoff_target_url"],
                "reason": "delivery is owned by the streaming-server handoff loop",
            },
            blocked_reason=None,
            lineage=lineage,
        )

    def _block_rvt_export_without_revit_runtime(self, job: Mapping[str, Any]) -> dict[str, Any]:
        lineage = dict(job.get("lineage") or {})
        lineage.update(
            {
                "source_rvt_artifact_id": job["source_rvt_artifact_id"],
                "ifc_artifact_id": None,
                "real_revit_export": False,
                "blocked_reason": "revit_runtime_unavailable",
            }
        )
        return self._update_rvt_export_job(
            job["export_job_id"],
            status="blocked",
            queue_state="failed",
            stage="blocked_missing_revit_runtime",
            blocked_reason="revit_runtime_unavailable",
            ifc_artifact=None,
            ifc_ready_event=None,
            handoff_delivery=None,
            lineage=lineage,
            evidence={
                "missing_prerequisite": "external Revit runtime or export lane is not available to _worker",
                "fake_fixture_mode_enabled": False,
            },
        )

    def _conversion_jobs(self) -> list[dict[str, Any]]:
        jobs: list[dict[str, Any]] = []
        for path in sorted(Path(self.settings.jobs_dir).glob("*.json")):
            payload = read_json(path, None)
            if isinstance(payload, dict):
                jobs.append(payload)
        return jobs

    def _rvt_export_jobs(self) -> list[dict[str, Any]]:
        jobs: list[dict[str, Any]] = []
        for path in sorted(self._rvt_exports_dir().glob("*.json")):
            payload = read_json(path, None)
            if isinstance(payload, dict):
                jobs.append(payload)
        return jobs

    def _find_rvt_export_job(self, event_id: str) -> dict[str, Any] | None:
        safe_event_id = safe_id(event_id, "event_id")
        for job in reversed(self._rvt_export_jobs()):
            if job.get("event_id") == safe_event_id:
                return job
        return None

    def _lineage_artifact_candidates(self, result: Mapping[str, Any]) -> dict[str, str]:
        candidates: dict[str, str] = {}
        source_artifact_id = result.get("source_artifact_id")
        usdc_artifact_id = result.get("usdc_artifact_id")
        if source_artifact_id:
            candidates[str(source_artifact_id)] = "source"
        if usdc_artifact_id:
            candidates[str(usdc_artifact_id)] = "derived_model"
        derived_ids = result.get("derived_artifact_ids") or {}
        for key, kind in (
            ("model_usdc", "derived_model"),
            ("ifc_index", "ifc_index"),
            ("usd_index", "usd_index"),
            ("element_mapping", "element_mapping"),
            ("entity_index", "entity_index"),
        ):
            artifact_id = derived_ids.get(key)
            if artifact_id:
                candidates[str(artifact_id)] = kind
        metadata_id = self._metadata_artifact_id(result)
        if metadata_id:
            candidates[metadata_id] = "metadata"
        return candidates

    def _source_only_lineage(
        self,
        source: dict[str, Any],
        requested_artifact_id: str,
        jobs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        related_jobs = [
            job["conversion_job_id"]
            for job in jobs
            if job.get("source_artifact_id") == source["source_artifact_id"]
        ]
        diagnostics = [
            {
                "code": "derived_artifacts_not_ready",
                "severity": "info",
                "message": "Source artifact has no succeeded conversion lineage yet.",
            }
        ]
        return {
            "artifact_id": requested_artifact_id,
            "current_artifact_id": requested_artifact_id,
            "current_node_id": requested_artifact_id,
            "current_artifact_kind": "source",
            "artifact_group_id": source["artifact_group_id"],
            "tenant_id": source["metadata"]["tenant_id"],
            "project_id": source["metadata"]["project_id"],
            "model_version_id": source["metadata"]["model_version_id"],
            "root_source_artifact_id": source["source_artifact_id"],
            "conversion_job_ids": related_jobs,
            "nodes": [self._source_lineage_node(source)],
            "edges": [],
            "quality_metrics_summary": None,
            "diagnostics": diagnostics,
        }

    def _lineage_from_conversion_job(
        self,
        job: Mapping[str, Any],
        requested_artifact_id: str,
        requested_kind: str,
    ) -> dict[str, Any] | None:
        result = job.get("result") or {}
        source_artifact_id = result.get("source_artifact_id")
        if not source_artifact_id:
            return None
        source = self.get_source_artifact(str(source_artifact_id))
        if source is None:
            return None

        diagnostics: list[dict[str, Any]] = []
        derived_ids = self._normalized_derived_artifact_ids(result, diagnostics)
        derived_root = Path(str((result.get("lineage") or {}).get("derived_object_prefix") or ""))
        metadata = self._read_derived_metadata(derived_root, diagnostics)
        lineage = metadata.get("lineage") if isinstance(metadata, dict) else None
        if not isinstance(lineage, dict):
            diagnostics.append(
                {
                    "code": "missing_metadata_lineage",
                    "severity": "warn",
                    "message": "metadata.json is missing a lineage object.",
                }
            )
        else:
            for field in ("source_artifact_id", "source_object_key", "derived_object_prefix"):
                if field not in lineage:
                    diagnostics.append(
                        {
                            "code": f"missing_metadata_lineage_{field}",
                            "severity": "warn",
                            "message": f"metadata.json lineage is missing {field}.",
                        }
                    )

        conversion_node_id = str(result["conversion_job_id"])
        nodes = [
            self._source_lineage_node(source),
            {
                "node_id": conversion_node_id,
                "artifact_id": conversion_node_id,
                "kind": "conversion_job",
                "role": "conversion",
                "status": result.get("status"),
                "conversion_job_id": conversion_node_id,
            },
            {
                "node_id": derived_ids["model_usdc"],
                "artifact_id": derived_ids["model_usdc"],
                "kind": "derived_model",
                "role": "model_usdc",
                "format": "usdc",
                "object_key": (derived_root / "model.usdc").as_posix(),
                "url": result.get("usdc_url"),
                "conversion_job_id": conversion_node_id,
                "exists": self._object_exists(derived_root / "model.usdc"),
            },
        ]

        sidecar_specs: list[tuple[str, str, str, Any]] = [
            ("ifc_index", "ifc_index", "ifc_index.json", result.get("ifc_index_url")),
            ("usd_index", "usd_index", "usd_index.json", result.get("usd_index_url")),
            ("element_mapping", "element_mapping", "element_mapping.json", result.get("mapping_url")),
        ]
        if "entity_index" in derived_ids:
            sidecar_specs.append(
                ("entity_index", "entity_index", "entity_index.json", result.get("entity_index_url"))
            )
        for key, kind, filename, url in sidecar_specs:
            if not url:
                diagnostics.append(
                    {
                        "code": f"missing_{key}_url",
                        "severity": "warn",
                        "message": f"Conversion result does not expose {filename}.",
                    }
                )
                continue
            object_key = (derived_root / filename).as_posix()
            nodes.append(
                {
                    "node_id": derived_ids[key],
                    "artifact_id": derived_ids[key],
                    "kind": kind,
                    "role": key,
                    "format": "json",
                    "object_key": object_key,
                    "url": url,
                    "conversion_job_id": conversion_node_id,
                    "exists": self._object_exists(derived_root / filename),
                }
            )

        metadata_id = self._metadata_artifact_id(result)
        if result.get("metadata_url"):
            nodes.append(
                {
                    "node_id": metadata_id,
                    "artifact_id": metadata_id,
                    "kind": "metadata",
                    "role": "metadata",
                    "format": "json",
                    "object_key": (derived_root / "metadata.json").as_posix(),
                    "url": result.get("metadata_url"),
                    "conversion_job_id": conversion_node_id,
                    "exists": self._object_exists(derived_root / "metadata.json"),
                }
            )
        else:
            diagnostics.append(
                {
                    "code": "missing_metadata_url",
                    "severity": "warn",
                    "message": "Conversion result does not expose metadata.json.",
                }
            )

        edges = [
            {
                "from": source["source_artifact_id"],
                "to": conversion_node_id,
                "relationship": "converted_by",
            },
            {
                "from": conversion_node_id,
                "to": derived_ids["model_usdc"],
                "relationship": "produced",
            },
        ]
        for node in nodes:
            if node["kind"] in {"ifc_index", "usd_index", "element_mapping", "entity_index", "metadata"}:
                edges.append(
                    {
                        "from": derived_ids["model_usdc"],
                        "to": node["node_id"],
                        "relationship": "has_sidecar",
                    }
                )

        return {
            "artifact_id": requested_artifact_id,
            "current_artifact_id": requested_artifact_id,
            "current_node_id": requested_artifact_id,
            "current_artifact_kind": requested_kind,
            "artifact_group_id": result["artifact_group_id"],
            "tenant_id": result["tenant_id"],
            "project_id": result["project_id"],
            "model_version_id": result["model_version_id"],
            "root_source_artifact_id": result["source_artifact_id"],
            "conversion_job_ids": [conversion_node_id],
            "nodes": nodes,
            "edges": edges,
            "quality_metrics_summary": self._quality_metrics_summary(result.get("quality_metrics") or {}),
            "diagnostics": diagnostics,
        }

    def _source_lineage_node(self, source: Mapping[str, Any]) -> dict[str, Any]:
        metadata = source["metadata"]
        return {
            "node_id": source["source_artifact_id"],
            "artifact_id": source["source_artifact_id"],
            "kind": "source",
            "role": "source_ifc",
            "format": metadata.get("source_format"),
            "object_key": source.get("object_key"),
            "url": source.get("object_url"),
            "sha256": metadata.get("sha256"),
            "original_filename": metadata.get("original_filename"),
        }

    def _normalized_derived_artifact_ids(
        self,
        result: Mapping[str, Any],
        diagnostics: list[dict[str, Any]],
    ) -> dict[str, str]:
        suffix = str(result["conversion_job_id"]).removeprefix("conv_")
        defaults = {
            "model_usdc": str(result.get("usdc_artifact_id") or f"artifact_usdc_{suffix}"),
            "ifc_index": f"artifact_ifc_index_{suffix}",
            "usd_index": f"artifact_usd_index_{suffix}",
            "element_mapping": f"artifact_mapping_{suffix}",
        }
        raw_ids = result.get("derived_artifact_ids")
        if not isinstance(raw_ids, dict):
            diagnostics.append(
                {
                    "code": "missing_derived_artifact_ids",
                    "severity": "warn",
                    "message": "Conversion result is missing derived_artifact_ids; stable fallback IDs were reconstructed.",
                }
            )
            if result.get("entity_index_url"):
                defaults["entity_index"] = f"artifact_entity_index_{suffix}"
            return defaults
        ids = dict(defaults)
        for key in defaults:
            if raw_ids.get(key):
                ids[key] = str(raw_ids[key])
            else:
                diagnostics.append(
                    {
                        "code": f"missing_derived_artifact_id_{key}",
                        "severity": "warn",
                        "message": f"Conversion result is missing derived_artifact_ids.{key}; fallback ID was reconstructed.",
                    }
                )
        if raw_ids.get("entity_index"):
            ids["entity_index"] = str(raw_ids["entity_index"])
        elif result.get("entity_index_url"):
            ids["entity_index"] = f"artifact_entity_index_{suffix}"
        return ids

    def _metadata_artifact_id(self, result: Mapping[str, Any]) -> str:
        suffix = str(result.get("conversion_job_id") or "unknown").removeprefix("conv_")
        return f"artifact_metadata_{suffix}"

    def _read_derived_metadata(self, derived_root: Path, diagnostics: list[dict[str, Any]]) -> dict[str, Any]:
        if not derived_root.as_posix():
            diagnostics.append(
                {
                    "code": "missing_derived_object_prefix",
                    "severity": "warn",
                    "message": "Conversion result lineage is missing derived_object_prefix.",
                }
            )
            return {}
        metadata_path = Path(self.settings.objects_root) / derived_root / "metadata.json"
        metadata = read_json(metadata_path, {})
        if not metadata:
            diagnostics.append(
                {
                    "code": "missing_metadata_json",
                    "severity": "warn",
                    "message": "Derived metadata.json is missing or unreadable.",
                }
            )
        return metadata if isinstance(metadata, dict) else {}

    def _object_exists(self, object_key: Path) -> bool:
        return (Path(self.settings.objects_root) / object_key).is_file()

    def _quality_metrics_summary(self, quality_metrics: Mapping[str, Any]) -> dict[str, Any]:
        normalized = self._normalize_quality_metrics(quality_metrics)
        keys = (
            "source_ifc_entity_count",
            "source_ifc_element_count",
            "usd_prim_count",
            "mapped_entity_count",
            "unmapped_entity_count",
            "mapped_count",
            "unmapped_count",
            "coverage_ratio",
            "minimum_coverage_ratio",
            "coverage_denominator",
            "minimum_coverage_baseline_locked",
            "coverage_status",
            "issue_to_real_prim_readiness",
            "threshold_status",
            "coverage_policy_diagnostics",
        )
        return {key: normalized.get(key) for key in keys if key in normalized}

    def _normalize_quality_metrics(self, quality_metrics: Mapping[str, Any] | None) -> dict[str, Any]:
        metrics = dict(quality_metrics or {})
        source_count = self._int_metric(
            metrics.get("source_ifc_entity_count"),
            metrics.get("source_ifc_element_count"),
            metrics.get("source_count"),
            default=0,
        )
        mapped_count = self._int_metric(metrics.get("mapped_entity_count"), metrics.get("mapped_count"), default=0)
        if "unmapped_entity_count" in metrics:
            unmapped_count = self._int_metric(metrics.get("unmapped_entity_count"), default=0)
        elif "unmapped_count" in metrics:
            unmapped_count = self._int_metric(metrics.get("unmapped_count"), default=0)
        elif "unmapped_ifc_count" in metrics:
            unmapped_count = self._int_metric(metrics.get("unmapped_ifc_count"), default=0)
        else:
            unmapped_count = max(source_count - mapped_count, 0)

        if metrics.get("coverage_ratio") is None:
            coverage_ratio = (mapped_count / source_count) if source_count else 0.0
        else:
            coverage_ratio = float(metrics.get("coverage_ratio") or 0.0)

        locked = bool(metrics.get("minimum_coverage_baseline_locked", False))
        minimum_ratio = float(metrics.get("minimum_coverage_ratio") if metrics.get("minimum_coverage_ratio") is not None else 1.0)
        coverage_status = str(metrics.get("coverage_status") or "").strip().lower()
        if not coverage_status:
            if locked:
                coverage_status = "pass" if coverage_ratio >= minimum_ratio and unmapped_count == 0 else "fail"
            else:
                coverage_status = "unlocked"

        diagnostics = list(metrics.get("coverage_policy_diagnostics") or metrics.get("policy_diagnostics") or [])
        if locked and coverage_status == "fail" and not diagnostics:
            diagnostics.append(
                {
                    "code": "coverage_below_minimum",
                    "severity": "error",
                    "message": "At least one source IFC entity lacks a USD prim mapping under the locked 1.0 coverage policy.",
                }
            )
        if coverage_status == "warn" and not diagnostics:
            diagnostics.append(
                {
                    "code": "coverage_warning",
                    "severity": "warn",
                    "message": "Coverage is degraded but allowed for review-session creation.",
                }
            )

        metrics["source_ifc_entity_count"] = source_count
        metrics.setdefault("source_ifc_element_count", source_count)
        metrics["mapped_entity_count"] = mapped_count
        metrics["unmapped_entity_count"] = unmapped_count
        metrics["mapped_count"] = mapped_count
        metrics["unmapped_count"] = unmapped_count
        metrics["coverage_ratio"] = coverage_ratio
        metrics["minimum_coverage_ratio"] = minimum_ratio
        metrics["coverage_denominator"] = metrics.get("coverage_denominator") or "source_ifc_entity_count"
        metrics["minimum_coverage_baseline_locked"] = locked
        metrics["coverage_status"] = coverage_status
        metrics["threshold_status"] = metrics.get("threshold_status") or ("locked" if locked else "measure_only")
        metrics["coverage_policy_diagnostics"] = diagnostics
        metrics["issue_to_real_prim_readiness"] = bool(
            metrics.get("issue_to_real_prim_readiness", locked and coverage_status == "pass")
        )
        if not locked or coverage_status != "pass":
            metrics["issue_to_real_prim_readiness"] = False
        return metrics

    def _int_metric(self, *values: Any, default: int = 0) -> int:
        for value in values:
            if value is None:
                continue
            try:
                return int(value)
            except (TypeError, ValueError):
                continue
        return default

    def _content_bytes(self, request: ArtifactIntakeRequest) -> bytes:
        if request.content_base64:
            return base64.b64decode(request.content_base64)
        if request.content_text is not None:
            return request.content_text.encode("utf-8")
        reference = request.source_url or request.signed_upload_url or ""
        return json.dumps({"upload_reference": reference}, ensure_ascii=False).encode("utf-8")

    def _converter_output_dir(self, root_path: Path, conversion_job_id: str) -> Path:
        model_path = root_path / "model.usdc"
        if len(str(model_path)) < 240:
            return root_path
        return Path(self.settings.service_root) / "data" / "conversion-staging" / conversion_job_id

    def _publish_staged_adapter_outputs(
        self,
        adapter_result: Any,
        root_path: Path,
        generate_mapping: bool,
    ) -> Any:
        model_path = root_path / "model.usdc"
        ifc_index_path = root_path / "ifc_index.json"
        usd_index_path = root_path / "usd_index.json"
        mapping_path = root_path / "element_mapping.json" if generate_mapping else None
        entity_index_path: Path | None = (
            root_path / "entity_index.json" if adapter_result.entity_index_path is not None else None
        )
        shutil.copy2(adapter_result.model_path, model_path)
        shutil.copy2(adapter_result.ifc_index_path, ifc_index_path)
        shutil.copy2(adapter_result.usd_index_path, usd_index_path)
        if generate_mapping and adapter_result.mapping_path is not None and mapping_path is not None:
            shutil.copy2(adapter_result.mapping_path, mapping_path)
        if adapter_result.entity_index_path is not None and entity_index_path is not None:
            shutil.copy2(adapter_result.entity_index_path, entity_index_path)

        staging_dir = Path(adapter_result.model_path).parent.resolve()
        staging_root = (Path(self.settings.service_root) / "data" / "conversion-staging").resolve()
        if staging_dir == staging_root or staging_root in staging_dir.parents:
            shutil.rmtree(staging_dir, ignore_errors=True)

        return replace(
            adapter_result,
            model_path=model_path,
            ifc_index_path=ifc_index_path,
            usd_index_path=usd_index_path,
            mapping_path=mapping_path,
            entity_index_path=entity_index_path,
        )

    def _cleanup_staging_dir(self, converter_output_dir: Path, root_path: Path) -> None:
        if converter_output_dir == root_path:
            return
        staging_root = (Path(self.settings.service_root) / "data" / "conversion-staging").resolve()
        candidate = converter_output_dir.resolve()
        if candidate == staging_root or staging_root in candidate.parents:
            shutil.rmtree(candidate, ignore_errors=True)

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
        quality_metrics = self._normalize_quality_metrics(result.get("quality_metrics"))
        coverage_status = quality_metrics.get("coverage_status")
        mapping_url = result.get("mapping_url")
        mapping_ready = bool(mapping_url) and coverage_status != "fail"
        if not mapping_url:
            ready_status = "missing_mapping"
            group_status = "ready"
        elif coverage_status == "fail":
            ready_status = "mapping_quality_failed"
            group_status = "quality_failed"
        else:
            ready_status = "ready"
            group_status = "ready"
        return {
            "artifact_group_id": result["artifact_group_id"],
            "tenant_id": result["tenant_id"],
            "project_id": result["project_id"],
            "model_version_id": result["model_version_id"],
            "status": group_status,
            "ready_status": ready_status,
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
                "artifact_id": (result.get("derived_artifact_ids") or {}).get("element_mapping"),
                "object_key": (derived_root / "element_mapping.json").as_posix(),
                "url": mapping_url,
                "ready": mapping_ready,
                "coverage_status": coverage_status,
                "quality_ready": mapping_ready,
                "issue_to_real_prim_readiness": quality_metrics.get("issue_to_real_prim_readiness"),
            },
            "indexes": {
                "ifc_index_artifact_id": (result.get("derived_artifact_ids") or {}).get("ifc_index"),
                "ifc_index_url": result["ifc_index_url"],
                "usd_index_artifact_id": (result.get("derived_artifact_ids") or {}).get("usd_index"),
                "usd_index_url": result["usd_index_url"],
                "entity_index_artifact_id": (result.get("derived_artifact_ids") or {}).get("entity_index"),
                "entity_index_url": result.get("entity_index_url"),
            },
            "quality_metrics": quality_metrics,
            "converter": result.get("converter"),
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
                "original_filename": metadata.get("original_filename"),
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

    def _rvt_exports_dir(self) -> Path:
        return Path(self.settings.jobs_dir) / "rvt-exports"

    def _rvt_export_job_path(self, export_job_id: str) -> Path:
        safe_id(export_job_id, "export_job_id")
        return self._rvt_exports_dir() / f"{export_job_id}.json"

    def _update_job(self, conversion_job_id: str, **updates: Any) -> dict[str, Any]:
        job = self.get_conversion_job(conversion_job_id)
        if job is None:
            raise KeyError(conversion_job_id)
        job.update(updates)
        job["updated_at"] = utc_now()
        write_json(self._job_path(conversion_job_id), job)
        return job

    def _update_rvt_export_job(self, export_job_id: str, **updates: Any) -> dict[str, Any]:
        job = self.get_rvt_export_job(export_job_id)
        if job is None:
            raise KeyError(export_job_id)
        job.update(updates)
        job["updated_at"] = utc_now()
        write_json(self._rvt_export_job_path(export_job_id), job)
        return job

    def _assert_adapter_result(self, adapter_result: Any, root_path: Path, generate_mapping: bool) -> None:
        required_paths = [
            adapter_result.model_path,
            adapter_result.ifc_index_path,
            adapter_result.usd_index_path,
        ]
        if generate_mapping:
            required_paths.append(adapter_result.mapping_path)
        if adapter_result.entity_index_path is not None:
            if Path(adapter_result.entity_index_path).name != "entity_index.json":
                raise ConversionAdapterError(
                    f"Converter output entity_index_path must be named 'entity_index.json', "
                    f"got: {Path(adapter_result.entity_index_path).name!r}"
                )
            required_paths.append(adapter_result.entity_index_path)
        for path in required_paths:
            if path is None or not Path(path).is_file():
                raise ConversionAdapterError(f"Converter did not create required output: {path}")
            if root_path.resolve() != Path(path).resolve() and root_path.resolve() not in Path(path).resolve().parents:
                raise ConversionAdapterError(f"Converter output escaped the derived object layout: {path}")

        gates = (adapter_result.quality_metrics or {}).get("hard_quality_gates", {})
        if not gates.get("usdc_openable"):
            raise ConversionAdapterError("Generated model.usdc did not pass USD stage openability gate.")
        if not gates.get("has_renderable_prims"):
            raise ConversionAdapterError("Generated model.usdc did not contain renderable prims.")
        if self._looks_like_placeholder(adapter_result.model_path):
            raise ConversionAdapterError("Generated model.usdc looks like a placeholder output.")

        if generate_mapping and adapter_result.mapping_path is not None:
            mapping = read_json(adapter_result.mapping_path, {})
            if mapping.get("mock") is True:
                raise ConversionAdapterError("Generated element_mapping.json is marked as mock output.")
            summary = mapping.get("summary") or {}
            if int(summary.get("fake_mapping_count") or 0) > 0:
                raise ConversionAdapterError("Generated element_mapping.json contains fake mapping entries.")

    def _looks_like_placeholder(self, path: Path) -> bool:
        content = path.read_bytes()[:4096].lower()
        markers = (b"worker adapter usdc placeholder", b"placeholder", b"worker_adapter_smoke")
        return any(marker in content for marker in markers)

    def _fail_conversion_job(
        self,
        job: Mapping[str, Any],
        *,
        code: str,
        message: str,
        stage: str,
    ) -> dict[str, Any]:
        result = {
            "conversion_job_id": job["conversion_job_id"],
            "job_id": job["job_id"],
            "status": "failed",
            "ready": False,
            "artifact_group_id": job["artifact_group_id"],
            "tenant_id": job["tenant_id"],
            "project_id": job["project_id"],
            "model_version_id": job["model_version_id"],
            "source_artifact_id": job["source_artifact_id"],
            "usdc_url": None,
            "ifc_index_url": None,
            "usd_index_url": None,
            "mapping_url": None,
            "metadata_url": None,
            "error": {"code": code, "message": message},
        }
        warnings = list(job.get("warnings") or [])
        warnings.append(f"{code}: {message}")
        return self._update_job(job["conversion_job_id"], status="failed", stage=stage, result=result, warnings=warnings)
