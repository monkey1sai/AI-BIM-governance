"""CP1 probe stage generator (tools/cfd/kit/make_presentation_probe_stage.py), pure usd-core."""

from __future__ import annotations

import hashlib
import math
import sys
from pathlib import Path

import numpy as np
import pytest

pxr = pytest.importorskip("pxr")
from pxr import Sdf, Usd, UsdGeom  # noqa: E402

KIT_DIR = Path(__file__).resolve().parents[1] / "kit"
if str(KIT_DIR) not in sys.path:
    sys.path.insert(0, str(KIT_DIR))

import make_presentation_probe_stage as probe  # noqa: E402

RUN = "/World/Overlays/Cfd/cfd_probe"


def _build(tmp_path: Path, **kwargs) -> tuple[dict, Usd.Stage]:
    spec = probe.ProbeSpec(run_id="cfd_probe", **kwargs)
    manifest = probe.build_probe_stage(tmp_path, spec)
    return manifest, Usd.Stage.Open(manifest["view"])


def test_default_stage_has_building_plane_and_production_conventions(tmp_path):
    manifest, stage = _build(tmp_path)
    assert UsdGeom.GetStageUpAxis(stage) == UsdGeom.Tokens.z
    assert UsdGeom.GetStageMetersPerUnit(stage) == 1.0
    box = stage.GetPrimAtPath("/World/Elements/IfcWall/ProbeBuilding")
    assert box.IsA(UsdGeom.Mesh)
    extent = UsdGeom.Mesh(box).GetExtentAttr().Get()
    assert tuple(extent[0]) == (-20.0, -12.5, 0.0)
    assert tuple(extent[1]) == (20.0, 12.5, 30.0)
    run = stage.GetPrimAtPath(RUN)
    assert run.GetCustomDataByKey("cfd:run_id") == "cfd_probe"
    assert run.GetCustomDataByKey("cfd:legend")["U"]["max"] == 5.0
    plane = UsdGeom.Mesh(stage.GetPrimAtPath(f"{RUN}/PedestrianWind_1p5m"))
    points = np.asarray(plane.GetPointsAttr().Get())
    assert np.allclose(points[:, 2], 1.5)
    # clipped to the building bbox expanded by 3H, like usd_results.plane_clip_box
    assert points[:, 0].min() == pytest.approx(-20.0 - 90.0) and points[:, 1].max() == pytest.approx(12.5 + 90.0)
    assert len(plane.GetDisplayColorPrimvar().Get()) == len(points)
    assert stage.GetPrimAtPath(f"{RUN}/BuildingSurfacePressure").IsA(UsdGeom.Mesh)
    # no animation requested: the overlay layer carries no loop metadata
    overlay = Sdf.Layer.FindOrOpen(manifest["overlay"])
    assert "cfd:animation" not in dict(overlay.customLayerData)
    assert manifest["overlay_bytes"] == Path(manifest["overlay"]).stat().st_size > 0


def test_optional_context_prims_can_be_left_out(tmp_path):
    _, stage = _build(tmp_path, plane=False, surface_pressure=False)
    assert [c.GetName() for c in stage.GetPrimAtPath(RUN).GetChildren()] == []


def test_streamlines_have_requested_count_and_points_outside_building(tmp_path):
    manifest, stage = _build(tmp_path, streamlines=24, streamline_points=40)
    curves = UsdGeom.BasisCurves(stage.GetPrimAtPath(f"{RUN}/Streamlines"))
    counts = list(curves.GetCurveVertexCountsAttr().Get())
    assert counts == [40] * 24
    pts = np.asarray(curves.GetPointsAttr().Get())
    inside = (np.abs(pts[:, 0]) < 20.0) & (np.abs(pts[:, 1]) < 12.5) & (pts[:, 2] < 30.0)
    assert not inside.any()
    assert manifest["prims"]["Streamlines"] == {"curves": 24, "points": 960}


def test_growth_segments_reveal_in_travel_time_order_inside_the_loop(tmp_path):
    manifest, stage = _build(tmp_path, streamlines=12, streamline_points=30, growth="segments", growth_segments=8)
    group = stage.GetPrimAtPath(f"{RUN}/StreamlineGrowth")
    segs = list(group.GetChildren())
    assert [s.GetName() for s in segs] == [f"Seg_{i:03d}" for i in range(8)]
    reveal = []
    for seg in segs:
        assert seg.IsA(UsdGeom.BasisCurves)
        vis = UsdGeom.Imageable(seg).GetVisibilityAttr()
        samples = vis.GetTimeSamples()
        assert len(samples) == 2
        assert vis.Get(0.0) == UsdGeom.Tokens.invisible
        assert vis.Get(239.0) == UsdGeom.Tokens.inherited
        reveal.append(samples[1])
    assert reveal == sorted(reveal) and len(set(reveal)) == 8
    assert reveal[-1] == pytest.approx(6.0 * 24)  # growth_seconds * fps, inside the 240-frame loop
    overlay = Sdf.Layer.FindOrOpen(manifest["overlay"])
    anim = dict(overlay.customLayerData)["cfd:animation"]
    assert anim["frames"] == 240 and anim["fps"] == 24 and anim["loop"] is True
    assert overlay.startTimeCode == 0 and overlay.endTimeCode == 239
    assert stage.GetEndTimeCode() == 239  # wrapper copies the range so Kit plays it
    assert manifest["prims"]["StreamlineGrowth"]["segments"] == 8


def test_growth_segments_join_end_to_end(tmp_path):
    _, stage = _build(tmp_path, streamlines=1, streamline_points=30, growth="segments", growth_segments=4)
    pieces = [np.asarray(UsdGeom.BasisCurves(seg).GetPointsAttr().Get())
              for seg in stage.GetPrimAtPath(f"{RUN}/StreamlineGrowth").GetChildren()]
    assert len(pieces) == 4
    for a, b in zip(pieces, pieces[1:]):
        assert np.allclose(a[-1], b[0], atol=1e-4)


def test_growth_widths_single_curve_prim_with_time_sampled_widths(tmp_path):
    _, stage = _build(tmp_path, streamlines=6, streamline_points=20, growth="widths", growth_segments=5)
    curves = UsdGeom.BasisCurves(stage.GetPrimAtPath(f"{RUN}/StreamlineGrowth"))
    assert curves.GetWidthsInterpolation() == UsdGeom.Tokens.vertex
    widths = curves.GetWidthsAttr()
    samples = widths.GetTimeSamples()
    assert len(samples) == 6 and samples[0] == 0 and samples[-1] == pytest.approx(144)
    assert np.allclose(widths.Get(0.0), 0.0)
    assert np.allclose(widths.Get(239.0), 0.5)
    assert len(widths.Get(0.0)) == 120


def test_particles_are_time_sampled_every_frame(tmp_path):
    _, stage = _build(tmp_path, streamlines=10, streamline_points=30, particles=50)
    pts = UsdGeom.Points(stage.GetPrimAtPath(f"{RUN}/FlowParticles"))
    assert len(pts.GetPointsAttr().GetTimeSamples()) == 240
    assert len(pts.GetPointsAttr().Get(0.0)) == 50
    assert not np.allclose(pts.GetPointsAttr().Get(0.0), pts.GetPointsAttr().Get(10.0))


@pytest.mark.parametrize("mode", ["instancer", "instancer_binned", "merged"])
def test_vector_arrows_have_exact_count_and_per_arrow_colour(tmp_path, mode):
    manifest, stage = _build(tmp_path, arrows=300, arrow_mode=mode)
    prim = stage.GetPrimAtPath(f"{RUN}/PedestrianWindVectors")
    if mode == "merged":
        mesh = UsdGeom.Mesh(prim)
        n_pts = len(mesh.GetPointsAttr().Get())
        assert n_pts == 300 * probe.ARROW_POINTS
        assert len(mesh.GetDisplayColorPrimvar().Get()) == n_pts
    else:
        inst = UsdGeom.PointInstancer(prim)
        assert len(inst.GetPositionsAttr().Get()) == 300
        assert len(inst.GetOrientationsAttr().Get()) == 300
        assert len(inst.GetScalesAttr().Get()) == 300
        protos = inst.GetPrototypesRel().GetTargets()
        if mode == "instancer":
            assert len(protos) == 1
            colors = UsdGeom.PrimvarsAPI(prim).GetPrimvar("displayColor")
            assert colors.GetInterpolation() == UsdGeom.Tokens.vertex and len(colors.Get()) == 300
        else:
            assert len(protos) == probe.COLOUR_BINS
            assert set(inst.GetProtoIndicesAttr().Get()) <= set(range(probe.COLOUR_BINS))
    assert manifest["prims"]["PedestrianWindVectors"]["arrows"] == 300


def test_arrow_orientation_follows_the_velocity(tmp_path):
    _, stage = _build(tmp_path, arrows=200, arrow_mode="instancer")
    inst = UsdGeom.PointInstancer(stage.GetPrimAtPath(f"{RUN}/PedestrianWindVectors"))
    positions = np.asarray(inst.GetPositionsAttr().Get(), dtype=np.float64)
    assert np.allclose(positions[:, 2], 1.55)
    velocity = probe.velocity_field(positions, probe.ProbeSpec())
    for q, v in zip(list(inst.GetOrientationsAttr().Get())[:50], velocity[:50]):
        heading = 2.0 * math.atan2(q.GetImaginary()[2], q.GetReal())
        expected = math.atan2(v[1], v[0])
        assert math.isclose(math.cos(heading - expected), 1.0, abs_tol=1e-3)


@pytest.mark.parametrize("bearing", [0.0, 90.0, 225.0])
def test_wind_arrow_sits_upstream_and_points_downwind(tmp_path, bearing):
    _, stage = _build(tmp_path, wind_from_deg=bearing, wind_arrow=True)
    mesh = UsdGeom.Mesh(stage.GetPrimAtPath(f"{RUN}/WindDirectionArrow"))
    pts = np.asarray(mesh.GetPointsAttr().Get(), dtype=np.float64)
    rad = math.radians(bearing)
    from_vec = np.array([math.sin(rad), math.cos(rad)])  # model +Y = project north
    downwind = -from_vec
    centre = pts[:, :2].mean(axis=0)
    assert float(centre @ from_vec) > math.hypot(20.0, 12.5)  # upstream of the building
    tip = pts[np.argmax(pts[:, :2] @ downwind), :2]
    tail = pts[np.argmin(pts[:, :2] @ downwind), :2]
    axis = (tip - tail) / np.linalg.norm(tip - tail)
    assert float(axis @ downwind) > 0.99
    assert pts[:, 2].min() > 1.5 + 1.0  # clear of the pedestrian plane


def test_flow_field_follows_the_wind_bearing(tmp_path):
    spec = probe.ProbeSpec(wind_from_deg=0.0)  # from north: blows toward -Y
    v = probe.velocity_field(np.array([[0.0, 500.0, 10.0]]), spec)[0]
    assert v[1] < 0 and abs(v[0]) < 1e-6 * abs(v[1])


def test_sections_hidden_by_default_on_standard_positions(tmp_path):
    manifest, stage = _build(tmp_path, sections=5)
    names = ["Section_Z1", "Section_Z2", "Section_Z3", "Section_X1", "Section_Y1"]
    for name in names:
        prim = stage.GetPrimAtPath(f"{RUN}/{name}")
        assert prim.IsA(UsdGeom.Mesh), name
        assert UsdGeom.Imageable(prim).GetVisibilityAttr().Get() == UsdGeom.Tokens.invisible
        mesh = UsdGeom.Mesh(prim)
        assert len(mesh.GetDisplayColorPrimvar().Get()) == len(mesh.GetPointsAttr().Get())
    for name, z in zip(names[:3], (7.5, 15.0, 22.5)):
        pts = np.asarray(UsdGeom.Mesh(stage.GetPrimAtPath(f"{RUN}/{name}")).GetPointsAttr().Get())
        assert np.allclose(pts[:, 2], z)
    assert np.allclose(np.asarray(UsdGeom.Mesh(stage.GetPrimAtPath(f"{RUN}/Section_X1")).GetPointsAttr().Get())[:, 0], 0.0)
    assert np.allclose(np.asarray(UsdGeom.Mesh(stage.GetPrimAtPath(f"{RUN}/Section_Y1")).GetPointsAttr().Get())[:, 1], 0.0)
    assert manifest["prims"]["sections"]["count"] == 5


def test_every_toggleable_prim_is_a_direct_child_of_the_run_prim(tmp_path):
    _, stage = _build(tmp_path, streamlines=4, streamline_points=10, growth="segments", growth_segments=3,
                      particles=8, arrows=20, wind_arrow=True, sections=5)
    names = {child.GetName() for child in stage.GetPrimAtPath(RUN).GetChildren()}
    assert names == {"PedestrianWind_1p5m", "BuildingSurfacePressure", "Streamlines", "StreamlineGrowth", "FlowParticles",
                     "PedestrianWindVectors", "WindDirectionArrow",
                     "Section_Z1", "Section_Z2", "Section_Z3", "Section_X1", "Section_Y1"}


def test_output_is_deterministic(tmp_path):
    kwargs = dict(streamlines=6, streamline_points=12, growth="segments", growth_segments=4, particles=10, arrows=40, sections=2)
    a, _ = _build(tmp_path / "a", **kwargs)
    b, _ = _build(tmp_path / "b", **kwargs)

    def digest(path):
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()

    assert digest(a["overlay"]) == digest(b["overlay"])
    assert digest(a["model"]) == digest(b["model"])


def test_rejects_unknown_modes(tmp_path):
    with pytest.raises(ValueError):
        probe.build_probe_stage(tmp_path, probe.ProbeSpec(growth="sideways", streamlines=2))
    with pytest.raises(ValueError):
        probe.build_probe_stage(tmp_path, probe.ProbeSpec(arrow_mode="glyphs", arrows=3))
    with pytest.raises(ValueError):
        probe.build_probe_stage(tmp_path, probe.ProbeSpec(sections=6))
    with pytest.raises(ValueError):
        probe.build_probe_stage(tmp_path, probe.ProbeSpec(growth="segments", streamlines=0))
