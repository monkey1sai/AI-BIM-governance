from __future__ import annotations

import math

import numpy as np
import pytest

from bimcfd.foam_vtk import VtkSurface
from bimcfd.usd_results import OVERLAY_ROOT, colormap, safe_prim_name, write_result_layer, write_wrapper_stage


def _plane():
    points = np.array([[0, 0, 1.5], [10, 0, 1.5], [10, 10, 1.5], [0, 10, 1.5]], dtype=float)
    return VtkSurface(
        points=points,
        polygons=[np.array([0, 1, 2]), np.array([0, 2, 3])],
        point_data={"U": np.array([[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]], dtype=float), "p": np.array([0.1, 0.2, 0.3, 0.4])},
    )


def _building():
    points = np.array([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], dtype=float)
    return VtkSurface(points=points, polygons=[np.array([0, 1, 2, 3])], cell_data={"p": np.array([-3.0])})


def _tracks():
    points = np.array([[0, 0, 1], [1, 0, 1], [2, 0, 1], [0, 5, 1], [1, 5, 1]], dtype=float)
    return VtkSurface(
        points=points,
        lines=[np.array([0, 1, 2]), np.array([3, 4])],
        point_data={"U": np.array([[1, 0, 0]] * 5, dtype=float)},
    )


def test_safe_prim_name():
    assert safe_prim_name("cfd_2026-09-21T10:00_w000") == "cfd_2026_09_21T10_00_w000"
    assert safe_prim_name("9abc").startswith("_")


def test_colormap_spans_blue_to_red():
    colors = colormap(np.array([0.0, 1.0]))
    assert np.allclose(colors[0], [0, 0, 1])
    assert np.allclose(colors[1], [1, 0, 0])


def test_result_layer_is_authored_under_overlays_and_rotated_back(tmp_path):
    from pxr import Usd, UsdGeom

    layer = tmp_path / "cfd_run1.usdc"
    alpha = math.radians(90.0)  # solver frame = model rotated +90 deg
    summary = write_result_layer(
        out_path=layer,
        run_id="run1",
        pedestrian_plane=_plane(),
        building_surface=_building(),
        streamlines=_tracks(),
        solver_rotation_alpha_rad=alpha,
        run_custom_data={"wind_from_degrees": 0.0},
    )
    assert summary["run_prim"] == f"{OVERLAY_ROOT}/run1"
    assert set(summary["prims"]) == {"PedestrianWind_1p5m", "BuildingSurfacePressure", "Streamlines"}

    stage = Usd.Stage.Open(str(layer))
    assert stage.GetDefaultPrim().GetPath() == "/World"
    run = stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run1")
    assert run.GetCustomDataByKey("cfd:run_id") == "run1"
    assert run.GetCustomDataByKey("cfd:wind_from_degrees") == 0.0
    assert run.GetCustomDataByKey("cfd:purpose") == "design_comparison_only"

    plane = UsdGeom.Mesh(stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run1/PedestrianWind_1p5m"))
    pts = np.array(plane.GetPointsAttr().Get())
    # Solver point (10, 0, 1.5) rotated back by -90 deg lands on (0, -10, 1.5).
    assert np.allclose(pts[1], [0.0, -10.0, 1.5], atol=1e-5)
    primvars = UsdGeom.PrimvarsAPI(plane)
    mag = primvars.GetPrimvar("U_magnitude")
    assert mag.GetInterpolation() == "vertex"
    assert list(mag.Get()) == pytest.approx([1, 2, 3, 4])
    velocity = np.array(primvars.GetPrimvar("U").Get())
    assert np.allclose(velocity[0], [0.0, -1.0, 0.0], atol=1e-6)  # +X in solver frame is -Y in model frame
    assert len(plane.GetDisplayColorPrimvar().Get()) == 4
    assert list(plane.GetFaceVertexCountsAttr().Get()) == [3, 3]

    building = UsdGeom.Mesh(stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run1/BuildingSurfacePressure"))
    p = UsdGeom.PrimvarsAPI(building).GetPrimvar("p")
    assert p.GetInterpolation() == "uniform"
    assert list(p.Get()) == [-3.0]

    curves = UsdGeom.BasisCurves(stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run1/Streamlines"))
    assert list(curves.GetCurveVertexCountsAttr().Get()) == [3, 2]
    assert len(curves.GetPointsAttr().Get()) == 5
    # Nothing was written outside the overlay scope.
    assert not stage.GetPrimAtPath("/World/Elements").IsValid()


def test_wrapper_stage_composes_model_and_results(tmp_path):
    from pxr import Usd, UsdGeom

    model = tmp_path / "conversion" / "model.usdc"
    model.parent.mkdir()
    model_stage = Usd.Stage.CreateNew(str(model))
    UsdGeom.Xform.Define(model_stage, "/World")
    UsdGeom.Mesh.Define(model_stage, "/World/Elements/IfcWall/G_A")
    model_stage.SetDefaultPrim(model_stage.GetPrimAtPath("/World"))
    model_stage.GetRootLayer().Save()

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    layer = run_dir / "cfd_run1.usdc"
    write_result_layer(
        out_path=layer,
        run_id="run1",
        pedestrian_plane=_plane(),
        building_surface=None,
        streamlines=None,
        solver_rotation_alpha_rad=0.0,
    )
    wrapper = write_wrapper_stage(out_path=run_dir / "cfd_view_run1.usda", model_usdc=model, result_layer=layer)

    stage = Usd.Stage.Open(str(wrapper))
    assert stage.GetPrimAtPath("/World/Elements/IfcWall/G_A").IsValid()
    assert stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run1/PedestrianWind_1p5m").IsValid()
    sublayers = list(stage.GetRootLayer().subLayerPaths)
    assert sublayers[0].endswith("conversion/model.usdc")
    assert sublayers[1] == "./cfd_run1.usdc"
    # The model layer itself is untouched.
    fresh = Usd.Stage.Open(str(model))
    assert not fresh.GetPrimAtPath("/World/Overlays").IsValid()
