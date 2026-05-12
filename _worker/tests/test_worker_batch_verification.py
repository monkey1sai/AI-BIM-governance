from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.batch_verification import run_storage_batch_verification
from app.converters import ConversionAdapterResult
from app.settings import Settings
from app.store import write_json


class FakeBatchConverter:
    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        ifc_index_path = output_dir / "ifc_index.json"
        usd_index_path = output_dir / "usd_index.json"
        mapping_path = output_dir / "element_mapping.json" if generate_mapping else None
        model_path.write_bytes(b"PXR-USDC-fake-openable\n")
        write_json(ifc_index_path, {"summary": {"source_ifc_entity_count": 1}, "entities": []})
        write_json(usd_index_path, {"summary": {"prim_count": 2, "mesh_prim_count": 1}, "prims": []})
        if mapping_path is not None:
            write_json(
                mapping_path,
                {
                    "mock": False,
                    "items": [
                        {
                            "ifc_entity_key": "guid-1",
                            "ifc_guid": "guid-1",
                            "usd_prim_path": "/World/IfcWall_guid_1",
                            "primary_usd_prim_path": "/World/IfcWall_guid_1",
                            "usd_prim_paths": ["/World/IfcWall_guid_1"],
                        }
                    ],
                    "summary": {"fake_mapping_count": 0, "coverage_ratio": 1.0},
                },
            )
        return ConversionAdapterResult(
            model_path=model_path,
            ifc_index_path=ifc_index_path,
            usd_index_path=usd_index_path,
            mapping_path=mapping_path,
            converter={"name": "fake-batch-converter"},
            quality_metrics={
                "source_ifc_entity_count": 1,
                "mapped_entity_count": 1,
                "unmapped_entity_count": 0,
                "coverage_ratio": 1.0,
                "minimum_coverage_baseline_locked": False,
                "hard_quality_gates": {
                    "usdc_openable": True,
                    "has_renderable_prims": True,
                    "placeholder_output": False,
                },
            },
            warnings=[],
        )


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        service_root=tmp_path,
        objects_root=tmp_path / "objects",
        jobs_dir=tmp_path / "jobs",
        dev_storage_root=tmp_path / "storage",
        fake_bim_control_url="http://127.0.0.1:1",
        public_objects_url="http://testserver/objects",
    )


def test_batch_verification_reports_blocked_for_missing_fixture_root(tmp_path: Path):
    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeBatchConverter())

    assert payload["status"] == "blocked"
    assert payload["minimum_coverage_locked"] is False
    assert payload["results"] == []


def test_batch_verification_preserves_duplicate_fixture_identity(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    duplicate_bytes = b"ISO-10303-21;\nEND-ISO-10303-21;\n"
    (storage / "A.ifc").write_bytes(duplicate_bytes)
    (storage / "B.ifc").write_bytes(duplicate_bytes)

    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeBatchConverter())

    assert payload["status"] == "passed"
    assert payload["minimum_coverage_locked"] is False
    assert [item["original_filename"] for item in payload["results"]] == ["A.ifc", "B.ifc"]
    assert len({item["source_artifact_id"] for item in payload["results"]}) == 2
    assert len({item["conversion_job_id"] for item in payload["results"]}) == 2
    assert all(item["lineage_api_status"] == "ok" for item in payload["results"])
