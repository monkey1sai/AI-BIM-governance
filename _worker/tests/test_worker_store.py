"""Unit tests for _worker/app/store.py and _worker/app/models.py."""
import base64
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import ArtifactIntakeRequest, ConversionRequest, ConversionOptions
from app.settings import Settings
from app.store import WorkerStore, safe_id, safe_filename, write_json, read_json


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        service_root=tmp_path,
        objects_root=tmp_path / "objects",
        jobs_dir=tmp_path / "jobs",
        fake_bim_control_url="http://127.0.0.1:1",
        public_objects_url="http://testserver/objects",
    )


def make_store(tmp_path: Path) -> WorkerStore:
    return WorkerStore(make_settings(tmp_path))


def base_intake(**overrides) -> ArtifactIntakeRequest:
    payload = {
        "tenant_id": "tenant_001",
        "project_id": "project_001",
        "model_version_id": "version_001",
        "source_system": "revit",
        "uploaded_by": "user_001",
        "filename": "model.ifc",
        "content_text": "SIMPLE IFC CONTENT",
    }
    payload.update(overrides)
    return ArtifactIntakeRequest(**payload)


# ---------------------------------------------------------------------------
# safe_id tests
# ---------------------------------------------------------------------------


class TestSafeId:
    def test_valid_alphanumeric(self):
        assert safe_id("artifact_001", "artifact_id") == "artifact_001"

    def test_valid_with_dots_and_hyphens(self):
        assert safe_id("conv_2024-01-01.abc", "conv_id") == "conv_2024-01-01.abc"

    def test_valid_uppercase(self):
        assert safe_id("ArtifactABC123", "artifact_id") == "ArtifactABC123"

    def test_rejects_slash(self):
        with pytest.raises(ValueError, match="Invalid"):
            safe_id("../etc/passwd", "path")

    def test_rejects_space(self):
        with pytest.raises(ValueError, match="Invalid"):
            safe_id("bad id here", "label")

    def test_rejects_empty_string(self):
        with pytest.raises(ValueError, match="Invalid"):
            safe_id("", "label")

    def test_rejects_special_chars(self):
        with pytest.raises(ValueError, match="Invalid"):
            safe_id("id;rm -rf", "label")

    def test_rejects_null_byte(self):
        with pytest.raises(ValueError, match="Invalid"):
            safe_id("id\x00inject", "label")


# ---------------------------------------------------------------------------
# safe_filename tests
# ---------------------------------------------------------------------------


class TestSafeFilename:
    def test_simple_filename(self):
        assert safe_filename("model.ifc") == "model.ifc"

    def test_strips_path_components(self):
        result = safe_filename("/etc/passwd")
        assert "/" not in result
        assert result == "passwd"

    def test_replaces_spaces(self):
        result = safe_filename("my model file.ifc")
        assert " " not in result
        assert ".ifc" in result

    def test_replaces_special_chars(self):
        result = safe_filename("file;inject.ifc")
        assert ";" not in result

    def test_falls_back_when_empty(self):
        assert safe_filename("") == "source.ifc"

    def test_falls_back_for_only_dots(self):
        assert safe_filename("...") == "source.ifc"


# ---------------------------------------------------------------------------
# write_json / read_json tests
# ---------------------------------------------------------------------------


class TestJsonIO:
    def test_roundtrip(self, tmp_path: Path):
        path = tmp_path / "sub" / "data.json"
        payload = {"key": "value", "nested": {"a": 1}}
        write_json(path, payload)
        assert read_json(path, None) == payload

    def test_read_missing_returns_default(self, tmp_path: Path):
        result = read_json(tmp_path / "nonexistent.json", "fallback")
        assert result == "fallback"

    def test_write_creates_parent_dirs(self, tmp_path: Path):
        deep_path = tmp_path / "a" / "b" / "c" / "file.json"
        write_json(deep_path, {"created": True})
        assert deep_path.is_file()

    def test_write_uses_atomic_temp_file(self, tmp_path: Path):
        path = tmp_path / "atomic.json"
        write_json(path, {"value": 42})
        temp = path.with_suffix(path.suffix + ".tmp")
        assert not temp.exists()
        assert path.is_file()

    def test_write_produces_valid_utf8_json(self, tmp_path: Path):
        path = tmp_path / "unicode.json"
        write_json(path, {"msg": "繁體中文"})
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        assert data["msg"] == "繁體中文"


# ---------------------------------------------------------------------------
# ArtifactIntakeRequest model validation
# ---------------------------------------------------------------------------


class TestArtifactIntakeRequestModel:
    def test_accepts_content_text(self):
        req = ArtifactIntakeRequest(
            tenant_id="t",
            project_id="p",
            model_version_id="v",
            source_system="sys",
            uploaded_by="u",
            filename="a.ifc",
            content_text="data",
        )
        assert req.content_text == "data"

    def test_accepts_source_url(self):
        req = ArtifactIntakeRequest(
            tenant_id="t",
            project_id="p",
            model_version_id="v",
            source_system="sys",
            uploaded_by="u",
            filename="a.ifc",
            source_url="http://example.com/file.ifc",
        )
        assert req.source_url == "http://example.com/file.ifc"

    def test_accepts_signed_upload_url(self):
        req = ArtifactIntakeRequest(
            tenant_id="t",
            project_id="p",
            model_version_id="v",
            source_system="sys",
            uploaded_by="u",
            filename="a.ifc",
            signed_upload_url="https://s3.example.com/presigned",
        )
        assert req.signed_upload_url == "https://s3.example.com/presigned"

    def test_accepts_content_base64(self):
        encoded = base64.b64encode(b"data").decode()
        req = ArtifactIntakeRequest(
            tenant_id="t",
            project_id="p",
            model_version_id="v",
            source_system="sys",
            uploaded_by="u",
            filename="a.ifc",
            content_base64=encoded,
        )
        assert req.content_base64 == encoded

    def test_rejects_when_no_source_provided(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ArtifactIntakeRequest(
                tenant_id="t",
                project_id="p",
                model_version_id="v",
                source_system="sys",
                uploaded_by="u",
                filename="a.ifc",
            )

    def test_default_source_format_is_ifc(self):
        req = ArtifactIntakeRequest(
            tenant_id="t",
            project_id="p",
            model_version_id="v",
            source_system="sys",
            uploaded_by="u",
            filename="a.ifc",
            content_text="x",
        )
        assert req.source_format == "ifc"

    def test_rejects_unknown_source_format(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ArtifactIntakeRequest(
                tenant_id="t",
                project_id="p",
                model_version_id="v",
                source_system="sys",
                uploaded_by="u",
                filename="a.xyz",
                content_text="x",
                source_format="xyz",
            )


# ---------------------------------------------------------------------------
# ConversionRequest model
# ---------------------------------------------------------------------------


class TestConversionRequestModel:
    def test_defaults(self):
        req = ConversionRequest(source_artifact_id="artifact_001")
        assert req.target_format == "usdc"
        assert req.generate_mapping is True
        assert req.options.auto_complete is True

    def test_auto_complete_can_be_disabled(self):
        req = ConversionRequest(
            source_artifact_id="artifact_001",
            options=ConversionOptions(auto_complete=False),
        )
        assert req.options.auto_complete is False


# ---------------------------------------------------------------------------
# WorkerStore.create_source_artifact
# ---------------------------------------------------------------------------


class TestCreateSourceArtifact:
    def test_returns_uploaded_status(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(base_intake())
        assert result["status"] == "uploaded"

    def test_object_key_follows_versioned_layout(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(base_intake())
        key = result["object_key"]
        assert "tenants/tenant_001" in key
        assert "projects/project_001" in key
        assert "versions/version_001" in key
        assert "artifact-groups/" in key
        assert "/source/revit/" in key
        assert "/original/" in key

    def test_object_url_reflects_public_url(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(base_intake())
        assert result["object_url"].startswith("http://testserver/objects/")

    def test_sha256_is_computed(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(base_intake(content_text="hello world"))
        assert len(result["sha256"]) == 64

    def test_explicit_artifact_group_id_is_respected(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(
            base_intake(artifact_group_id="ag_explicit_001")
        )
        assert result["artifact_group_id"] == "ag_explicit_001"

    def test_auto_generated_artifact_group_id_is_set(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(base_intake())
        assert result["artifact_group_id"].startswith("ag_")

    def test_content_text_source_writes_bytes(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(base_intake(content_text="HELLO IFC"))
        path = (tmp_path / "objects" / result["object_key"])
        assert path.read_bytes() == b"HELLO IFC"

    def test_content_base64_source_decodes_and_writes(self, tmp_path: Path):
        store = make_store(tmp_path)
        original = b"BINARY CONTENT"
        encoded = base64.b64encode(original).decode()
        result = store.create_source_artifact(base_intake(content_base64=encoded))
        path = tmp_path / "objects" / result["object_key"]
        assert path.read_bytes() == original

    def test_source_url_reference_is_stored(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(
            base_intake(source_url="http://upstream/file.ifc", content_text=None)
        )
        assert result["metadata"]["lineage"]["source_url"] == "http://upstream/file.ifc"

    def test_group_is_created_with_source_uploaded_status(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(base_intake())
        group = store.get_artifact_group(result["artifact_group_id"])
        assert group is not None
        assert group["status"] == "source_uploaded"
        assert group["ready_status"] == "missing_derived"

    def test_source_index_is_written(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.create_source_artifact(base_intake())
        retrieved = store.get_source_artifact(result["source_artifact_id"])
        assert retrieved is not None
        assert retrieved["source_artifact_id"] == result["source_artifact_id"]

    def test_invalid_tenant_id_raises_value_error(self, tmp_path: Path):
        store = make_store(tmp_path)
        with pytest.raises(ValueError, match="Invalid tenant_id"):
            store.create_source_artifact(
                base_intake(tenant_id="bad tenant/id")
            )


# ---------------------------------------------------------------------------
# WorkerStore.get_source_artifact
# ---------------------------------------------------------------------------


class TestGetSourceArtifact:
    def test_returns_none_for_unknown_id(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.get_source_artifact("artifact_src_unknown")
        assert result is None

    def test_retrieves_after_create(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        found = store.get_source_artifact(created["source_artifact_id"])
        assert found is not None
        assert found["source_artifact_id"] == created["source_artifact_id"]


# ---------------------------------------------------------------------------
# WorkerStore.get_artifact_group
# ---------------------------------------------------------------------------


class TestGetArtifactGroup:
    def test_returns_none_for_unknown_group(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.get_artifact_group("ag_nonexistent")
        assert result is None

    def test_raises_for_invalid_group_id(self, tmp_path: Path):
        store = make_store(tmp_path)
        with pytest.raises(ValueError, match="Invalid artifact_group_id"):
            store.get_artifact_group("../traversal")


# ---------------------------------------------------------------------------
# WorkerStore.create_conversion_job
# ---------------------------------------------------------------------------


class TestCreateConversionJob:
    def test_raises_key_error_for_unknown_source(self, tmp_path: Path):
        store = make_store(tmp_path)
        with pytest.raises(KeyError):
            store.create_conversion_job("artifact_src_nonexistent", {"target_format": "usdc"})

    def test_creates_queued_job(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(
            created["source_artifact_id"],
            {"target_format": "usdc", "generate_mapping": True},
        )
        assert job["status"] == "queued"
        assert job["stage"] == "queued"
        assert job["source_artifact_id"] == created["source_artifact_id"]
        assert job["artifact_group_id"] == created["artifact_group_id"]

    def test_job_id_format(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {})
        assert job["conversion_job_id"].startswith("conv_")

    def test_job_is_persisted(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {})
        retrieved = store.get_conversion_job(job["conversion_job_id"])
        assert retrieved is not None
        assert retrieved["conversion_job_id"] == job["conversion_job_id"]


# ---------------------------------------------------------------------------
# WorkerStore.get_conversion_job
# ---------------------------------------------------------------------------


class TestGetConversionJob:
    def test_returns_none_for_unknown_job(self, tmp_path: Path):
        store = make_store(tmp_path)
        result = store.get_conversion_job("conv_20240101120000_nonexistent")
        assert result is None

    def test_raises_for_invalid_job_id(self, tmp_path: Path):
        store = make_store(tmp_path)
        with pytest.raises(ValueError, match="Invalid conversion_job_id"):
            store.get_conversion_job("../../../etc")


# ---------------------------------------------------------------------------
# WorkerStore.complete_conversion_job
# ---------------------------------------------------------------------------


class TestCompleteConversionJob:
    def test_status_becomes_succeeded(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {"generate_mapping": True})
        result = store.complete_conversion_job(job["conversion_job_id"])
        assert result["status"] == "succeeded"

    def test_result_contains_derived_urls(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {"generate_mapping": True})
        result = store.complete_conversion_job(job["conversion_job_id"])
        assert result["result"]["usdc_url"].endswith("/model.usdc")
        assert result["result"]["ifc_index_url"].endswith("/ifc_index.json")
        assert result["result"]["usd_index_url"].endswith("/usd_index.json")
        assert result["result"]["mapping_url"].endswith("/element_mapping.json")

    def test_mapping_url_is_none_when_not_generated(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {"generate_mapping": False})
        result = store.complete_conversion_job(job["conversion_job_id"])
        assert result["result"]["mapping_url"] is None

    def test_artifact_group_becomes_ready(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {"generate_mapping": True})
        store.complete_conversion_job(job["conversion_job_id"])
        group = store.get_artifact_group(created["artifact_group_id"])
        assert group is not None
        assert group["status"] == "ready"
        assert group["ready_status"] == "ready"
        assert len(group["derived"]) == 1

    def test_artifact_group_missing_mapping_when_not_generated(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {"generate_mapping": False})
        store.complete_conversion_job(job["conversion_job_id"])
        group = store.get_artifact_group(created["artifact_group_id"])
        assert group is not None
        assert group["ready_status"] == "missing_mapping"

    def test_derived_files_are_written_on_disk(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {"generate_mapping": True})
        result = store.complete_conversion_job(job["conversion_job_id"])
        usdc_key = result["result"]["usdc_url"].removeprefix("http://testserver/objects/")
        usdc_file = tmp_path / "objects" / usdc_key
        assert usdc_file.is_file()

    def test_raises_key_error_for_unknown_job(self, tmp_path: Path):
        store = make_store(tmp_path)
        with pytest.raises(KeyError):
            store.complete_conversion_job("conv_20240101120000_unknown12")

    def test_lineage_references_source_artifact(self, tmp_path: Path):
        store = make_store(tmp_path)
        created = store.create_source_artifact(base_intake())
        job = store.create_conversion_job(created["source_artifact_id"], {})
        result = store.complete_conversion_job(job["conversion_job_id"])
        assert result["result"]["lineage"]["source_artifact_id"] == created["source_artifact_id"]