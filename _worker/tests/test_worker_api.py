import base64
import json
import os
import shutil
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.converters import ConversionAdapterResult, ConversionAdapterUnavailable, IfcOpenShellUsdConverter
from app.main import create_app
from app.settings import Settings
from app.store import write_json


class FakeSuccessfulConverter:
    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        ifc_index_path = output_dir / "ifc_index.json"
        usd_index_path = output_dir / "usd_index.json"
        mapping_path = output_dir / "element_mapping.json" if generate_mapping else None
        model_path.write_bytes(b"PXR-USDC-fake-openable\n")
        write_json(ifc_index_path, {"summary": {"element_count": 2, "guid_count": 2}, "elements": []})
        write_json(usd_index_path, {"summary": {"prim_count": 3, "mesh_prim_count": 2}, "prims": []})
        if mapping_path is not None:
            write_json(
                mapping_path,
                {
                    "mock": False,
                    "items": [
                        {
                            "ifc_guid": "guid-1",
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
        return ConversionAdapterResult(
            model_path=model_path,
            ifc_index_path=ifc_index_path,
            usd_index_path=usd_index_path,
            mapping_path=mapping_path,
            converter={"name": "test-fake-converter", "mock": True},
            quality_metrics={
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
            },
            warnings=[],
        )


class FakeUnavailableConverter:
    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        raise ConversionAdapterUnavailable("test converter is unavailable")


@pytest.fixture
def case_dir() -> Path:
    root = Path(__file__).resolve().parents[1] / "pytest-cache-files-worker"
    path = root / uuid4().hex
    path.mkdir(parents=True, exist_ok=False)
    return path


def make_client(case_dir: Path, run_background: bool = True, converter=None) -> TestClient:
    settings = Settings(
        service_root=case_dir,
        objects_root=case_dir / "objects",
        jobs_dir=case_dir / "jobs",
        dev_storage_root=case_dir / "storage",
        fake_bim_control_url="http://127.0.0.1:1",
        public_objects_url="http://testserver/objects",
    )
    return TestClient(create_app(settings=settings, run_background=run_background, converter=converter or FakeSuccessfulConverter()))


def real_ifc_storage_root() -> Path:
    return Path(os.getenv("WORKER_REAL_IFC_STORAGE_ROOT", r"C:\Repos\active\iot\AI-BIM-governance\storage"))


def source_payload(**overrides):
    payload = {
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "source_system": "revit",
        "uploaded_by": "dev_user_001",
        "filename": "source.ifc",
        "source_format": "ifc",
        "content_base64": base64.b64encode(b"ISO-10303-21;\nEND-ISO-10303-21;\n").decode("ascii"),
    }
    payload.update(overrides)
    return payload


def test_source_artifact_upload_writes_versioned_object_layout(case_dir: Path):
    client = make_client(case_dir)

    response = client.post("/api/artifacts", json=source_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["source_artifact_id"].startswith("artifact_src_")
    assert body["status"] == "uploaded"
    assert "tenants/tenant_demo_001/projects/project_demo_001/versions/version_demo_001/artifact-groups/" in body["object_key"]
    assert body["object_url"].startswith("http://testserver/objects/")

    object_response = client.get(body["object_url"].removeprefix("http://testserver"))
    assert object_response.status_code == 200
    assert b"ISO-10303-21" in object_response.content


def test_source_artifact_upload_preserves_original_filename_metadata_index_and_response(case_dir: Path):
    client = make_client(case_dir)
    original_filename = "許良宇圖書館建築_2026 - 複製 (1).ifc"

    response = client.post("/api/artifacts", json=source_payload(filename=original_filename))

    assert response.status_code == 200
    body = response.json()
    assert body["original_filename"] == original_filename
    assert body["metadata"]["original_filename"] == original_filename
    assert original_filename not in body["object_key"]

    object_path = case_dir / "objects" / Path(*body["object_key"].split("/"))
    metadata = json.loads((object_path.parents[1] / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["original_filename"] == original_filename

    index = json.loads((case_dir / "objects" / "_index" / "source_artifacts.json").read_text(encoding="utf-8"))
    entry = next(item for item in index["items"] if item["source_artifact_id"] == body["source_artifact_id"])
    assert entry["original_filename"] == original_filename
    assert entry["metadata"]["original_filename"] == original_filename


def test_object_download_allows_local_viewer_origin(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    response = client.get(
        artifact["object_url"].removeprefix("http://testserver"),
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_dev_ifc_sources_reports_missing_root_without_paths(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/dev/ifc-sources")

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["root"]["exists"] is False
    assert str(case_dir) not in response.text


def test_worker_demo_ui_loads_without_legacy_services(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/")

    assert response.status_code == 200
    assert "Worker 上傳建模與自動轉換" in response.text
    assert "/api/dev/ifc-sources" in response.text
    assert "8002" not in response.text
    assert "8003" not in response.text


def test_dev_ifc_sources_lists_recursive_ifc_only_without_absolute_paths(case_dir: Path):
    storage = case_dir / "storage"
    nested = storage / "nested"
    nested.mkdir(parents=True)
    (storage / "A.ifc").write_text("ISO-10303-21;", encoding="utf-8")
    (nested / "B.IFC").write_text("ISO-10303-21;", encoding="utf-8")
    (nested / "note.txt").write_text("not ifc", encoding="utf-8")
    client = make_client(case_dir)

    response = client.get("/api/dev/ifc-sources")

    assert response.status_code == 200
    body = response.json()
    assert [item["relative_path"] for item in body["items"]] == ["A.ifc", "nested/B.IFC"]
    assert all(item["source_id"] for item in body["items"])
    assert str(storage) not in response.text


def test_selected_dev_ifc_source_creates_artifact_and_conversion_job(case_dir: Path):
    storage = case_dir / "storage"
    storage.mkdir()
    (storage / "source.ifc").write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")
    client = make_client(case_dir)
    source = client.get("/api/dev/ifc-sources").json()["items"][0]

    response = client.post(
        f"/api/dev/ifc-sources/{source['source_id']}/conversions",
        json={
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "source_system": "dev_storage",
            "uploaded_by": "dev_user_001",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"]["relative_path"] == "source.ifc"
    assert body["source_artifact_id"].startswith("artifact_src_")
    assert body["artifact_group_id"].startswith("ag_")
    assert body["conversion_job_id"].startswith("conv_")
    result = client.get(body["result_url"])
    assert result.status_code == 200
    assert result.json()["status"] == "succeeded"


def test_selected_dev_ifc_source_conversion_preserves_original_filename(case_dir: Path):
    storage = case_dir / "storage"
    storage.mkdir()
    original_filename = "許良宇圖書館建築_2026 - 複製 (2).ifc"
    (storage / original_filename).write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")
    client = make_client(case_dir)
    source = client.get("/api/dev/ifc-sources").json()["items"][0]

    response = client.post(
        f"/api/dev/ifc-sources/{source['source_id']}/conversions",
        json={
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "source_system": "dev_storage",
            "uploaded_by": "dev_user_001",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"]["filename"] == original_filename
    assert body["original_filename"] == original_filename

    result = client.get(body["result_url"])
    assert result.status_code == 200
    assert result.json()["original_filename"] == original_filename


def test_real_ifc_inputs_preserve_filename_through_worker_adapter_conversions(case_dir: Path):
    """Uses real IFC bytes with an explicit test converter, not runtime evidence."""
    real_storage = real_ifc_storage_root()
    real_ifc_files = sorted(real_storage.glob("*.ifc"), key=lambda path: path.name.casefold())
    if len(real_ifc_files) < 2:
        pytest.skip(f"Need at least two real IFC files under {real_storage}.")

    storage = case_dir / "storage"
    storage.mkdir()
    selected_files = real_ifc_files[:2]
    for source_file in selected_files:
        shutil.copy2(source_file, storage / source_file.name)

    client = make_client(case_dir)
    sources = client.get("/api/dev/ifc-sources").json()["items"]
    assert [source["filename"] for source in sources] == [source_file.name for source_file in selected_files]

    conversions = []
    for index, source in enumerate(sources):
        response = client.post(
            f"/api/dev/ifc-sources/{source['source_id']}/conversions",
            json={
                "tenant_id": "tenant_demo_001",
                "project_id": "project_demo_001",
                "model_version_id": "version_demo_001",
                "source_system": "dev_storage",
                "uploaded_by": "dev_user_001",
                "artifact_group_id": f"ag_real_ifc_{index}",
            },
        )

        assert response.status_code == 200
        body = response.json()
        result = client.get(body["result_url"])
        assert result.status_code == 200
        conversions.append((source, body, result.json()))

    assert len({body["source_artifact_id"] for _, body, _ in conversions}) == len(selected_files)
    assert len({body["conversion_job_id"] for _, body, _ in conversions}) == len(selected_files)
    assert len({result["source_url"] for _, _, result in conversions}) == len(selected_files)

    index = json.loads((case_dir / "objects" / "_index" / "source_artifacts.json").read_text(encoding="utf-8"))
    index_by_artifact = {item["source_artifact_id"]: item for item in index["items"]}
    for source, body, result in conversions:
        assert body["original_filename"] == source["filename"]
        assert result["status"] == "succeeded"
        assert result["original_filename"] == source["filename"]
        assert result["usdc_url"].endswith("/model.usdc")
        assert index_by_artifact[body["source_artifact_id"]]["original_filename"] == source["filename"]
        assert source["filename"] not in result["lineage"]["source_object_key"]


def test_real_ifc_files_convert_to_kit_openable_usdc_when_enabled(case_dir: Path):
    if os.getenv("WORKER_RUN_REAL_USDC_SMOKE") != "1":
        pytest.skip("Set WORKER_RUN_REAL_USDC_SMOKE=1 to run the opt-in real IFC-to-USDC smoke test.")

    storage_root = real_ifc_storage_root()
    if not storage_root.exists():
        pytest.skip(f"Real IFC storage root is missing: {storage_root}")

    real_ifc_files = sorted(storage_root.glob("*.ifc"), key=lambda path: path.name.casefold())
    if not real_ifc_files:
        pytest.skip(f"Need at least one real IFC file under {storage_root}.")

    storage = case_dir / "storage"
    storage.mkdir()
    shutil.copy2(real_ifc_files[0], storage / real_ifc_files[0].name)
    client = make_client(case_dir, converter=IfcOpenShellUsdConverter())
    source = client.get("/api/dev/ifc-sources").json()["items"][0]

    response = client.post(
        f"/api/dev/ifc-sources/{source['source_id']}/conversions",
        json={
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "source_system": "dev_storage",
            "uploaded_by": "dev_user_001",
            "artifact_group_id": "ag_real_converter_smoke",
        },
    )

    assert response.status_code == 200
    body = response.json()
    result = client.get(body["result_url"]).json()
    assert result["status"] == "succeeded"
    assert result["quality_metrics"]["hard_quality_gates"]["usdc_openable"] is True
    assert result["quality_metrics"]["usd_prim_count"] > 1
    assert result["quality_metrics"]["coverage_ratio"] >= 0

    derived_root = case_dir / "objects" / Path(*result["lineage"]["derived_object_prefix"].split("/"))
    assert (derived_root / "model.usdc").stat().st_size > 1024
    mapping = json.loads((derived_root / "element_mapping.json").read_text(encoding="utf-8"))
    assert mapping["mock"] is False
    assert mapping["summary"]["fake_mapping_count"] == 0
    assert mapping["items"][0]["usd_prim_path"] == mapping["items"][0]["primary_usd_prim_path"]


def test_selected_dev_ifc_source_rejects_stale_source_id(case_dir: Path):
    storage = case_dir / "storage"
    storage.mkdir()
    source_file = storage / "source.ifc"
    source_file.write_text("ISO-10303-21;\n", encoding="utf-8")
    client = make_client(case_dir)
    source_id = client.get("/api/dev/ifc-sources").json()["items"][0]["source_id"]
    source_file.write_text("ISO-10303-21;\nDATA;\n", encoding="utf-8")

    response = client.post(
        f"/api/dev/ifc-sources/{source_id}/conversions",
        json={
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "source_system": "dev_storage",
            "uploaded_by": "dev_user_001",
        },
    )

    assert response.status_code == 404
    assert "Unknown or stale" in response.json()["detail"]


def test_source_artifact_rejects_missing_lineage(case_dir: Path):
    client = make_client(case_dir)
    payload = source_payload()
    payload.pop("project_id")

    response = client.post("/api/artifacts", json=payload)

    assert response.status_code == 422


def test_conversion_can_remain_queued_without_background_runner(case_dir: Path):
    client = make_client(case_dir, run_background=False)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    response = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    result = client.get(f"/api/conversions/{body['conversion_job_id']}/result")
    assert result.status_code == 200
    assert result.json()["ready"] is False


def test_conversion_result_contains_derived_urls_lineage_and_readiness(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )

    assert created.status_code == 200
    job_id = created.json()["conversion_job_id"]
    job = client.get(f"/api/conversions/{job_id}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"

    result = client.get(f"/api/conversions/{job_id}/result")
    assert result.status_code == 200
    body = result.json()
    assert body["status"] == "succeeded"
    assert body["usdc_url"].endswith("/model.usdc")
    assert body["mapping_url"].endswith("/element_mapping.json")
    assert body["lineage"]["source_artifact_id"] == artifact["source_artifact_id"]
    assert body["converter"]["name"] == "test-fake-converter"
    assert body["quality_metrics"]["coverage_ratio"] == 0.5
    assert body["quality_metrics"]["hard_quality_gates"]["usdc_openable"] is True

    readiness = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")
    assert readiness.status_code == 200
    assert readiness.json()["ready_status"] == "ready"


def test_artifact_lineage_api_returns_source_only_graph_before_conversion(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_api_source_lineage")).json()

    response = client.get(f"/api/artifacts/{artifact['source_artifact_id']}/lineage")

    assert response.status_code == 200
    body = response.json()
    assert body["current_artifact_kind"] == "source"
    assert body["root_source_artifact_id"] == artifact["source_artifact_id"]
    assert body["nodes"][0]["artifact_id"] == artifact["source_artifact_id"]
    assert body["diagnostics"][0]["code"] == "derived_artifacts_not_ready"


def test_artifact_lineage_api_returns_stable_derived_nodes(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_api_lineage")).json()
    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )
    result = client.get(f"/api/conversions/{created.json()['conversion_job_id']}/result").json()
    derived_ids = result["derived_artifact_ids"]

    response = client.get(f"/api/artifacts/{result['usdc_artifact_id']}/lineage")

    assert response.status_code == 200
    body = response.json()
    node_ids = {node["artifact_id"] for node in body["nodes"]}
    assert derived_ids["model_usdc"] in node_ids
    assert derived_ids["ifc_index"] in node_ids
    assert derived_ids["usd_index"] in node_ids
    assert derived_ids["element_mapping"] in node_ids
    assert body["quality_metrics_summary"]["minimum_coverage_ratio"] == 1.0


def test_artifact_lineage_api_accepts_mapping_and_index_artifact_ids(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_api_lineage_sidecars")).json()
    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )
    result = client.get(f"/api/conversions/{created.json()['conversion_job_id']}/result").json()

    for key in ("ifc_index", "usd_index", "element_mapping"):
        artifact_id = result["derived_artifact_ids"][key]
        response = client.get(f"/api/artifacts/{artifact_id}/lineage")
        assert response.status_code == 200
        assert response.json()["current_artifact_kind"] == key


def test_artifact_lineage_api_returns_404_for_unknown_artifact(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/artifacts/artifact_unknown/lineage")

    assert response.status_code == 404


def test_artifact_group_readiness_exposes_mapping_quality_fields(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_api_quality")).json()
    client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )

    readiness = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")

    assert readiness.status_code == 200
    body = readiness.json()
    assert body["coverage_status"] == "unlocked"
    assert body["mapping_quality_ready"] is True
    assert body["issue_to_real_prim_readiness"] is False


def test_conversion_failure_does_not_publish_ready_artifact_group(case_dir: Path):
    client = make_client(case_dir, converter=FakeUnavailableConverter())
    artifact = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_api_converter_missing")).json()

    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )

    assert created.status_code == 200
    job_id = created.json()["conversion_job_id"]
    job = client.get(f"/api/conversions/{job_id}")
    assert job.json()["status"] == "failed"

    result = client.get(f"/api/conversions/{job_id}/result").json()
    assert result["ready"] is False
    assert result["usdc_url"] is None
    assert "unavailable" in result["error"]["message"]

    readiness = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")
    assert readiness.json()["ready_status"] == "missing_derived"
    assert readiness.json()["has_derived"] is False


def test_callback_failure_is_recorded_as_job_warning(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload()).json()

    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )

    assert created.status_code == 200
    job = client.get(f"/api/conversions/{created.json()['conversion_job_id']}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"
    assert any("_bim-control callback failed" in warning for warning in job.json()["warnings"])


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


def test_health_returns_ok(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "_worker"


# ---------------------------------------------------------------------------
# Additional artifact intake tests
# ---------------------------------------------------------------------------


def test_content_text_intake_stores_utf8_bytes(case_dir: Path):
    client = make_client(case_dir)
    text_content = "ISO-10303-21;\nHEADER; /* 建模 */\nEND-ISO-10303-21;\n"

    response = client.post("/api/artifacts", json=source_payload(content_text=text_content, content_base64=None))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "uploaded"
    download = client.get(body["object_url"].removeprefix("http://testserver"))
    assert download.status_code == 200
    assert "ISO-10303-21" in download.text


def test_source_url_intake_writes_reference_stub(case_dir: Path):
    client = make_client(case_dir)
    ref_url = "http://example.com/model.ifc"

    response = client.post(
        "/api/artifacts",
        json=source_payload(source_url=ref_url, content_base64=None),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "uploaded"
    download = client.get(body["object_url"].removeprefix("http://testserver"))
    assert download.status_code == 200
    downloaded_json = download.json()
    assert downloaded_json["upload_reference"] == ref_url


def test_custom_artifact_group_id_is_preserved(case_dir: Path):
    client = make_client(case_dir)

    response = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_custom_abc"))

    assert response.status_code == 200
    assert response.json()["artifact_group_id"] == "ag_custom_abc"


def test_artifact_intake_rejects_all_empty_required_string_fields(case_dir: Path):
    client = make_client(case_dir)
    payload = source_payload()
    payload["tenant_id"] = ""

    response = client.post("/api/artifacts", json=payload)

    assert response.status_code == 422


def test_artifact_intake_accepts_rvt_format(case_dir: Path):
    client = make_client(case_dir)

    response = client.post("/api/artifacts", json=source_payload(source_format="rvt", filename="model.rvt"))

    assert response.status_code == 200
    assert response.json()["status"] == "uploaded"


def test_artifact_intake_accepts_dwg_format(case_dir: Path):
    client = make_client(case_dir)

    response = client.post("/api/artifacts", json=source_payload(source_format="dwg", filename="plan.dwg"))

    assert response.status_code == 200
    assert response.json()["status"] == "uploaded"


# ---------------------------------------------------------------------------
# Artifact group endpoint tests
# ---------------------------------------------------------------------------


def test_get_artifact_group_returns_source_uploaded_after_intake(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_group_test")).json()

    response = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "source_uploaded"
    assert body["ready_status"] == "missing_derived"
    assert body["derived"] == []


def test_get_artifact_group_returns_404_for_missing(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/artifact-groups/ag_nonexistent")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_get_artifact_group_readiness_returns_missing_derived_before_conversion(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_readiness_test")).json()

    readiness = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")

    assert readiness.status_code == 200
    body = readiness.json()
    assert body["ready_status"] == "missing_derived"
    assert body["has_source"] is True
    assert body["has_derived"] is False
    assert body["has_mapping"] is False


def test_get_artifact_group_readiness_returns_404_for_missing(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/artifact-groups/ag_nonexistent/readiness")

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Conversion endpoint edge cases
# ---------------------------------------------------------------------------


def test_conversion_returns_404_for_unknown_source_artifact(case_dir: Path):
    client = make_client(case_dir, run_background=False)

    response = client.post(
        "/api/conversions",
        json={"source_artifact_id": "artifact_src_nonexistent", "target_format": "usdc"},
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_get_conversion_returns_404_for_unknown_job(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/conversions/conv_99999999_ffffffff")

    assert response.status_code == 404


def test_conversion_result_ifc_and_usd_index_urls_are_returned(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload()).json()
    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": True},
    )
    result = client.get(f"/api/conversions/{created.json()['conversion_job_id']}/result").json()

    assert result["ifc_index_url"].endswith("/ifc_index.json")
    assert result["usd_index_url"].endswith("/usd_index.json")


def test_conversion_without_mapping_has_null_mapping_url(case_dir: Path):
    client = make_client(case_dir)
    artifact = client.post("/api/artifacts", json=source_payload(artifact_group_id="ag_no_mapping")).json()
    created = client.post(
        "/api/conversions",
        json={"source_artifact_id": artifact["source_artifact_id"], "target_format": "usdc", "generate_mapping": False},
    )
    assert created.status_code == 200
    job_id = created.json()["conversion_job_id"]

    result = client.get(f"/api/conversions/{job_id}/result").json()
    assert result["mapping_url"] is None

    readiness = client.get(f"/api/artifact-groups/{artifact['artifact_group_id']}/readiness")
    assert readiness.json()["ready_status"] == "missing_mapping"
    assert readiness.json()["has_mapping"] is False


# ---------------------------------------------------------------------------
# Object path traversal protection
# ---------------------------------------------------------------------------


def test_object_endpoint_rejects_path_traversal(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/objects/../../../etc/passwd")

    # Should be 400 (path traversal rejected) or 404 (resolved outside root)
    assert response.status_code in (400, 404)


def test_object_endpoint_returns_404_for_missing_file(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/objects/tenants/t1/missing.ifc")

    assert response.status_code == 404
