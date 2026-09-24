"""Settings phase B engine parameters (docs/plans/building-energy-cfd-b-engine-params.md §3, §6).

Defaults are pinned by test_golden_case.py; these tests pin what each new parameter does to the written case.
"""

from __future__ import annotations

import json
import re

import numpy as np
import pytest

from bimcfd.aij_case_c import _limitations
from bimcfd.cli import build_parser
from bimcfd.openfoam_case import CaseParams, build_case
from bimcfd.stl import write_binary_stl
from bimcfd.usd_results import PLANE_CLIP_HEIGHTS

from test_voxel_shell import box_triangles

LAYOUT_FIELDS = ("domain_upstream_h", "domain_downstream_h", "domain_lateral_h", "domain_top_h", "max_blockage_ratio",
                 "refinement_box_scale", "outer_coarsening_levels", "coarsening_shell_h", "ground_band_height_h")


@pytest.fixture
def slender_shell(tmp_path):
    """20 x 20 x 40 m: slender enough that 5H side margins keep the blockage under 3% (no widening)."""
    tris = box_triangles((0, 0, 0), (20, 20, 40))
    vertices = tris.reshape(-1, 3)
    path = tmp_path / "slender.stl"
    write_binary_stl(path, vertices, np.arange(vertices.shape[0]).reshape(-1, 3))
    return path


def _case(shell, tmp_path, name, **params):
    # West wind: the flow is already along +x, so solver-frame coordinates equal the model's.
    meta = build_case(shell_stl=shell, out_dir=tmp_path / name,
                      params=CaseParams(wind_from_degrees=270.0, true_north_degrees=0.0, **params))
    snappy = (tmp_path / name / "system/snappyHexMeshDict").read_text(encoding="utf-8")
    return meta, snappy


def _region_levels(snappy: str) -> dict[str, int]:
    block = snappy.split("refinementRegions", 1)[1]
    return {name: int(level) for name, level in re.findall(r"(\w+)\s*\{\s*mode inside;\s*levels \(\(1E15 (\d+)\)\);", block)}


def _surface_level(snappy: str) -> int:
    return int(re.search(r"level \((\d+) \d+\);", snappy).group(1))


def test_domain_multipliers_reach_the_case_and_the_cost732_check(slender_shell, tmp_path):
    default, _ = _case(slender_shell, tmp_path, "default")
    assert default["cost732_deviations"] == []
    meta, _ = _case(slender_shell, tmp_path, "short", domain_upstream_h=3.0, domain_downstream_h=10.0, domain_lateral_h=4.0, domain_top_h=4.0)
    height = meta["domain"]["building_height_m"]
    lo, hi = meta["building_bbox_solver_frame"]["min"], meta["building_bbox_solver_frame"]["max"]
    assert meta["domain"]["xmin"] == pytest.approx(lo[0] - 3.0 * height)
    assert meta["domain"]["xmax"] == pytest.approx(hi[0] + 10.0 * height)
    assert meta["domain"]["zmax"] == pytest.approx(hi[2] + 4.0 * height)
    assert meta["domain"]["ymin"] == pytest.approx(lo[1] - 4.0 * height)
    assert sorted(meta["cost732_deviations"]) == ["downstream_below_15H", "lateral_below_5H", "top_below_5H", "upstream_below_5H"]
    # A wide, low building (200 m across the wind, 10 m tall) widened only to an 8% blockage.
    tris = box_triangles((0, 0, 0), (20, 200, 10))
    vertices = tris.reshape(-1, 3)
    wide_shell = tmp_path / "wide.stl"
    write_binary_stl(wide_shell, vertices, np.arange(vertices.shape[0]).reshape(-1, 3))
    wide, _ = _case(wide_shell, tmp_path, "blockage", max_blockage_ratio=0.08, domain_lateral_h=2.0)
    assert wide["domain"]["blockage_ratio"] == pytest.approx(0.08)
    assert wide["cost732_deviations"] == ["blockage_above_0.03"]


def test_refinement_box_scale_multiplies_only_the_margins(slender_shell, tmp_path):
    meta, _ = _case(slender_shell, tmp_path, "scaled", refinement_box_mode="bbox", refinement_box_scale=2.0)
    height = meta["domain"]["building_height_m"]
    lo, hi = meta["building_bbox_solver_frame"]["min"], meta["building_bbox_solver_frame"]["max"]
    box = meta["refinement_box"]
    assert box["min"][0] == pytest.approx(lo[0] - 2.0 * height)
    assert box["max"][0] == pytest.approx(hi[0] + 4.0 * height)
    assert box["max"][2] == pytest.approx(hi[2] + 2.0 * height)


def test_location_in_mesh_moves_with_a_short_upstream_fetch(slender_shell, tmp_path):
    default, _ = _case(slender_shell, tmp_path, "default")
    height, cell = default["domain"]["building_height_m"], default["background_mesh"]["cell_size_m"]
    assert default["location_in_mesh"][0] == default["domain"]["xmin"] + 2.0 * height + 0.37 * cell  # unchanged formula
    short, _ = _case(slender_shell, tmp_path, "short", domain_upstream_h=2.0)
    lo = short["building_bbox_solver_frame"]["min"]
    assert short["location_in_mesh"][0] == pytest.approx(lo[0] - height + 0.37 * cell)
    assert short["location_in_mesh"][0] < lo[0]  # upstream of the building, in the fluid


@pytest.mark.parametrize("levels", [1, 2])
def test_outer_coarsening_keeps_the_near_building_spacing(slender_shell, tmp_path, levels):
    base, base_snappy = _case(slender_shell, tmp_path, "n0")
    meta, snappy = _case(slender_shell, tmp_path, f"n{levels}", outer_coarsening_levels=levels)
    factor = 2 ** levels
    base_mesh, mesh = base["background_mesh"], meta["background_mesh"]
    # The pre-coarsening spacing is kept exactly; the blockMesh cells are 2^n of it.
    assert mesh["fine_spacing_m"] == pytest.approx(base_mesh["fine_spacing_m"], rel=1e-12)
    assert mesh["cell_size_m"] == pytest.approx(base_mesh["cell_size_m"] * factor)
    for axis, key in enumerate(("x", "y", "z")):
        fine_count = mesh["cells"][axis] * factor
        assert fine_count >= base_mesh["cells"][axis] and fine_count - base_mesh["cells"][axis] < factor
        size = meta["domain"][f"{key}max"] - meta["domain"][f"{key}min"]
        assert size / mesh["cells"][axis] == pytest.approx(mesh["fine_spacing_m"][axis] * factor, rel=1e-12)
        # Only the max side moves, so the grid lines keep their place relative to the building.
        assert meta["domain"][f"{key}min"] == base["domain"][f"{key}min"]
    assert meta["domain"]["blockage_ratio"] <= base["domain"]["blockage_ratio"]
    # Levels: surface and box +n, so the refined cells near the building are exactly today's.
    assert _surface_level(snappy) == _surface_level(base_snappy) + levels
    region = _region_levels(snappy)
    assert region["refinementBox"] == _region_levels(base_snappy)["refinementBox"] + levels
    for axis, key in enumerate(("x", "y", "z")):
        spacing_now = (meta["domain"][f"{key}max"] - meta["domain"][f"{key}min"]) / mesh["cells"][axis]
        spacing_before = (base["domain"][f"{key}max"] - base["domain"][f"{key}min"]) / base_mesh["cells"][axis]
        # Actual refined spacing in the box: blockMesh spacing / 2^level, identical to today's.
        assert spacing_now / 2 ** region["refinementBox"] == pytest.approx(spacing_before / 2 ** _region_levels(base_snappy)["refinementBox"], rel=1e-12)
    assert [region[f"coarseningShell{k}"] for k in range(1, levels + 1)] == list(range(levels, 0, -1))
    assert meta["surface_refinement_level_effective"] == CaseParams.surface_refinement_level + levels


def test_innermost_shell_covers_the_box_and_the_pedestrian_crop(slender_shell, tmp_path):
    meta, _ = _case(slender_shell, tmp_path, "n1", outer_coarsening_levels=1, coarsening_shell_h=0.5)
    height = meta["domain"]["building_height_m"]
    lo, hi = meta["building_bbox_solver_frame"]["min"], meta["building_bbox_solver_frame"]["max"]
    shell = next(r for r in meta["refinement_regions"] if r["name"] == "coarseningShell1")
    box = meta["refinement_box"]
    crop = PLANE_CLIP_HEIGHTS * height
    for axis in (0, 1):
        assert shell["min"][axis] <= max(min(box["min"][axis], lo[axis] - crop), meta["domain"]["xmin" if axis == 0 else "ymin"]) + 1e-9
        assert shell["max"][axis] >= min(max(box["max"][axis], hi[axis] + crop), meta["domain"]["xmax" if axis == 0 else "ymax"]) - 1e-9
    assert shell["max"][2] >= box["max"][2]


def test_ground_band_sits_upstream_on_the_ground_and_must_hold_two_cells(slender_shell, tmp_path):
    meta, snappy = _case(slender_shell, tmp_path, "band", ground_band_height_h=0.2)
    band = next(r for r in meta["refinement_regions"] if r["name"] == "groundBand")
    height = meta["domain"]["building_height_m"]
    assert band["min"][0] == meta["domain"]["xmin"] and band["max"][0] == meta["refinement_box"]["min"][0]
    assert band["min"][2] == 0.0 and band["max"][2] == pytest.approx(0.2 * height)
    assert _region_levels(snappy)["groundBand"] == CaseParams.region_refinement_level
    with pytest.raises(ValueError, match="thinner than two cells"):
        _case(slender_shell, tmp_path, "thin", ground_band_height_h=0.01)


def test_cli_layout_flags_default_to_caseparams_and_reach_the_case(slender_shell, tmp_path):
    parser = build_parser()
    for command in ("make-case", "batch", "converge", "aij-case-c"):
        required = {"make-case": ["--shell", "s", "--out", "o", "--wind-from", "0"],
                    "batch": ["--shell", "s", "--model-usdc", "m", "--conversion-dir", "c", "--preprocess-dir", "p", "--out", "o"],
                    "converge": ["--shell", "s", "--conversion-dir", "c", "--preprocess-dir", "p", "--out", "o", "--run-id", "r"],
                    "aij-case-c": ["--data-dir", "d", "--out", "o", "--run-id", "r"]}[command]
        args = parser.parse_args([command, *required])
        assert {field: getattr(args, field) for field in LAYOUT_FIELDS} == {field: getattr(CaseParams, field) for field in LAYOUT_FIELDS}, command
    out = tmp_path / "cli_case"
    args = parser.parse_args(["make-case", "--shell", str(slender_shell), "--out", str(out), "--wind-from", "270",
                              "--domain-upstream-h", "4", "--outer-coarsening-levels", "1", "--refinement-box-scale", "1.5"])
    assert args.func(args) == 0
    params = json.loads((out / "case_meta.json").read_text(encoding="utf-8"))["params"]
    assert (params["domain_upstream_h"], params["outer_coarsening_levels"], params["refinement_box_scale"]) == (4.0, 1, 1.5)


def test_aij_limitations_name_the_real_upstream_fetch():
    inflow = {"u_ref_measurement_height_m_s": 4.0, "z0_m": 0.0282}
    default = " ".join(_limitations({"params": {}}, 75.0, inflow, 3.9))
    shorter = " ".join(_limitations({"params": {"domain_upstream_h": 3.0}, "wall_z0_m_effective": 0.01}, 75.0, inflow, 3.9))
    assert "5H upstream of the array" in default
    assert "3H upstream of the array" in shorter and "over the 3H fetch" in shorter
