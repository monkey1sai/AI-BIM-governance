"""Content fingerprints for observed conversion input stability, not attestation."""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile


@dataclass(frozen=True)
class SourceFingerprint:
    path: Path
    identity: tuple[int, int, int, int, int]
    sha256: str


def _identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def capture_source(path: Path) -> SourceFingerprint:
    resolved = Path(path).resolve(strict=True)
    with resolved.open("rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Source must be a regular file.")
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
        after = os.fstat(stream.fileno())
        if _identity(before) != _identity(after):
            raise ValueError("Source changed during fingerprint capture.")
    return SourceFingerprint(resolved, _identity(after), digest.hexdigest())


def verify_source(path: Path, expected: SourceFingerprint) -> None:
    if capture_source(path) != expected:
        raise ValueError("Conversion source changed.")


def attach_source_fingerprint(metadata_path: Path, source: SourceFingerprint, model_version_id: str) -> None:
    if not isinstance(model_version_id, str) or not model_version_id.strip():
        raise ValueError("Source model version is required.")
    metadata_path = Path(metadata_path)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if not isinstance(metadata, dict):
        raise ValueError("Metadata must be an object.")
    fact = {
        "schema_version": "ifc-source-fingerprint/v1",
        "sha256": source.sha256,
        "size_bytes": source.identity[2],
        "model_version_id": model_version_id,
        "observation": "before_after_match",
    }
    if "source_fingerprint" in metadata:
        if metadata["source_fingerprint"] != fact:
            raise ValueError("Source fingerprint conflict.")
        return
    metadata["source_fingerprint"] = fact
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=metadata_path.parent,
                                         prefix=".source-fingerprint-", suffix=".tmp", delete=False) as stream:
            temporary_path = Path(stream.name)
            json.dump(metadata, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, metadata_path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
