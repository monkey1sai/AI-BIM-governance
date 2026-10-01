import numpy as np
import pytest

from bimcfd.foam_vtk import VtkSurface
from bimcfd.openfoam_case import CaseParams, streamline_seed_points, domain_kwargs
from bimcfd.streamline_presentation import clip_tracks, footprint_hull, growth_buckets
from bimcfd.usd_results import write_result_layer
from bimcfd.wind import domain_from_building


def tracks(points, speed=2):
    points = np.asarray(points, dtype=float)
    return VtkSurface(points=points, lines=[np.arange(len(points))], point_data={"U": np.tile([speed, 0., 0.], (len(points), 1))})


def test_service_curtain_covers_building_and_all_eight_rows():
    bbox = (np.array([10., 20., 0.]), np.array([40., 60., 10.]))
    params = CaseParams(0, 0, presentation_version=2)
    domain = domain_from_building(*bbox, ground_z=0, **domain_kwargs(params))
    seeds = np.array(streamline_seed_points(params, domain, 1.5, bbox))
    assert seeds.shape == (240, 3)
    assert np.unique(seeds[:, 0]) == pytest.approx([5])
    assert len(np.unique(seeds[:, 2])) == 8
    assert seeds[:, 1].min() == 10 and seeds[:, 1].max() == 70
    assert seeds[:, 2].min() == 1.5 and seeds[:, 2].max() == 12
    assert (seeds[:, 0] < bbox[0][0]).all()


def test_clip_crossing_interpolates_velocity_and_does_not_bridge_reentry():
    source = tracks([[-10, 0, 1], [0, 0, 1], [10, 0, 1], [0, 1, 1]])
    source.point_data["U"][:, 0] = [0, 10, 20, 30]
    clipped = clip_tracks(source, ([0, 0, 0], [1, 1, 2]), 0)
    assert len(clipped.lines) == 2
    assert clipped.points[:, 0].min() == -6 and clipped.points[:, 0].max() == 7
    assert clipped.point_data["U"][0, 0] == pytest.approx(4)
    assert not np.allclose(clipped.points[clipped.lines[0][-1]], clipped.points[clipped.lines[1][0]])


def test_caps_bound_geometry_and_keep_track_endpoints():
    source = tracks(np.column_stack([np.linspace(-2, 2, 1000), np.zeros(1000), np.ones(1000)]))
    source.lines *= 300
    clipped = clip_tracks(source, ([0, 0, 0], [1, 1, 2]), 0)
    assert len(clipped.lines) == 240
    assert all(len(line) == 200 for line in clipped.lines)
    assert np.allclose(clipped.points[clipped.lines[0][[0, -1]]], source.points[[0, -1]])


def test_growth_uses_travel_time_not_vertex_index():
    source = tracks([[0, 0, 1], [1, 0, 1], [2, 0, 1], [0, 1, 1], [1, 1, 1], [2, 1, 1]])
    source.lines = [np.arange(3), np.arange(3, 6)]
    source.point_data["U"][3:, 0] = 1
    buckets = growth_buckets(source)
    assert buckets[23] == [(1, 2), (3, 4)]
    assert buckets[47] == [(4, 5)]


def test_hull_is_model_coordinate_convex_and_bounded():
    assert footprint_hull([[0, 0], [1, 1], [0, 1], [1, 0], [.5, .5]]) == [[0, 0], [1, 0], [1, 1], [0, 1]]
    angles = np.linspace(0, 2*np.pi, 1000)
    assert len(footprint_hull(np.column_stack([np.cos(angles), np.sin(angles)]))) == 64


@pytest.mark.parametrize("growth_seconds", [6.0, 9.99])
def test_real_usd_growth_defaults_reset_and_metadata(tmp_path, growth_seconds):
    from pxr import Usd, UsdGeom
    source = tracks(np.column_stack([np.linspace(-5, 5, 100), np.zeros(100), np.ones(100)]))
    path = tmp_path / "growth.usdc"
    summary = write_result_layer(out_path=path, run_id="growth", pedestrian_plane=None, building_surface=None,
                                 streamlines=source, solver_rotation_alpha_rad=np.pi/2,
                                 building_bbox_solver_frame=([0, 0, 0], [100, 20, 10]),
                                 presentation_version=2, growth_seconds=growth_seconds,
                                 building_footprint_xy=[[0, 0], [100, 0], [100, 20]])
    stage = Usd.Stage.Open(str(path))
    root = summary["run_prim"]
    growth = stage.GetPrimAtPath(root + "/StreamlineGrowth")
    assert 1 <= len(growth.GetChildren()) <= 48
    for child in growth.GetChildren():
        imageable = UsdGeom.Imageable(child)
        assert imageable.ComputeVisibility(0) == "invisible"
        assert imageable.ComputeVisibility(min(239, round(growth_seconds * 24))) == "inherited"
        assert max(imageable.GetVisibilityAttr().GetTimeSamples()) <= 239
        assert imageable.ComputeVisibility(239) == "inherited"
        assert imageable.ComputeVisibility(0) == "invisible"
    assert UsdGeom.Imageable(stage.GetPrimAtPath(root + "/Streamlines")).ComputeVisibility() == "invisible"
    assert UsdGeom.Imageable(stage.GetPrimAtPath(root + "/FlowParticles")).ComputeVisibility() == "invisible"
    curves = UsdGeom.BasisCurves(stage.GetPrimAtPath(root + "/Streamlines"))
    assert list(curves.GetWidthsAttr().Get()) == pytest.approx([.5])
    assert np.allclose(np.array(curves.GetPointsAttr().Get())[0], [0, 5, 1])
    assert stage.GetEndTimeCode() == 239
    assert stage.GetRootLayer().customLayerData["cfd:animation"]["fps"] == 24
    assert summary["presentation"]["version"] == 2
    assert summary["presentation"]["sections"] == []
    assert all('/' not in p["name"] for p in summary["presentation"]["prims"])
    assert not stage.GetPrimAtPath('/World/Elements')


def test_absent_tracks_do_not_advertise_growth_prim(tmp_path):
    summary = write_result_layer(out_path=tmp_path/'empty.usdc', run_id='empty', pedestrian_plane=None,
                                 building_surface=None, streamlines=None, solver_rotation_alpha_rad=0,
                                 building_bbox_solver_frame=([0, 0, 0], [1, 1, 2]), presentation_version=2)
    assert summary['presentation']['prims'] == []
