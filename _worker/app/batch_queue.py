"""Persisted, resumable canonical batch queue (manifest-as-index).

M.1 scope: only `enqueue` (build/refresh a standalone `batch_queue.json`) and
`status` (read-only progress). No dispatch, no retention, no change to the
existing monolithic batch path or `_compute_outcome_distribution`. The schema is
forward-compatible with the full design (Decision 1) so later sections extend
rows in place rather than rewriting the file.
"""

from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
import shutil
from typing import Any

from .batch_verification import (
    _compute_minimum_coverage_locked,
    _compute_outcome_distribution,
    _fixture_outcome_bucket,
    _run_single_fixture_with_timeout,
)
from .dev_sources import list_dev_ifc_sources, resolve_dev_ifc_source
from .settings import Settings
from .store import read_json


MANIFEST_VERSION = 1

# Retention strategy A (design Decision 3 / task 5.1), scoped to the canonical
# verification scratch tenant ONLY. The giant per-entity arrays are dropped once
# coverage is computed; the runtime + audit artifacts are kept.
SCRATCH_TENANT = "tenant_batch_verification"
RETENTION_DROP = ("ifc_index.json", "element_mapping.json", "entity_index.json")
RETENTION_KEEP = ("model.usdc", "usd_index.json", "metadata.json")
RETENTION_CLASS = "post_coverage_strategy_a"

# Terminal outcomes a row can carry (design Decision 2 / tasks 2.1, 3.x).
# M.1 only ever writes `pending`; the dispatch sections add the rest.
TERMINAL_STATUSES = frozenset(
    {"passed", "passed_with_quality_warning", "failed", "timed_out"}
)
QUEUE_STATUSES = frozenset({"pending", "running"} | set(TERMINAL_STATUSES))


def batch_queue_path(settings: Settings) -> Path:
    return Path(settings.batch_queue_path)


def read_batch_queue(path: Path | str) -> dict[str, Any] | None:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    data = json.loads(raw)
    return data if isinstance(data, dict) else None


def write_batch_queue(path: Path | str, manifest: dict[str, Any]) -> None:
    """Atomic write (temp + os.replace).

    Short write-then-rename on the same filesystem root-fixes the predecessor's
    Windows `.tmp`-rename PermissionError under git/AV watch (design Decision 4).
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(tmp, target)


def _new_row(source: dict[str, Any]) -> dict[str, Any]:
    # Full manifest-as-index row schema (design Decision 1 / task 2.1). The
    # dispatch + retention sections populate the optional containers in place;
    # enqueue only ever writes the `pending` skeleton.
    return {
        "source_id": source["source_id"],
        "filename": source["filename"],
        "relative_path": source["relative_path"],
        "size_bytes": source["size_bytes"],
        "modified_at": source.get("modified_at"),
        "status": "pending",
        "conversion_job_id": None,
        "artifact_group_id": None,
        "retained_paths": {},
        "retention_class": None,
        "coverage_summary": {},
        "history": [],
    }


def enqueue_batch_queue(settings: Settings) -> dict[str, Any]:
    """Build/refresh the manifest from the dev IFC source listing.

    Idempotent: a row that already exists (any status, including a recorded
    terminal outcome) is preserved — only its non-authoritative descriptors are
    refreshed; the recorded `status`/`history` are never overwritten. Genuinely
    new fixtures are added as `pending`. Rows whose source disappeared are kept
    (manifest-as-index is a durable record, not a directory mirror).
    """
    listing = list_dev_ifc_sources(settings.dev_storage_root)
    root = listing["root"]
    sources = list(listing.get("items") or [])

    path = batch_queue_path(settings)
    existing = read_batch_queue(path)
    now = datetime.now(UTC).isoformat()

    by_id: dict[str, dict[str, Any]] = {}
    created_at = now
    if isinstance(existing, dict):
        created_at = existing.get("created_at") or now
        for row in existing.get("fixtures") or []:
            if isinstance(row, dict) and row.get("source_id"):
                by_id[row["source_id"]] = row

    for source in sources:
        sid = source["source_id"]
        if sid in by_id:
            row = by_id[sid]
            row["filename"] = source["filename"]
            row["relative_path"] = source["relative_path"]
            row["size_bytes"] = source["size_bytes"]
            row["modified_at"] = source.get("modified_at")
        else:
            by_id[sid] = _new_row(source)

    fixtures = sorted(
        by_id.values(), key=lambda r: str(r.get("relative_path", "")).casefold()
    )
    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "root": root,
        "created_at": created_at,
        "updated_at": now,
        "fixtures": fixtures,
    }
    write_batch_queue(path, manifest)
    return manifest


def _count_by_status(fixtures: list[dict[str, Any]]) -> dict[str, int]:
    counts = {status: 0 for status in sorted(QUEUE_STATUSES)}
    for row in fixtures:
        status = row.get("status")
        if status in counts:
            counts[status] += 1
    return counts


def batch_queue_status(settings: Settings) -> dict[str, Any]:
    path = batch_queue_path(settings)
    manifest = read_batch_queue(path)
    if manifest is None:
        return {
            "manifest_path": str(path),
            "exists": False,
            "message": "batch_queue.json not found; run --enqueue first.",
        }
    fixtures = [r for r in manifest.get("fixtures") or [] if isinstance(r, dict)]
    counts = _count_by_status(fixtures)
    total = len(fixtures)
    pending_remaining = counts.get("pending", 0) + counts.get("running", 0)
    return {
        "manifest_path": str(path),
        "exists": True,
        "manifest_version": manifest.get("manifest_version"),
        "created_at": manifest.get("created_at"),
        "updated_at": manifest.get("updated_at"),
        "total": total,
        "counts": counts,
        "pending_remaining": pending_remaining,
        "all_dispatched": total > 0 and pending_remaining == 0,
        "retained_paths_drift": _retained_paths_drift(fixtures),
    }


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _fixtures(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    return [r for r in manifest.get("fixtures") or [] if isinstance(r, dict)]


def _coverage_summary_from_record(record: dict[str, Any]) -> dict[str, Any]:
    """Minimal record shape consumed by `_compute_outcome_distribution` /
    `_compute_minimum_coverage_locked`, so `--summary` reuses the predecessor's
    bucket + lock-gate functions verbatim (design Decision 5/8)."""
    quality = record.get("quality_metrics") or {}
    return {
        "status": record.get("status"),
        "coverage_status": record.get("coverage_status"),
        "quality_metrics": {
            "minimum_coverage_baseline_locked": bool(
                quality.get("minimum_coverage_baseline_locked")
            ),
            "coverage_status": quality.get("coverage_status"),
        },
    }


def _derived_dir_for_record(settings: Settings, record: dict[str, Any]) -> Path | None:
    job_id = record.get("conversion_job_id")
    if not job_id:
        return None
    job = read_json(Path(settings.jobs_dir) / f"{job_id}.json", None)
    prefix = (((job or {}).get("result") or {}).get("lineage") or {}).get(
        "derived_object_prefix"
    )
    if not prefix:
        return None
    return Path(settings.objects_root) / prefix


def _is_scratch_tenant_path(derived_dir: Path, objects_root: Path | str) -> bool:
    """True only when derived_dir is under <objects_root>/tenants/<SCRATCH_TENANT>/.

    The retention safety boundary (task 5.2): a non-scratch tenant path is never
    pruned, even if a caller mislabels it.
    """
    try:
        rel = derived_dir.resolve().relative_to(Path(objects_root).resolve())
    except ValueError:
        return False
    parts = rel.parts
    return len(parts) >= 2 and parts[0] == "tenants" and parts[1] == SCRATCH_TENANT


def apply_post_coverage_retention(
    settings: Settings, record: dict[str, Any]
) -> dict[str, Any]:
    """Drop the giant per-entity arrays for the scratch tenant after coverage is
    computed; keep model.usdc + usd_index.json + metadata.json. Returns the
    retained-path map recorded on the manifest row (design Decision 3)."""
    derived = _derived_dir_for_record(settings, record)
    if derived is None or not derived.is_dir():
        return {"applied": False, "reason": "derived_dir_unavailable"}
    if not _is_scratch_tenant_path(derived, settings.objects_root):
        return {"applied": False, "reason": "not_scratch_tenant", "path": str(derived)}
    dropped: list[str] = []
    prune_errors: list[dict[str, str]] = []
    for name in RETENTION_DROP:
        target = derived / name
        if target.is_file():
            try:
                target.unlink()
                dropped.append(name)
            except OSError as exc:
                # Best-effort: a Windows file lock under git/AV watch is the
                # exact predecessor failure class this change exists to defeat —
                # a prune lock must NOT crash the dispatch. Surface it as a
                # diagnostic; the row still records a terminal outcome.
                prune_errors.append({"file": name, "error": exc.__class__.__name__})
    retained: dict[str, str] = {}
    for name in RETENTION_KEEP:
        target = derived / name
        if target.is_file():
            retained[name] = str(target)
    result = {
        "applied": True,
        "derived_dir": str(derived),
        "dropped": dropped,
        "retained_paths": retained,
        "retention_class": RETENTION_CLASS,
    }
    if prune_errors:
        result["prune_errors"] = prune_errors
    return result


def cleanup_batch_scratch(settings: Settings) -> dict[str, Any]:
    """Idempotently remove the canonical-verification scratch tenant tree
    (task 5.3). Safe to call when nothing exists — `tenant_batch_verification`
    output is throwaway evidence, not durable review data."""
    scratch_root = Path(settings.objects_root) / "tenants" / SCRATCH_TENANT
    existed = scratch_root.exists()
    if existed:
        shutil.rmtree(scratch_root, ignore_errors=True)
    return {
        "scratch_root": str(scratch_root),
        "removed": existed,
        "exists_after": scratch_root.exists(),
    }


def _retained_paths_drift(fixtures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Surface rows whose recorded retained paths no longer exist (task 5.4).

    Drift is reported as a diagnostic; it is never silently passed over.
    """
    drift: list[dict[str, Any]] = []
    for row in fixtures:
        retained = row.get("retained_paths") or {}
        missing = [name for name, p in retained.items() if not Path(p).is_file()]
        if missing:
            drift.append({"source_id": row.get("source_id"), "missing": missing})
    return drift


def run_next_batch_queue(
    settings: Settings,
    *,
    converter: Any | None = None,
    timeout_seconds: float = 600.0,
    profile_source_entities: bool = False,
) -> dict[str, Any]:
    """Dispatch exactly one `pending` (or crashed-`running`) fixture.

    Short-lived single-step (design A1 / task 3.2): no drain loop. Resume only
    re-claims a row with no recorded terminal outcome; a recorded
    passed/failed/timed_out is never auto-rerun (Decision 2 / task 3.4).
    """
    path = batch_queue_path(settings)
    manifest = read_batch_queue(path)
    if manifest is None:
        return {"dispatched": False, "reason": "manifest_not_found"}

    fixtures = _fixtures(manifest)
    row = next(
        (r for r in fixtures if r.get("status") in {"pending", "running"}), None
    )
    if row is None:
        return {"dispatched": False, "reason": "no_pending_rows", "all_dispatched": True}

    source_id = row["source_id"]
    prev_status = row.get("status")
    row["status"] = "running"
    row.setdefault("history", []).append(
        {"event": "dispatch_start", "at": _now(), "prev_status": prev_status}
    )
    manifest["updated_at"] = _now()
    write_batch_queue(path, manifest)

    try:
        _source_path, source_item = resolve_dev_ifc_source(
            settings.dev_storage_root, source_id
        )
    except ValueError as exc:
        return _record_outcome(
            settings,
            path,
            source_id,
            bucket="failed",
            record={},
            history_extra={"error": {"code": "SourceUnavailable", "message": str(exc)}},
        )

    record = _run_single_fixture_with_timeout(
        settings,
        source_id,
        source_item,
        converter=converter,
        timeout_seconds=timeout_seconds,
        profile_source_entities=profile_source_entities,
    )
    bucket = _fixture_outcome_bucket(record)
    return _record_outcome(settings, path, source_id, bucket=bucket, record=record)


def _record_outcome(
    settings: Settings,
    path: Path,
    source_id: str,
    *,
    bucket: str,
    record: dict[str, Any],
    history_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # Prune first, then persist the row WITH retained paths — so a row never
    # claims a retained path that was not actually kept (design Risk: drift).
    retention = (
        apply_post_coverage_retention(settings, record)
        if record
        else {"applied": False, "reason": "no_record"}
    )
    manifest = read_batch_queue(path) or {"fixtures": []}
    target = next(
        (r for r in _fixtures(manifest) if r.get("source_id") == source_id), None
    )
    if target is None:
        return {"dispatched": True, "source_id": source_id, "outcome": bucket,
                "warning": "row_vanished_before_outcome", "retention": retention}
    target["status"] = bucket
    target["conversion_job_id"] = record.get("conversion_job_id")
    target["artifact_group_id"] = record.get("artifact_group_id")
    target["coverage_summary"] = _coverage_summary_from_record(record) if record else {}
    if retention.get("applied"):
        target["retained_paths"] = retention["retained_paths"]
        target["retention_class"] = retention["retention_class"]
    history = {"event": "dispatch_outcome", "at": _now(), "outcome": bucket}
    if record.get("conversion_job_id"):
        history["conversion_job_id"] = record["conversion_job_id"]
    if retention.get("applied"):
        history["retention"] = {
            "dropped": retention["dropped"],
            "class": retention["retention_class"],
        }
    if history_extra:
        history.update(history_extra)
    target.setdefault("history", []).append(history)
    manifest["updated_at"] = _now()
    write_batch_queue(path, manifest)
    return {
        "dispatched": True,
        "source_id": source_id,
        "outcome": bucket,
        "conversion_job_id": record.get("conversion_job_id"),
        "retention": retention,
    }


def retry_batch_queue(
    settings: Settings, source_id: str, *, who: str = "cli"
) -> dict[str, Any]:
    """Explicitly reset ONE recorded-failure row to `pending` (task 3.3).

    Only a `failed` / `timed_out` row is eligible; any other status is rejected
    so a passing fixture can never be silently re-run.
    """
    path = batch_queue_path(settings)
    manifest = read_batch_queue(path)
    if manifest is None:
        return {"retried": False, "reason": "manifest_not_found"}
    row = next(
        (r for r in _fixtures(manifest) if r.get("source_id") == source_id), None
    )
    if row is None:
        return {"retried": False, "reason": "unknown_source_id", "source_id": source_id}
    if row.get("status") not in {"failed", "timed_out"}:
        return {
            "retried": False,
            "reason": "not_a_recorded_failure",
            "source_id": source_id,
            "status": row.get("status"),
        }
    prev = row.get("status")
    row["status"] = "pending"
    row.setdefault("history", []).append(
        {"event": "retry", "at": _now(), "who": who, "prev_outcome": prev}
    )
    manifest["updated_at"] = _now()
    write_batch_queue(path, manifest)
    return {"retried": True, "source_id": source_id, "prev_outcome": prev}


def _summary_record(row: dict[str, Any]) -> dict[str, Any]:
    """Record consumed by `_compute_outcome_distribution` for one terminal row.

    Uses the stored coverage_summary when present; otherwise synthesizes the
    minimal shape so `_fixture_outcome_bucket` re-derives the SAME bucket as the
    row's recorded terminal status — even when no conversion record was produced
    (e.g. a source-unavailable failure). Without this, such rows would silently
    drop out of the distribution and under-report failures (parity hole).
    """
    cov = row.get("coverage_summary")
    if isinstance(cov, dict) and cov:
        return cov
    status = row.get("status")
    if status == "timed_out":
        return {"status": "timed_out"}
    if status == "blocked":
        return {"status": "blocked"}
    if status == "passed_with_quality_warning":
        return {"status": "passed", "coverage_status": "warn"}
    if status == "passed":
        return {"status": "passed", "coverage_status": "pass"}
    return {"status": "failed"}


def summarize_batch_queue(settings: Settings) -> dict[str, Any]:
    """Compute `outcome_distribution` + `minimum_coverage_locked` from the
    manifest, reusing the predecessor's functions unchanged (task 4.1). A queue
    run to completion yields a bit-identical result to the monolithic path on
    the same inputs (parity, task 4.3 / 6.4)."""
    path = batch_queue_path(settings)
    manifest = read_batch_queue(path)
    if manifest is None:
        return {
            "manifest_path": str(path),
            "exists": False,
            "message": "batch_queue.json not found; run --enqueue first.",
        }
    fixtures = _fixtures(manifest)
    total = len(fixtures)
    pending_remaining = sum(
        1 for r in fixtures if r.get("status") in {"pending", "running"}
    )
    records = [
        _summary_record(r)
        for r in fixtures
        if r.get("status") not in {"pending", "running"}
    ]
    distribution = _compute_outcome_distribution(records)
    partial = pending_remaining > 0
    minimum_coverage_locked = _compute_minimum_coverage_locked(
        records,
        partial=partial,
        selected_count=total,
        outcome_distribution=distribution,
    )
    return {
        "manifest_path": str(path),
        "exists": True,
        "total": total,
        "pending_remaining": pending_remaining,
        "outcome_distribution": distribution,
        "minimum_coverage_locked": minimum_coverage_locked,
        "retained_paths_drift": _retained_paths_drift(fixtures),
    }
