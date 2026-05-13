"""Unit tests for _worker store utilities, models, and settings."""
import base64
import json
import sys
from pathlib import Path
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.converters import ConversionAdapterResult, ConversionAdapterUnavailable
from app.models import ArtifactIntakeRequest, ConversionOptions, ConversionRequest
from app.settings import Settings
from app.store import WorkerStore, safe_filename, safe_id, write_json, read_json


class FakeSuccessfulConverter:
    def __init__(self, *, model_content: bytes = b"PXR-USDC-fake-openable\n", quality_overrides: dict | None = None):
        self.model_content = model_content
        self.quality_overrides = quality_overrides or {}

    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        ifc_index_path = output_dir / "ifc_index.json"
        usd_index_path = output_dir / "usd_index.json"
        mapping_path = output_dir / "element_mapping.json" if generate_mapping else None
        model_path.write_bytes(self.model_content)
        write_json(
            ifc_index_path,
            {
                "summary": {"element_count": 2, "guid_count": 2},
                "elements": [
                    {"ifc_guid": "guid-1", "ifc_class": "IfcWall"},
                    {"ifc_guid": "guid-2", "ifc_class": "IfcDoor"},
                ],
            },
        )
        write_json(
            usd_index_path,
            {
                "summary": {"prim_count": 3, "mesh_prim_count": 2},
                "prims": [
                    {"path": "/World/IfcWall_guid_1", "type": "Mesh", "ifc_guid": "guid-1"},
                    {"path": "/World/IfcWall_guid_1_2", "type": "Mesh", "ifc_guid": "guid-1"},
                ],
            },
        )
        if mapping_path is not None:
            write_json(
                mapping_path,
                {
                    "mock": False,
                    "items": [
                        {
                            "ifc_guid": "guid-1",
                            "ifc_class": "IfcWall",
                            "usd_prim_path": "/World/IfcWall_guid_1",
                            "primary_usd_prim_path": "/World/IfcWall_guid_1",
                            "usd_prim_paths": ["/World/IfcWall_guid_1", "/World/IfcWall_guid_1_2"],
                            "mapping_method": "test_fake_converter",
                            "mapping_confidence": 0.95,
                        }
                    ],
                    "summary": {
                        "mapped_count": 1,
                        "unmapped_ifc_count": 1,
                        "unmapped_usd_count": 0,
                        "coverage_ratio": 0.5,
                        "fake_mapping_count": 0,
                    },
                },
            )
        quality_metrics = {
            "converter_identity": {"name": "test-fake-converter", "mock": True},
            "duration_seconds": 0.01,
            "source_ifc_element_count": 2,
            "usd_prim_count": 3,
            "mapped_count": 1,
            "unmapped_count": 1,
            "coverage_ratio": 0.5,
            "threshold_status": "measure_only",
            "minimum_coverage_baseline_locked": False,
            "hard_quality_gates": {
                "usdc_openable": True,
                "has_renderable_prims": True,
                "placeholder_output": False,
            },
        }
        quality_metrics.update(self.quality_overrides)
        return ConversionAdapterResult(
            model_path=model_path,
            ifc_index_path=ifc_index_path,
            usd_index_path=usd_index_path,
            mapping_path=mapping_path,
            converter={"name": "test-fake-converter", "mock": True},
            quality_metrics=quality_metrics,
            warnings=[],
        )


class FakeUnavailableConverter:
    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        raise ConversionAdapterUnavailable("test converter is unavailable")


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


def make_store(tmp_path: Path, converter=None) -> WorkerStore:
    settings = Settings(
        service_root=tmp_path,
        objects_root=tmp_path / "objects",
        jobs_dir=tmp_path / "jobs",
        fake_bim_control_url="http://127.0.0.1:1",
        public_objects_url="http://testserver/objects",
    )
    return WorkerStore(settings, converter=converter or FakeSuccessfulConverter())


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


def test_store_complete_conversion_reports_quality_metrics_and_one_to_many_mapping(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(artifact_group_id="ag_quality_test")
    upload = store.create_source_artifact(req)
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})

    completed = store.complete_conversion_job(job["conversion_job_id"])

    result = completed["result"]
    assert result["quality_metrics"]["converter_identity"]["name"] == "test-fake-converter"
    assert result["quality_metrics"]["coverage_ratio"] == 0.5
    assert result["quality_metrics"]["phase_timings"]["artifact_publish"]["status"] == "completed"
    mapping_path = Path(store.settings.objects_root) / result["lineage"]["derived_object_prefix"] / "element_mapping.json"
    mapping = read_json(mapping_path, {})
    assert mapping["mock"] is False
    assert mapping["items"][0]["usd_prim_path"] == "/World/IfcWall_guid_1"
    assert mapping["items"][0]["primary_usd_prim_path"] == "/World/IfcWall_guid_1"
    assert mapping["items"][0]["usd_prim_path"] == mapping["items"][0]["primary_usd_prim_path"]
    assert mapping["items"][0]["usd_prim_paths"] == ["/World/IfcWall_guid_1", "/World/IfcWall_guid_1_2"]


def test_store_normalizes_unlocked_coverage_policy(tmp_path: Path):
    store = make_store(tmp_path)
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_unlocked_quality"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})

    completed = store.complete_conversion_job(job["conversion_job_id"])

    quality = completed["result"]["quality_metrics"]
    assert quality["minimum_coverage_baseline_locked"] is False
    assert quality["minimum_coverage_ratio"] == 1.0
    assert quality["coverage_denominator"] == "source_ifc_entity_count"
    assert quality["coverage_status"] == "unlocked"
    assert quality["issue_to_real_prim_readiness"] is False
    group = store.get_artifact_group("ag_unlocked_quality")
    assert group["ready_status"] == "ready"
    assert group["mapping"]["ready"] is True


def test_store_locked_coverage_pass_verifies_issue_to_real_prim_readiness(tmp_path: Path):
    store = make_store(
        tmp_path,
        converter=FakeSuccessfulConverter(
            quality_overrides={
                "source_ifc_entity_count": 2,
                "mapped_entity_count": 2,
                "unmapped_entity_count": 0,
                "mapped_count": 2,
                "unmapped_count": 0,
                "coverage_ratio": 1.0,
                "minimum_coverage_baseline_locked": True,
            }
        ),
    )
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_locked_pass"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})

    completed = store.complete_conversion_job(job["conversion_job_id"])

    quality = completed["result"]["quality_metrics"]
    assert quality["coverage_status"] == "pass"
    assert quality["issue_to_real_prim_readiness"] is True
    group = store.get_artifact_group("ag_locked_pass")
    assert group["ready_status"] == "ready"
    assert group["mapping"]["ready"] is True


def test_store_coverage_warning_keeps_reviewable_but_not_verified(tmp_path: Path):
    store = make_store(
        tmp_path,
        converter=FakeSuccessfulConverter(
            quality_overrides={
                "minimum_coverage_baseline_locked": True,
                "coverage_status": "warn",
                "coverage_policy_diagnostics": [
                    {"code": "allowed_metadata_degradation", "severity": "warn", "message": "test warning"}
                ],
            }
        ),
    )
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_quality_warn"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})

    completed = store.complete_conversion_job(job["conversion_job_id"])

    quality = completed["result"]["quality_metrics"]
    assert quality["coverage_status"] == "warn"
    assert quality["issue_to_real_prim_readiness"] is False
    group = store.get_artifact_group("ag_quality_warn")
    assert group["ready_status"] == "ready"
    assert group["mapping"]["ready"] is True
    assert group["mapping"]["issue_to_real_prim_readiness"] is False


def test_store_coverage_fail_blocks_mapping_readiness(tmp_path: Path):
    store = make_store(
        tmp_path,
        converter=FakeSuccessfulConverter(
            quality_overrides={
                "minimum_coverage_baseline_locked": True,
                "coverage_status": "fail",
                "coverage_policy_diagnostics": [
                    {"code": "missing_ifc_entity_mapping", "severity": "error", "message": "test failure"}
                ],
            }
        ),
    )
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_quality_fail"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})

    completed = store.complete_conversion_job(job["conversion_job_id"])

    assert completed["result"]["quality_metrics"]["coverage_status"] == "fail"
    group = store.get_artifact_group("ag_quality_fail")
    assert group["status"] == "quality_failed"
    assert group["ready_status"] == "mapping_quality_failed"
    assert group["mapping"]["ready"] is False


def test_store_source_only_lineage_reports_missing_derived_artifacts(tmp_path: Path):
    store = make_store(tmp_path)
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_source_lineage"))

    lineage = store.get_artifact_lineage(upload["source_artifact_id"])

    assert lineage["artifact_id"] == upload["source_artifact_id"]
    assert lineage["current_artifact_kind"] == "source"
    assert lineage["root_source_artifact_id"] == upload["source_artifact_id"]
    assert lineage["nodes"] == [
        {
            "node_id": upload["source_artifact_id"],
            "artifact_id": upload["source_artifact_id"],
            "kind": "source",
            "role": "source_ifc",
            "format": "ifc",
            "object_key": upload["object_key"],
            "url": upload["object_url"],
            "sha256": upload["sha256"],
            "original_filename": "model.ifc",
        }
    ]
    assert lineage["diagnostics"][0]["code"] == "derived_artifacts_not_ready"


def test_store_lineage_uses_stable_derived_artifact_ids(tmp_path: Path):
    store = make_store(tmp_path)
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_lineage"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})
    completed = store.complete_conversion_job(job["conversion_job_id"])
    result = completed["result"]
    derived_ids = result["derived_artifact_ids"]

    lineage = store.get_artifact_lineage(result["usdc_artifact_id"])

    node_ids = {node["artifact_id"] for node in lineage["nodes"]}
    assert derived_ids["model_usdc"] in node_ids
    assert derived_ids["ifc_index"] in node_ids
    assert derived_ids["usd_index"] in node_ids
    assert derived_ids["element_mapping"] in node_ids
    assert lineage["quality_metrics_summary"]["minimum_coverage_ratio"] == 1.0
    assert {
        (edge["from"], edge["to"], edge["relationship"])
        for edge in lineage["edges"]
    } >= {
        (upload["source_artifact_id"], result["conversion_job_id"], "converted_by"),
        (result["conversion_job_id"], derived_ids["model_usdc"], "produced"),
    }


def test_store_lineage_can_be_queried_by_mapping_and_index_artifact_ids(tmp_path: Path):
    store = make_store(tmp_path)
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_lineage_sidecars"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})
    result = store.complete_conversion_job(job["conversion_job_id"])["result"]

    for key in ("ifc_index", "usd_index", "element_mapping"):
        artifact_id = result["derived_artifact_ids"][key]
        lineage = store.get_artifact_lineage(artifact_id)
        assert lineage["artifact_id"] == artifact_id
        assert lineage["current_artifact_kind"] == key
        assert lineage["root_source_artifact_id"] == upload["source_artifact_id"]


def test_store_lineage_returns_legacy_diagnostics_instead_of_failing(tmp_path: Path):
    store = make_store(tmp_path)
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_legacy_lineage"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})
    result = store.complete_conversion_job(job["conversion_job_id"])["result"]
    job_path = Path(store.settings.jobs_dir) / f"{job['conversion_job_id']}.json"
    legacy_job = read_json(job_path, {})
    legacy_job["result"].pop("derived_artifact_ids")
    metadata_path = Path(store.settings.objects_root) / result["lineage"]["derived_object_prefix"] / "metadata.json"
    metadata = read_json(metadata_path, {})
    metadata.pop("lineage")
    write_json(metadata_path, metadata)
    write_json(job_path, legacy_job)

    lineage = store.get_artifact_lineage(result["usdc_artifact_id"])

    assert lineage["artifact_id"] == result["usdc_artifact_id"]
    assert {item["code"] for item in lineage["diagnostics"]} >= {
        "missing_derived_artifact_ids",
        "missing_metadata_lineage",
    }


def test_store_surfaces_entity_index_sidecar_in_lineage_when_emitted(tmp_path: Path):
    """§5.5: lineage API must list the sidecar artifact when the converter emits entity_index.json."""

    class _SidecarConverter(FakeSuccessfulConverter):
        def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
            base = super().convert(
                source_path=source_path,
                output_dir=output_dir,
                job=job,
                generate_mapping=generate_mapping,
            )
            entity_index_path = output_dir / "entity_index.json"
            write_json(
                entity_index_path,
                {
                    "source_artifact_id": job["source_artifact_id"],
                    "mapping_method": "ifc_entity_to_sidecar_index",
                    "materialization_strategy": "sidecar",
                    "summary": {"sidecar_entity_count": 2},
                    "entities": [
                        {
                            "ifc_entity_key": "IfcPropertySet:42",
                            "ifc_entity_id": "42",
                            "ifc_guid": None,
                            "ifc_class": "IfcPropertySet",
                            "name": "Wall Pset",
                            "renderable": False,
                        },
                        {
                            "ifc_entity_key": "guid-project",
                            "ifc_entity_id": "1",
                            "ifc_guid": "guid-project",
                            "ifc_class": "IfcProject",
                            "name": "Demo project",
                            "renderable": False,
                        },
                    ],
                },
            )
            quality = dict(base.quality_metrics)
            quality["materialization_strategy"] = "sidecar"
            quality["sidecar_carrier_count"] = 2
            return ConversionAdapterResult(
                model_path=base.model_path,
                ifc_index_path=base.ifc_index_path,
                usd_index_path=base.usd_index_path,
                mapping_path=base.mapping_path,
                converter=base.converter,
                quality_metrics=quality,
                warnings=list(base.warnings),
                entity_index_path=entity_index_path,
            )

    store = make_store(tmp_path, converter=_SidecarConverter())
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_sidecar_lineage"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})
    completed = store.complete_conversion_job(job["conversion_job_id"])
    result = completed["result"]

    # Result surfaces entity_index_url + derived_artifact_ids.entity_index.
    assert result["entity_index_url"] is not None
    assert result["entity_index_url"].endswith("entity_index.json")
    assert "entity_index" in result["derived_artifact_ids"]
    entity_index_artifact_id = result["derived_artifact_ids"]["entity_index"]
    assert entity_index_artifact_id.startswith("artifact_entity_index_")

    # Lineage resolves the sidecar artifact and includes a has_sidecar edge.
    lineage = store.get_artifact_lineage(entity_index_artifact_id)
    assert lineage is not None
    assert lineage["current_artifact_kind"] == "entity_index"
    kinds = {node["kind"] for node in lineage["nodes"]}
    assert "entity_index" in kinds
    has_sidecar_edges = [edge for edge in lineage["edges"] if edge["relationship"] == "has_sidecar"]
    sidecar_targets = {edge["to"] for edge in has_sidecar_edges}
    assert entity_index_artifact_id in sidecar_targets

    # Artifact group "indexes" block also exposes the sidecar artifact and URL.
    group = store.get_artifact_group("ag_sidecar_lineage")
    assert group["indexes"]["entity_index_artifact_id"] == entity_index_artifact_id
    assert group["indexes"]["entity_index_url"] == result["entity_index_url"]


def test_store_omits_entity_index_lineage_when_carrier_is_usd_prim(tmp_path: Path):
    """When the converter does not emit a sidecar, the lineage MUST NOT fabricate one."""
    store = make_store(tmp_path)  # FakeSuccessfulConverter does not produce entity_index
    upload = store.create_source_artifact(make_intake_request(artifact_group_id="ag_no_sidecar"))
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})
    result = store.complete_conversion_job(job["conversion_job_id"])["result"]
    assert "entity_index" not in result["derived_artifact_ids"]
    assert result["entity_index_url"] is None
    lineage = store.get_artifact_lineage(result["usdc_artifact_id"])
    kinds = {node["kind"] for node in lineage["nodes"]}
    assert "entity_index" not in kinds


def test_store_conversion_without_mapping_sets_missing_mapping_status(tmp_path: Path):
    store = make_store(tmp_path)
    req = make_intake_request(artifact_group_id="ag_nomapping")
    upload = store.create_source_artifact(req)
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": False})
    store.complete_conversion_job(job["conversion_job_id"])
    group = store.get_artifact_group("ag_nomapping")
    assert group["ready_status"] == "missing_mapping"
    assert group["mapping"]["ready"] is False


def test_store_converter_unavailable_fails_without_ready_artifact_group(tmp_path: Path):
    store = make_store(tmp_path, converter=FakeUnavailableConverter())
    req = make_intake_request(artifact_group_id="ag_converter_missing")
    upload = store.create_source_artifact(req)
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})

    completed = store.complete_conversion_job(job["conversion_job_id"])

    assert completed["status"] == "failed"
    assert completed["result"]["ready"] is False
    assert "unavailable" in completed["result"]["error"]["message"]
    group = store.get_artifact_group("ag_converter_missing")
    assert group["status"] == "source_uploaded"
    assert group["ready_status"] == "missing_derived"


def test_store_rejects_placeholder_output_as_ready_evidence(tmp_path: Path):
    store = make_store(tmp_path, converter=FakeSuccessfulConverter(model_content=b"# worker adapter USDC placeholder\n"))
    req = make_intake_request(artifact_group_id="ag_placeholder")
    upload = store.create_source_artifact(req)
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})

    completed = store.complete_conversion_job(job["conversion_job_id"])

    assert completed["status"] == "failed"
    assert completed["result"]["ready"] is False
    assert "placeholder" in completed["result"]["error"]["message"].lower()
    group = store.get_artifact_group("ag_placeholder")
    assert group["ready_status"] == "missing_derived"


def test_store_rejects_non_openable_converter_output(tmp_path: Path):
    quality = {
        "hard_quality_gates": {
            "usdc_openable": False,
            "has_renderable_prims": True,
            "placeholder_output": False,
        }
    }
    store = make_store(tmp_path, converter=FakeSuccessfulConverter(quality_overrides=quality))
    req = make_intake_request(artifact_group_id="ag_non_openable")
    upload = store.create_source_artifact(req)
    job = store.create_conversion_job(upload["source_artifact_id"], {"target_format": "usdc", "generate_mapping": True})

    completed = store.complete_conversion_job(job["conversion_job_id"])

    assert completed["status"] == "failed"
    assert completed["result"]["ready"] is False
    assert "openability" in completed["result"]["error"]["message"].lower()
    group = store.get_artifact_group("ag_non_openable")
    assert group["ready_status"] == "missing_derived"


def test_store_object_url_constructs_from_public_base(tmp_path: Path):
    store = make_store(tmp_path)
    url = store.object_url("tenants/t1/projects/p1/model.usdc")
    assert url == "http://testserver/objects/tenants/t1/projects/p1/model.usdc"


def test_store_object_url_strips_leading_slash(tmp_path: Path):
    store = make_store(tmp_path)
    url = store.object_url("/tenants/t1/model.usdc")
    assert url == "http://testserver/objects/tenants/t1/model.usdc"
