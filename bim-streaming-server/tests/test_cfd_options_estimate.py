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
import re
import sys
from pathlib import Path
from types import SimpleNamespace

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

from cfd_estimate import auto_background_cell_m, estimate_outcome, estimate_run, region_cells  # noqa: E402
from cfd_job_service import (  # noqa: E402
    MESH_LAYOUT_FIELDS,
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
from cfd_pipeline.mesh_limits import SNAPPY_MAX_GLOBAL_CELLS  # noqa: E402
from cfd_pipeline.openfoam_case import CaseParams, build_case, domain_kwargs  # noqa: E402
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
    assert request["mesh"] == {"background_cell_m": None, "surface_refinement_level": 2, "region_refinement_level": 1,
                               # Settings phase B: the engine's own defaults, i.e. today's case layout.
                               **{name: getattr(CaseParams, name) for name in MESH_LAYOUT_FIELDS}}
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
    # Settings phase B: CaseParams owns the layout defaults; the standard preset and the schema repeat them.
    for name in MESH_LAYOUT_FIELDS:
        assert f"mesh.{name}" in PRESET_KEYS, name
        assert OPTIONS.default(f"mesh.{name}") == getattr(CaseParams, name), name
        assert request_schema["mesh"]["properties"][name]["default"] == getattr(CaseParams, name), name


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


def test_layout_fields_take_the_standard_preset_and_make_the_run_custom():
    body = copy.deepcopy(_schema("cfd-run-request-v1")["examples"][0])
    body["mesh"] = {"outer_coarsening_levels": 1, "domain_upstream_h": 3, "ground_band_height_h": 0.2}
    request = validate_run_request(body, max_directions=16, n_procs_max=8)
    assert (request["mesh"]["outer_coarsening_levels"], request["mesh"]["domain_upstream_h"], request["mesh"]["ground_band_height_h"]) == (1, 3.0, 0.2)
    assert request["mesh"]["coarsening_shell_h"] == CaseParams.coarsening_shell_h  # omitted: the standard preset
    assert settings_profile(request, OPTIONS)["custom_fields"] == [
        "mesh.domain_upstream_h", "mesh.outer_coarsening_levels", "mesh.ground_band_height_h"]
    # An explicit null keeps "no band", as the standard preset does.
    body["mesh"] = {"ground_band_height_h": None}
    assert settings_profile(validate_run_request(body, max_directions=16, n_procs_max=8), OPTIONS)["preset_match"] == "standard"
    # The estimate request hands its mesh block to the same validator.
    estimate = validate_estimate_request(
        {"schema": "cfd-estimate-request/v1", "source": {"conversion_job_id": "stream_conv_demo"}, "preprocess": {"profile": "exterior-wind/v1"},
         "wind": body["wind"], "mesh": {"outer_coarsening_levels": 2}}, max_directions=16, n_procs_max=8)
    assert estimate["mesh"]["outer_coarsening_levels"] == 2 and estimate["mesh"]["domain_upstream_h"] == CaseParams.domain_upstream_h


def test_limitations_name_cost732_shortfalls_and_unverified_layouts():
    layout = {"outer_coarsening_levels": 1, "ground_band_height_h": 0.2}
    items = _limitations([], None, mesh=layout, cost732_deviations={90.0: ["upstream_below_5H"], 0.0: ["blockage_above_0.03", "upstream_below_5H"]})
    # Each shortfall names only its own directions: the blockage shortfall is at 0° only.
    assert ("Effective computational domain is below the COST 732 recommendations: upstream fetch below 5H (wind directions 0°, 90°); "
            "blockage ratio above 3% (wind direction 0°).") in items
    assert "Mesh layout is not verified (outer coarsening 1 level, upstream ground band 0.2H): it is not part of a verified preset." in items
    standard_mesh = {name: getattr(CaseParams, name) for name in MESH_LAYOUT_FIELDS}
    plain = _limitations([], None, mesh=standard_mesh, cost732_deviations={})
    assert not any("COST 732" in item or "Mesh layout" in item for item in plain)
    assert plain == _limitations([], None)  # a standard request reads exactly as before B1b

    request = validate_run_request(_schema("cfd-run-request-v1")["examples"][0] | {"mesh": {"outer_coarsening_levels": 2}},
                                   max_directions=16, n_procs_max=8)
    record = build_run_record_document(
        run_id="cfd_20260929T000000Z_abcdef", operator="test", request=request, stats={"shell": {}, "effective": {"voxel_pitch_m": 0.5, "closing_radius_voxels": 2}},
        leak_limit=0.15, sealing_suspect=False, first_record={}, direction_records=[], assumptions=[], settings_profile=None,
        cost732_deviations={0.0: ["top_below_5H"]},
    )
    assert any("recommendations: top margin below 5H (wind direction 0°)." in item for item in record["limitations"])
    assert any("outer coarsening 2 levels" in item for item in record["limitations"])
    assert record["settings"]["requested"]["mesh"]["outer_coarsening_levels"] == 2


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


def _grid(domain: tuple, fine: tuple, levels: int = 0) -> SimpleNamespace:
    """The three attributes region_cells reads from a BackgroundGrid."""
    names = ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax")
    return SimpleNamespace(domain=SimpleNamespace(**dict(zip(names, domain))), fine_spacing_m=fine, coarsening_levels=levels)


def _grid_of(meta: dict) -> SimpleNamespace:
    """The background grid of a written case, rebuilt from its case_meta (a path independent of the estimator's)."""
    domain = meta["domain"]
    background = meta["background_mesh"]
    return _grid(tuple(domain[k] for k in ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax")), tuple(background["fine_spacing_m"]),
                 background["outer_coarsening_levels"])


def test_region_cells_counts_nested_and_clipped_regions_by_hand():
    grid = _grid((0.0, 10.0, 0.0, 10.0, 0.0, 10.0), (1.0, 1.0, 1.0))  # 1000 level-0 cells of 1 m3
    assert region_cells(grid, []) == 1000
    box = {"min": [0.0, 0.0, 0.0], "max": [5.0, 5.0, 5.0], "level": 1}
    assert region_cells(grid, [box]) == 875 + 125 * 8
    # The highest level wins where regions nest: 8 m3 at level 2, the rest of the box at level 1.
    inner = {"min": [0.0, 0.0, 0.0], "max": [2.0, 2.0, 2.0], "level": 2}
    assert region_cells(grid, [box, inner]) == region_cells(grid, [inner, box]) == 875 + 117 * 8 + 8 * 64
    # A region reaching outside the domain counts only its part inside it.
    assert region_cells(grid, [{"min": [-5.0, 0.0, 0.0], "max": [5.0, 10.0, 10.0], "level": 1}]) == 500 + 500 * 8
    # With n coarsening levels the blockMesh cells are 2^n fine spacings per side, and levels count from them.
    coarse = _grid((0.0, 16.0, 0.0, 16.0, 0.0, 16.0), (1.0, 1.0, 1.0), levels=1)
    assert region_cells(coarse, []) == 16 ** 3 / 8
    assert region_cells(coarse, [{"min": [0.0, 0.0, 0.0], "max": [16.0, 16.0, 8.0], "level": 1}]) == 16 * 16 * 8 + 16 * 16 * 8 / 8


@pytest.mark.parametrize("layout", [
    {"outer_coarsening_levels": 1},
    {"outer_coarsening_levels": 2, "domain_downstream_h": 10.0},
    {"domain_lateral_h": 8.0, "refinement_box_scale": 1.5},
    {"outer_coarsening_levels": 1, "ground_band_height_h": 0.2},
])
def test_layout_estimate_follows_the_engines_background_and_regions(tmp_path, layout):
    """Settings phase B §5: background cells as build_case writes them; refined cells = the nested-box model of the
    case's own regions plus the default layout's residual (the surface refinement the boxes do not describe)."""
    store = CfdJobStore(tmp_path / "cfd")
    conv = _conversion_dir(tmp_path / "conv")
    wind = {"wind_from_degrees": [0.0, 30.0], "uref_m_s": 5.0, "zref_m": 10.0, "z0_m": 0.5, "true_north_source": "geo_reference"}
    request = validate_estimate_request(_estimate_body(conv.name, wind=wind, mesh=dict(layout)), max_directions=16, n_procs_max=4, options=OPTIONS)
    shell = store.run_dir(store.create(request)["run_id"]) / "shell.stl"
    _write_box_stl(shell, (3.0, -7.0, -1.0), (40.0, 16.0, 19.3))
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert estimate["available"] is True
    Draft202012Validator(_schema("cfd-estimate-v1")).validate(estimate)
    factor = estimate["basis"]["refine_factor"]
    for index, direction in enumerate(estimate["directions"]):
        degrees = direction["wind_from_degrees"]
        standard = build_case(shell_stl=shell, out_dir=tmp_path / f"std_{index}", params=CaseParams(wind_from_degrees=degrees, true_north_degrees=0.0, n_procs=4))
        case = build_case(shell_stl=shell, out_dir=tmp_path / f"req_{index}", params=CaseParams(wind_from_degrees=degrees, true_north_degrees=0.0, n_procs=4, **layout))
        assert direction["background_cells"] == case["background_mesh"]["cell_count"], degrees
        domain = case["domain"]
        assert direction["domain_m"] == [round(domain[f"{a}max"] - domain[f"{a}min"], 1) for a in "xyz"], degrees
        residual = standard["background_mesh"]["cell_count"] * factor - region_cells(_grid_of(standard), standard["refinement_regions"])
        expected = region_cells(_grid_of(case), case["refinement_regions"]) + max(0.0, residual)
        assert direction["estimated_cells"] == round(expected), degrees
        # The reported background cell stays the pre-coarsening one, so the near-building sizes shown are today's.
        assert estimate["background_cell_m"] * 2 ** layout.get("outer_coarsening_levels", 0) == case["background_mesh"]["cell_size_m"]
    assert any("nested-box volume model" in note for note in estimate["basis"]["notes"])


def test_an_explicit_default_layout_estimates_exactly_as_before(tmp_path):
    store = CfdJobStore(tmp_path / "cfd")
    conv = _conversion_dir(tmp_path / "conv")
    implicit = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    explicit = validate_estimate_request(_estimate_body(conv.name, mesh={name: getattr(CaseParams, name) for name in MESH_LAYOUT_FIELDS}),
                                         max_directions=16, n_procs_max=4, options=OPTIONS)
    _write_box_stl(store.run_dir(store.create(implicit)["run_id"]) / "shell.stl", (3.0, -7.0, -1.0), (40.0, 16.0, 19.3))
    first = estimate_run(request=implicit, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    second = estimate_run(request=explicit, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert first == second
    assert not any("volume model" in note for note in first["basis"]["notes"])
    direction = first["directions"][0]
    assert direction["estimated_cells"] == round(direction["background_cells"] * first["basis"]["refine_factor"])


def test_an_infeasible_layout_is_reported_instead_of_estimated(tmp_path):
    # A 2H fetch with a doubled isotropic box: the box reaches the inlet, so a ground band has no upstream ground.
    store = CfdJobStore(tmp_path / "cfd")
    conv = _conversion_dir(tmp_path / "conv")
    mesh = {"domain_upstream_h": 2.0, "refinement_box_scale": 2.0, "ground_band_height_h": 0.2}
    request = validate_estimate_request(_estimate_body(conv.name, mesh=mesh), max_directions=16, n_procs_max=4, options=OPTIONS)
    shell = store.run_dir(store.create(request)["run_id"]) / "shell.stl"
    _write_box_stl(shell, (3.0, -7.0, -1.0), (40.0, 16.0, 19.3))
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert (estimate["available"], estimate["reason"], estimate["totals"]) == (False, "layout_not_feasible", None)
    Draft202012Validator(_schema("cfd-estimate-v1")).validate(estimate)
    with pytest.raises(ValueError, match="no upstream fetch"):  # the case writer refuses the same layout
        build_case(shell_stl=shell, out_dir=tmp_path / "case", params=CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, n_procs=4, **mesh))


# A 2H fetch with a 1.7x isotropic box: a ground band fits upstream only where the building is long along the wind, since
# the box does not turn with the bbox. On the test box that is 90° (37 m along the wind) but not 0° (23 m).
PARTLY_FEASIBLE = {"domain_upstream_h": 2.0, "refinement_box_scale": 1.7, "ground_band_height_h": 0.2}


def _expected_cells(shell: Path, out: Path, degrees: float, layout: dict, factor: float) -> int:
    """One direction's estimate from build_case's own output, a path independent of the estimator: the requested case's
    box model plus the default case's residual."""
    standard = build_case(shell_stl=shell, out_dir=out / "std", params=CaseParams(wind_from_degrees=degrees, true_north_degrees=0.0, n_procs=4))
    case = build_case(shell_stl=shell, out_dir=out / "req", params=CaseParams(wind_from_degrees=degrees, true_north_degrees=0.0, n_procs=4, **layout))
    residual = standard["background_mesh"]["cell_count"] * factor - region_cells(_grid_of(standard), standard["refinement_regions"])
    return round(region_cells(_grid_of(case), case["refinement_regions"]) + max(0.0, residual))


@pytest.mark.parametrize("order", [[90.0, 0.0], [0.0, 90.0]])
def test_a_layout_only_some_directions_can_take_keeps_the_cap_on_every_direction(tmp_path, order):
    """Self-review of #958 and #960: the directions a layout cannot be written for are named, and every direction meets
    the compute cap in either order. The run meshes the directions before the first unwritable one, and on the rough
    bbox geometry the case writer may still take an unwritable one (judged here without the ground band)."""
    store = CfdJobStore(tmp_path / "cfd")
    conv = _conversion_dir(tmp_path / "conv")
    wind = {"wind_from_degrees": order, "uref_m_s": 5.0, "zref_m": 10.0, "z0_m": 0.5, "true_north_source": "geo_reference"}
    request = validate_estimate_request(_estimate_body(conv.name, wind=wind, mesh=dict(PARTLY_FEASIBLE)), max_directions=16, n_procs_max=4, options=OPTIONS)
    shell = store.run_dir(store.create(request)["run_id"]) / "shell.stl"
    _write_box_stl(shell, (3.0, -7.0, -1.0), (40.0, 16.0, 19.3))
    build_case(shell_stl=shell, out_dir=tmp_path / "w090", params=CaseParams(wind_from_degrees=90.0, true_north_degrees=0.0, n_procs=4, **PARTLY_FEASIBLE))
    with pytest.raises(ValueError, match="no upstream fetch"):
        build_case(shell_stl=shell, out_dir=tmp_path / "w000", params=CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, n_procs=4, **PARTLY_FEASIBLE))
    factor = CONFIG_DOC["estimate"]["refine_factor_default"]  # this store has no finished runs
    without_band = {name: value for name, value in PARTLY_FEASIBLE.items() if name != "ground_band_height_h"}
    expected = {90.0: _expected_cells(shell, tmp_path / "e090", 90.0, PARTLY_FEASIBLE, factor),
                0.0: _expected_cells(shell, tmp_path / "e000", 0.0, without_band, factor)}
    assert expected[90.0] != expected[0.0]
    # Only the larger direction exceeds this cap, so it has to be judged wherever it is listed.
    tight = estimate_outcome(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=min(expected.values()))
    doc = tight.document
    assert (doc["available"], doc["reason"], doc["directions"], doc["totals"]) == (False, "layout_not_feasible", [], None)
    Draft202012Validator(_schema("cfd-estimate-v1")).validate(doc)
    assert [degrees for degrees, _ in tight.infeasible] == [0.0] and "no upstream fetch" in tight.infeasible[0][1]
    assert tight.worst == max(expected.items(), key=lambda item: item[1])
    assert doc["limits"]["exceeds_hard_cap"] is True
    roomy = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert roomy["reason"] == "layout_not_feasible" and roomy["limits"]["exceeds_hard_cap"] is False


def test_a_layout_whose_mesh_point_leaves_the_domain_is_not_feasible(tmp_path):
    """Self-review of #958: outer coarsening multiplies the blockMesh cell that nudges locationInMesh, which can then
    leave a low domain; build_case refuses that case, so the estimate reports it instead of giving numbers."""
    store = CfdJobStore(tmp_path / "cfd")
    conv = _conversion_dir(tmp_path / "conv")
    layout = {"outer_coarsening_levels": 2, "domain_top_h": 2.0}
    request = validate_estimate_request(_estimate_body(conv.name, mesh={"background_cell_m": 20.0, **layout}), max_directions=16, n_procs_max=4, options=OPTIONS)
    shell = store.run_dir(store.create(request)["run_id"]) / "shell.stl"
    _write_box_stl(shell, (0.0, 0.0, 0.0), (10.0, 10.0, 5.0))
    outcome = estimate_outcome(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert outcome.document["reason"] == "layout_not_feasible" and "lies outside the domain" in outcome.infeasible[0][1]
    with pytest.raises(ValueError, match="lies outside the domain"):
        build_case(shell_stl=shell, out_dir=tmp_path / "case", params=CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, n_procs=4, background_cell_m=20.0, **layout))
    # The same cell without the layout fits, and the default layout estimates as before.
    plain = validate_estimate_request(_estimate_body(conv.name, mesh={"background_cell_m": 20.0}), max_directions=16, n_procs_max=4, options=OPTIONS)
    assert estimate_run(request=plain, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)["available"] is True


def test_no_negative_residual_when_history_shows_little_surface_refinement(tmp_path):
    """Self-review of #958: with a refinement factor near 1 the default layout's box model exceeds its estimate; the
    residual is then zero rather than negative, and the estimate is the requested layout's box model alone."""
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    base = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    run_id = _ready_run_with_history(store, base, mesh_cells=200_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    layout = {"outer_coarsening_levels": 1}
    request = validate_estimate_request(_estimate_body(conv.name, mesh=dict(layout)), max_directions=16, n_procs_max=4, options=OPTIONS)
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert (estimate["basis"]["refine_factor"], estimate["geometry_basis_run_id"]) == (1.0, run_id)
    shell = store.run_dir(run_id) / "shell.stl"
    standard = build_case(shell_stl=shell, out_dir=tmp_path / "std", params=CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, n_procs=4))
    case = build_case(shell_stl=shell, out_dir=tmp_path / "req", params=CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, n_procs=4, **layout))
    assert standard["background_mesh"]["cell_count"] * 1.0 < region_cells(_grid_of(standard), standard["refinement_regions"])
    assert estimate["directions"][0]["estimated_cells"] == round(region_cells(_grid_of(case), case["refinement_regions"]))


def test_a_zero_closing_radius_reuses_the_previous_shell(tmp_path):
    """A closing radius of 0 is valid; the previous-run match used to test its truthiness and never found the shell."""
    store = CfdJobStore(tmp_path / "cfd")
    conv = _conversion_dir(tmp_path / "conv")
    request = validate_estimate_request(_estimate_body(conv.name, preprocess={"profile": "exterior-wind/v1", "closing_radius_voxels": 0}),
                                        max_directions=16, n_procs_max=4, options=OPTIONS)
    previous = store.create(request)
    _write_box_stl(store.run_dir(previous["run_id"]) / "shell.stl", (3.0, -7.0, -1.0), (40.0, 16.0, 19.3))
    estimate = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert (estimate["geometry_source"], estimate["geometry_basis_run_id"]) == ("previous_run_shell", previous["run_id"])


def test_the_case_writer_writes_the_shared_max_global_cells(tmp_path):
    shell = tmp_path / "shell.stl"
    _write_box_stl(shell, (0.0, 0.0, 0.0), (30.0, 20.0, 12.0))
    build_case(shell_stl=shell, out_dir=tmp_path / "case", params=CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, n_procs=4))
    assert f"maxGlobalCells  {SNAPPY_MAX_GLOBAL_CELLS};" in (tmp_path / "case" / "system" / "snappyHexMeshDict").read_text(encoding="utf-8")


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
    domain = domain_from_building(rotated.min(axis=0), rotated.max(axis=0), ground_z=0.0, **domain_kwargs(CaseParams))
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


def test_a_coarsened_run_stays_out_of_the_standard_history_pool(tmp_path):
    """Settings phase B §5: a coarsened run's cells / background ratio would inflate every standard estimate."""
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    request = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    _ready_run_with_history(store, request, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    coarse = _ready_run_with_history(store, request, mesh_cells=300_000, background=25_000, elapsed=150.0, n_procs=4, iterations=480)
    meta_path = store.run_dir(coarse) / "case_w000" / "case_meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["params"]["outer_coarsening_levels"] = 1
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    basis = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)["basis"]
    # Only the standard run calibrates the ratio (330k / 200k), not the coarsened one (300k / 25k = 12).
    assert (basis["refine_factor"], basis["refine_factor_samples"]) == (1.65, 1)


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


def test_the_preprocess_reserve_is_this_models_measured_time(tmp_path):
    """Settings phase B §5: the 300 s reserve gives way to the pre-processing time this model's finished runs measured
    with the same pre-processing settings."""
    conv = _conversion_dir(tmp_path / "conv")
    store = CfdJobStore(tmp_path / "cfd")
    request = validate_estimate_request(_estimate_body(conv.name), max_directions=16, n_procs_max=4, options=OPTIONS)
    _ready_run_with_history(store, request, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    before = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    assert before["totals"]["preprocess_seconds"] == CONFIG_DOC["estimate"]["preprocess_seconds_default"]
    assert "Pre-processing time: documented default." in before["basis"]["notes"]
    measured = _ready_run_with_history(store, request, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    (store.run_dir(measured) / "pre").mkdir()
    (store.run_dir(measured) / "pre" / "preprocess_stats.json").write_text(json.dumps({"elapsed_seconds": 123.4}), encoding="utf-8")
    other_model = validate_estimate_request(_estimate_body("stream_conv_est_other"), max_directions=16, n_procs_max=4, options=OPTIONS)
    foreign = _ready_run_with_history(store, other_model, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    (store.run_dir(foreign) / "pre").mkdir()
    (store.run_dir(foreign) / "pre" / "preprocess_stats.json").write_text(json.dumps({"elapsed_seconds": 999.0}), encoding="utf-8")
    finer = validate_estimate_request(_estimate_body(conv.name, preprocess={"profile": "exterior-wind/v1", "voxel_pitch_m": 0.25}),
                                      max_directions=16, n_procs_max=4, options=OPTIONS)
    fine_run = _ready_run_with_history(store, finer, mesh_cells=330_000, background=200_000, elapsed=165.0, n_procs=4, iterations=480)
    (store.run_dir(fine_run) / "pre").mkdir()
    (store.run_dir(fine_run) / "pre" / "preprocess_stats.json").write_text(json.dumps({"elapsed_seconds": 888.0}), encoding="utf-8")
    after = estimate_run(request=request, conversion_dir=conv, store=store, options=OPTIONS, max_cells_per_direction=10_000_000)
    # Only this model's run with the same settings and a measurement counts: not the earlier run without one, not another
    # model's run, not the run at a finer voxel pitch (self-review of #958).
    assert after["totals"]["preprocess_seconds"] == 123.4
    assert "Pre-processing time: median of 1 finished run(s) of this model with the same pre-processing settings." in after["basis"]["notes"]
    assert math.isclose(after["totals"]["estimated_seconds"], 123.4 + sum(d["estimated_seconds"] for d in after["directions"]), abs_tol=0.11)


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


def _layout_body(conv: Path, sha: str, idempotency_key: str = "cfdreq_layout_20260929_0001") -> dict:
    body = copy.deepcopy(_schema("cfd-run-request-v1")["examples"][0])
    body["idempotency_key"] = idempotency_key
    body["source"] = {"conversion_job_id": conv.name, "model_usdc_sha256": sha}
    body["wind"]["wind_from_degrees"] = [90, 0]
    body["mesh"] = dict(PARTLY_FEASIBLE)
    return body


def test_create_rejects_a_layout_the_exact_shell_cannot_take(service_factory):
    """Self-review of #958: on a previous run's shell the case writer's refusal is certain, and the run would stop there
    only after running the directions before it, so nothing is queued."""
    client, service, conv, sha = service_factory()
    prior = service.store.create(validate_run_request(_layout_body(conv, sha, "cfdreq_prior_20260929_0001"), max_directions=16, n_procs_max=64))
    _write_box_stl(service.store.run_dir(prior["run_id"]) / "shell.stl", (3.0, -7.0, -1.0), (40.0, 16.0, 19.3))
    resp = client.post("/api/cfd-runs", json=_layout_body(conv, sha))
    assert resp.status_code == 422, resp.text
    assert resp.json()["error_code"] == "layout_not_feasible"
    assert "wind from 0.0 degrees" in resp.json()["detail"] and "no upstream fetch" in resp.json()["detail"]
    assert [doc["run_id"] for doc in service.store.list()] == [prior["run_id"]]


def test_create_still_caps_a_layout_the_rough_geometry_partly_refuses(service_factory):
    """Self-review of #958: on the rough bbox geometry a direction the layout cannot take does not skip the compute cap
    (which direction is the largest, in either order, is pinned by the estimator test above)."""
    client, service, conv, sha = service_factory(env_extra={"CFD_MAX_CELLS_PER_DIRECTION": "100000"})
    _cluster_bbox_index(conv, size=(200.0, 20.0, 23.0))  # 200 m along the 90° wind, 20 m along the 0° wind
    wind = {"wind_from_degrees": [90, 0], "uref_m_s": 5.0, "zref_m": 10.0, "z0_m": 0.5, "true_north_source": "geo_reference"}
    estimate = client.post("/api/cfd-estimates", json=_estimate_body(conv.name, wind=wind, mesh=dict(PARTLY_FEASIBLE))).json()
    Draft202012Validator(_schema("cfd-estimate-v1")).validate(estimate)
    assert (estimate["reason"], estimate["geometry_source"], estimate["limits"]["exceeds_hard_cap"]) == ("layout_not_feasible", "bbox_index_profile_filter", True)
    resp = client.post("/api/cfd-runs", json=_layout_body(conv, sha))
    assert resp.status_code == 422, resp.text
    assert resp.json()["error_code"] == "compute_cap_exceeded" and re.search(r"cells for wind from (90|0)\.0 degrees", resp.json()["detail"])
    assert service.store.list() == []


def test_create_caps_a_direction_that_only_the_rough_geometry_refuses(service_factory):
    """Round-2 review (#960): the real shell may take a direction the rough bbox geometry refuses, so its cells (without
    the ground band) still meet the cap; with every direction refused, nothing escapes it."""
    client, service, conv, sha = service_factory(env_extra={"CFD_MAX_CELLS_PER_DIRECTION": "100000"})
    _cluster_bbox_index(conv, size=(200.0, 20.0, 23.0))
    body = _layout_body(conv, sha)
    body["wind"]["wind_from_degrees"] = [0]  # 20 m along the wind: the ground band has no upstream fetch
    resp = client.post("/api/cfd-runs", json=body)
    assert resp.status_code == 422, resp.text
    assert resp.json()["error_code"] == "compute_cap_exceeded" and "wind from 0.0 degrees" in resp.json()["detail"]
    assert service.store.list() == []


def test_create_lets_the_case_writer_decide_on_rough_geometry(service_factory):
    """The bbox geometry is rough, so its refusal is not certain: with room under the cap the run is queued and the case
    writer decides, and the submission records why there was no estimate."""
    client, _service, conv, sha = service_factory()
    _cluster_bbox_index(conv, size=(200.0, 20.0, 23.0))
    resp = client.post("/api/cfd-runs", json=_layout_body(conv, sha))
    assert resp.status_code == 202, resp.text
    status = client.get(f"/api/cfd-runs/{resp.json()['run_id']}").json()
    assert status["estimate_at_submission"] == {"available": False, "reason": "layout_not_feasible"}


@pytest.mark.parametrize("host_cap, cap", [(20_000_000, 12_000_000), (8_000_000, 8_000_000)])
def test_the_compute_cap_stays_within_snappys_max_global_cells(service_factory, host_cap, cap):
    """Settings phase B §3: past maxGlobalCells snappyHexMesh stops refining early without failing, so the cap that the
    options, the estimate and the submission use never exceeds it."""
    client, service, conv, sha = service_factory(env_extra={"CFD_MAX_CELLS_PER_DIRECTION": str(host_cap)})
    assert service.cells_cap == cap
    assert client.get("/api/cfd-options").json()["limits"]["max_cells_per_direction"] == cap
    _cluster_bbox_index(conv)
    assert client.post("/api/cfd-estimates", json=_estimate_body(conv.name)).json()["limits"]["max_cells_per_direction"] == cap
    body = copy.deepcopy(_schema("cfd-run-request-v1")["examples"][0])
    body["source"] = {"conversion_job_id": conv.name, "model_usdc_sha256": sha}
    body["wind"]["wind_from_degrees"] = [0]
    body["mesh"] = {"background_cell_m": 0.5}
    resp = client.post("/api/cfd-runs", json=body)
    assert resp.status_code == 422, resp.text
    assert f"per-direction cap {cap} (CFD_MAX_CELLS_PER_DIRECTION={host_cap}, snappyHexMesh maxGlobalCells=12000000)" in resp.json()["detail"]


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
