from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import json
import re
from typing import Any, Mapping
from uuid import uuid4


SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
CONVERSION_API_ENDPOINTS = {
    "create": "POST /api/conversions/ifc-to-usdc",
    "status": "GET /api/conversions/{conversion_job_id}",
    "result": "GET /api/conversions/{conversion_job_id}/result",
}
CONVERSION_STATUSES = ("queued", "running", "succeeded", "succeeded_with_warnings", "failed", "cancelled")
CONVERSION_STAGES = ("queued", "running_headless_converter", "done", "conversion_failed", "cancelled")


class ConversionAuthorityError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ConversionRequestError(ValueError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@dataclass(frozen=True)
class ConversionAuthoritySettings:
    service_root: Path
    artifacts_root: Path
    jobs_dir: Path
    public_artifacts_url: str
    # B-scheme（local-coordinator-ifc-ready-intake-boundary T4）：
    # `_bim-control`(:8001) 已自 repo 刪除。streaming 為 internal-only 轉檔引擎，
    # 不再寫死 callback 到已刪服務；轉檔結果回拋公司雲端（metadata-only outbox）
    # 屬 T5 並由 coordinator 驅動。預設 None＝不主動 callback（coordinator 輪詢
    # /result 或由 T5 outbox 投遞）。
    bim_control_callback_url: str | None = None
    internal_conversion_token: str | None = None


class HeadlessConverterNotConfigured:
    def convert(self, *, job: dict[str, Any], ifc_ready_event: dict[str, Any], output_dir: Path) -> dict[str, Any]:
        raise ConversionAuthorityError(
            "converter_unavailable",
            "Headless IFC to USDC converter is not configured for this process.",
        )


def create_conversion_api_app(
    *,
    settings: ConversionAuthoritySettings,
    converter: Any | None = None,
    run_background: bool = True,
):
    from fastapi import BackgroundTasks, Body, FastAPI, HTTPException, Request

    store = StreamingConversionStore(settings=settings, converter=converter)
    app = FastAPI(title="BIM Streaming Conversion Authority", version="0.1.0")

    @app.post("/api/conversions/ifc-to-usdc", status_code=202)
    def create_conversion(
        request: Request,
        background_tasks: BackgroundTasks,
        ifc_ready_event: dict[str, Any] = Body(...),
    ):
        """Internal conversion request (B-scheme: local-coordinator-ifc-ready-intake-boundary T4).

        `bim-streaming-server` is an internal-only conversion engine. The supported
        caller is `bim-review-coordinator` (the single external IFC-ready intake);
        this is NOT an external IFC Worker entry point and NOT `_worker`. The
        request body keeps the `event_type="ifc_ready"` shape that the coordinator's
        StreamingConversionClient produces; the external IFC-ready contract lives at
        `bim-review-coordinator` `POST /api/external/ifc-ready`.
        """
        expected_token = settings.internal_conversion_token
        if expected_token:
            actual_token = request.headers.get("X-Internal-Conversion-Token")
            if not actual_token:
                raise HTTPException(status_code=401, detail="Missing internal conversion token.")
            if actual_token != expected_token:
                raise HTTPException(status_code=403, detail="Invalid internal conversion token.")
        try:
            job = store.create_conversion_job(ifc_ready_event)
        except ConversionRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if run_background and not job.get("idempotent_replay"):
            background_tasks.add_task(store.complete_conversion_job, job["conversion_job_id"])
        return job

    @app.get("/api/conversions/{conversion_job_id}")
    def get_conversion(conversion_job_id: str):
        try:
            job = store.get_conversion_job(conversion_job_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if job is None:
            raise HTTPException(status_code=404, detail="Conversion job not found.")
        return job

    @app.get("/api/conversions/{conversion_job_id}/result")
    def get_conversion_result(conversion_job_id: str):
        try:
            job = store.get_conversion_job(conversion_job_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if job is None:
            raise HTTPException(status_code=404, detail="Conversion job not found.")
        return job.get("result") or {
            "conversion_job_id": conversion_job_id,
            "authority": "bim-streaming-server",
            "status": job.get("status", "unknown"),
            "ready": False,
        }

    return app


class StreamingConversionStore:
    def __init__(self, *, settings: ConversionAuthoritySettings, converter: Any | None = None):
        self.settings = settings
        self.converter = converter or HeadlessConverterNotConfigured()
        Path(self.settings.artifacts_root).mkdir(parents=True, exist_ok=True)
        Path(self.settings.jobs_dir).mkdir(parents=True, exist_ok=True)

    def create_conversion_job(self, ifc_ready_event: Mapping[str, Any]) -> dict[str, Any]:
        event = dict(ifc_ready_event)
        if event.get("event_type") != "ifc_ready":
            raise ValueError("Expected ifc_ready event.")
        event_id = _safe_id(str(event.get("event_id") or ""), "event_id")
        idempotency_key = _safe_id(str(event.get("idempotency_key") or event_id), "idempotency_key")
        request_fingerprint = _request_fingerprint(event)
        existing = self._find_job_by_idempotency_key(idempotency_key)
        if existing is not None:
            existing_fingerprint = existing.get("request_fingerprint")
            if existing_fingerprint and existing_fingerprint != request_fingerprint:
                raise ConversionRequestError(409, "Idempotency key already belongs to a different conversion request.")
            replay = dict(existing)
            replay["idempotent_replay"] = True
            return replay

        ifc_artifact = _ifc_artifact(event)
        conversion_job_id = f"stream_conv_{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"
        now = _utc_now()
        job = {
            "conversion_job_id": conversion_job_id,
            "job_id": conversion_job_id,
            "authority": "bim-streaming-server",
            "event_id": event_id,
            "idempotency_key": idempotency_key,
            "request_fingerprint": request_fingerprint,
            "event_type": event["event_type"],
            "correlation_id": _safe_id(str(event.get("correlation_id") or ""), "correlation_id"),
            "tenant_id": _safe_id(str(event.get("tenant_id") or "tenant_demo_001"), "tenant_id"),
            "project_id": _safe_id(str(event.get("project_id") or "project_demo_001"), "project_id"),
            "model_version_id": _safe_id(str(event.get("model_version_id") or ""), "model_version_id"),
            "export_job_id": _safe_id(str(event.get("export_job_id") or ""), "export_job_id"),
            "source_rvt_artifact_id": _safe_id(str(event.get("source_rvt_artifact_id") or ""), "source_rvt_artifact_id"),
            "ifc_artifact": ifc_artifact,
            "status": "queued",
            "stage": "queued",
            "target_format": "usdc",
            "requested_outputs": list(event.get("requested_outputs") or ["usdc", "element_mapping", "entity_index"]),
            "callback_url": event.get("callback_url") or self.settings.bim_control_callback_url,
            "created_at": now,
            "updated_at": now,
            "ifc_ready_event": event,
            "result": None,
            "callback_payload": None,
            "callback_delivery": None,
            "execution_boundary": {
                "owner": "bim-streaming-server",
                "live_webrtc_runtime": "separately_health_checked",
                "converter_lane": "headless_subprocess_or_worker_lane",
            },
        }
        self._write_job(job)
        return job

    def get_conversion_job(self, conversion_job_id: str) -> dict[str, Any] | None:
        _safe_id(conversion_job_id, "conversion_job_id")
        path = self._job_path(conversion_job_id)
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def complete_conversion_job(self, conversion_job_id: str) -> dict[str, Any]:
        job = self.get_conversion_job(conversion_job_id)
        if job is None:
            raise KeyError(conversion_job_id)
        if job.get("status") not in {"queued", "running"}:
            return job

        job = self._update_job(conversion_job_id, status="running", stage="running_headless_converter")
        output_dir = Path(self.settings.artifacts_root) / conversion_job_id
        try:
            converter_result = self.converter.convert(
                job=job,
                ifc_ready_event=dict(job["ifc_ready_event"]),
                output_dir=output_dir,
            )
            result = self._build_success_result(job, converter_result)
        except ConversionAuthorityError as exc:
            return self._fail_job(job, code=exc.code, message=exc.message, stage="conversion_failed")
        except Exception as exc:
            return self._fail_job(job, code=exc.__class__.__name__, message=str(exc), stage="conversion_failed")

        callback_payload = self._callback_payload(job, result)
        callback_url = job.get("callback_url")
        if callback_url:
            callback_delivery = {
                "status": "pending",
                "target_url": callback_url,
                "reason": "network delivery deferred to coordinator / T5 cloud callback outbox",
            }
        else:
            # B-scheme T4: `_bim-control` removed; with no callback target the
            # streaming server does NOT post anywhere. The coordinator owns the
            # external contract — it polls /result and (T5) drives the
            # metadata-only cloud callback outbox.
            callback_delivery = {
                "status": "skipped",
                "target_url": None,
                "reason": "no callback_url; coordinator polls /result, cloud callback is T5 outbox",
            }
        return self._update_job(
            conversion_job_id,
            status="succeeded",
            stage="done",
            result=result,
            callback_payload=callback_payload,
            callback_delivery=callback_delivery,
        )

    def _build_success_result(self, job: Mapping[str, Any], converter_result: Mapping[str, Any]) -> dict[str, Any]:
        output_paths = self._required_output_paths(converter_result)
        quality_metrics = self._normalize_quality_metrics(converter_result.get("quality_metrics") or {})
        self._assert_publishable_outputs(output_paths, quality_metrics, job)

        suffix = str(job["conversion_job_id"]).removeprefix("stream_conv_")
        artifacts = {
            "model_usdc": self._artifact_payload(
                artifact_id=f"artifact_stream_usdc_{suffix}",
                role="model_usdc",
                format_="usdc",
                path=output_paths["model_path"],
            ),
            "element_mapping": self._artifact_payload(
                artifact_id=f"artifact_stream_mapping_{suffix}",
                role="element_mapping",
                format_="json",
                path=output_paths["mapping_path"],
            ),
            "entity_index": self._artifact_payload(
                artifact_id=f"artifact_stream_entity_index_{suffix}",
                role="entity_index",
                format_="json",
                path=output_paths["entity_index_path"],
            ),
            "metadata": self._artifact_payload(
                artifact_id=f"artifact_stream_metadata_{suffix}",
                role="metadata",
                format_="json",
                path=output_paths["metadata_path"],
            ),
        }
        lineage = {
            "source_rvt_artifact_id": job["source_rvt_artifact_id"],
            "ifc_artifact_id": job["ifc_artifact"]["artifact_id"],
            "usdc_artifact_id": artifacts["model_usdc"]["artifact_id"],
            "mapping_artifact_id": artifacts["element_mapping"]["artifact_id"],
            "entity_index_artifact_id": artifacts["entity_index"]["artifact_id"],
            "relations": [
                {"from": job["ifc_artifact"]["artifact_id"], "to": artifacts["model_usdc"]["artifact_id"], "type": "converted_to"},
                {"from": artifacts["model_usdc"]["artifact_id"], "to": artifacts["element_mapping"]["artifact_id"], "type": "has_sidecar"},
                {"from": artifacts["model_usdc"]["artifact_id"], "to": artifacts["entity_index"]["artifact_id"], "type": "has_sidecar"},
            ],
        }
        return {
            "conversion_job_id": job["conversion_job_id"],
            "authority": "bim-streaming-server",
            "status": "succeeded",
            "ready": True,
            "tenant_id": job["tenant_id"],
            "project_id": job["project_id"],
            "model_version_id": job["model_version_id"],
            "correlation_id": job["correlation_id"],
            "ifc_artifact_id": job["ifc_artifact"]["artifact_id"],
            "model": {
                "status": "ready",
                "format": "usdc",
                "url": artifacts["model_usdc"]["url"],
            },
            "artifacts": artifacts,
            "quality_metrics": quality_metrics,
            "lineage": lineage,
        }

    def _required_output_paths(self, converter_result: Mapping[str, Any]) -> dict[str, Path]:
        keys = ("model_path", "mapping_path", "entity_index_path", "metadata_path")
        paths: dict[str, Path] = {}
        for key in keys:
            value = converter_result.get(key)
            if not value:
                raise ConversionAuthorityError("missing_output", f"Converter result is missing {key}.")
            paths[key] = Path(value)
        return paths

    def _assert_publishable_outputs(
        self,
        output_paths: Mapping[str, Path],
        quality_metrics: Mapping[str, Any],
        job: Mapping[str, Any],
    ) -> None:
        for key, path in output_paths.items():
            if not path.is_file():
                raise ConversionAuthorityError("missing_output", f"Converter output does not exist: {key}={path}")
        model_bytes = output_paths["model_path"].read_bytes()[:4096].lower()
        if b"placeholder" in model_bytes or b"worker adapter usdc placeholder" in model_bytes:
            raise ConversionAuthorityError("placeholder_usdc", "Generated model.usdc looks like a placeholder output.")
        gates = quality_metrics.get("hard_quality_gates") or {}
        if gates and not gates.get("usdc_openable"):
            raise ConversionAuthorityError("usdc_not_openable", "Generated model.usdc did not pass openability gate.")
        if gates and not gates.get("has_renderable_prims"):
            raise ConversionAuthorityError("missing_renderable_prims", "Generated model.usdc has no renderable prims.")
        mapping = json.loads(output_paths["mapping_path"].read_text(encoding="utf-8"))
        allow_fake_mapping = bool((job.get("ifc_ready_event") or {}).get("allow_fake_mapping"))
        fake_count = int(((mapping.get("summary") or {}).get("fake_mapping_count") or 0))
        if (mapping.get("mock") is True or fake_count > 0) and not allow_fake_mapping:
            raise ConversionAuthorityError("fake_mapping_not_allowed", "Mapping output is fake but allow_fake_mapping is not enabled.")

    def _normalize_quality_metrics(self, raw: Mapping[str, Any]) -> dict[str, Any]:
        metrics = dict(raw)
        source_count = _int_metric(metrics.get("source_ifc_entity_count"), metrics.get("source_ifc_element_count"))
        mapped_count = _int_metric(metrics.get("mapped_count"), metrics.get("mapped_entity_count"))
        unmapped_count = _int_metric(metrics.get("unmapped_count"), metrics.get("unmapped_entity_count"), default=max(source_count - mapped_count, 0))
        coverage_ratio = float(metrics.get("coverage_ratio") if metrics.get("coverage_ratio") is not None else (mapped_count / source_count if source_count else 0.0))
        metrics["source_ifc_entity_count"] = source_count
        metrics["mapped_count"] = mapped_count
        metrics["unmapped_count"] = unmapped_count
        metrics["coverage_ratio"] = coverage_ratio
        metrics["coverage_status"] = str(metrics.get("coverage_status") or ("pass" if unmapped_count == 0 else "warn"))
        metrics["materialization_strategy"] = str(metrics.get("materialization_strategy") or "sidecar")
        metrics["sidecar_carrier_count"] = _int_metric(metrics.get("sidecar_carrier_count"), default=0)
        metrics["minimum_coverage_baseline_locked"] = bool(metrics.get("minimum_coverage_baseline_locked", False))
        return metrics

    def _artifact_payload(self, *, artifact_id: str, role: str, format_: str, path: Path) -> dict[str, Any]:
        return {
            "artifact_id": artifact_id,
            "role": role,
            "format": format_,
            "path": str(path),
            "url": self._artifact_url(path),
        }

    def _artifact_url(self, path: Path) -> str:
        try:
            relative = Path(path).resolve().relative_to(Path(self.settings.artifacts_root).resolve())
        except ValueError:
            relative = Path(path).name
        return f"{self.settings.public_artifacts_url.rstrip('/')}/{Path(relative).as_posix()}"

    def _callback_payload(self, job: Mapping[str, Any], result: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "event_type": "streaming_conversion_result",
            "authority": "bim-streaming-server",
            "correlation_id": job["correlation_id"],
            "tenant_id": job["tenant_id"],
            "project_id": job["project_id"],
            "model_version_id": job["model_version_id"],
            "conversion_job_id": job["conversion_job_id"],
            "status": result["status"],
            "result": result,
        }

    def _fail_job(self, job: Mapping[str, Any], *, code: str, message: str, stage: str) -> dict[str, Any]:
        result = {
            "conversion_job_id": job["conversion_job_id"],
            "authority": "bim-streaming-server",
            "status": "failed",
            "ready": False,
            "tenant_id": job["tenant_id"],
            "project_id": job["project_id"],
            "model_version_id": job["model_version_id"],
            "correlation_id": job["correlation_id"],
            "model": {
                "status": "failed",
                "format": "usdc",
                "url": None,
            },
            "artifacts": {},
            "quality_metrics": None,
            "lineage": {
                "source_rvt_artifact_id": job["source_rvt_artifact_id"],
                "ifc_artifact_id": job["ifc_artifact"]["artifact_id"],
            },
            "error": {
                "code": code,
                "message": message,
            },
        }
        callback_payload = self._callback_payload(job, result)
        callback_url = job.get("callback_url")
        return self._update_job(
            job["conversion_job_id"],
            status="failed",
            stage=stage,
            result=result,
            callback_payload=callback_payload,
            callback_delivery={
                "status": "pending" if callback_url else "skipped",
                "target_url": callback_url,
                "reason": "network delivery is performed by the service runtime loop"
                if callback_url
                else "no callback_url; coordinator polls /result, cloud callback is T5 outbox",
            },
        )

    def _find_job_by_idempotency_key(self, idempotency_key: str) -> dict[str, Any] | None:
        for path in sorted(Path(self.settings.jobs_dir).glob("stream_conv_*.json"), reverse=True):
            job = json.loads(path.read_text(encoding="utf-8"))
            if (job.get("idempotency_key") or job.get("event_id")) == idempotency_key:
                return job
        return None

    def _job_path(self, conversion_job_id: str) -> Path:
        _safe_id(conversion_job_id, "conversion_job_id")
        return Path(self.settings.jobs_dir) / f"{conversion_job_id}.json"

    def _write_job(self, job: Mapping[str, Any]) -> None:
        path = self._job_path(str(job["conversion_job_id"]))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(job, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    def _update_job(self, conversion_job_id: str, **updates: Any) -> dict[str, Any]:
        job = self.get_conversion_job(conversion_job_id)
        if job is None:
            raise KeyError(conversion_job_id)
        job.update(updates)
        job["updated_at"] = _utc_now()
        self._write_job(job)
        return job


def _ifc_artifact(event: Mapping[str, Any]) -> dict[str, Any]:
    raw = event.get("ifc_artifact")
    if not isinstance(raw, dict):
        raise ValueError("ifc_ready event must include ifc_artifact.")
    artifact_id = _safe_id(str(raw.get("artifact_id") or ""), "ifc_artifact_id")
    if str(raw.get("format") or "").lower() != "ifc":
        raise ValueError("ifc_artifact.format must be 'ifc'.")
    url = raw.get("url") or raw.get("file_url") or raw.get("signed_upload_reference")
    if not url:
        raise ValueError("ifc_artifact must include url, file_url, or signed_upload_reference.")
    return {
        "artifact_id": artifact_id,
        "format": "ifc",
        "filename": str(raw.get("filename") or "model.ifc"),
        "url": url,
        "checksum_sha256": raw.get("checksum_sha256"),
    }


def _safe_id(value: str, label: str) -> str:
    if not value or not SAFE_ID_RE.fullmatch(value):
        raise ValueError(f"Invalid {label}: {value}")
    return value


def _request_fingerprint(event: Mapping[str, Any]) -> str:
    stable_event = dict(event)
    stable_event.pop("event_id", None)
    stable_event.pop("idempotency_key", None)
    return json.dumps(stable_event, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _int_metric(*values: Any, default: int = 0) -> int:
    for value in values:
        if value is None:
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return default


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
