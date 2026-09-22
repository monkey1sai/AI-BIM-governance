"""CFD job service (P2 S1): HTTP + store behaviour against the frozen S0 contracts.

The docker-backed runner is replaced by a fake that writes the files the
contract expects, so these tests need neither docker nor OpenFOAM. The real
pipeline is exercised separately (tools/cfd tests + local evidence run).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

MODULE_DIR = (
    Path(__file__).resolve().parents[1]
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))
REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = REPO_ROOT / "tests" / "contracts"

from cfd_job_service import (  # noqa: E402
    CfdRequestError,
    CfdWorkerUnavailable,
    _Cancelled,
    _StageFailure,
    load_cfd_config,
    validate_run_request,
)
from host_native_conversion_service import build_app, load_config  # noqa: E402


def _schema(name: str) -> Draft202012Validator:
    return Draft202012Validator(json.loads((CONTRACTS / f"{name}.schema.json").read_text(encoding="utf-8")))


def _example(name: str) -> dict:
    return json.loads((CONTRACTS / f"{name}.schema.json").read_text(encoding="utf-8"))["examples"][0]


class FakeConverter:
    def preflight(self) -> None:
        return None

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:  # pragma: no cover - unused here
        raise AssertionError("conversion not exercised by CFD tests")


class FakeCfdRunner:
    """Writes the contract-shaped outputs without docker."""

    def __init__(self, *, fail_stage: str | None = None, unavailable: bool = False, cancel_after_preprocess: bool = False):
        self.fail_stage = fail_stage
        self.unavailable = unavailable
        self.cancel_after_preprocess = cancel_after_preprocess
        self.calls: list[dict] = []

    def preflight(self) -> None:
        if self.unavailable:
            raise CfdWorkerUnavailable("docker missing (fake)")

    def execute(self, *, run, run_dir, conversion_dir, model_usdc, progress, is_cancelled):
        self.calls.append({"run_id": run["run_id"], "model_usdc": str(model_usdc)})
        request = run["request"]
        progress(status="preprocessing")
        if self.fail_stage == "preprocess":
            raise _StageFailure("preprocess_failed", "no elements left (fake)")
        (run_dir / "exclusions.json").write_text(json.dumps({"schema": "cfd-exclusion-list/v1", "counts": {"class_excluded": 3, "outlier": 1}, "items": []}), encoding="utf-8")
        (run_dir / "shell.stl").write_bytes(b"\0" * 84)
        progress(sealing_suspect=False)
        if self.cancel_after_preprocess or is_cancelled():
            raise _Cancelled()
        directions = []
        for direction in request["wind"]["wind_from_degrees"]:
            tag = f"w{int(round(direction)) % 360:03d}"
            progress(status="solving", current_container=f"cfd_{run['run_id']}_{tag}")
            if self.fail_stage == "solver":
                raise _StageFailure("solver_failed", "FOAM FATAL (fake)")
            layer = run_dir / f"{run['run_id']}_{tag}.usdc"
            layer.write_bytes(b"PXR-USDC-fake-layer-" + tag.encode())
            directions.append(
                {
                    "wind_from_degrees": direction,
                    "status": "ready",
                    "converged_by_residual_control": True,
                    "iterations": 285,
                    "end_time_extended_to": None if direction == 0 else 1200,
                    "mesh_cells": 626099,
                    "overlay_layer": {"artifact_id": f"cfd:{run['run_id']}:{tag}", "filename": layer.name, "sha256": hashlib.sha256(layer.read_bytes()).hexdigest()},
                    "pedestrian_1p5m": {"U_magnitude_max": 3.58, "polygons": 29096},
                    "building_pressure": {"p_min": -17.6, "p_max": 11.8},
                }
            )
            progress(directions_done=len(directions), converged_count=len(directions), current_container=None)
        record = run_dir / "run_record.json"
        record.write_text(json.dumps({"schema": "cfd-run-record/v1", "run_id": run["run_id"], "directions": []}), encoding="utf-8")
        return {
            "schema": "cfd-run-result/v1",
            "run_id": run["run_id"],
            "status": "ready",
            "purpose": "design_comparison_only",
            "source": dict(request["source"]),
            "preprocess": {"profile": "exterior-wind/v1", "closing_radius_voxels": request["preprocess"]["closing_radius_voxels"], "leak_fraction": 0.1198, "leak_fraction_limit": request["preprocess"]["leak_fraction_limit"], "sealing_suspect": False, "appendage_policy": "included"},
            "directions": directions,
            "validation_level": "screening",
            "run_record": {"schema": "cfd-run-record/v1", "filename": "run_record.json", "sha256": hashlib.sha256(record.read_bytes()).hexdigest()},
            "exclusions": {"filename": "exclusions.json", "sha256": hashlib.sha256((run_dir / "exclusions.json").read_bytes()).hexdigest(), "counts": {"class_excluded": 3, "outlier": 1}},
            "assumptions": ["true_north_default_direction"],
            "limitations": ["Results are for design comparison only; not a regulatory or certification basis."],
        }


@pytest.fixture
def harness(tmp_path, monkeypatch):
    """Service with CFD enabled, a converted model on disk, and a fake runner (inline execution)."""

    def make(*, enabled: bool = True, runner: FakeCfdRunner | None = None, token: str | None = None, run_background: bool = False):
        env = {
            "STREAMING_CONVERSION_SERVICE_ROOT": str(tmp_path / "svc"),
            "STREAMING_CONVERSION_ARTIFACTS_ROOT": str(tmp_path / "svc" / "artifacts"),
            "STREAMING_CONVERSION_JOBS_DIR": str(tmp_path / "svc" / "jobs"),
            "STREAMING_CONVERSION_REPO_ROOT": str(REPO_ROOT / "bim-streaming-server"),
            "CFD_ENABLED": "true" if enabled else "false",
        }
        if token:
            env["STREAMING_CONVERSION_INTERNAL_TOKEN"] = token
        config = load_config(env)
        runner = runner or FakeCfdRunner()
        app = build_app(config, converter=FakeConverter(), run_background=run_background, cfd_runner=runner)
        # A "converted" model the CFD run binds to.
        conv_dir = Path(config.artifacts_root) / "stream_conv_test_0001"
        conv_dir.mkdir(parents=True, exist_ok=True)
        (conv_dir / "model.usdc").write_bytes(b"PXR-USDC-fake-model\n")
        (conv_dir / "geo_reference.json").write_text(json.dumps({"available": False, "true_north_degrees": 0.0, "warnings": ["geo_reference_missing", "true_north_default_direction"]}), encoding="utf-8")
        sha = hashlib.sha256((conv_dir / "model.usdc").read_bytes()).hexdigest()
        # The conversion store only knows real jobs; expose the fake one through the lookup.
        service = app.state.cfd_service
        service.conversion_lookup = lambda job_id: {"conversion_job_id": job_id} if job_id == "stream_conv_test_0001" else None
        client = TestClient(app)
        return client, service, sha, runner, config

    return make


def _request(sha: str, **overrides) -> dict:
    body = _example("cfd-run-request-v1")
    body["source"] = {"conversion_job_id": "stream_conv_test_0001", "model_usdc_sha256": sha}
    body["wind"]["wind_from_degrees"] = [0, 90]
    body.update(overrides)
    return body


# --------------------------------------------------------------------------- validation


def test_schema_example_passes_validate_run_request():
    normalized = validate_run_request(_example("cfd-run-request-v1"), max_directions=16, n_procs_max=8)
    assert normalized["schema"] == "cfd-run-request/v1"
    assert normalized["solver"]["n_procs"] == 8
    _schema("cfd-run-request-v1").validate(normalized)


@pytest.mark.parametrize(
    "mutate, fragment",
    [
        (lambda b: b["wind"].__setitem__("wind_from_degrees", [0, 360]), "wind_from_degrees"),
        (lambda b: b["wind"].__setitem__("wind_from_degrees", [10, 10]), "unique"),
        (lambda b: b["wind"].update({"true_north_source": "manual", "true_north_degrees_manual": None}), "true_north_degrees_manual"),
        (lambda b: b["solver"].__setitem__("gpu", True), "unknown fields"),
        (lambda b: b["source"].__setitem__("model_usdc_sha256", "abc"), "sha256"),
        (lambda b: b["preprocess"].__setitem__("profile", "interior-ventilation/v1"), "profile"),
        (lambda b: b.__setitem__("schema", "cfd-run-request/v2"), "schema"),
    ],
)
def test_validate_run_request_rejects_bad_shapes(mutate, fragment):
    body = _example("cfd-run-request-v1")
    mutate(body)
    with pytest.raises(CfdRequestError) as exc:
        validate_run_request(body, max_directions=16, n_procs_max=8)
    assert exc.value.status_code == 400
    assert fragment in exc.value.message


def test_validate_caps_n_procs_and_direction_count():
    body = _example("cfd-run-request-v1")
    body["solver"]["n_procs"] = 32
    assert validate_run_request(body, max_directions=16, n_procs_max=4)["solver"]["n_procs"] == 4
    body["wind"]["wind_from_degrees"] = [0, 45, 90]
    with pytest.raises(CfdRequestError):
        validate_run_request(body, max_directions=2, n_procs_max=4)


def test_load_cfd_config_defaults_and_env(tmp_path):
    cfg = load_cfd_config({}, default_artifacts_root=tmp_path / "a", base_url="http://127.0.0.1:49101", internal_token=None)
    assert cfg.enabled is False
    assert cfg.image == "opencfd/openfoam-default:2412"
    assert cfg.artifacts_root == tmp_path / "a" / "cfd"
    assert cfg.public_artifacts_url == "http://127.0.0.1:49101/cfd-artifacts"
    cfg2 = load_cfd_config(
        {"CFD_ENABLED": "1", "CFD_N_PROCS": "99", "CFD_MAX_DIRECTIONS": "4", "CFD_IMAGE_DIGEST": "sha256:abc", "CFD_ARTIFACTS_ROOT": str(tmp_path / "x")},
        default_artifacts_root=tmp_path / "a",
        base_url="http://h:1",
        internal_token="t",
    )
    assert cfg2.enabled is True and cfg2.n_procs_max == 64 and cfg2.max_directions == 4
    assert cfg2.image_digest == "sha256:abc" and cfg2.artifacts_root == tmp_path / "x" and cfg2.internal_token == "t"


# --------------------------------------------------------------------------- HTTP


def test_disabled_host_answers_503_cfd_disabled_but_lists(harness):
    client, _service, sha, _runner, _cfg = harness(enabled=False)
    resp = client.post("/api/cfd-runs", json=_request(sha))
    assert resp.status_code == 503
    assert resp.json()["error_code"] == "cfd_disabled"
    listing = client.get("/api/cfd-runs")
    assert listing.status_code == 200
    assert listing.json() == {"items": [], "count": 0, "enabled": False}


def test_create_run_inline_reaches_ready_and_result_matches_contract(harness):
    client, service, sha, runner, cfg = harness()
    resp = client.post("/api/cfd-runs", json=_request(sha))
    assert resp.status_code == 202, resp.text
    doc = resp.json()
    run_id = doc["run_id"]
    assert doc["idempotent_replay"] is False
    assert runner.calls and runner.calls[0]["run_id"] == run_id

    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "ready"
    assert status["progress"] == {"directions_total": 2, "directions_done": 2}
    assert status["converged_count"] == 2
    assert status["sealing_suspect"] is False
    assert status["purpose"] == "design_comparison_only"
    assert "current_container" not in status

    result = client.get(f"/api/cfd-runs/{run_id}/result")
    assert result.status_code == 200
    body = result.json()
    for direction in body["directions"]:
        assert direction["overlay_layer"]["url"] == f"{cfg.cfd.public_artifacts_url}/{run_id}/{direction['overlay_layer']['filename']}"
    assert body["run_record"]["url"].endswith("/run_record.json")
    _schema("cfd-run-result-v1").validate(body)

    exclusions = client.get(f"/api/cfd-runs/{run_id}/exclusions")
    assert exclusions.status_code == 200 and exclusions.json()["counts"] == {"class_excluded": 3, "outlier": 1}

    # Artifacts are served from the run root only, with traversal guards.
    layer = body["directions"][0]["overlay_layer"]["filename"]
    served = client.get(f"/cfd-artifacts/{run_id}/{layer}")
    assert served.status_code == 200 and served.content.startswith(b"PXR-USDC-fake-layer")
    assert client.get(f"/cfd-artifacts/{run_id}/nope.usdc").status_code == 404
    assert client.get(f"/cfd-artifacts/{run_id}/..%2Frun.json").status_code == 404
    assert client.get(f"/cfd-artifacts/not_a_run/{layer}").status_code == 404

    # Listing projects the ledger-relevant fields.
    listing = client.get("/api/cfd-runs", params={"conversion_job_id": "stream_conv_test_0001"}).json()
    assert listing["count"] == 1 and listing["items"][0]["run_id"] == run_id
    assert client.get("/api/cfd-runs", params={"status": "bogus"}).status_code == 400


def test_idempotent_replay_returns_same_run(harness):
    client, _service, sha, runner, _cfg = harness()
    first = client.post("/api/cfd-runs", json=_request(sha))
    second = client.post("/api/cfd-runs", json=_request(sha))
    assert first.status_code == 202 and second.status_code == 200
    assert second.json()["run_id"] == first.json()["run_id"]
    assert second.json()["idempotent_replay"] is True
    assert len(runner.calls) == 1


def test_source_mismatch_and_unknown_conversion_are_rejected_before_running(harness):
    client, _service, sha, runner, _cfg = harness()
    wrong = _request("0" * 64)
    resp = client.post("/api/cfd-runs", json=wrong)
    assert resp.status_code == 409 and resp.json()["error_code"] == "source_mismatch"
    missing = _request(sha)
    missing["source"]["conversion_job_id"] = "stream_conv_unknown"
    missing["idempotency_key"] = "cfdreq_demo_20260921_0002"
    resp = client.post("/api/cfd-runs", json=missing)
    assert resp.status_code == 404 and resp.json()["error_code"] == "conversion_not_found"
    bad = _request(sha)
    bad["wind"]["wind_from_degrees"] = []
    bad["idempotency_key"] = "cfdreq_demo_20260921_0003"
    resp = client.post("/api/cfd-runs", json=bad)
    assert resp.status_code == 400 and resp.json()["error_code"] == "invalid_request"
    assert runner.calls == []


def test_worker_unavailable_is_reported_at_create_time(harness):
    client, _service, sha, _runner, _cfg = harness(runner=FakeCfdRunner(unavailable=True))
    resp = client.post("/api/cfd-runs", json=_request(sha))
    assert resp.status_code == 503 and resp.json()["error_code"] == "worker_unavailable"
    assert client.get("/api/cfd-runs").json()["count"] == 0


def test_stage_failure_marks_run_failed_and_result_reports_code(harness):
    client, _service, sha, _runner, _cfg = harness(runner=FakeCfdRunner(fail_stage="solver"))
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "failed" and status["failure_code"] == "solver_failed"
    assert "FOAM FATAL" in status["error"]
    result = client.get(f"/api/cfd-runs/{run_id}/result")
    assert result.status_code == 409 and result.json()["error_code"] == "solver_failed"
    # Files produced before the failure are still downloadable once terminal.
    assert client.get(f"/cfd-artifacts/{run_id}/exclusions.json").status_code == 200


def test_cancel_queued_run_and_cancel_during_execution(harness):
    client, service, sha, _runner, _cfg = harness(run_background=True)
    # Background mode: the worker thread picks it up; cancel immediately and accept either outcome.
    service.run_background = False  # keep deterministic: we drive processing manually below
    service._enqueue = lambda run_id: None  # type: ignore[method-assign]
    resp = client.post("/api/cfd-runs", json=_request(sha))
    run_id = resp.json()["run_id"]
    assert client.get(f"/api/cfd-runs/{run_id}").json()["status"] == "queued"
    cancelled = client.post(f"/api/cfd-runs/{run_id}/cancel").json()
    assert cancelled["status"] == "cancelled" and cancelled["failure_code"] == "cancelled"
    assert service.process_run(run_id)["status"] == "cancelled"

    client2, service2, sha2, _r2, _c2 = harness(runner=FakeCfdRunner(cancel_after_preprocess=True))
    body = _request(sha2)
    body["idempotency_key"] = "cfdreq_demo_20260921_0009"
    run2 = client2.post("/api/cfd-runs", json=body).json()["run_id"]
    assert client2.get(f"/api/cfd-runs/{run2}").json()["status"] == "cancelled"
    assert client2.get(f"/api/cfd-runs/{run2}/result").status_code == 409


def test_token_is_enforced_on_writes_only(harness):
    client, _service, sha, _runner, _cfg = harness(token="secret-token")
    assert client.post("/api/cfd-runs", json=_request(sha)).status_code == 401
    assert client.post("/api/cfd-runs", json=_request(sha), headers={"X-Internal-Conversion-Token": "wrong"}).status_code == 403
    ok = client.post("/api/cfd-runs", json=_request(sha), headers={"X-Internal-Conversion-Token": "secret-token"})
    assert ok.status_code == 202
    assert client.get("/api/cfd-runs").status_code == 200


def test_background_worker_processes_queue_sequentially(harness):
    client, service, sha, runner, _cfg = harness(run_background=True)
    ids = []
    for i in range(3):
        body = _request(sha)
        body["idempotency_key"] = f"cfdreq_demo_20260921_1{i:03d}"
        ids.append(client.post("/api/cfd-runs", json=body).json()["run_id"])
    service._queue.join()
    assert [client.get(f"/api/cfd-runs/{run_id}").json()["status"] for run_id in ids] == ["ready"] * 3
    assert [call["run_id"] for call in runner.calls] == ids


# --------------------------------------------------------------------------- S1.1 review fixes


def test_partial_direction_failure_keeps_result_contract_valid():
    """One failed + one ready direction: result must validate (no failure_code on the entry)."""
    from cfd_job_service import build_result_document, build_run_record_document, failed_direction_entry

    request = validate_run_request(_example("cfd-run-request-v1"), max_directions=16, n_procs_max=8)
    request["wind"]["wind_from_degrees"] = [0.0, 90.0]
    stats = {
        "effective": {"voxel_pitch_m": 0.5, "closing_radius_voxels": 4},
        "shell": {"leak_fraction": 0.1198, "watertight": True},
        "element_count_total": 10,
        "element_count_kept": 8,
        "excluded_by_reason": {"class_excluded": 2},
    }
    ready = {
        "wind_from_degrees": 90.0,
        "status": "ready",
        "converged_by_residual_control": True,
        "iterations": 285,
        "mesh_cells": 626099,
        "overlay_layer": {"artifact_id": "cfd:cfd_20260921T000000Z_abc123:w090", "filename": "cfd_20260921T000000Z_abc123_w090.usdc", "sha256": "0" * 64},
        "pedestrian_1p5m": {"U_magnitude_max": 3.5, "polygons": 100},
        "building_pressure": {"p_min": -1.0, "p_max": 1.0},
    }
    result = build_result_document(
        run_id="cfd_20260921T000000Z_abc123",
        request=request,
        stats=stats,
        leak_limit=0.15,
        sealing_suspect=False,
        directions=[failed_direction_entry(0.0), ready],
        run_record_sha256="1" * 64,
        exclusions_sha256="2" * 64,
        exclusion_counts={"class_excluded": 2},
        assumptions=["true_north_default_direction"],
    )
    errors = list(_schema("cfd-run-result-v1").iter_errors(result))
    assert errors == [], [e.message for e in errors]
    assert result["directions"][0]["status"] == "failed"
    assert "failure_code" not in result["directions"][0]

    record = build_run_record_document(
        run_id="cfd_20260921T000000Z_abc123",
        operator="t",
        request=request,
        stats=stats,
        leak_limit=0.15,
        sealing_suspect=False,
        first_record={
            "source": {"sidecars": {"element_mapping": {"path": "C:/svc/artifacts/conv/element_mapping.json", "sha256": "a" * 64}}},
            "geo_reference": {"available": False},
            "weather": {"uref_m_s": 5.0},
        },
        direction_records=[
            {"wind_from_degrees": 0.0, "status": "failed", "failure_code": "mesh_failed", "docker_exit_code": 1},
            {"wind_from_degrees": 90.0, "status": "ready", "outputs": {"layer": {"path": "/srv/cfd/run/layer.usdc"}}},
        ],
        assumptions=["true_north_default_direction"],
    )
    assert record["source"]["sidecars"]["element_mapping"]["path"] == "element_mapping.json"
    assert record["directions"][1]["outputs"]["layer"]["path"] == "layer.usdc"
    assert record["directions"][0]["failure_code"] == "mesh_failed"
    assert record["assumptions"] == ["true_north_default_direction"]


@pytest.mark.parametrize(
    "true_north, flags, expected",
    [
        (0.0, ["true_north_default_direction"], (0.0, ["true_north_default_direction"])),
        (None, ["true_north_missing"], (0.0, ["true_north_unknown_assumed_project_north"])),
        (None, ["geo_reference_file_missing"], (0.0, ["true_north_unknown_assumed_project_north"])),
        (12.5, [], (12.5, [])),
        (-30.0, ["true_north_manual"], (-30.0, ["true_north_manual"])),
    ],
)
def test_normalize_true_north_maps_onto_frozen_assumption_vocabulary(true_north, flags, expected):
    from cfd_job_service import normalize_true_north

    value, assumptions = normalize_true_north(true_north, list(flags))
    assert (value, assumptions) == expected
    allowed = _schema("cfd-run-result-v1").schema["properties"]["assumptions"]["items"]["enum"]
    assert all(a in allowed for a in assumptions)


def test_bounded_error_hides_host_paths():
    from cfd_job_service import _bounded_error

    text = _bounded_error(FileNotFoundError("C:\\svc\\artifacts\\cfd\\run\\pre\\exclusions.json missing"), Path("C:/svc/artifacts/cfd/run"))
    assert "C:\\" not in text and "<" in text
    posix = _bounded_error(RuntimeError("cannot open /srv/data/conv/model.usdc"), Path("/srv/data/conv"))
    assert "/srv/" not in posix
    assert len(_bounded_error(RuntimeError("x" * 2000))) <= 500


def test_artifact_allowlist_blocks_internal_state_files(harness):
    client, _service, sha, _runner, _cfg = harness()
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    assert client.get(f"/cfd-artifacts/{run_id}/shell.stl").status_code == 200
    assert client.get(f"/cfd-artifacts/{run_id}/run_record.json").status_code == 200
    assert client.get(f"/cfd-artifacts/{run_id}/run.json").status_code == 404
    assert client.get(f"/cfd-artifacts/{run_id}/request.json").status_code == 404


def test_concurrent_same_idempotency_key_creates_one_run(harness):
    import threading
    import time as _time

    class SlowRunner(FakeCfdRunner):
        def execute(self, **kwargs):
            _time.sleep(0.3)
            return super().execute(**kwargs)

    client, service, sha, runner, _cfg = harness(runner=SlowRunner(), run_background=True)
    body = _request(sha)
    body["idempotency_key"] = "cfdreq_demo_20260921_race"
    results: list[tuple[int, str]] = []

    def post():
        resp = client.post("/api/cfd-runs", json=body)
        results.append((resp.status_code, resp.json().get("run_id")))

    threads = [threading.Thread(target=post) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    service._queue.join()
    run_ids = {run_id for _, run_id in results}
    assert len(run_ids) == 1, results
    assert sorted(status for status, _ in results) == [200, 200, 200, 202]
    assert len(service.store.list()) == 1
    assert len(runner.calls) == 1


def test_reconcile_on_start_requeues_queued_and_fails_orphaned_runs(tmp_path, monkeypatch):
    import cfd_pipeline.openfoam_case as openfoam_case

    killed: list[str] = []
    monkeypatch.setattr(openfoam_case, "kill_container", lambda name: killed.append(name) or True)

    cfd_root = tmp_path / "svc" / "artifacts" / "cfd"
    request = validate_run_request(_example("cfd-run-request-v1"), max_directions=16, n_procs_max=8)
    fixtures = (
        ("cfd_20260921T000000Z_queued", "queued", None),
        ("cfd_20260921T000001Z_orphan", "solving", "cfd_20260921T000001Z_orphan_w000"),
    )
    for run_id, status, container in fixtures:
        run_dir = cfd_root / run_id
        run_dir.mkdir(parents=True)
        doc = {
            "schema": "cfd-run-status/v1",
            "run_id": run_id,
            "status": status,
            "failure_code": None,
            "error": None,
            "progress": {"directions_total": 3, "directions_done": 0},
            "sealing_suspect": None,
            "converged_count": 0,
            "cancel_requested": False,
            "current_container": container,
            "created_at": "2026-09-21T00:00:00Z",
            "started_at": None,
            "finished_at": None,
            "request": request,
            "source": request["source"],
            "requested_by": request["requested_by"],
            "result_filename": None,
            "purpose": "design_comparison_only",
        }
        (run_dir / "run.json").write_text(json.dumps(doc), encoding="utf-8")

    env = {
        "STREAMING_CONVERSION_SERVICE_ROOT": str(tmp_path / "svc"),
        "STREAMING_CONVERSION_ARTIFACTS_ROOT": str(tmp_path / "svc" / "artifacts"),
        "STREAMING_CONVERSION_JOBS_DIR": str(tmp_path / "svc" / "jobs"),
        "STREAMING_CONVERSION_REPO_ROOT": str(REPO_ROOT / "bim-streaming-server"),
        "CFD_ENABLED": "true",
    }
    app = build_app(load_config(env), converter=FakeConverter(), run_background=False, cfd_runner=FakeCfdRunner())
    service = app.state.cfd_service
    assert service.reconciled == {"requeued": ["cfd_20260921T000000Z_queued"], "failed_restart": ["cfd_20260921T000001Z_orphan"]}
    assert killed == ["cfd_20260921T000001Z_orphan_w000"]
    orphan = service.store.load("cfd_20260921T000001Z_orphan")
    assert orphan["status"] == "failed"
    assert orphan["failure_code"] == "worker_unavailable"
    assert orphan["current_container"] is None
    requeued = service.store.load("cfd_20260921T000000Z_queued")
    assert requeued["status"] == "ready"  # processed inline (run_background=False) by the fake runner


def test_cancel_queued_run_is_compare_and_set(harness):
    client, service, sha, _runner, _cfg = harness()
    service._enqueue = lambda run_id: None  # type: ignore[method-assign]
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    # Worker claims first: cancel must not clobber the claim, only flag it.
    assert service.store.compare_and_set_status(run_id, "queued", status="preprocessing")["status"] == "preprocessing"
    doc = client.post(f"/api/cfd-runs/{run_id}/cancel").json()
    assert doc["status"] == "preprocessing"
    assert doc["cancel_requested"] is True
    # A queued run that is cancelled is never claimed afterwards.
    second = dict(_request(sha), idempotency_key="cfdreq_demo_20260921_cas2")
    run2 = client.post("/api/cfd-runs", json=second).json()["run_id"]
    assert client.post(f"/api/cfd-runs/{run2}/cancel").json()["status"] == "cancelled"
    assert service.process_run(run2)["status"] == "cancelled"
