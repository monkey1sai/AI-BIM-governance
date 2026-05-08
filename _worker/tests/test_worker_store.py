"""Unit tests for _worker store utilities, models, and settings."""
import base64
import json
import sys
from pathlib import Path
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import ArtifactIntakeRequest, ConversionOptions, ConversionRequest
from app.settings import Settings
from app.store import WorkerStore, safe_filename, safe_id, write_json, read_json


# ---------------------------------------------------------------------------
# safe_id
# ---------------------------------------------------------------------------


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


def test_store_create_source_artifact_preserves_original_filename_in_metadata():
    store_root = Path(__file__).resolve().parents[1] / "pytest-cache-files-store" / uuid4().hex
    store_root.mkdir(parents=True, exist_ok=False)
    store = make_store(store_root)
    original_filename = "許良宇圖書館建築_2026.ifc"
    req = make_intake_request(filename=original_filename)

    result = store.create_source_artifact(req)

    assert result["original_filename"] == original_filename
    assert result["metadata"]["original_filename"] == original_filename


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
