from datetime import UTC, datetime
from pathlib import Path
import hashlib
import os
from typing import Any


def dev_source_root_status(root: Path | str) -> dict[str, Any]:
    resolved = Path(root).resolve()
    exists = resolved.exists()
    is_directory = resolved.is_dir()
    return {
        "exists": exists,
        "is_directory": is_directory,
        "readable": bool(exists and is_directory),
        "items": 0 if not exists or not is_directory else None,
    }


def list_dev_ifc_sources(root: Path | str) -> dict[str, Any]:
    resolved_root = Path(root).resolve()
    status = dev_source_root_status(resolved_root)
    if not status["readable"]:
        return {"root": {**status, "items": 0}, "items": []}

    items: list[dict[str, Any]] = []
    for path in _iter_ifc_files(resolved_root):
        stat = path.stat()
        relative_path = path.relative_to(resolved_root).as_posix()
        items.append(
            {
                "source_id": _source_id(relative_path, stat.st_size, stat.st_mtime_ns),
                "filename": path.name,
                "relative_path": relative_path,
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
            }
        )

    items.sort(key=lambda item: item["relative_path"].casefold())
    return {"root": {**status, "items": len(items)}, "items": items}


def resolve_dev_ifc_source(root: Path | str, source_id: str) -> tuple[Path, dict[str, Any]]:
    resolved_root = Path(root).resolve()
    if not resolved_root.is_dir():
        raise ValueError("Dev IFC source root is unavailable.")
    for path in _iter_ifc_files(resolved_root):
        stat = path.stat()
        relative_path = path.relative_to(resolved_root).as_posix()
        candidate_id = _source_id(relative_path, stat.st_size, stat.st_mtime_ns)
        if candidate_id == source_id:
            return path, {
                "source_id": candidate_id,
                "filename": path.name,
                "relative_path": relative_path,
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
            }
    raise ValueError("Unknown or stale dev IFC source.")


def _iter_ifc_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        current_dir = Path(dirpath)
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if not (current_dir / dirname).is_symlink()
        ]
        for filename in filenames:
            path = current_dir / filename
            if path.is_symlink() or path.suffix.lower() != ".ifc" or not path.is_file():
                continue
            resolved = path.resolve(strict=True)
            _ensure_inside_root(root, resolved)
            yield resolved


def _ensure_inside_root(root: Path, candidate: Path) -> None:
    resolved_root = root.resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise ValueError("Dev IFC source resolves outside the configured root.")


def _source_id(relative_path: str, size_bytes: int, modified_ns: int) -> str:
    payload = f"v1:{relative_path}:{size_bytes}:{modified_ns}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
