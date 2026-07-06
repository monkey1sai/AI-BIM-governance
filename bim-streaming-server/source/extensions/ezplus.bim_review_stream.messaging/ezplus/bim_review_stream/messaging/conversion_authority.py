from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import json
import re
import threading
from typing import Any, Mapping
from uuid import uuid4


SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
CONVERSION_API_ENDPOINTS = {
    "create": "POST /api/conversions/ifc-to-usdc",
    "list": "GET /api/conversions",
    "status": "GET /api/conversions/{conversion_job_id}",
    "result": "GET /api/conversions/{conversion_job_id}/result",
}
CONVERSION_STATUSES = ("queued", "running", "succeeded", "succeeded_with_warnings", "failed", "cancelled")
CONVERSION_STAGES = ("queued", "running_headless_converter", "done", "conversion_failed", "cancelled")
# Single source of truth for placeholder-output detection. Shared with the
# worker adapter (imports `_PLACEHOLDER_MARKERS` from here) so the "looks like a
# placeholder USDC" rule cannot drift between producer and authority gate.
_PLACEHOLDER_MARKERS = (b"placeholder",)


class ConversionAuthorityError(RuntimeError):
    def __init__(self, code: str, message: str, metadata: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        # streaming-server-capture-kit-conversion-logs:optional diagnostic context
        # (e.g. kit_stdout_log / kit_stderr_log file paths from PowerShell wrapper),
        # surfaced through host_native_conversion_service into result.error dict.
        self.metadata: dict = metadata or {}


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
    def preflight(self) -> None:
        raise ConversionAuthorityError(
            "converter_unavailable",
            "Headless IFC to USDC converter is not configured for this process.",
        )

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

    # harden-internal-auth-and-config-hygiene #2: these read-only GET handlers
    # (list / {id} / {id}/result, plus the artifacts served via
    # `public_artifacts_url`) are intentionally NOT token-protected. Their trust
    # boundary is the loopback-only binding — the host-native service defaults to
    # `DEFAULT_HOST=127.0.0.1` (see host_native_conversion_service.py), so only
    # local callers (the coordinator polling /result) can reach them. The write
    # path (POST /api/conversions/ifc-to-usdc) already enforces
    # `internal_conversion_token` above for defense-in-depth. If
    # `STREAMING_CONVERSION_HOST` is ever set to a non-loopback address, these
    # GET / artifacts paths should also be put behind token protection, since the
    # loopback assumption that makes them safe no longer holds.
    @app.get("/api/conversions")
    def list_conversions(
        model_version_id: str | None = None,
        status: str | None = None,
        ready: bool | None = None,
        limit: int = 50,
    ):
        try:
            items = store.list_conversion_results(
                model_version_id=model_version_id,
                status=status,
                ready=ready,
                limit=limit,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"items": items, "count": len(items)}

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

    @app.get("/health")
    def health():
        """Conversion-only identity, honestly reported.

        This host-native service owns IFC->USDC conversion only. It MUST NOT
        claim WebRTC (`49100`), Kit launcher, or viewport readiness; those are
        separately health-checked tiers (see demo-runtime-readiness-smoke spec).

        `ifc_to_usdc_conversion` reflects a real converter preflight rather than
        a hard-coded `True`: if the converter cannot be reached (or exposes no
        preflight), we report `status="degraded"` with `ifc_to_usdc_conversion`
        False and a `reason` string, while keeping HTTP 200 so the readiness
        smoke can distinguish "process up" from "conversion actually available".
        """
        converter = store.converter
        preflight = getattr(converter, "preflight", None)
        if callable(preflight):
            try:
                preflight()
            except ConversionAuthorityError as exc:
                status = "degraded"
                conversion_ready = False
                # message 為主、code 為輔:degraded reason 要給 operator 可行動的
                # blocker 文字,而非只回錯誤碼(code 恆非空會蓋掉 message)。
                reason: str | None = exc.message or exc.code
            except Exception as exc:  # noqa: BLE001 - /health 為 introspection,不應因 converter 異常回 500
                status = "degraded"
                conversion_ready = False
                reason = f"preflight raised {type(exc).__name__}: {exc}"
            else:
                status = "ok"
                conversion_ready = True
                reason = None
        else:
            status = "degraded"
            conversion_ready = False
            reason = "converter exposes no preflight"
        payload = {
            "status": status,
            "authority": "bim-streaming-server",
            "service": "host-native-conversion-authority",
            "role": "conversion-only",
            "ifc_to_usdc_conversion": conversion_ready,
            "endpoints": CONVERSION_API_ENDPOINTS,
            "claims": {
                "ifc_to_usdc_conversion": conversion_ready,
                "webrtc_49100": False,
                "kit_launcher": False,
                "viewport_render": False,
            },
        }
        if reason is not None:
            payload["reason"] = reason
        return payload

    return app


class StreamingConversionStore:
    def __init__(self, *, settings: ConversionAuthoritySettings, converter: Any | None = None):
        self.settings = settings
        self.converter = converter or HeadlessConverterNotConfigured()
        Path(self.settings.artifacts_root).mkdir(parents=True, exist_ok=True)
        Path(self.settings.jobs_dir).mkdir(parents=True, exist_ok=True)
        # conversion-kit-port-race: `/api/conversions/ifc-to-usdc` returns 202 and
        # runs complete_conversion_job() via FastAPI BackgroundTasks, so concurrent
        # requests get independent background tasks with no inherent mutual
        # exclusion. Each job's Kit CAD-conversion subprocess binds the same
        # default port (omni.services.transport.server.http, 8011) for an HTTP
        # service the headless `--exec` conversion never uses; two Kit subprocesses
        # launched close together race for that port and the loser crashes. This
        # lock forces actual conversion execution (not just dispatch acceptance)
        # to run one job at a time within this process.
        self._conversion_lock = threading.Lock()

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
            "export_job_id": _safe_optional_id(event.get("export_job_id"), "export_job_id"),
            "source_rvt_artifact_id": _safe_optional_id(
                event.get("source_rvt_artifact_id"), "source_rvt_artifact_id"
            ),
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
        job = self._get_conversion_job_raw(conversion_job_id)
        return self._project_job_for_read(job) if job is not None else None

    def _get_conversion_job_raw(self, conversion_job_id: str) -> dict[str, Any] | None:
        _safe_id(conversion_job_id, "conversion_job_id")
        path = self._job_path(conversion_job_id)
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def list_conversion_results(
        self,
        *,
        model_version_id: str | None = None,
        status: str | None = None,
        ready: bool | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        if model_version_id:
            _safe_id(model_version_id, "model_version_id")
        if status and status not in CONVERSION_STATUSES:
            raise ValueError(f"Invalid conversion status: {status}")
        if limit < 1:
            raise ValueError("limit must be greater than zero.")
        max_limit = min(limit, 200)
        jobs = []
        for path in Path(self.settings.jobs_dir).glob("stream_conv_*.json"):
            job = self._project_job_for_read(json.loads(path.read_text(encoding="utf-8")))
            if model_version_id and job.get("model_version_id") != model_version_id:
                continue
            result = job.get("result") or {}
            result_status = result.get("status") or job.get("status")
            if status and result_status != status:
                continue
            result_ready = bool(result.get("ready", False))
            if ready is not None and result_ready is not ready:
                continue
            jobs.append(job)

        jobs.sort(key=lambda job: (str(job.get("created_at") or ""), str(job.get("conversion_job_id") or "")), reverse=True)
        return [self._conversion_result_list_item(job) for job in jobs[:max_limit]]

    def complete_conversion_job(self, conversion_job_id: str) -> dict[str, Any]:
        job = self._get_conversion_job_raw(conversion_job_id)
        if job is None:
            raise KeyError(conversion_job_id)
        if job.get("status") not in {"queued", "running"}:
            return job

        # conversion-kit-port-race: serialize actual Kit CAD-conversion execution
        # across concurrently-accepted jobs (see lock comment in __init__). Jobs
        # waiting on the lock stay "queued" and only flip to "running" once they
        # actually start, so status faithfully reflects what's really executing.
        with self._conversion_lock:
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
                return self._fail_job(
                    job,
                    code=exc.code,
                    message=exc.message,
                    stage="conversion_failed",
                    metadata=exc.metadata,
                )
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
        optional_artifacts = self._optional_artifact_payloads(
            suffix=suffix,
            converter_result=converter_result,
        )
        artifacts.update(optional_artifacts)
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
        for artifact in optional_artifacts.values():
            lineage["relations"].append(
                {
                    "from": artifacts["model_usdc"]["artifact_id"],
                    "to": artifact["artifact_id"],
                    "type": "has_sidecar",
                }
            )
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
            "source_ifc_filename": job["ifc_artifact"].get("filename"),
            "usdc_url": artifacts["model_usdc"]["url"],
            "mapping_url": artifacts["element_mapping"]["url"],
            "manifest_url": artifacts["metadata"]["url"],
            "artifacts": artifacts,
            "quality_metrics": quality_metrics,
            "lineage": lineage,
        }

    def _optional_artifact_payloads(
        self,
        *,
        suffix: str,
        converter_result: Mapping[str, Any],
    ) -> dict[str, dict[str, Any]]:
        optional_specs = {
            "pset_index": ("pset_index_path", "json"),
            "spatial_index": ("spatial_index_path", "json"),
            "bbox_index": ("bbox_index_path", "json"),
            "quality_metrics": ("quality_metrics_path", "json"),
            "geo_reference": ("geo_reference_path", None),
        }
        artifacts: dict[str, dict[str, Any]] = {}
        for role, (key, explicit_format) in optional_specs.items():
            value = converter_result.get(key)
            if not value:
                continue
            path = Path(value)
            if not path.is_file():
                raise ConversionAuthorityError(
                    "missing_output",
                    f"Converter optional artifact does not exist: {key}={path}",
                )
            format_ = explicit_format or ("usda" if path.suffix.lower() == ".usda" else "json")
            artifacts[role] = self._artifact_payload(
                artifact_id=f"artifact_stream_{role}_{suffix}",
                role=role,
                format_=format_,
                path=path,
            )
        return artifacts

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
        model_bytes = output_paths["model_path"].read_bytes().lower()
        if any(marker in model_bytes for marker in _PLACEHOLDER_MARKERS):
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

    def _fail_job(
        self,
        job: Mapping[str, Any],
        *,
        code: str,
        message: str,
        stage: str,
        metadata: dict | None = None,
    ) -> dict[str, Any]:
        # streaming-server-capture-kit-conversion-logs §3:把
        # ConversionAuthorityError.metadata 的 diagnostic keys(kit_stdout_log /
        # kit_stderr_log 等)merge 進 error dict,讓 GET /result caller 直接拿到
        # host fs log file path 去 tail。callback outbox 仍 metadata-only,log
        # 本身不會被 forward(per conversion-webhook-lifecycle).
        error_dict: dict[str, Any] = {
            "code": code,
            "message": message,
        }
        if metadata:
            for key, value in metadata.items():
                if key not in error_dict:
                    error_dict[key] = value
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
            "error": error_dict,
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
        job = self._get_conversion_job_raw(conversion_job_id)
        if job is None:
            raise KeyError(conversion_job_id)
        job.update(updates)
        job["updated_at"] = _utc_now()
        self._write_job(job)
        return job

    def _project_job_for_read(self, job: Mapping[str, Any]) -> dict[str, Any]:
        projected = dict(job)
        result = projected.get("result")
        if not isinstance(result, dict) or not self._result_claims_ready(result):
            return projected

        missing = self._missing_ready_artifacts(projected, result)
        if not missing:
            return projected

        projected_result = dict(result)
        model = dict(projected_result.get("model") or {})
        error = dict(projected_result.get("error") or {})
        original_status = projected_result.get("status")
        projected_result["ready"] = False
        projected_result["status"] = "failed"
        model["status"] = "failed"
        projected_result["model"] = model
        error.update(
            {
                "code": "artifact_missing",
                "message": "Published conversion result is missing required artifacts.",
                "missing_artifacts": missing,
                "original_status": original_status,
            }
        )
        projected_result["error"] = error
        projected["status"] = "failed"
        projected["stage"] = "artifact_missing"
        projected["result"] = projected_result

        callback_payload = projected.get("callback_payload")
        if isinstance(callback_payload, dict):
            projected_callback = dict(callback_payload)
            projected_callback["status"] = "failed"
            projected_callback["result"] = projected_result
            projected["callback_payload"] = projected_callback
        return projected

    def _result_claims_ready(self, result: Mapping[str, Any]) -> bool:
        model = result.get("model") if isinstance(result.get("model"), dict) else {}
        return (
            result.get("ready") is True
            or result.get("status") in {"succeeded", "succeeded_with_warnings"}
            or model.get("status") == "ready"
        )

    def _missing_ready_artifacts(self, job: Mapping[str, Any], result: Mapping[str, Any]) -> list[dict[str, str]]:
        artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
        requested_outputs = {
            str(output)
            for output in (job.get("requested_outputs") or [])
            if output is not None
        }
        required_roles = ["model_usdc", "metadata"]
        requested_role_map = {
            "element_mapping": "element_mapping",
            "mapping": "element_mapping",
            "entity_index": "entity_index",
        }
        for output, role in requested_role_map.items():
            if output in requested_outputs and role not in required_roles:
                required_roles.append(role)

        missing: list[dict[str, str]] = []
        for role in required_roles:
            entry = artifacts.get(role) if isinstance(artifacts.get(role), dict) else None
            raw_path = entry.get("path") if entry else None
            if not raw_path:
                missing.append({"role": role, "reason": "artifact_path_missing"})
                continue
            path = Path(str(raw_path))
            if not path.is_file():
                missing.append({"role": role, "reason": "artifact_file_missing", "path": str(path)})
                continue
            if not self._artifact_is_serveable(str(job.get("conversion_job_id") or ""), path, entry):
                missing.append({"role": role, "reason": "artifact_unserveable", "path": str(path)})
        return missing

    def _artifact_is_serveable(self, conversion_job_id: str, path: Path, entry: Mapping[str, Any]) -> bool:
        try:
            relative = path.resolve().relative_to(Path(self.settings.artifacts_root).resolve())
        except ValueError:
            return False
        if len(relative.parts) != 2 or relative.parts[0] != conversion_job_id:
            return False
        expected_url = f"{self.settings.public_artifacts_url.rstrip('/')}/{relative.as_posix()}"
        return entry.get("url") == expected_url

    def _conversion_result_list_item(self, job: Mapping[str, Any]) -> dict[str, Any]:
        result = dict(job.get("result") or {})
        if not result:
            result = {
                "conversion_job_id": job.get("conversion_job_id"),
                "authority": job.get("authority", "bim-streaming-server"),
                "status": job.get("status", "unknown"),
                "ready": False,
                "tenant_id": job.get("tenant_id"),
                "project_id": job.get("project_id"),
                "model_version_id": job.get("model_version_id"),
                "correlation_id": job.get("correlation_id"),
            }
        ifc_artifact = job.get("ifc_artifact") if isinstance(job.get("ifc_artifact"), dict) else {}
        artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
        model_artifact = artifacts.get("model_usdc") if isinstance(artifacts.get("model_usdc"), dict) else {}
        mapping_artifact = artifacts.get("element_mapping") if isinstance(artifacts.get("element_mapping"), dict) else {}
        metadata_artifact = artifacts.get("metadata") if isinstance(artifacts.get("metadata"), dict) else {}
        result.setdefault("source_ifc_filename", ifc_artifact.get("filename"))
        result.setdefault("usdc_url", result.get("model", {}).get("url") if isinstance(result.get("model"), dict) else None)
        result.setdefault("mapping_url", mapping_artifact.get("url"))
        result.setdefault("manifest_url", metadata_artifact.get("url"))
        result.setdefault("artifact_id", model_artifact.get("artifact_id"))
        result.setdefault("artifact_group_id", f"ag_{job.get('model_version_id')}_{job.get('conversion_job_id')}")
        return result


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
    local_path = raw.get("local_path")
    host_local_path = raw.get("host_local_path")
    return {
        "artifact_id": artifact_id,
        "format": "ifc",
        "filename": str(raw.get("filename") or "model.ifc"),
        "url": url,
        "checksum_sha256": raw.get("checksum_sha256"),
        "local_path": str(local_path) if local_path else None,
        "host_local_path": str(host_local_path) if host_local_path else None,
    }


def _safe_id(value: str, label: str) -> str:
    if not value or not SAFE_ID_RE.fullmatch(value):
        raise ValueError(f"Invalid {label}: {value}")
    return value


def _safe_optional_id(value: Any, label: str) -> str | None:
    if value is None or str(value) == "":
        return None
    return _safe_id(str(value), label)


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
