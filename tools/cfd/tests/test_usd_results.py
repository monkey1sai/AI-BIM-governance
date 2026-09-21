from __future__ import annotations

import math

import numpy as np
import pytest

from bimcfd.flow_animation import AnimationParams
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



# --------------------------------------------------------------------------- S3.1 visual quality


def _long_tracks(n_points: int = 8):
    points = np.array([[float(i) * 3.0, 0.0, 2.0] for i in range(n_points)] + [[float(i) * 3.0, 6.0, 2.0] for i in range(n_points)])
    velocity = np.array([[2.0, 0.0, 0.0]] * (2 * n_points))
    return VtkSurface(points=points, lines=[np.arange(n_points), np.arange(n_points, 2 * n_points)], point_data={"U": velocity})


def _wide_plane():
    # 3x3 quads over 0..30 in x and y at z=1.5; building bbox = [10,20]x[10,20]x[0,2] → 3H margin = 6 m
    xs = np.linspace(0.0, 30.0, 4)
    pts = np.array([[x, y, 1.5] for y in xs for x in xs])
    polys = []
    for j in range(3):
        for i in range(3):
            a = j * 4 + i
            polys.append(np.array([a, a + 1, a + 5, a + 4]))
    velocity = np.tile([3.0, 0.0, 0.0], (pts.shape[0], 1))
    return VtkSurface(points=pts, polygons=polys, point_data={"U": velocity, "p": np.zeros(pts.shape[0])})


def test_clip_surface_keeps_only_polygons_inside_box():
    from bimcfd.usd_results import clip_surface_to_xy_box, plane_clip_box

    box = plane_clip_box((10, 10, 0), (20, 20, 2), ground_z=0.0)
    assert box == (4.0, 26.0, 4.0, 26.0)
    clipped = clip_surface_to_xy_box(_wide_plane(), *box)
    # Only the centre quad (10..20 × 10..20) has all four corners inside 4..26.
    assert clipped.polygon_count == 1
    assert clipped.points.shape[0] == 4
    assert clipped.point_data["U"].shape == (4, 3)
    assert clipped.point_data["p"].shape == (4,)
    assert clipped.polygons[0].max() < 4


def test_result_layer_has_fixed_scales_legend_opacity_tubes_and_particle_animation(tmp_path):
    from pxr import Sdf, Usd, UsdGeom

    from bimcfd.usd_results import ANIMATION_NOTE

    layer = tmp_path / "cfd_run2.usdc"
    summary = write_result_layer(
        out_path=layer,
        run_id="run2",
        pedestrian_plane=_wide_plane(),
        building_surface=_building(),
        streamlines=_long_tracks(),
        solver_rotation_alpha_rad=0.0,
        building_bbox_solver_frame=((10, 10, 0), (20, 20, 2)),
        ground_z=0.0,
        animation=AnimationParams(fps=6, seconds=1.0, target_particles=4),
    )
    assert set(summary["prims"]) == {"PedestrianWind_1p5m", "BuildingSurfacePressure", "Streamlines", "FlowParticles"}
    assert summary["prims"]["PedestrianWind_1p5m"]["polygons"] == 1
    assert summary["prims"]["PedestrianWind_1p5m"]["clipped_to_bbox_heights"] == 3.0
    assert summary["prims"]["PedestrianWind_1p5m"]["display_opacity"] == 0.6
    assert summary["prims"]["Streamlines"]["width_m"] == 0.5
    assert summary["prims"]["FlowParticles"]["frames"] == 6
    assert summary["legend"]["U"] == {"min": 0.0, "max": 5.0, "unit": "m/s", "prims": ["PedestrianWind_1p5m", "Streamlines", "FlowParticles"]}
    assert summary["legend"]["p"]["min"] == -3.0 and summary["legend"]["p"]["max"] == -3.0 and summary["legend"]["p"]["available"] is True

    stage = Usd.Stage.Open(str(layer))
    run = stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run2")
    legend = run.GetCustomDataByKey("cfd:legend")
    assert legend["U"]["max"] == 5.0 and legend["p"]["unit"] == "Pa"
    animation = run.GetCustomDataByKey("cfd:animation")
    assert animation["note"] == ANIMATION_NOTE and animation["fps"] == 6 and animation["frames"] == 6

    plane = UsdGeom.Mesh(stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run2/PedestrianWind_1p5m"))
    assert list(plane.GetDisplayOpacityPrimvar().Get()) == pytest.approx([0.6])
    # Fixed scale: 3 m/s on a 0..5 ramp is 0.6 → between green (0.5) and yellow (0.75).
    colour = np.array(plane.GetDisplayColorPrimvar().Get())[0]
    assert colour[0] == pytest.approx(0.4, abs=1e-6) and colour[1] == pytest.approx(1.0) and colour[2] == pytest.approx(0.0)

    curves = UsdGeom.BasisCurves(stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run2/Streamlines"))
    assert list(curves.GetWidthsAttr().Get()) == pytest.approx([0.5])
    assert curves.GetWidthsInterpolation() == UsdGeom.Tokens.constant

    particles = UsdGeom.Points(stage.GetPrimAtPath(f"{OVERLAY_ROOT}/run2/FlowParticles"))
    times = particles.GetPointsAttr().GetTimeSamples()
    assert times == [float(i) for i in range(6)]
    first = np.array(particles.GetPointsAttr().Get(0.0))
    later = np.array(particles.GetPointsAttr().Get(3.0))
    assert first.shape == (4, 3) and not np.allclose(first, later)
    assert len(particles.GetDisplayColorPrimvar().GetAttr().GetTimeSamples()) == 6
    assert particles.GetPrim().GetCustomDataByKey("cfd:animation_note") == ANIMATION_NOTE
    assert stage.GetStartTimeCode() == 0 and stage.GetEndTimeCode() == 5 and stage.GetTimeCodesPerSecond() == 6
    assert Sdf.Layer.FindOrOpen(str(layer)).customLayerData["cfd:animation"]["loop"] is True


def test_short_tracks_produce_no_particles_and_no_time_range(tmp_path):
    from pxr import Usd

    layer = tmp_path / "cfd_run3.usdc"
    summary = write_result_layer(
        out_path=layer, run_id="run3", pedestrian_plane=None, building_surface=None, streamlines=_tracks(), solver_rotation_alpha_rad=0.0,
    )
    assert "FlowParticles" not in summary["prims"]
    assert not Usd.Stage.Open(str(layer)).HasAuthoredTimeCodeRange()


def test_wrapper_stage_copies_the_animation_time_range(tmp_path):
    from pxr import Usd, UsdGeom

    model = tmp_path / "model.usdc"
    model_stage = Usd.Stage.CreateNew(str(model))
    UsdGeom.Xform.Define(model_stage, "/World")
    model_stage.SetDefaultPrim(model_stage.GetPrimAtPath("/World"))
    model_stage.GetRootLayer().Save()
    layer = tmp_path / "cfd_run4.usdc"
    write_result_layer(
        out_path=layer, run_id="run4", pedestrian_plane=None, building_surface=None, streamlines=_long_tracks(),
        solver_rotation_alpha_rad=0.0, animation=AnimationParams(fps=12, seconds=0.5, target_particles=2),
    )
    wrapper = write_wrapper_stage(out_path=tmp_path / "view.usda", model_usdc=model, result_layer=layer)
    stage = Usd.Stage.Open(str(wrapper))
    assert stage.GetStartTimeCode() == 0 and stage.GetEndTimeCode() == 5 and stage.GetTimeCodesPerSecond() == 12


def test_particle_width_scales_with_the_building_footprint():
    from bimcfd.usd_results import PARTICLE_WIDTH_M, particle_width_m

    assert particle_width_m(None) == PARTICLE_WIDTH_M
    assert particle_width_m(((0, 0, 0), (20, 30, 10))) == PARTICLE_WIDTH_M  # 1% of 30 m < lower bound
    assert particle_width_m(((0, 0, 0), (200, 120, 23))) == pytest.approx(2.0)
    assert particle_width_m(((0, 0, 0), (900, 900, 50))) == 2.5  # upper bound
