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
from typing import Any

from .dev_sources import list_dev_ifc_sources
from .settings import Settings


MANIFEST_VERSION = 1

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
    return {
        "source_id": source["source_id"],
        "filename": source["filename"],
        "relative_path": source["relative_path"],
        "size_bytes": source["size_bytes"],
        "modified_at": source.get("modified_at"),
        "status": "pending",
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
    }
