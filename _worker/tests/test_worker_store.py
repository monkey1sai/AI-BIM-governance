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

def test_safe_id_accepts_alphanumeric_and_separators():
    assert safe_id("tenant_demo_001", "tenant_id") == "tenant_demo_001"
    assert safe_id("project-abc.1", "project_id") == "project-abc.1"

def test_safe_id_rejects_path_traversal():
    with pytest.raises(ValueError, match="Invalid tenant_id"):
        safe_id("../secrets", "tenant_id")

def test_safe_id_rejects_spaces():
    with pytest.raises(ValueError, match="Invalid label"):
        safe_id("bad id", "label")

def test_safe_id_rejects_slash():
    with pytest.raises(ValueError, match="Invalid artifact_id"):
        safe_id("a/b", "artifact_id")


# ---------------------------------------------------------------------------
# safe_filename
# ---------------------------------------------------------------------------

def test_safe_filename_strips_dangerous_characters():
    result = safe_filename("../../etc/passwd")
    # path traversal dots stripped, only basename kept and sanitized
    assert "/" not in result
    assert result != ""

def test_safe_filename_preserves_normal_filename():
    assert safe_filename("model.ifc") == "model.ifc"

def test_safe_filename_falls_back_to_default_when_empty_after_sanitize():
    # All-separator filename collapses to empty → fallback
    result = safe_filename("...")
    assert result == "source.ifc"

def test_safe_filename_handles_spaces_and_unicode():
    result = safe_filename("建模 file (1).ifc")
    assert " " not in result
    assert "(" not in result


# ---------------------------------------------------------------------------
# write_json / read_json
# ---------------------------------------------------------------------------

def test_write_and_read_json_round_trips(tmp_path: Path):
    target = tmp_path / "sub" / "data.json"
    payload = {"key": "value", "items": [1, 2, 3]}
    write_json(target, payload)
    assert read_json(target, None) == payload

def test_read_json_returns_default_when_file_missing(tmp_path: Path):
    result = read_json(tmp_path / "nonexistent.json", "fallback")
    assert result == "fallback"

def test_write_json_creates_missing_parent_directories(tmp_path: Path):
    deep = tmp_path / "a" / "b" / "c" / "file.json"
    write_json(deep, {"ok": True})
    assert deep.is_file()


# ---------------------------------------------------------------------------
# ArtifactIntakeRequest model validation
# ---------------------------------------------------------------------------

def test_artifact_intake_request_requires_at_least_one_source_field():
    with pytest.raises(Exception):
        ArtifactIntakeRequest(
            tenant_id="t1",
            project_id="p1",
            model_version_id="v1",
            source_system="revit",
            uploaded_by="user1",
            filename="file.ifc",
        )

def test_artifact_intake_request_accepts_content_base64():
    req = ArtifactIntakeRequest(
        tenant_id="t1",
        project_id="p1",
        model_version_id="v1",
        source_system="revit",
        uploaded_by="user1",
        filename="file.ifc",
        content_base64=base64.b64encode(b"ISO-10303-21;").decode("ascii"),
    )
    assert req.content_base64 is not None

def test_artifact_intake_request_accepts_content_text():
    req = ArtifactIntakeRequest(
        tenant_id="t1",
        project_id="p1",
        model_version_id="v1",
        source_system="revit",
        uploaded_by="user1",
        filename="file.ifc",
        content_text="ISO-10303-21;\nEND-ISO-10303-21;\n",
    )
    assert req.content_text is not None

def test_artifact_intake_request_accepts_source_url():
    req = ArtifactIntakeRequest(
        tenant_id="t1",
        project_id="p1",
        model_version_id="v1",
        source_system="revit",
        uploaded_by="user1",
        filename="file.ifc",
        source_url="http://example.com/model.ifc",
    )
    assert req.source_url is not None

def test_artifact_intake_request_accepts_signed_upload_url():
    req = ArtifactIntakeRequest(
        tenant_id="t1",
        project_id="p1",
        model_version_id="v1",
        source_system="revit",
        uploaded_by="user1",
        filename="file.ifc",
        signed_upload_url="https://s3.example.com/signed-upload-url",
    )
    assert req.signed_upload_url is not None

def test_artifact_intake_request_rejects_invalid_source_format():
    with pytest.raises(Exception):
        ArtifactIntakeRequest(
            tenant_id="t1",
            project_id="p1",
            model_version_id="v1",
            source_system="revit",
            uploaded_by="user1",
            filename="file.nwd",
            source_format="nwd",  # not in Literal["ifc", "rvt", "dwg"]
            content_text="data",
        )


# ---------------------------------------------------------------------------
# ConversionOptions defaults
# ---------------------------------------------------------------------------

def test_conversion_options_defaults():
    opts = ConversionOptions()
    assert opts.force is False
    assert opts.generate_mapping is True
    assert opts.auto_complete is True

def test_conversion_request_requires_min_length_source_artifact_id():
    with pytest.raises(Exception):
        ConversionRequest(source_artifact_id="")


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def test_settings_defaults_resolve_relative_to_service_root(tmp_path: Path):
    settings = Settings(service_root=tmp_path)
    assert Path(settings.objects_root).is_absolute()
    assert Path(settings.jobs_dir).is_absolute()
    assert str(settings.objects_root).startswith(str(tmp_path))

def test_settings_strips_trailing_slash_from_urls(tmp_path: Path):
    settings = Settings(
        service_root=tmp_path,
        fake_bim_control_url="http://127.0.0.1:8001/",
        public_objects_url="http://127.0.0.1:8005/objects/",
    )
    assert not settings.fake_bim_control_url.endswith("/")
    assert not settings.public_objects_url.endswith("/")

def test_settings_absolute_paths_are_preserved(tmp_path: Path):
    abs_objects = tmp_path / "my_objects"
    abs_jobs = tmp_path / "my_jobs"
    settings = Settings(
        service_root=tmp_path,
        objects_root=abs_objects,
        jobs_dir=abs_jobs,
    )
    assert Path(settings.objects_root) == abs_objects.resolve()
    assert Path(settings.jobs_dir) == abs_jobs.resolve()

def test_settings_from_env_uses_defaults_when_env_vars_absent(monkeypatch):
    monkeypatch.delenv("WORKER_OBJECTS_ROOT", raising=False)
    monkeypatch.delenv("WORKER_JOBS_DIR", raising=False)
    monkeypatch.delenv("WORKER_BIM_CONTROL_URL", raising=False)
    monkeypatch.delenv("WORKER_PUBLIC_OBJECTS_URL", raising=False)

    settings = Settings.from_env()
    assert settings.fake_bim_control_url == "http://127.0.0.1:8001"
    assert settings.public_objects_url == "http://127.0.0.1:8005/objects"

def test_settings_from_env_reads_environment_variables(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("WORKER_BIM_CONTROL_URL", "http://localhost:9999")
    monkeypatch.setenv("WORKER_PUBLIC_OBJECTS_URL", "http://localhost:8888/objects")
    monkeypatch.setenv("WORKER_OBJECTS_ROOT", str(tmp_path / "my_objs"))
    monkeypatch.setenv("WORKER_JOBS_DIR", str(tmp_path / "my_jobs"))

    settings = Settings.from_env()
    assert settings.fake_bim_control_url == "http://localhost:9999"
    assert settings.public_objects_url == "http://localhost:8888/objects"


# ---------------------------------------------------------------------------
# WorkerStore.create_source_artifact
# ---------------------------------------------------------------------------


def make_store(tmp_path: Path) -> WorkerStore:
    settings = Settings(
        service_root=tmp_path,
        objects_root=tmp_path / "objects",
        jobs_dir=tmp_path / "jobs",
        fake_bim_control_url="http://127.0.0.1:1",
        public_objects_url="http://testserver/objects",
    )
    return WorkerStore(settings)


def make_intake_request(**overrides) -> ArtifactIntakeRequest:
    defaults = {
        "tenant_id": "tenant001",
        "project_id": "project001",
        "model_version_id": "version001",
        "source_system": "revit",
        "uploaded_by": "user001",
        "filename": "model.ifc",
        "content_text": "ISO-10303-21;\nEND-ISO-10303-21;\n",
    }
    defaults.update(overrides)
    return ArtifactIntakeRequest(**defaults)

def test_store_create_source_artifact_uses_provided_artifact_group_id(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(artifact_group_id="ag_explicit_001")
    result = store.create_source_artifact(req)
    assert result["artifact_group_id"] == "ag_explicit_001"

def test_store_create_source_artifact_generates_artifact_group_id_when_absent(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request()
    result = store.create_source_artifact(req)
    assert result["artifact_group_id"].startswith("ag_")

def test_store_create_source_artifact_stores_sha256_in_metadata(tmp_path: Path):
    store = make_store(tmp_path)
    content = "ISO-10303-21;\nEND-ISO-10303-21;\n"
    req = make_intake_request(content_text=content)
    result = store.create_source_artifact(req)
    import hashlib
    expected = hashlib.sha256(content.encode("utf-8")).hexdigest()
    assert result["sha256"] == expected

def test_store_create_source_artifact_content_base64_decodes_correctly(tmp_path: Path):
    store = make_store(tmp_path)
    raw = b"ISO-10303-21;\nEND-ISO-10303-21;\n"
    req = make_intake_request(content_base64=base64.b64encode(raw).decode("ascii"), content_text=None)
    result = store.create_source_artifact(req)
    written_bytes = (Path(store.settings.objects_root) / result["object_key"]).read_bytes()
    assert written_bytes == raw

def test_store_create_source_artifact_source_url_writes_reference_stub(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(source_url="http://example.com/model.ifc", content_text=None)
    result = store.create_source_artifact(req)
    written = json.loads((Path(store.settings.objects_root) / result["object_key"]).read_text(encoding="utf-8"))
    assert written["upload_reference"] == "http://example.com/model.ifc"

def test_store_create_source_artifact_signed_upload_url_writes_reference_stub(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(signed_upload_url="https://s3.example.com/signed", content_text=None)
    result = store.create_source_artifact(req)
    written = json.loads((Path(store.settings.objects_root) / result["object_key"]).read_text(encoding="utf-8"))
    assert written["upload_reference"] == "https://s3.example.com/signed"

def test_store_get_source_artifact_returns_none_for_unknown_id(tmp_path: Path):
    store = make_store(tmp_path)
    assert store.get_source_artifact("artifact_src_unknown") is None

def test_store_get_artifact_group_returns_none_before_any_upload(tmp_path: Path):
    store = make_store(tmp_path)
    assert store.get_artifact_group("ag_nonexistent") is None

def test_store_artifact_group_status_is_source_uploaded_before_conversion(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(artifact_group_id="ag_status_test")
    store.create_source_artifact(req)
    group = store.get_artifact_group("ag_status_test")
    assert group is not None
    assert group["status"] == "source_uploaded"
    assert group["ready_status"] == "missing_derived"
    assert group["derived"] == []
    assert group["mapping"] is None

def test_store_create_conversion_job_raises_key_error_for_unknown_source(tmp_path: Path):
    store = make_store(tmp_path)
    with pytest.raises(KeyError):
        store.create_conversion_job("artifact_src_nonexistent", {"target_format": "usdc"})

def test_store_create_conversion_job_initial_status_is_queued(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(artifact_group_id="ag_conv_test")
    result = store.create_source_artifact(req)
    job = store.create_conversion_job(result["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})
    assert job["status"] == "queued"
    assert job["stage"] == "queued"
    assert job["artifact_group_id"] == "ag_conv_test"

def test_store_complete_conversion_job_writes_derived_files(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(artifact_group_id="ag_derive_test")
    upload = store.create_source_artifact(req)
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})
    completed = store.complete_conversion_job(job["conversion_job_id"])
    result = completed["result"]
    assert result["status"] == "succeeded"

    # Verify physical files exist
    root = Path(store.settings.objects_root)
    group = store.get_artifact_group("ag_derive_test")
    derived = group["derived"][0]
    usdc_path = root / derived["object_key"]
    assert usdc_path.is_file()
    mapping_path = root / group["mapping"]["object_key"]
    assert mapping_path.is_file()

def test_store_complete_conversion_sets_group_to_ready(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(artifact_group_id="ag_ready_test")
    upload = store.create_source_artifact(req)
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})
    store.complete_conversion_job(job["conversion_job_id"])
    group = store.get_artifact_group("ag_ready_test")
    assert group["status"] == "ready"
    assert group["ready_status"] == "ready"
    assert group["mapping"]["ready"] is True

def test_store_conversion_without_mapping_sets_missing_mapping_status(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(artifact_group_id="ag_nomapping")
    upload = store.create_source_artifact(req)
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": False})
    store.complete_conversion_job(job["conversion_job_id"])
    group = store.get_artifact_group("ag_nomapping")
    assert group["ready_status"] == "missing_mapping"
    assert group["mapping"]["ready"] is False

def test_store_object_url_constructs_from_public_base(tmp_path: Path):
    store = make_store(tmp_path)
    url = store.object_url("tenants/t1/projects/p1/model.usdc")
    assert url == "http://testserver/objects/tenants/t1/projects/p1/model.usdc"

def test_store_object_url_strips_leading_slash(tmp_path: Path):
    store = make_store(tmp_path)
    url = store.object_url("/tenants/t1/model.usdc")
    assert url == "http://testserver/objects/tenants/t1/model.usdc"
