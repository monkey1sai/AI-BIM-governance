"""Contract S5b: three-grid mesh-convergence study (Celik 2008 GCI) and its outputs."""
import json
import math
from types import SimpleNamespace

import numpy as np
import pytest

from bimcfd.convergence import (
    METRICS, SCHEMA, build_convergence_document, compute_gci, plane_metrics, render_convergence_svg, surface_pressure_metrics,
    write_convergence_outputs,
)


def test_gci_recovers_a_second_order_solution_exactly():
    # f(h) = f_exact + c h^2 on r = 2 grids -> p = 2, f_ext = f_exact.
    h = [1.0, 2.0, 4.0]
    f = [10.0 + 0.5 * v ** 2 for v in h]
    g = compute_gci(h, f)
    assert g["convergence"] == "monotonic"
    assert g["p"] == pytest.approx(2.0, rel=1e-9)
    assert g["f_ext"] == pytest.approx(10.0, rel=1e-9)
    assert g["r21"] == 2.0 and g["r32"] == 2.0
    # GCI_fine = 1.25 * |e21| / (r^p - 1) with e21 = |(f1-f2)/f1| = 1.5/10.5
    assert g["gci_fine"] == pytest.approx(1.25 * (1.5 / 10.5) / 3.0, rel=1e-9)
    assert g["e_ext_relative"] == pytest.approx(0.05, rel=1e-9)


def test_gci_handles_non_uniform_refinement_and_first_order():
    h = [1.0, 1.5, 3.0]
    f = [4.0 + 0.2 * v for v in h]  # first order
    g = compute_gci(h, f)
    assert g["convergence"] == "monotonic" and g["p"] == pytest.approx(1.0, rel=1e-6) and g["f_ext"] == pytest.approx(4.0, rel=1e-6)


@pytest.mark.parametrize("f, expected", [
    ([1.0, 1.2, 1.1], "oscillatory"),   # e21 > 0, e32 < 0
    ([1.0, 1.5, 1.6], "divergent"),     # fine-grid step larger than coarse step -> ratio >= 1
    ([2.0, 2.0, 2.0], "exact"),
])
def test_gci_classifies_non_monotonic_sequences_without_an_order(f, expected):
    g = compute_gci([1.0, 2.0, 4.0], f)
    assert g["convergence"] == expected
    if expected != "exact":
        assert g["p"] is None and g["gci_fine"] is None
    else:
        assert g["gci_fine"] == 0.0 and g["f_ext"] == 2.0


def test_gci_reports_capped_order_and_near_zero_reference_without_nan():
    fast = compute_gci([1.0, 2.0, 4.0], [10.0 + 0.001 * v ** 5 for v in (1.0, 2.0, 4.0)])  # apparent order 5
    assert fast["p"] == pytest.approx(5.0, rel=1e-6) and fast["p_capped"] == 2.0 and fast["gci_fine_p_capped"] > fast["gci_fine"]
    zero_ref = compute_gci([1.0, 2.0, 4.0], [0.0, 0.5, 1.5])  # fine-grid value exactly zero
    assert zero_ref["convergence"] == "monotonic" and zero_ref["reference_near_zero"] is True and zero_ref["gci_fine"] is None
    doc = build_convergence_document(run_id="x", wind_from_degrees=0.0, operator="t", levels=[
        _level(1.0, 0.0, 2.0, 1), _level(2.0, 0.5, 2.1, 1), _level(4.0, 1.5, 2.3, 1)])
    assert "reference_near_zero_for_some_metric" in doc["verdict"]["warnings"]
    import json as _json
    _json.dumps(doc, allow_nan=False)  # strict JSON must succeed


def test_gci_rejects_bad_inputs():
    with pytest.raises(ValueError):
        compute_gci([1.0, 2.0], [1.0, 2.0])
    with pytest.raises(ValueError):
        compute_gci([2.0, 1.0, 4.0], [1.0, 2.0, 3.0])  # not fine -> coarse


def _plane(with_polygons: bool = False):
    xs, ys = np.meshgrid(np.linspace(-10, 10, 5), np.linspace(-10, 10, 5))
    points = np.column_stack([xs.ravel(), ys.ravel(), np.full(xs.size, 1.5)])
    u = np.column_stack([np.linspace(1.0, 5.0, points.shape[0]), np.zeros(points.shape[0]), np.zeros(points.shape[0])])
    polygons = []
    if with_polygons:
        for j in range(4):
            for i in range(4):
                a = j * 5 + i
                polygons.append(np.array([a, a + 1, a + 6, a + 5]))  # 16 quads of 5 m x 5 m
    return SimpleNamespace(points=points, point_data={"U": u}, polygons=polygons, cell_data={})


def test_plane_metrics_and_clipping_without_polygons_fall_back_to_points():
    plane = _plane()
    full = plane_metrics(plane)
    assert full["U_max"] == 5.0 and full["points"] == 25 and 1.0 < full["U_mean"] < 5.0 and full["U_p95"] <= 5.0
    assert full["weighting"] == "points" and full["polygons"] == 0
    clipped = plane_metrics(plane, clip_box=(-5.0, 5.0, -5.0, 5.0))
    assert clipped["points"] == 9 and clipped["U_max"] < 5.0
    empty_clip = plane_metrics(plane, clip_box=(100.0, 101.0, 100.0, 101.0))
    assert empty_clip["points"] == 25 and empty_clip["clip_applied"] is False  # never silently drop everything, but say so
    assert plane_metrics(plane, clip_box=(-5.0, 5.0, -5.0, 5.0))["clip_applied"] is True
    with pytest.raises(ValueError):
        plane_metrics(SimpleNamespace(points=plane.points, point_data={}, polygons=[]))


def test_plane_metrics_are_area_weighted_when_polygons_exist():
    plane = _plane(with_polygons=True)
    full = plane_metrics(plane)
    assert full["weighting"] == "area" and full["polygons"] == 16 and full["area_m2"] == pytest.approx(400.0)
    # Uniform quads: area weighting equals the mean of per-polygon means.
    expected = np.mean([np.linalg.norm(plane.point_data["U"][poly], axis=1).mean() for poly in plane.polygons])
    assert full["U_mean"] == pytest.approx(expected)
    assert full["U_max"] == 5.0 and full["U_p95"] <= 5.0
    clipped = plane_metrics(plane, clip_box=(-5.0, 5.0, -5.0, 5.0))
    assert clipped["polygons"] == 4 and clipped["points"] == 9 and clipped["area_m2"] == pytest.approx(100.0)
    # A refined patch (many small polygons) must not dominate the mean: duplicate one quad as four small ones with a high value.
    dense = _plane(with_polygons=True)
    dense.point_data["U"] = dense.point_data["U"].copy()
    heavy = plane_metrics(dense)
    assert heavy["U_mean"] == pytest.approx(full["U_mean"])


def test_surface_pressure_prefers_cell_data():
    assert surface_pressure_metrics(SimpleNamespace(point_data={}, cell_data={"p": np.array([-3.0, 2.0])})) == {"p_min": -3.0, "p_max": 2.0}
    assert surface_pressure_metrics(SimpleNamespace(point_data={"p": np.array([-1.0, 1.0])}, cell_data={})) == {"p_min": -1.0, "p_max": 1.0}
    assert surface_pressure_metrics(SimpleNamespace(point_data={}, cell_data={})) == {"p_min": None, "p_max": None}
    assert surface_pressure_metrics(None) == {"p_min": None, "p_max": None}


def _level(cell, u_max, u_mean, cells, p_min=-10.0, p_max=5.0):
    return {"background_cell_m": cell, "mesh_cells": cells, "iterations": 300, "converged_by_residual_control": True,
            "end_time_extended_to": None, "elapsed_seconds": 60.0,
            "metrics": {"U_max": u_max, "U_mean": u_mean, "U_p95": u_max * 0.9, "p_min": p_min, "p_max": p_max}}


def test_document_orders_levels_fine_to_coarse_and_judges_pedestrian_metrics(tmp_path):
    levels = [_level(8.0, 4.4, 2.3, 100_000), _level(4.0, 4.1, 2.05, 800_000), _level(6.0, 4.2, 2.1, 250_000)]
    doc = build_convergence_document(run_id="cfd_conv", wind_from_degrees=0.0, levels=levels, operator="t")
    assert doc["schema"] == SCHEMA and [l["background_cell_m"] for l in doc["levels"]] == [4.0, 6.0, 8.0]
    assert set(doc["gci"]) == set(METRICS)
    assert doc["gci"]["U_max"]["convergence"] == "monotonic"
    assert doc["gci"]["p_min"]["convergence"] == "exact" and doc["gci"]["p_min"]["gci_fine"] == 0.0
    assert isinstance(doc["verdict"]["pedestrian_within_5pct"], bool)
    assert doc["verdict"]["fine_grid_gci_max"] is not None
    paths = write_convergence_outputs(doc, tmp_path)
    saved = json.loads(paths["json"].read_text(encoding="utf-8"))
    assert saved["verdict"] == doc["verdict"]
    svg = paths["svg"].read_text(encoding="utf-8")
    assert svg.startswith("<svg") and "U_max" in svg and "f_ext" in svg and svg.count("<circle") == 3 * len([m for m in METRICS if doc["gci"][m]])


def test_document_tolerates_missing_pressure_and_requires_three_levels():
    levels = [_level(8.0, 4.4, 2.3, 1, p_min=None, p_max=None), _level(4.0, 4.1, 2.05, 1, p_min=None, p_max=None), _level(6.0, 4.2, 2.1, 1, p_min=None, p_max=None)]
    doc = build_convergence_document(run_id="x", wind_from_degrees=90.0, levels=levels, operator="t")
    assert doc["gci"]["p_min"] is None and "p_min" not in doc["verdict"]["metrics_monotonic"]
    assert "<svg" in render_convergence_svg(doc)
    with pytest.raises(ValueError):
        build_convergence_document(run_id="x", wind_from_degrees=0.0, levels=levels[:2], operator="t")
    empty = render_convergence_svg({"gci": {}})
    assert "no metrics" in empty


def test_pedestrian_verdict_false_when_oscillatory():
    levels = [_level(8.0, 4.0, 2.0, 1), _level(6.0, 4.5, 2.2, 1), _level(4.0, 4.2, 2.1, 1)]
    doc = build_convergence_document(run_id="x", wind_from_degrees=0.0, levels=levels, operator="t")
    assert doc["gci"]["U_max"]["convergence"] == "oscillatory"
    assert doc["verdict"]["pedestrian_within_5pct"] is False
    assert math.isnan(float("nan"))  # keep numpy/ math imports honest
