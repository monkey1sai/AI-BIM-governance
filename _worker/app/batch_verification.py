from __future__ import annotations

import base64
import multiprocessing as mp
from queue import Empty
from time import perf_counter
from typing import Any, Callable

from .dev_sources import list_dev_ifc_sources, resolve_dev_ifc_source
from .models import ArtifactIntakeRequest
from .settings import Settings
from .store import WorkerStore, read_json, utc_now, write_json


BATCH_PHASES = (
    "source_read",
    "artifact_intake",
    "conversion_total",
    "lineage_lookup",
)


def run_storage_batch_verification(
    settings: Settings,
    *,
    converter: Any | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    timeout_seconds: float | None = None,
    profile_source_entities: bool = False,
) -> dict[str, Any]:
    sources_payload = list_dev_ifc_sources(settings.dev_storage_root)
    root = sources_payload["root"]
    sources = list(sources_payload.get("items") or [])
    if not root.get("readable") or not sources:
        return {
            "status": "blocked",
            "blocked_reason": "storage_ifc_fixture_root_unavailable_or_empty",
            "root": root,
            "fixture_count": len(sources),
            "minimum_coverage_locked": False,
            "results": [],
        }

    selected_sources = sources
    partial = False
    if limit is not None and limit >= 0:
        selected_sources = sources[:limit]
        partial = limit < len(sources)
    if dry_run:
        return {
            "status": "partial",
            "blocked_reason": "dry_run_no_conversions_executed",
            "root": root,
            "fixture_count": len(sources),
            "selected_count": len(selected_sources),
            "minimum_coverage_locked": False,
            "results": [
                {
                    "filename": item["filename"],
                    "relative_path": item["relative_path"],
                    "size_bytes": item["size_bytes"],
                    "status": "partial",
                    "lineage_api_status": "not_run",
                    "duration_seconds": 0.0,
                    "phase_timings": _not_run_phase_timings(),
                    "warnings": ["dry_run_no_conversions_executed"],
                }
                for item in selected_sources
            ],
        }

    results: list[dict[str, Any]] = []
    failures = 0
    timed_out = 0
    locked_passes = 0
    for source_item in selected_sources:
        if timeout_seconds is not None and timeout_seconds > 0:
            record = _run_single_fixture_with_timeout(
                settings,
                source_item["source_id"],
                source_item,
                converter=converter,
                timeout_seconds=timeout_seconds,
                profile_source_entities=profile_source_entities,
            )
        else:
            record = _run_single_fixture(
                settings,
                source_item["source_id"],
                converter=converter,
                profile_source_entities=profile_source_entities,
            )

        if record.get("status") == "timed_out":
            timed_out += 1
        elif record.get("status") != "passed":
            failures += 1

        quality = record.get("quality_metrics") or {}
        if quality.get("minimum_coverage_baseline_locked") and quality.get("coverage_status") == "pass":
            locked_passes += 1
        results.append(record)

    if timed_out:
        status = "timed_out"
    elif partial:
        status = "partial"
    elif failures:
        status = "failed"
    else:
        status = "passed"

    return {
        "status": status,
        "root": root,
        "fixture_count": len(sources),
        "selected_count": len(selected_sources),
        "timeout_seconds": timeout_seconds,
        "minimum_coverage_locked": bool(
            status == "passed" and selected_sources and locked_passes == len(selected_sources)
        ),
        "failure_count": failures,
        "timed_out_count": timed_out,
        "results": results,
    }


def _run_single_fixture_with_timeout(
    settings: Settings,
    source_id: str,
    source_item: dict[str, Any],
    *,
    converter: Any | None,
    timeout_seconds: float,
    profile_source_entities: bool,
) -> dict[str, Any]:
    ctx = mp.get_context("spawn")
    queue = ctx.Queue()
    process = ctx.Process(
        target=_run_single_fixture_process,
        args=(settings, source_id, converter, profile_source_entities, queue),
    )
    started = perf_counter()
    process.start()
    process.join(timeout_seconds)
    messages = _drain_queue(queue)
    if process.is_alive():
        process.terminate()
        process.join(5)
        elapsed = perf_counter() - started
        partial = _last_progress(messages)
        phase_progress = _read_phase_progress(settings, partial)
        record = _timeout_record(
            source_item,
            timeout_seconds=timeout_seconds,
            elapsed_seconds=elapsed,
            partial=partial,
            phase_progress=phase_progress,
        )
        _mark_job_timed_out(settings, record)
        return record

    messages.extend(_drain_queue(queue))
    result = _last_result(messages)
    if result is not None:
        return result

    error = _last_error(messages)
    elapsed = perf_counter() - started
    record = {
        "filename": source_item["filename"],
        "relative_path": source_item["relative_path"],
        "size_bytes": source_item["size_bytes"],
        "status": "failed",
        "lineage_api_status": "not_run",
        "duration_seconds": elapsed,
        "phase_timings": _not_run_phase_timings(),
        "failure": error
        or {
            "code": "FixtureProcessFailed",
            "message": f"Fixture worker exited with code {process.exitcode}.",
        },
    }
    return record


def _run_single_fixture_process(
    settings: Settings,
    source_id: str,
    converter: Any | None,
    profile_source_entities: bool,
    queue: Any,
) -> None:
    try:
        record = _run_single_fixture(
            settings,
            source_id,
            converter=converter,
            profile_source_entities=profile_source_entities,
            progress=lambda payload: queue.put({"event": "progress", "payload": payload}),
        )
        queue.put({"event": "result", "payload": record})
    except BaseException as exc:  # pragma: no cover - defensive process boundary
        queue.put(
            {
                "event": "error",
                "payload": {"code": exc.__class__.__name__, "message": str(exc)},
            }
        )
        raise


def _run_single_fixture(
    settings: Settings,
    source_id: str,
    *,
    converter: Any | None,
    profile_source_entities: bool = False,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    started = perf_counter()
    phase_timings = _pending_phase_timings()
    store = WorkerStore(settings, converter=converter)
    source_path, resolved_item = resolve_dev_ifc_source(settings.dev_storage_root, source_id)
    record: dict[str, Any] = {
        "filename": resolved_item["filename"],
        "relative_path": resolved_item["relative_path"],
        "size_bytes": resolved_item["size_bytes"],
    }

    try:
        phase_started = perf_counter()
        source_bytes = source_path.read_bytes()
        phase_timings["source_read"] = _completed_timing(perf_counter() - phase_started)

        phase_started = perf_counter()
        source_artifact = store.create_source_artifact(
            ArtifactIntakeRequest(
                tenant_id="tenant_batch_verification",
                project_id="project_batch_verification",
                model_version_id="version_batch_verification",
                source_system="dev_storage",
                uploaded_by="batch_verification",
                filename=resolved_item["filename"],
                source_format="ifc",
                content_base64=base64.b64encode(source_bytes).decode("ascii"),
            )
        )
        phase_timings["artifact_intake"] = _completed_timing(perf_counter() - phase_started)
        _publish_progress(
            progress,
            phase="artifact_intake",
            source_artifact_id=source_artifact["source_artifact_id"],
            artifact_group_id=source_artifact["artifact_group_id"],
        )

        job = store.create_conversion_job(
            source_artifact["source_artifact_id"],
            {
                "target_format": "usdc",
                "generate_mapping": True,
                "profile_source_entity_enumeration": profile_source_entities,
            },
        )
        _publish_progress(
            progress,
            phase="conversion_total",
            source_artifact_id=source_artifact["source_artifact_id"],
            artifact_group_id=source_artifact["artifact_group_id"],
            conversion_job_id=job["conversion_job_id"],
        )
        phase_started = perf_counter()
        completed = store.complete_conversion_job(job["conversion_job_id"])
        phase_timings["conversion_total"] = _completed_timing(perf_counter() - phase_started)

        result = completed.get("result") or {}
        quality = result.get("quality_metrics") or {}
        phase_timings = _merge_phase_timings(phase_timings, quality.get("phase_timings"))

        lineage = None
        phase_started = perf_counter()
        if result.get("usdc_artifact_id"):
            lineage = store.get_artifact_lineage(result["usdc_artifact_id"])
        phase_timings["lineage_lookup"] = _completed_timing(perf_counter() - phase_started)

        group = store.get_artifact_group(source_artifact["artifact_group_id"]) or {}
        lineage_api_status = "ok" if lineage else "missing"
        status = _fixture_status(result, quality, lineage_api_status)
        record.update(
            {
                "status": status,
                "conversion_status": result.get("status", completed.get("status")),
                "source_artifact_id": source_artifact["source_artifact_id"],
                "artifact_group_id": source_artifact["artifact_group_id"],
                "conversion_job_id": job["conversion_job_id"],
                "derived_usdc_artifact_id": result.get("usdc_artifact_id"),
                "usdc_artifact_id": result.get("usdc_artifact_id"),
                "usdc_url": result.get("usdc_url"),
                "mapping_artifact_id": (result.get("derived_artifact_ids") or {}).get("element_mapping"),
                "mapping_url": result.get("mapping_url"),
                "readiness_state": {
                    "status": group.get("status"),
                    "ready_status": group.get("ready_status"),
                    "mapping_ready": bool((group.get("mapping") or {}).get("ready")),
                    "coverage_status": (group.get("mapping") or {}).get("coverage_status"),
                },
                "review_viewer_handoff": _review_viewer_handoff(result, group),
                "usdc_openability": (quality.get("hard_quality_gates") or {}).get("usdc_openable"),
                "source_ifc_entity_count": quality.get("source_ifc_entity_count"),
                "mapped_entity_count": quality.get("mapped_entity_count"),
                "unmapped_entity_count": quality.get("unmapped_entity_count"),
                "mapped_count": quality.get("mapped_count"),
                "unmapped_count": quality.get("unmapped_count"),
                "coverage_ratio": quality.get("coverage_ratio"),
                "minimum_coverage_ratio": quality.get("minimum_coverage_ratio"),
                "coverage_status": quality.get("coverage_status"),
                "lineage_api_status": lineage_api_status,
                "duration_seconds": perf_counter() - started,
                "phase_timings": phase_timings,
                "converter": result.get("converter"),
                "output_file_size_bytes": quality.get("output_file_size_bytes"),
                "quality_metrics": quality,
                "warnings": result.get("warnings") or [],
                "failure": result.get("error") if status != "passed" else None,
                "original_filename": result.get("original_filename"),
            }
        )
    except Exception as exc:
        record.update(
            {
                "status": "failed",
                "lineage_api_status": "not_run",
                "duration_seconds": perf_counter() - started,
                "phase_timings": phase_timings,
                "failure": {"code": exc.__class__.__name__, "message": str(exc)},
            }
        )
    return record


def _fixture_status(result: dict[str, Any], quality: dict[str, Any], lineage_api_status: str) -> str:
    if result.get("status") != "succeeded":
        return "failed"
    gates = quality.get("hard_quality_gates") or {}
    if gates.get("usdc_openable") is False or gates.get("has_renderable_prims") is False:
        return "failed"
    if quality.get("coverage_status") == "fail":
        return "failed"
    if lineage_api_status != "ok":
        return "failed"
    return "passed"


def _review_viewer_handoff(result: dict[str, Any], group: dict[str, Any]) -> dict[str, Any] | None:
    if not result.get("usdc_url") or not result.get("artifact_group_id"):
        return None
    params = {
        "artifact_group_id": result["artifact_group_id"],
        "model_version_id": result.get("model_version_id"),
        "conversion_job_id": result.get("conversion_job_id"),
        "source_artifact_id": result.get("source_artifact_id"),
        "usdc_artifact_id": result.get("usdc_artifact_id"),
        "mapping_artifact_id": (result.get("derived_artifact_ids") or {}).get("element_mapping"),
        "usdc_url": result.get("usdc_url"),
        "mapping_url": result.get("mapping_url"),
        "ready_status": group.get("ready_status"),
        "coverage_status": ((group.get("mapping") or {}).get("coverage_status")),
    }
    return {
        "target": "bim-review-coordinator",
        "url": "http://127.0.0.1:8004",
        "params": {key: value for key, value in params.items() if value is not None},
    }


def _timeout_record(
    source_item: dict[str, Any],
    *,
    timeout_seconds: float,
    elapsed_seconds: float,
    partial: dict[str, Any] | None,
    phase_progress: dict[str, Any] | None,
) -> dict[str, Any]:
    partial = partial or {}
    phase_progress = phase_progress or {}
    last_phase = phase_progress.get("current_phase") or partial.get("phase") or "fixture_process"
    last_phase_timing = (phase_progress.get("phase_timings") or {}).get(last_phase) or {}
    last_phase_details = last_phase_timing.get("details") if isinstance(last_phase_timing, dict) else None
    diagnostics = {
        "phase": last_phase,
        "converter_phase_status": phase_progress.get("status"),
        "message": "Fixture exceeded configured per-fixture timeout before completion.",
    }
    if isinstance(last_phase_details, dict):
        diagnostics["details"] = last_phase_details
    return {
        "filename": source_item["filename"],
        "relative_path": source_item["relative_path"],
        "size_bytes": source_item["size_bytes"],
        "status": "timed_out",
        "lineage_api_status": "not_run",
        "duration_seconds": elapsed_seconds,
        "timeout_seconds": timeout_seconds,
        "source_artifact_id": partial.get("source_artifact_id"),
        "artifact_group_id": partial.get("artifact_group_id"),
        "conversion_job_id": partial.get("conversion_job_id"),
        "phase_timings": _timeout_phase_timings(
            last_phase,
            phase_progress.get("phase_timings"),
            intake_completed=bool(partial.get("source_artifact_id")),
        ),
        "last_known_phase_diagnostics": diagnostics,
        "failure": {
            "code": "FixtureTimedOut",
            "message": f"Fixture exceeded configured timeout of {timeout_seconds} seconds.",
        },
        "warnings": ["fixture_timed_out_before_conversion_result"],
    }


def _read_phase_progress(settings: Settings, partial: dict[str, Any] | None) -> dict[str, Any] | None:
    conversion_job_id = (partial or {}).get("conversion_job_id")
    if not conversion_job_id:
        return None
    payload = read_json(settings.jobs_dir / f"{conversion_job_id}.phase.json", None)
    return payload if isinstance(payload, dict) else None


def _mark_job_timed_out(settings: Settings, record: dict[str, Any]) -> None:
    conversion_job_id = record.get("conversion_job_id")
    if not conversion_job_id:
        return
    job_path = settings.jobs_dir / f"{conversion_job_id}.json"
    job = read_json(job_path, None)
    if not isinstance(job, dict):
        return
    job["status"] = "failed"
    job["stage"] = "timed_out"
    job["updated_at"] = utc_now()
    job["result"] = {
        "conversion_job_id": conversion_job_id,
        "job_id": conversion_job_id,
        "status": "timed_out",
        "ready": False,
        "artifact_group_id": record.get("artifact_group_id"),
        "source_artifact_id": record.get("source_artifact_id"),
        "usdc_url": None,
        "mapping_url": None,
        "error": record["failure"],
        "timeout_seconds": record.get("timeout_seconds"),
        "duration_seconds": record.get("duration_seconds"),
        "last_known_phase_diagnostics": record.get("last_known_phase_diagnostics"),
    }
    warnings = list(job.get("warnings") or [])
    warnings.append(record["failure"]["message"])
    job["warnings"] = warnings
    write_json(job_path, job)


def _pending_phase_timings() -> dict[str, dict[str, Any]]:
    return {
        phase: {
            "status": "not_reached",
            "duration_seconds": None,
            "diagnostic": "phase_not_reached",
        }
        for phase in BATCH_PHASES
    }


def _not_run_phase_timings() -> dict[str, dict[str, Any]]:
    return {
        phase: {
            "status": "not_run",
            "duration_seconds": None,
            "diagnostic": "dry_run_no_conversions_executed",
        }
        for phase in BATCH_PHASES
    }


def _timeout_phase_timings(
    last_phase: str,
    progress_timings: Any = None,
    *,
    intake_completed: bool = False,
) -> dict[str, dict[str, Any]]:
    timings = _merge_phase_timings(_pending_phase_timings(), progress_timings)
    if intake_completed:
        timings["source_read"] = _completed_unmeasured_timing("completed_before_timeout")
        timings["artifact_intake"] = _completed_unmeasured_timing("completed_before_timeout")
    if last_phase in timings:
        existing = timings.get(last_phase) or {}
        timing = {
            "status": "timed_out",
            "duration_seconds": None,
            "diagnostic": "fixture_timed_out_during_phase",
        }
        if isinstance(existing, dict) and isinstance(existing.get("details"), dict):
            timing["details"] = existing["details"]
        timings[last_phase] = {
            **timing,
        }
    else:
        timings["conversion_total"] = {
            "status": "timed_out",
            "duration_seconds": None,
            "diagnostic": f"fixture_timed_out_after_{last_phase}",
        }
    return timings


def _completed_timing(duration_seconds: float) -> dict[str, Any]:
    return {
        "status": "completed",
        "duration_seconds": duration_seconds,
    }


def _completed_unmeasured_timing(diagnostic: str) -> dict[str, Any]:
    return {
        "status": "completed",
        "duration_seconds": None,
        "diagnostic": diagnostic,
    }


def _merge_phase_timings(
    base: dict[str, dict[str, Any]],
    extra: Any,
) -> dict[str, dict[str, Any]]:
    merged = dict(base)
    if isinstance(extra, dict):
        for phase, value in extra.items():
            if isinstance(value, dict):
                merged[str(phase)] = value
    return merged


def _publish_progress(
    progress: Callable[[dict[str, Any]], None] | None,
    **payload: Any,
) -> None:
    if progress is None:
        return
    progress(payload)


def _drain_queue(queue: Any) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    while True:
        try:
            messages.append(queue.get_nowait())
        except Empty:
            return messages


def _last_progress(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for message in reversed(messages):
        if message.get("event") == "progress":
            payload = message.get("payload")
            if isinstance(payload, dict):
                return payload
    return None


def _last_result(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for message in reversed(messages):
        if message.get("event") == "result":
            payload = message.get("payload")
            if isinstance(payload, dict):
                return payload
    return None


def _last_error(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for message in reversed(messages):
        if message.get("event") == "error":
            payload = message.get("payload")
            if isinstance(payload, dict):
                return payload
    return None
