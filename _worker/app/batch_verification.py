from __future__ import annotations

import base64
from time import perf_counter
from typing import Any

from .dev_sources import list_dev_ifc_sources, resolve_dev_ifc_source
from .models import ArtifactIntakeRequest
from .settings import Settings
from .store import WorkerStore


def run_storage_batch_verification(
    settings: Settings,
    *,
    converter: Any | None = None,
    limit: int | None = None,
    dry_run: bool = False,
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
                    "status": "not_run",
                    "lineage_api_status": "not_run",
                }
                for item in selected_sources
            ],
        }

    store = WorkerStore(settings, converter=converter)
    results: list[dict[str, Any]] = []
    failures = 0
    locked_passes = 0
    for source_item in selected_sources:
        started = perf_counter()
        record: dict[str, Any] = {
            "filename": source_item["filename"],
            "relative_path": source_item["relative_path"],
            "size_bytes": source_item["size_bytes"],
        }
        try:
            source_path, resolved_item = resolve_dev_ifc_source(settings.dev_storage_root, source_item["source_id"])
            source_artifact = store.create_source_artifact(
                ArtifactIntakeRequest(
                    tenant_id="tenant_batch_verification",
                    project_id="project_batch_verification",
                    model_version_id="version_batch_verification",
                    source_system="dev_storage",
                    uploaded_by="batch_verification",
                    filename=resolved_item["filename"],
                    source_format="ifc",
                    content_base64=base64.b64encode(source_path.read_bytes()).decode("ascii"),
                )
            )
            job = store.create_conversion_job(
                source_artifact["source_artifact_id"],
                {"target_format": "usdc", "generate_mapping": True},
            )
            completed = store.complete_conversion_job(job["conversion_job_id"])
            result = completed.get("result") or {}
            quality = result.get("quality_metrics") or {}
            lineage = None
            if result.get("usdc_artifact_id"):
                lineage = store.get_artifact_lineage(result["usdc_artifact_id"])
            coverage_locked = bool(quality.get("minimum_coverage_baseline_locked"))
            coverage_passed = quality.get("coverage_status") == "pass"
            if coverage_locked and coverage_passed:
                locked_passes += 1
            record.update(
                {
                    "status": result.get("status", completed.get("status")),
                    "source_artifact_id": source_artifact["source_artifact_id"],
                    "artifact_group_id": source_artifact["artifact_group_id"],
                    "conversion_job_id": job["conversion_job_id"],
                    "usdc_openability": (quality.get("hard_quality_gates") or {}).get("usdc_openable"),
                    "source_ifc_entity_count": quality.get("source_ifc_entity_count"),
                    "mapped_entity_count": quality.get("mapped_entity_count"),
                    "unmapped_entity_count": quality.get("unmapped_entity_count"),
                    "mapped_count": quality.get("mapped_count"),
                    "unmapped_count": quality.get("unmapped_count"),
                    "coverage_ratio": quality.get("coverage_ratio"),
                    "minimum_coverage_ratio": quality.get("minimum_coverage_ratio"),
                    "coverage_status": quality.get("coverage_status"),
                    "lineage_api_status": "ok" if lineage else "missing",
                    "duration_seconds": perf_counter() - started,
                    "warnings": result.get("warnings") or [],
                    "failure": result.get("error"),
                    "original_filename": result.get("original_filename"),
                }
            )
            if result.get("status") != "succeeded":
                failures += 1
        except Exception as exc:
            failures += 1
            record.update(
                {
                    "status": "failed",
                    "lineage_api_status": "not_run",
                    "duration_seconds": perf_counter() - started,
                    "failure": {"code": exc.__class__.__name__, "message": str(exc)},
                }
            )
        results.append(record)

    if partial:
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
        "minimum_coverage_locked": bool(
            not partial and not failures and selected_sources and locked_passes == len(selected_sources)
        ),
        "failure_count": failures,
        "results": results,
    }
