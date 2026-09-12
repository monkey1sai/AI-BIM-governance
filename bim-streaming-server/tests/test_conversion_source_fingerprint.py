import hashlib
import json
import sys
from pathlib import Path

import pytest

MODULE_DIR = Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"
sys.path.insert(0, str(MODULE_DIR))
import conversion_source_fingerprint as fingerprint


def test_source_digest_and_metadata_preservation(tmp_path):
    source = tmp_path / "sample.ifc"
    source.write_bytes(b"ISO-10303-21;fixture")
    metadata = tmp_path / "metadata.json"
    metadata.write_text('{"prim_count":3}', encoding="utf-8")
    before = fingerprint.capture_source(source)
    fingerprint.verify_source(source, before)
    fingerprint.attach_source_fingerprint(metadata, before, "v1")
    result = json.loads(metadata.read_text(encoding="utf-8"))
    assert result["prim_count"] == 3
    assert result["source_fingerprint"] == {
        "schema_version": "ifc-source-fingerprint/v1",
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "size_bytes": len(source.read_bytes()), "model_version_id": "v1",
        "observation": "before_after_match",
    }
    assert str(tmp_path) not in metadata.read_text(encoding="utf-8")
    fingerprint.attach_source_fingerprint(metadata, before, "v1")


@pytest.mark.parametrize("change", ["rewrite", "replace", "missing"])
def test_source_drift_is_rejected(tmp_path, change):
    source = tmp_path / "sample.ifc"
    source.write_bytes(b"AAAA")
    before = fingerprint.capture_source(source)
    if change == "rewrite":
        source.write_bytes(b"BBBB")
    elif change == "replace":
        replacement = tmp_path / "replacement.ifc"
        replacement.write_bytes(b"AAAA")
        replacement.replace(source)
    else:
        source.unlink()
    with pytest.raises((OSError, ValueError)):
        fingerprint.verify_source(source, before)


def test_directory_rejected(tmp_path):
    with pytest.raises((OSError, ValueError)):
        fingerprint.capture_source(tmp_path)


def test_change_during_capture_rejected(tmp_path, monkeypatch):
    source = tmp_path / "sample.ifc"
    source.write_bytes(b"AAAA")
    original = fingerprint.os.fstat
    calls = []
    def changed(fd):
        value = original(fd)
        calls.append(value)
        if len(calls) == 2:
            from types import SimpleNamespace
            return SimpleNamespace(st_dev=value.st_dev, st_ino=value.st_ino,
                st_size=value.st_size + 1, st_mtime_ns=value.st_mtime_ns,
                st_ctime_ns=value.st_ctime_ns, st_mode=value.st_mode)
        return value
    monkeypatch.setattr(fingerprint.os, "fstat", changed)
    with pytest.raises(ValueError):
        fingerprint.capture_source(source)


@pytest.mark.parametrize("body", ["not json", "[]", '{"source_fingerprint":{"sha256":"wrong"}}'])
def test_invalid_metadata_preserves_bytes(tmp_path, body):
    source = tmp_path / "sample.ifc"
    source.write_bytes(b"IFC")
    metadata = tmp_path / "metadata.json"
    metadata.write_text(body, encoding="utf-8")
    before = metadata.read_bytes()
    with pytest.raises(ValueError):
        fingerprint.attach_source_fingerprint(metadata, fingerprint.capture_source(source), "v1")
    assert metadata.read_bytes() == before


@pytest.mark.parametrize("version", ["", "  ", None, 42])
def test_invalid_version_preserves_metadata(tmp_path, version):
    source = tmp_path / "sample.ifc"
    source.write_bytes(b"IFC")
    metadata = tmp_path / "metadata.json"
    metadata.write_bytes(b"{}")
    with pytest.raises(ValueError):
        fingerprint.attach_source_fingerprint(metadata, fingerprint.capture_source(source), version)
    assert metadata.read_bytes() == b"{}"


def test_replace_failure_keeps_original_and_cleans_only_own_temp(tmp_path, monkeypatch):
    source = tmp_path / "sample.ifc"
    source.write_bytes(b"IFC")
    metadata = tmp_path / "metadata.json"
    metadata.write_bytes(b"{}")
    other = tmp_path / "other.tmp"
    other.write_bytes(b"keep")
    before = set(tmp_path.iterdir())
    def fail(*args):
        raise OSError("replace failed")
    monkeypatch.setattr(fingerprint.os, "replace", fail)
    with pytest.raises(OSError):
        fingerprint.attach_source_fingerprint(metadata, fingerprint.capture_source(source), "v1")
    assert metadata.read_bytes() == b"{}" and other.read_bytes() == b"keep"
    assert set(tmp_path.iterdir()) == before
