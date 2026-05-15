from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.batch_queue import (
    batch_queue_status,
    enqueue_batch_queue,
    read_batch_queue,
)
from app.batch_verification import run_storage_batch_verification
from app.converters import ConversionAdapterResult, ConversionAdapterUnavailable
from app.settings import Settings
from app.store import write_json


class FakeBatchConverter:
    def __init__(self, *, locked: bool = False):
        self.locked = locked
        self.profile_flags: list[bool] = []

    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        self.profile_flags.append(bool(job.get("profile_source_entity_enumeration")))
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
                "minimum_coverage_baseline_locked": self.locked,
                "coverage_status": "pass" if self.locked else "unlocked",
                "hard_quality_gates": {
                    "usdc_openable": True,
                    "has_renderable_prims": True,
                    "placeholder_output": False,
                },
            },
            warnings=[],
        )


class FakeFailingBatchConverter:
    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        raise ConversionAdapterUnavailable("test converter unavailable")


class FakeProgressThenSlowBatchConverter:
    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        progress_path = job.get("phase_progress_path")
        if progress_path:
            write_json(
                Path(progress_path),
                {
                    "conversion_job_id": job.get("conversion_job_id"),
                    "source_artifact_id": job.get("source_artifact_id"),
                    "current_phase": "geometry_iteration",
                    "status": "running",
                    "phase_timings": {
                        "ifc_open": {"status": "completed", "duration_seconds": 0.01},
                        "source_entity_enumeration": {"status": "completed", "duration_seconds": 0.02},
                        "geometry_iteration": {
                            "status": "not_reached",
                            "duration_seconds": None,
                            "diagnostic": "phase_not_reached",
                        },
                    },
                },
            )
        time.sleep(10)
        raise AssertionError("timeout test should terminate the process before this converter returns")


class FakeSourceEnumerationProgressThenSlowBatchConverter:
    def convert(self, *, source_path: Path, output_dir: Path, job: dict, generate_mapping: bool) -> ConversionAdapterResult:
        progress_path = job.get("phase_progress_path")
        if progress_path:
            write_json(
                Path(progress_path),
                {
                    "conversion_job_id": job.get("conversion_job_id"),
                    "source_artifact_id": job.get("source_artifact_id"),
                    "current_phase": "source_entity_enumeration",
                    "status": "running",
                    "phase_timings": {
                        "ifc_open": {"status": "completed", "duration_seconds": 0.01},
                        "source_entity_enumeration": {
                            "status": "running",
                            "duration_seconds": None,
                            "diagnostic": "enumerating_ifc_source_entities",
                            "details": {
                                "enumerated_entity_count": 42000,
                                "last_ifc_class": "IfcRelDefinesByProperties",
                                "last_operation": "extract_name",
                                "elapsed_seconds": 37.4,
                                "fallback_used": False,
                            },
                        },
                    },
                },
            )
        time.sleep(10)
        raise AssertionError("timeout test should terminate the process before this converter returns")


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


def test_batch_verification_dry_run_is_partial_and_unlocked(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeBatchConverter(), dry_run=True)

    assert payload["status"] == "partial"
    assert payload["minimum_coverage_locked"] is False
    assert payload["results"][0]["status"] == "partial"
    assert payload["results"][0]["phase_timings"]["source_read"]["status"] == "not_run"


def test_batch_verification_subset_is_partial_and_unlocked(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    (storage / "B.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeBatchConverter(), limit=1)

    assert payload["status"] == "partial"
    assert payload["minimum_coverage_locked"] is False
    assert payload["selected_count"] == 1
    assert payload["results"][0]["status"] == "passed"


def test_batch_verification_timeout_is_classified_and_unlocked(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(
        make_settings(tmp_path),
        converter=FakeProgressThenSlowBatchConverter(),
        timeout_seconds=2.0,
    )

    assert payload["status"] == "timed_out"
    assert payload["timed_out_count"] == 1
    assert payload["minimum_coverage_locked"] is False
    assert payload["results"][0]["status"] == "timed_out"
    assert payload["results"][0]["timeout_seconds"] == 2.0
    assert payload["results"][0]["last_known_phase_diagnostics"]["phase"] == "geometry_iteration"
    assert payload["results"][0]["phase_timings"]["source_read"]["status"] == "completed"
    assert payload["results"][0]["phase_timings"]["artifact_intake"]["status"] == "completed"
    assert payload["results"][0]["phase_timings"]["ifc_open"]["status"] == "completed"
    assert payload["results"][0]["phase_timings"]["geometry_iteration"]["status"] == "timed_out"


def test_batch_verification_timeout_preserves_source_enumeration_progress_details(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(
        make_settings(tmp_path),
        converter=FakeSourceEnumerationProgressThenSlowBatchConverter(),
        timeout_seconds=2.0,
    )

    result = payload["results"][0]
    source_timing = result["phase_timings"]["source_entity_enumeration"]
    assert result["status"] == "timed_out"
    assert result["last_known_phase_diagnostics"]["phase"] == "source_entity_enumeration"
    assert result["last_known_phase_diagnostics"]["details"]["enumerated_entity_count"] == 42000
    assert source_timing["status"] == "timed_out"
    assert source_timing["details"]["enumerated_entity_count"] == 42000
    assert source_timing["details"]["last_operation"] == "extract_name"


def test_batch_verification_failed_fixture_is_failed_and_unlocked(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeFailingBatchConverter())

    assert payload["status"] == "failed"
    assert payload["failure_count"] == 1
    assert payload["minimum_coverage_locked"] is False
    assert payload["results"][0]["status"] == "failed"


def test_batch_verification_full_locked_pass_can_lock_baseline(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeBatchConverter(locked=True))

    assert payload["status"] == "passed"
    assert payload["minimum_coverage_locked"] is True
    assert payload["results"][0]["coverage_status"] == "pass"


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
    assert all(item["status"] == "passed" for item in payload["results"])
    assert all(item["phase_timings"]["source_read"]["status"] == "completed" for item in payload["results"])
    assert all(item["phase_timings"]["artifact_publish"]["status"] == "completed" for item in payload["results"])
    assert all(item["review_viewer_handoff"]["params"]["usdc_url"] for item in payload["results"])


def test_batch_verification_can_enable_source_entity_profiling_flag(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    converter = FakeBatchConverter()

    run_storage_batch_verification(
        make_settings(tmp_path),
        converter=converter,
        profile_source_entities=True,
    )

    assert converter.profile_flags == [True]


def test_batch_verification_outcome_distribution_is_derivable_from_records(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    (storage / "B.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    (storage / "C.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeBatchConverter(locked=True))

    distribution = payload["outcome_distribution"]
    assert distribution["total"] == 3
    expected_buckets = {"passed", "passed_with_quality_warning", "timed_out", "failed", "blocked"}
    assert expected_buckets.issubset(distribution.keys())
    # All 3 records should land in the `passed` bucket — locked=True FakeBatchConverter emits
    # coverage_status=pass and fixture_status returns "passed".
    assert distribution["passed"]["count"] == 3
    assert distribution["passed"]["rate"] == 1.0
    for bucket in ("passed_with_quality_warning", "timed_out", "failed", "blocked"):
        assert distribution[bucket]["count"] == 0
        assert distribution[bucket]["rate"] == 0.0
    # Distribution is fully derivable from per-fixture records; recomputing matches.
    from app.batch_verification import _compute_outcome_distribution

    assert _compute_outcome_distribution(payload["results"]) == distribution


def test_batch_verification_outcome_distribution_mixes_quality_warning_and_failure(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeBatchConverter())

    # FakeBatchConverter() (locked=False) emits coverage_status="unlocked"; fixture_status stays
    # "passed" but the unlocked state must NOT bucket as "passed" — it becomes a quality warning.
    distribution = payload["outcome_distribution"]
    assert distribution["passed"]["count"] == 0
    assert distribution["passed_with_quality_warning"]["count"] == 1
    assert payload["minimum_coverage_locked"] is False


def test_batch_verification_subset_run_cannot_lock_baseline_even_when_all_pass(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    (storage / "B.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    # Even though FakeBatchConverter(locked=True) would mark the run as passed, processing only
    # a subset of the fixture root MUST NOT lock the coverage baseline. The canonical lock gate
    # requires the full batch (no --limit subset).
    payload = run_storage_batch_verification(
        make_settings(tmp_path),
        converter=FakeBatchConverter(locked=True),
        limit=1,
    )

    assert payload["status"] == "partial"
    assert payload["minimum_coverage_locked"] is False
    assert payload["outcome_distribution"]["total"] == 1
    assert payload["outcome_distribution"]["passed"]["count"] == 1


def test_batch_verification_failed_fixture_buckets_into_failed(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    (storage / "B.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(make_settings(tmp_path), converter=FakeFailingBatchConverter())

    distribution = payload["outcome_distribution"]
    assert distribution["total"] == 2
    assert distribution["failed"]["count"] == 2
    assert distribution["passed"]["count"] == 0
    assert payload["minimum_coverage_locked"] is False


def test_batch_verification_timed_out_fixture_buckets_into_timed_out(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")

    payload = run_storage_batch_verification(
        make_settings(tmp_path),
        converter=FakeProgressThenSlowBatchConverter(),
        timeout_seconds=2.0,
    )

    distribution = payload["outcome_distribution"]
    assert distribution["total"] == 1
    assert distribution["timed_out"]["count"] == 1
    assert distribution["passed"]["count"] == 0
    assert payload["minimum_coverage_locked"] is False


# --- M.1: --enqueue / --status minimal reversible slice -----------------------


def make_queue_settings(tmp_path: Path) -> Settings:
    """Settings whose batch_queue_path is pinned under tmp (never the real home)."""
    return Settings(
        service_root=tmp_path,
        objects_root=tmp_path / "objects",
        jobs_dir=tmp_path / "jobs",
        dev_storage_root=tmp_path / "storage",
        batch_queue_path=tmp_path / "queue" / "batch_queue.json",
        fake_bim_control_url="http://127.0.0.1:1",
        public_objects_url="http://testserver/objects",
    )


def test_batch_queue_enqueue_builds_manifest(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    (storage / "B.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\nB\n")
    settings = make_queue_settings(tmp_path)

    manifest = enqueue_batch_queue(settings)

    assert manifest["manifest_version"] == 1
    assert Path(settings.batch_queue_path).is_file()
    assert read_batch_queue(settings.batch_queue_path) == manifest
    fixtures = manifest["fixtures"]
    assert [row["filename"] for row in fixtures] == ["A.ifc", "B.ifc"]
    assert all(row["status"] == "pending" for row in fixtures)
    assert all(row["history"] == [] for row in fixtures)
    assert len({row["source_id"] for row in fixtures}) == 2


def test_batch_queue_enqueue_is_idempotent_and_preserves_recorded_outcome(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    settings = make_queue_settings(tmp_path)

    first = enqueue_batch_queue(settings)
    created_at = first["created_at"]
    # Simulate a later recorded terminal outcome on the existing row.
    recorded = read_batch_queue(settings.batch_queue_path)
    recorded["fixtures"][0]["status"] = "passed"
    recorded["fixtures"][0]["history"] = [{"event": "passed"}]
    from app.batch_queue import write_batch_queue

    write_batch_queue(settings.batch_queue_path, recorded)

    # A new fixture appears; re-enqueue must NOT reset the recorded row.
    (storage / "B.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\nB\n")
    second = enqueue_batch_queue(settings)

    by_name = {row["filename"]: row for row in second["fixtures"]}
    assert by_name["A.ifc"]["status"] == "passed"
    assert by_name["A.ifc"]["history"] == [{"event": "passed"}]
    assert by_name["B.ifc"]["status"] == "pending"
    assert second["created_at"] == created_at  # created_at is preserved


def test_batch_queue_status_reflects_pending(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    (storage / "A.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\n")
    (storage / "B.ifc").write_bytes(b"ISO-10303-21;\nEND-ISO-10303-21;\nB\n")
    settings = make_queue_settings(tmp_path)

    before = batch_queue_status(settings)
    assert before["exists"] is False

    enqueue_batch_queue(settings)
    after = batch_queue_status(settings)

    assert after["exists"] is True
    assert after["total"] == 2
    assert after["counts"]["pending"] == 2
    assert after["pending_remaining"] == 2
    assert after["all_dispatched"] is False
