"""CFD settings phase A (contract S8): options, estimate and compute cap, without docker.

* The options document reports exactly the contract bounds and the standard preset, and the
  standard preset reproduces the defaults the validator applied before S8.
* The estimate's background cells equal what ``openfoam_case.build_case`` writes for the same
  shell (the engine itself is not modified; its helpers are reused read-only).
* Submissions whose estimate exceeds ``CFD_MAX_CELLS_PER_DIRECTION`` are rejected before anything runs.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
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

from cfd_estimate import auto_background_cell_m, estimate_run  # noqa: E402
from cfd_job_service import (  # noqa: E402
    CfdJobStore,
    _limitations,
    build_run_record_document,
    validate_estimate_request,
    validate_run_request,
)
from cfd_options import (  # noqa: E402
    PRESET_KEYS,
    REQUEST_FIELD_BOUNDS,
    CfdOptionsConfigError,
    load_options_config,
    parse_options_config,
    settings_profile,
)
from cfd_pipeline.openfoam_case import CaseParams, build_case  # noqa: E402
from cfd_pipeline.stl import write_binary_stl  # noqa: E402
from cfd_pipeline.wind import domain_from_building, rotate_z, rotation_to_plus_x, wind_vector_model  # noqa: E402
from host_native_conversion_service import build_app, load_config  # noqa: E402

CONFIG_DOC = json.loads((MODULE_DIR / "cfd_options.json").read_text(encoding="utf-8"))
OPTIONS = load_options_config()
BOX_FACES = np.array([[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]])


def _schema(name: str) -> dict:
    return json.loads((CONTRACTS / f"{name}.schema.json").read_text(encoding="utf-8"))


def _box_corners(lo, hi) -> np.ndarray:
    return np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])], dtype=np.float64)


def _write_box_stl(path: Path, lo, hi) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_binary_stl(path, _box_corners(lo, hi), BOX_FACES, solid_name="building_shell")


def _estimate_body(conversion_job_id: str, **overrides) -> dict:
    body = {
        "schema": "cfd-estimate-request/v1",
        "source": {"conversion_job_id": conversion_job_id},
        "preprocess": {"profile": "exterior-wind/v1"},
        "wind": {"wind_from_degrees": [0], "uref_m_s": 5.0, "zref_m": 10.0, "z0_m": 0.5, "true_north_source": "geo_reference"},
        "mesh": {},
        "solver": {},
    }
    for key, value in overrides.items():
        body[key] = value
    return body


def _conversion_dir(root: Path, name: str = "stream_conv_est_0001") -> Path:
    conv = root / name
    conv.mkdir(parents=True, exist_ok=True)
    (conv / "model.usdc").write_bytes(b"PXR-USDC-fake-model\n")
    (conv / "geo_reference.json").write_text(json.dumps({"available": False, "true_north_degrees": 0.0, "warnings": ["true_north_default_direction"]}), encoding="utf-8")
    return conv


# --------------------------------------------------------------------------- bounds and defaults


def test_request_field_bounds_match_the_request_schema():
    props = _schema("cfd-run-request-v1")["properties"]
    for key, bounds in REQUEST_FIELD_BOUNDS.items():
        section, field = key.split(".", 1)
        spec = props[section]["properties"][field]
        assert bounds.get("minimum") == spec.get("minimum"), key
        assert bounds.get("maximum") == spec.get("maximum", spec.get("exclusiveMaximum")), key
        assert bounds.get("exclusive_minimum") == spec.get("exclusiveMinimum"), key
        assert bounds.get("enum") == spec.get("enum"), key
        assert bool(bounds.get("nullable")) == ("null" in (spec.get("type") if isinstance(spec.get("type"), list) else [])), key


def test_standard_preset_reproduces_the_pre_s8_validator_defaults():
    body = copy.deepcopy(_schema("cfd-run-request-v1")["examples"][0])
    body["preprocess"] = {"profile": "exterior-wind/v1"}
    body["mesh"] = {}
    body["solver"] = {}
    body["wind"].update({"zref_m": 10.0, "z0_m": 0.5, "true_north_source": "geo_reference", "true_north_degrees_manual": None})
    request = validate_run_request(body, max_directions=16, n_procs_max=8)
    # The literal defaults validate_run_request applied before S8 (cfd_job_service.py at #907).
    assert request["preprocess"] == {"profile": "exterior-wind/v1", "voxel_pitch_m": 0.5, "closing_radius_voxels": 4, "leak_fraction_limit": 0.15}
    assert request["mesh"] == {"background_cell_m": None, "surface_refinement_level": 2, "region_refinement_level": 1}
    assert request["solver"] == {"end_time": 600, "n_procs": 8}
    assert settings_profile(request, OPTIONS) == {"options_config_version": OPTIONS.config_version, "preset_match": "standard", "custom_fields": []}


def test_service_defaults_are_pinned_to_the_pipeline_single_sources():
    """cfd-case-run-adr.md §3: CaseParams owns end_time, the preprocess profile owns the sealing limit."""
    from cfd_pipeline.profiles import get_profile

    request_schema = _schema("cfd-run-request-v1")["properties"]
    assert OPTIONS.default("solver.end_time") == CaseParams.end_time == 600
    assert request_schema["solver"]["properties"]["end_time"]["default"] == CaseParams.end_time
    limit = get_profile("exterior-wind/v1").sealing_leak_fraction_limit
    assert OPTIONS.default("preprocess.leak_fraction_limit") == limit == 0.15
    assert request_schema["preprocess"]["properties"]["leak_fraction_limit"]["default"] == limit


def test_explicit_null_background_cell_keeps_the_automatic_rule():
    body = copy.deepcopy(_schema("cfd-run-request-v1")["examples"][0])
    body["mesh"] = {"background_cell_m": None}
    assert validate_run_request(body, max_directions=16, n_procs_max=8)["mesh"]["background_cell_m"] is None


@pytest.mark.parametrize(
    "mutate, fragment",
    [
        (lambda d: d["presets"][0]["values"].__setitem__("solver.end_time", 6000), "outside the contract bounds"),
        (lambda d: d["presets"][0].__setitem__("preset_id", "fast"), "standard preset"),
        (lambda d: d["presets"][0].__setitem__("verified", False), "must be verified"),
        (lambda d: d["presets"][0]["values"].pop("wind.z0_m"), "must set exactly"),
        (lambda d: d["panel_fields"].append({"key": "mesh.far_field_coarsening", "section": "advanced", "label": {"zh": "a", "en": "a"}, "help": {"zh": "a", "en": "a"}}), "unique contract field"),
        (lambda d: d["panel_fields"][1].__setitem__("ui_default", 20), "standard preset"),
        (lambda d: d["panel_fields"][0].__setitem__("section", "experimental"), "section"),
        (lambda d: d["estimate"].pop("seconds_per_cell_default_basis"), "document where the default comes from"),
        (lambda d: d.__setitem__("schema", "cfd-options-config/v2"), "schema"),
        # PR #911 review: the parser is as strict as the published contract.
        (lambda d: d["presets"][0].__setitem__("preset_id", "Standard-Mode"), "must be unique and match"),
        (lambda d: d["presets"][0]["label"].__setitem__("en", ""), "non-empty zh and en"),
        (lambda d: d["panel_fields"][4]["visible_when"].__setitem__("equals", "compass"), "is not a valid value"),
    ],
)
def test_options_config_is_validated_strictly(mutate, fragment):
    doc = copy.deepcopy(CONFIG_DOC)
    mutate(doc)
    with pytest.raises(CfdOptionsConfigError) as exc:
        parse_options_config(doc)
    assert fragment in str(exc.value)


def test_settings_profile_flags_custom_fields_and_ignores_unused_manual_angle():
    body = copy.deepcopy(_schema("cfd-run-request-v1")["examples"][0])
    request = validate_run_request(body, max_directions=16, n_procs_max=8)  # schema example: standard except 6 m background cells
    profile = settings_profile(request, OPTIONS)
    assert profile["preset_match"] is None
    assert profile["custom_fields"] == ["mesh.background_cell_m"]
    body["solver"]["end_time"] = 300
    body["preprocess"]["closing_radius_voxels"] = 2
    assert settings_profile(validate_run_request(body, max_directions=16, n_procs_max=8), OPTIONS)["custom_fields"] == [
        "preprocess.closing_radius_voxels", "mesh.background_cell_m", "solver.end_time"]

    standard = copy.deepcopy(body)
    standard["preprocess"] = {"profile": "exterior-wind/v1"}
    standard["mesh"], standard["solver"] = {}, {}
    standard["wind"].update({"zref_m": 10.0, "z0_m": 0.5, "true_north_source": "geo_reference", "true_north_degrees_manual": 33.0})
    # A manual angle is ignored by the runner unless the source is manual, so it does not make the run custom.
    assert settings_profile(validate_run_request(standard, max_directions=16, n_procs_max=8), OPTIONS)["preset_match"] == "standard"
    standard["wind"]["true_north_source"] = "manual"
    assert settings_profile(validate_run_request(standard, max_directions=16, n_procs_max=8), OPTIONS)["custom_fields"] == ["wind.true_north_source", "wind.true_north_degrees_manual"]


def test_limitations_and_run_record_carry_custom_settings():
    custom = {"options_config_version": "v", "preset_match": None, "custom_fields": ["mesh.background_cell_m"]}
    standard = {"options_config_version": "v", "preset_match": "standard", "custom_fields": []}
    assert any("differ from the verified standard preset (mesh.background_cell_m)" in item for item in _limitations([], custom))
    assert not any("standard preset" in item for item in _limitations([], standard))
    assert not any("standard preset" in item for item in _limitations([], None))

    request = validate_run_request(_schema("cfd-run-request-v1")["examples"][0], max_directions=16, n_procs_max=8)
    record = build_run_record_document(
        run_id="cfd_20260923T000000Z_abcdef", operator="test", request=request, stats={"shell": {}, "effective": {"voxel_pitch_m": 0.5, "closing_radius_voxels": 2}},
        leak_limit=0.15, sealing_suspect=False, first_record={}, direction_records=[], assumptions=[], settings_profile=custom,
    )
    assert record["settings"]["preset_match"] is None and record["settings"]["custom_fields"] == ["mesh.background_cell_m"]
    assert record["settings"]["requested"]["mesh"]["background_cell_m"] == 6.0
    assert any("standard preset" in item for item in record["limitations"])


# --------------------------------------------------------------------------- estimate: geometry and engine parity


@pytest.mark.parametrize("directions, cell", [([0.0, 30.0, 112.5], None), ([45.0], 2.0)])
def test_background_cells_equal_build_case_for_the_same_shell(tmp_path, directions, cell):
    store = CfdJobStore(tmp_path / "cfd")
    conv = _conversion_dir(tmp_path / "conv")
    mesh = {} if cell is None else {"background_cell_m": cell}
    request = validate_estimate_request(_estimate_body(conv.name, wind={"wind_from_degrees": directions, "uref_m_s": 5.0, "zref_m": 10.0, "z0_m": 0.5, "true_north_source": "geo_reference"}, mesh=mesh), max_directions=16, n_procs_max=4, options=OPTIONS)
    previous = store.create(request)
    shell = store.run_dir(previous["run_id"]) / "shell.stl"
    _write_box_stl(shell, (3.0, -7.0, -1.0), (40.0, 16.0, 19.3))
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert estimate["available"] is True and estimate["geometry_source"] == "previous_run_shell"
    assert estimate["geometry_basis_run_id"] == previous["run_id"]
    for index, degrees in enumerate(directions):
        meta = build_case(shell_stl=shell, out_dir=tmp_path / f"case_{index}", params=CaseParams(wind_from_degrees=degrees, true_north_degrees=0.0, background_cell_m=cell, n_procs=4))
        assert estimate["directions"][index]["background_cells"] == meta["background_mesh"]["cell_count"], degrees
        assert estimate["background_cell_m"] == meta["background_mesh"]["cell_size_m"]
    assert estimate["background_cell_rule"] == ("auto" if cell is None else "request")
    assert estimate["near_building_cell_m"] == round(estimate["background_cell_m"] / 4, 3)
    Draft202012Validator(_schema("cfd-estimate-v1")).validate(estimate)


@pytest.mark.parametrize("height, expected", [(4.0, 1.5), (23.08, 3.85), (60.0, 6.0)])
def test_auto_background_cell_rule(height, expected):
    assert auto_background_cell_m(height) == expected


def test_bbox_index_source_applies_profile_class_and_outlier_rules(tmp_path):
    conv = _conversion_dir(tmp_path / "conv")
    items = []
    for i in range(20):  # a 50 x 30 x 15 m cluster of walls
        x0, y0 = (i % 5) * 10.0, (i // 5) * 7.5
        items.append({"usd_prim_path": f"/World/Elements/IfcWall/G_w{i}", "ifc_guid": f"w{i}", "bbox_local": [x0, y0, 0.0, x0 + 10.0, y0 + 7.5, 15.0], "bbox_world": None})
    items.append({"usd_prim_path": "/World/Elements/IfcBeam/G_far", "ifc_guid": "far", "bbox_local": [300.0, 300.0, 0.0, 310.0, 301.0, 1.0], "bbox_world": None})
    items.append({"usd_prim_path": "/World/Elements/IfcDoor/G_door", "ifc_guid": "door", "bbox_local": [-80.0, -80.0, 0.0, -79.0, -79.0, 40.0], "bbox_world": None})
    items.append({"usd_prim_path": "/World/Elements/IfcSpace/G_space", "ifc_guid": "space", "bbox_local": [0.0, 0.0, 0.0, 50.0, 30.0, 60.0], "bbox_world": None})
    (conv / "bbox_index.json").write_text(json.dumps({"format_version": 1, "items": items}), encoding="utf-8")
    store = CfdJobStore(tmp_path / "cfd")
    request = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert estimate["geometry_source"] == "bbox_index_profile_filter" and estimate["geometry_basis_run_id"] is None
    assert estimate["building_height_m"] == 15.0  # the space (60 m) and the door (40 m) are excluded classes
    points = _box_corners((0.0, 0.0, 0.0), (50.0, 30.0, 15.0))  # the beam 300 m away is an outlier
    rotated = rotate_z(points, rotation_to_plus_x(wind_vector_model(0.0, 0.0)))
    domain = domain_from_building(rotated.min(axis=0), rotated.max(axis=0), ground_z=0.0)
    assert estimate["directions"][0]["domain_m"] == [round(v, 1) for v in domain.size]


def test_no_geometry_source_is_reported_not_guessed(tmp_path):
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    request = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert estimate["available"] is False and estimate["reason"] == "no_geometry_source"
    assert estimate["directions"] == [] and estimate["totals"] is None


# --------------------------------------------------------------------------- estimate: calibration from history


def _ready_run_with_history(store: CfdJobStore, request: dict, *, mesh_cells: int, background: int, elapsed: float, n_procs: int, iterations: int) -> str:
    doc = store.create(request)
    run_id = doc["run_id"]
    store.update(run_id, status="ready")
    run_dir = store.run_dir(run_id)
    (run_dir / "result.json").write_text(json.dumps({"directions": [{"wind_from_degrees": 0.0, "status": "ready", "mesh_cells": mesh_cells, "iterations": iterations}]}), encoding="utf-8")
    case = run_dir / "case_w000"
    case.mkdir(parents=True)
    (case / "case_meta.json").write_text(json.dumps({"params": {"surface_refinement_level": 2, "region_refinement_level": 1, "refinement_box_mode": "isotropic", "n_procs": n_procs}, "background_mesh": {"cell_count": background}}), encoding="utf-8")
    (case / "run_summary.json").write_text(json.dumps({"elapsed_seconds": elapsed, "exit_code": 0}), encoding="utf-8")
    _write_box_stl(run_dir / "shell.stl", (0.0, 0.0, 0.0), (30.0, 20.0, 12.0))
    return run_id


def test_history_calibrates_refine_factor_and_seconds_per_cell(tmp_path):
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    request = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    _ready_run_with_history(store, request, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    basis = estimate["basis"]
    assert (basis["refine_factor"], basis["refine_factor_source"], basis["refine_factor_samples"]) == (1.65, "history_same_model", 1)
    assert basis["seconds_per_cell_source"] == "history_same_n_procs" and math.isclose(basis["seconds_per_cell"], 165.0 / 330_000)
    assert basis["typical_iterations"] == 480.0
    direction = estimate["directions"][0]
    assert direction["estimated_cells"] == round(direction["background_cells"] * 1.65)
    assert math.isclose(direction["estimated_seconds"], direction["estimated_cells"] * 165.0 / 330_000, rel_tol=1e-3)

    # Another core count: no matching history, so the documented default is scaled by the core ratio.
    eight = validate_estimate_request(_estimate_body(conv.name, solver={"n_procs": 8}), max_directions=16, n_procs_max=8, options=OPTIONS)
    other = estimate_run(request=eight, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)["basis"]
    assert other["seconds_per_cell_source"] == "config_default_scaled_by_n_procs"
    assert math.isclose(other["seconds_per_cell"], CONFIG_DOC["estimate"]["seconds_per_cell_default"] * 4 / 8)


def test_short_end_time_scales_time_but_not_cells(tmp_path):
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    full = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    _ready_run_with_history(store, full, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    short = validate_estimate_request(_estimate_body(conv.name, solver={"end_time": 240}), max_directions=16, n_procs_max=4, options=OPTIONS)
    a = estimate_run(request=full, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)["directions"][0]
    b = estimate_run(request=short, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)["directions"][0]
    assert a["estimated_cells"] == b["estimated_cells"]
    assert math.isclose(b["estimated_seconds"], a["estimated_seconds"] * 240 / 480, rel_tol=1e-3)


def test_confirm_thresholds_and_hard_cap_flags(tmp_path):
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    request = validate_estimate_request(_estimate_body(conv.name, mesh={"background_cell_m": 0.5}), max_directions=16, n_procs_max=4, options=OPTIONS)
    _ready_run_with_history(store, request, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=1_000_000)
    limits = estimate["limits"]
    assert limits["exceeds_hard_cap"] is True
    assert limits["confirm_required"] is True and "cells_per_direction" in limits["confirm_reasons"]


# --------------------------------------------------------------------------- HTTP


@pytest.fixture
def service_factory(tmp_path):
    def make(*, enabled: bool = True, env_extra: dict | None = None):
        env = {
            "STREAMING_CONVERSION_SERVICE_ROOT": str(tmp_path / "svc"),
            "STREAMING_CONVERSION_ARTIFACTS_ROOT": str(tmp_path / "svc" / "artifacts"),
            "STREAMING_CONVERSION_JOBS_DIR": str(tmp_path / "svc" / "jobs"),
            "STREAMING_CONVERSION_REPO_ROOT": str(REPO_ROOT / "bim-streaming-server"),
            "CFD_ENABLED": "true" if enabled else "false",
            **(env_extra or {}),
        }
        from test_cfd_job_service import FakeCfdRunner, FakeConverter  # the same fake runner as the S1 tests

        config = load_config(env)
        app = build_app(config, converter=FakeConverter(), run_background=False, cfd_runner=FakeCfdRunner())
        conv = _conversion_dir(Path(config.artifacts_root), "stream_conv_test_0001")
        service = app.state.cfd_service
        service.conversion_lookup = lambda job_id: {"conversion_job_id": job_id} if job_id.startswith("stream_conv_test_") else None
        sha = hashlib.sha256((conv / "model.usdc").read_bytes()).hexdigest()
        return TestClient(app), service, conv, sha

    return make


def test_options_endpoint_matches_schema_and_host_limits(service_factory):
    client, _service, _conv, _sha = service_factory(env_extra={"CFD_N_PROCS": "4", "CFD_MAX_CELLS_PER_DIRECTION": "2500000", "CFD_MAX_DIRECTIONS": "12"})
    resp = client.get("/api/cfd-options")
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    Draft202012Validator(_schema("cfd-options-v1")).validate(doc)
    assert doc["enabled"] is True and doc["config_version"] == CONFIG_DOC["config_version"]
    assert doc["limits"] == {"max_directions": 12, "n_procs": 4, "max_cells_per_direction": 2_500_000}
    assert [f["key"] for f in doc["fields"]] == [f["key"] for f in CONFIG_DOC["panel_fields"]]
    for field in doc["fields"]:
        for bound in ("minimum", "maximum", "exclusive_minimum", "enum", "nullable"):
            assert field.get(bound) == REQUEST_FIELD_BOUNDS[field["key"]].get(bound), (field["key"], bound)
        expected_default = CONFIG_DOC["presets"][0]["values"][field["key"]] if field["key"] in PRESET_KEYS else next(p for p in CONFIG_DOC["panel_fields"] if p["key"] == field["key"]).get("ui_default")
        assert field["default"] == expected_default, field["key"]
    assert doc["presets"][0]["values"] == CONFIG_DOC["presets"][0]["values"]

    disabled, *_ = service_factory(enabled=False)
    assert disabled.get("/api/cfd-options").json()["enabled"] is False


def test_estimate_endpoint_validation_and_unavailable_answer(service_factory):
    client, service, conv, _sha = service_factory()
    assert client.post("/api/cfd-estimates", json={**_estimate_body(conv.name), "schema": "cfd-run-request/v1"}).status_code == 400
    assert client.post("/api/cfd-estimates", json=_estimate_body(conv.name, mesh={"background_cell_m": 0.1})).status_code == 400
    missing = client.post("/api/cfd-estimates", json=_estimate_body("unknown_conversion"))
    assert missing.status_code == 404 and missing.json()["error_code"] == "conversion_not_found"
    empty = Path(service.conversion_artifacts_root) / "stream_conv_test_empty"
    empty.mkdir(parents=True)
    assert client.post("/api/cfd-estimates", json=_estimate_body(empty.name)).json()["error_code"] == "source_not_ready"

    resp = client.post("/api/cfd-estimates", json=_estimate_body(conv.name, mesh={"background_cell_m": 3.0}))
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    Draft202012Validator(_schema("cfd-estimate-v1")).validate(doc)
    assert doc["available"] is False and doc["reason"] == "no_geometry_source"
    assert doc["settings_profile"]["custom_fields"] == ["mesh.background_cell_m"]


def test_estimate_is_read_only_and_works_while_cfd_is_disabled(service_factory):
    client, service, conv, _sha = service_factory(enabled=False)
    _write_box_stl(conv / "shell_is_not_a_source.stl", (0, 0, 0), (1, 1, 1))  # stray files are not geometry sources
    resp = client.post("/api/cfd-estimates", json=_estimate_body(conv.name))
    assert resp.status_code == 200 and resp.json()["available"] is False
    assert service.store.list() == []


def _cluster_bbox_index(conv: Path, size=(200.0, 200.0, 23.0)) -> None:
    items = [{"usd_prim_path": f"/World/Elements/IfcWall/G_{i}", "ifc_guid": str(i), "bbox_local": [0.0, i * size[1] / 10, 0.0, size[0], (i + 1) * size[1] / 10, size[2]], "bbox_world": None} for i in range(10)]
    (conv / "bbox_index.json").write_text(json.dumps({"format_version": 1, "items": items}), encoding="utf-8")


def test_create_rejects_a_run_over_the_compute_cap_before_anything_runs(service_factory):
    client, service, conv, sha = service_factory(env_extra={"CFD_MAX_CELLS_PER_DIRECTION": "100000"})
    _cluster_bbox_index(conv)
    body = copy.deepcopy(_schema("cfd-run-request-v1")["examples"][0])
    body["source"] = {"conversion_job_id": conv.name, "model_usdc_sha256": sha}
    body["wind"]["wind_from_degrees"] = [0]
    resp = client.post("/api/cfd-runs", json=body)
    assert resp.status_code == 422, resp.text
    assert resp.json()["error_code"] == "compute_cap_exceeded" and "CFD_MAX_CELLS_PER_DIRECTION=100000" in resp.json()["detail"]
    assert service.store.list() == []


def test_create_records_settings_profile_and_estimate_at_submission(service_factory):
    client, _service, conv, sha = service_factory(env_extra={"CFD_MAX_CELLS_PER_DIRECTION": "50000000"})
    _cluster_bbox_index(conv)
    body = copy.deepcopy(_schema("cfd-run-request-v1")["examples"][0])
    body["source"] = {"conversion_job_id": conv.name, "model_usdc_sha256": sha}
    body["wind"]["wind_from_degrees"] = [0]
    resp = client.post("/api/cfd-runs", json=body)
    assert resp.status_code == 202, resp.text
    status = client.get(f"/api/cfd-runs/{resp.json()['run_id']}").json()
    assert status["settings_profile"]["preset_match"] is None
    assert status["settings_profile"]["custom_fields"] == ["mesh.background_cell_m"]
    summary = status["estimate_at_submission"]
    assert summary["available"] is True and summary["geometry_source"] == "bbox_index_profile_filter"
    assert summary["background_cell_m"] == 6.0 and summary["estimated_cells_total"] > 0


def test_options_file_errors_name_the_file_but_never_the_host_path(tmp_path):
    missing = tmp_path / "deep" / "cfd_options.json"
    with pytest.raises(CfdOptionsConfigError) as exc:
        load_options_config(missing)
    assert str(exc.value) == "cannot read cfd_options.json (FileNotFoundError)"
    broken = tmp_path / "cfd_options.json"
    broken.write_text("{not json", encoding="utf-8")
    with pytest.raises(CfdOptionsConfigError) as exc:
        load_options_config(broken)
    assert str(tmp_path) not in str(exc.value) and "line 1" in str(exc.value)


def test_runs_without_a_recorded_box_mode_do_not_calibrate_isotropic_estimates(tmp_path):
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    request = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    run_id = _ready_run_with_history(store, request, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    meta_path = store.run_dir(run_id) / "case_w000" / "case_meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    del meta["params"]["refinement_box_mode"]  # a pre-S5b-2 run (bbox box, mode not recorded)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    basis = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)["basis"]
    assert basis["refine_factor_source"] == "config_default"
    assert basis["seconds_per_cell_source"] == "history_same_n_procs"  # time per cell does not depend on the box


def test_a_refinement_factor_below_one_is_reported_as_measured(tmp_path):
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    request = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    _ready_run_with_history(store, request, mesh_cells=198_000, background=200_000, elapsed=90.0, n_procs=4, iterations=300)
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert estimate["basis"]["refine_factor"] == 0.99
    Draft202012Validator(_schema("cfd-estimate-v1")).validate(estimate)
