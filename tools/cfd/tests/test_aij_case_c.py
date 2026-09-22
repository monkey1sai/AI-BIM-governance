"""Contract S5b-2: AIJ Case C blocks benchmark helpers (geometry, inflow fit, sampling, metrics) and the isotropic refinement box."""
import math
from types import SimpleNamespace

import numpy as np
import pytest

from bimcfd.aij_case_c import (
    BLOCK_D_M, BLOCK_PITCH_M, HIT_RATE_ABSOLUTE, HIT_RATE_RELATIVE, block_footprints, blocks_triangles, build_comparison_document,
    fit_log_law, inflow_case_params, interpolate_profile, read_approach_flow, read_measurements, render_scatter_svg, sample_plane_speed,
    validation_metrics, write_blocks_stl, write_comparison_outputs,
)
from bimcfd.openfoam_case import CaseParams, build_case, refinement_box_for
from bimcfd.stl import read_binary_stl
from bimcfd.wind import wind_vector_model

AF = "﻿z (m),U (m/s),u_rms (m/s)\n0.01,2.372,0.56\n0.02,2.434,0.564\n0.05,2.912,0.695\n0.1,3.392,0.743\n0.2,3.654,0.801\n0.3,4.019,0.786\n0.6,4.985,0.796\n"
RS = ("﻿No.,WD (deg.),CB,x (m),y (m),z (m),Vs (m/s)\n"
      "63,0,0D,-0.3,-0.25,0.02,2.75\n54,0,1D,-0.3,-0.2,0.02,3.08\n45,0,1D,-0.3,-0.15,0.02,2.67\n70,22.5,1D,-0.25,0.0,0.02,1.2\n"
      "1,0,1D,0.25,0.0,0.02,0.66\n")


def test_block_layout_matches_the_dataset_readme():
    blocks = block_footprints("1D")
    assert len(blocks) == 9 and all(b["half"] == BLOCK_D_M / 2 for b in blocks)
    centres = sorted((b["cx"], b["cy"]) for b in blocks)
    assert centres == sorted((ix * BLOCK_PITCH_M, iy * BLOCK_PITCH_M) for ix in (-1, 0, 1) for iy in (-1, 0, 1))
    assert {b["height"] for b in blocks} == {BLOCK_D_M}
    assert len(block_footprints("0D")) == 8
    centre = next(b for b in block_footprints("2D") if (b["cx"], b["cy"]) == (0.0, 0.0))
    assert centre["height"] == pytest.approx(2 * BLOCK_D_M)
    with pytest.raises(ValueError):
        block_footprints("3D")
    # Streets are 1D wide: gap between the centre block face (0.1) and the neighbour face (0.3).
    assert BLOCK_PITCH_M - BLOCK_D_M == pytest.approx(BLOCK_D_M)


def test_blocks_stl_is_scaled_outward_facing_and_grounded(tmp_path):
    tris = blocks_triangles("1D", scale=75.0)
    assert tris.shape == (9 * 12, 3, 3)
    assert tris[..., 2].min() == 0.0 and tris[..., 2].max() == pytest.approx(15.0)
    assert tris[..., 0].min() == pytest.approx(-37.5) and tris[..., 0].max() == pytest.approx(37.5)
    # Outward normals: every triangle's normal points away from its own block centre.
    for block in range(9):
        block_tris = tris[block * 12:(block + 1) * 12]
        centre = block_tris.reshape(-1, 3).mean(axis=0)
        for tri in block_tris:
            normal = np.cross(tri[1] - tri[0], tri[2] - tri[0])
            assert np.dot(normal, tri.mean(axis=0) - centre) > 0
    info = write_blocks_stl(tmp_path / "blocks.stl", "1D", scale=75.0)
    assert info["triangles"] == 108 and info["blocks"] == 9 and info["bbox_max"][2] == pytest.approx(15.0)
    assert read_binary_stl(tmp_path / "blocks.stl").shape == (108, 3, 3)
    with pytest.raises(ValueError):
        blocks_triangles("1D", scale=0)


def test_approach_flow_fit_and_pipeline_inflow(tmp_path):
    (tmp_path / "AF_caseC.csv").write_text(AF, encoding="utf-8")
    profile = read_approach_flow(tmp_path / "AF_caseC.csv")
    assert profile[0] == (0.01, 2.372, 0.56) and interpolate_profile(profile, 0.15) == pytest.approx((3.392 + 3.654) / 2)
    fit = fit_log_law(profile, z_max=0.6)
    assert 0 < fit["z0_m"] < 0.01 and fit["u_star_m_s"] > 0 and fit["points"] == 7
    inflow = inflow_case_params(profile, scale=75.0)
    assert inflow["uref_m_s"] == pytest.approx(3.654) and inflow["zref_m"] == pytest.approx(15.0)
    assert inflow["z0_m"] == pytest.approx(fit["z0_m"] * 75.0, rel=1e-6)
    assert inflow["u_ref_measurement_height_m_s"] == pytest.approx(2.434)
    # Exact log law is recovered.
    exact = [(z, 0.5 / 0.41 * math.log(z / 0.002), 0.0) for z in (0.01, 0.02, 0.05, 0.1, 0.2)]
    got = fit_log_law(exact)
    assert got["z0_m"] == pytest.approx(0.002, rel=1e-6) and got["u_star_m_s"] == pytest.approx(0.5, rel=1e-6) and got["rmse_m_s"] < 1e-9
    with pytest.raises(ValueError):
        fit_log_law([(0.1, 3.0, 0), (0.2, 2.0, 0), (0.3, 1.0, 0)])


def test_measurements_filter_by_direction_and_centre(tmp_path):
    (tmp_path / "RS_caseC.csv").write_text(RS, encoding="utf-8")
    rows = read_measurements(tmp_path / "RS_caseC.csv", wind_direction=0.0, center_config="1D")
    assert [r["id"] for r in rows] == [1, 45, 54] and rows[0]["Vs_m_s"] == 0.66 and rows[1]["x_m"] == -0.3
    with pytest.raises(ValueError):
        read_measurements(tmp_path / "RS_caseC.csv", wind_direction=45.0, center_config="1D")


def test_pipeline_wind_from_270_blows_along_plus_x():
    vector = wind_vector_model(270.0, 0.0)
    assert vector[0] == pytest.approx(1.0) and vector[1] == pytest.approx(0.0, abs=1e-12)


def test_plane_sampling_is_inverse_distance_over_nearest_points():
    pts = np.array([[0.0, 0.0, 1.5], [1.0, 0.0, 1.5], [0.0, 1.0, 1.5], [1.0, 1.0, 1.5], [5.0, 5.0, 1.5]])
    u = np.array([[1.0, 0, 0], [3.0, 0, 0], [1.0, 0, 0], [3.0, 0, 0], [9.0, 0, 0]])
    plane = SimpleNamespace(points=pts, point_data={"U": u})
    got = sample_plane_speed(plane, np.array([[0.5, 0.5], [0.0, 0.0]]))
    assert got[0] == pytest.approx(2.0) and got[1] == pytest.approx(1.0)


def test_validation_metrics_hit_rate_fac2_and_bias():
    m = np.array([1.0, 1.0, 0.5, 0.02])
    p = np.array([1.1, 1.3, 1.5, 0.06])
    metrics = validation_metrics(m, p)
    assert metrics["n"] == 4
    # hits: 1.1 (10 %), 0.06 (abs 0.04 <= 0.05); misses: 1.3 (30 %), 1.5 (x3)
    assert metrics["hit_rate"] == pytest.approx(0.5)
    assert metrics["fac2"] == pytest.approx(0.5)  # 1.1/1.0 and 1.3/1.0 within [0.5, 2]; 1.5/0.5 = 3 and 0.06/0.02 = 3 not
    assert metrics["fractional_bias"] < 0 and metrics["rmse"] > 0 and -1 <= metrics["correlation_r"] <= 1
    assert metrics["acceptance"]["hit_rate_target"] == 0.66 and "COST 732" in metrics["acceptance"]["hit_rate_target_source"]
    assert metrics["acceptance"]["hit_rate_relative"] == HIT_RATE_RELATIVE and metrics["acceptance"]["hit_rate_absolute"] == HIT_RATE_ABSOLUTE
    # FAC2 ignores non-positive measurements instead of counting them as misses.
    masked = validation_metrics(np.array([0.0, 1.0, 1.0]), np.array([0.5, 1.1, 1.2]))
    assert masked["n_fac2_valid"] == 2 and masked["fac2"] == 1.0
    with pytest.raises(ValueError):
        validation_metrics(np.array([1.0]), np.array([1.0, 2.0]))


def test_comparison_document_normalises_both_sides_and_writes_outputs(tmp_path):
    measurements = [{"id": 1, "x_m": -0.25, "y_m": 0.0, "z_m": 0.02, "Vs_m_s": 1.217}, {"id": 2, "x_m": 0.25, "y_m": 0.0, "z_m": 0.02, "Vs_m_s": 2.434}]
    inflow = {"uref_m_s": 3.654, "zref_m": 15.0, "z0_m": 0.1, "u_ref_measurement_height_m_s": 2.434, "log_law_fit": {}}
    doc = build_comparison_document(run_id="cfd_aij", operator="t", wind_direction=0.0, center_config="1D", scale=75.0, inflow=inflow,
                                    measurements=measurements, predicted_speed=np.array([1.5, 3.0]), cfd_reference_speed=3.0,
                                    case_summary={"solver": {}})
    assert [p["measured_ratio"] for p in doc["points"]] == pytest.approx([0.5, 1.0])
    assert [p["cfd_ratio"] for p in doc["points"]] == pytest.approx([0.5, 1.0])
    assert doc["metrics"]["hit_rate"] == 1.0 and all(p["hit"] for p in doc["points"])
    assert doc["dataset"]["doi"] == "10.5281/zenodo.15401792" and doc["purpose"] == "pipeline_validation_only"
    paths = write_comparison_outputs(doc, tmp_path)
    assert paths["json"].exists() and paths["svg"].read_text(encoding="utf-8").count("<circle") == 2
    assert "hit rate 100 %" in render_scatter_svg(doc)


def test_isotropic_refinement_box_is_direction_independent():
    bbox_min, bbox_max = np.array([0.0, 0.0, 0.0]), np.array([40.0, 10.0, 12.0])
    box = refinement_box_for(bbox_min, bbox_max, height=12.0, ground_z=0.0, mode="bbox")
    assert box["min"] == (-12.0, -12.0, 0.0) and box["max"] == (64.0, 22.0, 24.0)
    iso = refinement_box_for(bbox_min, bbox_max, height=12.0, ground_z=0.0, mode="isotropic")
    radius = 0.5 * math.hypot(40.0, 10.0)
    assert iso["min"][0] == pytest.approx(20.0 - radius - 12.0) and iso["max"][1] == pytest.approx(5.0 + radius + 12.0)
    # Rotating the footprint by 90 degrees changes the bbox box but not the isotropic box size.
    rotated_min, rotated_max = np.array([15.0, -15.0, 0.0]), np.array([25.0, 25.0, 12.0])
    iso_rot = refinement_box_for(rotated_min, rotated_max, height=12.0, ground_z=0.0, mode="isotropic")
    size = lambda b: (b["max"][0] - b["min"][0], b["max"][1] - b["min"][1])  # noqa: E731
    assert size(iso_rot) == pytest.approx(size(iso))
    assert size(refinement_box_for(rotated_min, rotated_max, height=12.0, ground_z=0.0, mode="bbox")) != pytest.approx(size(box))
    with pytest.raises(ValueError):
        refinement_box_for(bbox_min, bbox_max, height=12.0, ground_z=0.0, mode="sphere")


@pytest.mark.parametrize("angle_deg", [0.0, 22.5, 45.0, 90.0, 137.0])
def test_isotropic_box_with_footprint_is_invariant_for_any_rotation(angle_deg):
    from bimcfd.wind import rotate_z
    footprint = np.array([[0.0, 0.0, 0.0], [40.0, 0.0, 0.0], [40.0, 10.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 12.0], [40.0, 10.0, 12.0]])
    rotated = rotate_z(footprint, math.radians(angle_deg))
    box = refinement_box_for(rotated.min(axis=0), rotated.max(axis=0), height=12.0, ground_z=0.0, mode="isotropic", footprint_xy=rotated[:, :2])
    radius = 0.5 * math.hypot(40.0, 10.0)  # farthest vertex from the centroid of a rectangle = half diagonal
    assert box["max"][0] - box["min"][0] == pytest.approx(2 * radius + 3 * 12.0)
    assert box["max"][1] - box["min"][1] == pytest.approx(2 * radius + 2 * 12.0)
    centre = rotated[:, :2].mean(axis=0)
    assert box["min"][0] == pytest.approx(centre[0] - radius - 12.0) and box["max"][1] == pytest.approx(centre[1] + radius + 12.0)


def test_isotropic_is_the_default_and_is_recorded_in_case_meta(tmp_path):
    """S5c (owner 2026-09-22): service and CLI build every direction with the same refinement box size."""
    import json

    assert CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0).refinement_box_mode == "isotropic"
    shell = tmp_path / "shell.stl"
    write_blocks_stl(shell, "1D", scale=75.0)
    sizes = set()
    for direction in (0.0, 22.5, 45.0, 112.5, 270.0):
        meta = build_case(shell_stl=shell, out_dir=tmp_path / f"case_{direction}", params=CaseParams(wind_from_degrees=direction, true_north_degrees=0.0, background_cell_m=6.0))
        assert meta["params"]["refinement_box_mode"] == "isotropic"
        box = meta["refinement_box"]
        sizes.add((round(box["max"][0] - box["min"][0], 6), round(box["max"][1] - box["min"][1], 6), round(box["max"][2] - box["min"][2], 6)))
        assert json.loads((tmp_path / f"case_{direction}" / "case_meta.json").read_text(encoding="utf-8"))["params"]["refinement_box_mode"] == "isotropic"
    assert len(sizes) == 1, sizes
    bbox_meta = build_case(shell_stl=shell, out_dir=tmp_path / "case_bbox", params=CaseParams(wind_from_degrees=45.0, true_north_degrees=0.0, background_cell_m=6.0, refinement_box_mode="bbox"))
    assert bbox_meta["params"]["refinement_box_mode"] == "bbox"
