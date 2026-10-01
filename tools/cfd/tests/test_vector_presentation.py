import math

import numpy as np
import pytest

from bimcfd.foam_vtk import VtkSurface
from bimcfd.usd_results import write_result_layer
from bimcfd.vector_presentation import sample_surface_vectors
from bimcfd.wind import rotation_to_plus_x, wind_vector_model


def plane(size=10., velocity=(2., 0., 0.)):
    points = np.array([[0,0,1.5], [size,0,1.5], [size,size,1.5], [0,size,1.5]])
    return VtkSurface(points=points, polygons=[np.array([0,1,2,3])],
                      point_data={'U': np.tile(velocity, (4,1))})


def test_grid_interpolates_linear_field_and_bounds_count():
    source = plane()
    source.point_data['U'] = np.column_stack([source.points[:,0] + 1, source.points[:,1], np.zeros(4)])
    sites, vectors, spacing = sample_surface_vectors(source)
    assert spacing == 2 and len(sites) == 25
    assert np.allclose(vectors[:,:2], sites[:,:2] + [1,0])
    assert set(np.round(sites[:,0], 9)) == {1,3,5,7,9}
    sites, _, spacing = sample_surface_vectors(plane(1000))
    assert spacing == pytest.approx(1000/60)
    assert 0 < len(sites) <= 5000


def test_holes_and_low_or_nonfinite_speed_do_not_get_arrows():
    source = plane()
    source.polygons = [np.array([0,1,2])]
    sites, _, _ = sample_surface_vectors(source)
    assert (sites[:,1] <= sites[:,0]).all()
    assert len(sample_surface_vectors(plane(velocity=(.049,0,0)))[0]) == 0
    assert len(sample_surface_vectors(plane(velocity=(np.nan,0,0)))[0]) == 0


def test_shared_sampler_supports_vertical_sections():
    source = plane()
    source.points = source.points[:,[2,0,1]]
    sites, _, spacing = sample_surface_vectors(source, axes=(1,2))
    assert len(sites) == 25 and spacing == 2
    assert np.allclose(sites[:,0], 1.5)


@pytest.mark.parametrize('reverse', [False, True])
def test_concave_polygon_keeps_notch_empty_and_interpolates_original_field(reverse):
    xy = np.array([[0,0], [10,0], [10,10], [8,10], [8,2], [2,2], [2,10], [0,10]])
    points = np.column_stack([xy, np.full(8, 1.5)])
    ids = np.arange(8)[::-1] if reverse else np.arange(8)
    velocity = np.column_stack([xy[:,0] + 1, xy[:,1], np.zeros(8)])
    sites, vectors, spacing = sample_surface_vectors(VtkSurface(
        points=points, polygons=[ids], point_data={'U': velocity}))
    expected = {(x,y) for x in (1,3,5,7,9) for y in (1,3,5,7,9)
                if x < 2 or x > 8 or y < 2}
    assert spacing == 2
    assert {(round(x),round(y)) for x,y in sites[:,:2]} == expected
    assert len(sites) == 13
    assert np.allclose(vectors[:,:2], sites[:,:2] + [1,0])


def test_degenerate_polygon_does_not_invent_surface_data():
    source = plane()
    source.points[:,1] = source.points[:,0]
    assert len(sample_surface_vectors(source)[0]) == 0


def test_real_usd_vector_colour_and_length_follow_speed_and_saturate(tmp_path):
    from pxr import Usd, UsdGeom
    source = plane()
    source.point_data['U'] = np.column_stack([source.points[:,0], np.zeros((4,2))])
    path = tmp_path / 'speeds.usdc'
    result = write_result_layer(out_path=path, run_id='speeds', pedestrian_plane=source,
                                building_surface=None, streamlines=None, solver_rotation_alpha_rad=0,
                                building_bbox_solver_frame=([0,0,0],[10,10,10]), presentation_version=2)
    stage = Usd.Stage.Open(str(path))
    inst = UsdGeom.PointInstancer(stage.GetPrimAtPath(result['run_prim']+'/PedestrianWindVectors'))
    speeds = np.array(inst.GetPositionsAttr().Get())[:,0]
    lengths = np.array(inst.GetScalesAttr().Get())[:,0]
    colours = np.array(UsdGeom.PrimvarsAPI(inst).GetPrimvar('displayColor').Get())
    assert np.allclose(lengths, 1.8 * np.minimum(speeds / 5, 1))
    assert np.allclose(colours[np.isclose(speeds, 1)], [0., .8, 1.])
    assert np.allclose(colours[np.isclose(speeds, 3)], [.4, 1., 0.])
    assert np.allclose(colours[speeds >= 5 - 1e-6], [1., 0., 0.])


@pytest.mark.parametrize('bearing', [0,90,180,270])
@pytest.mark.parametrize('north', [0,30])
def test_real_usd_vector_and_scene_arrow_direction(tmp_path, bearing, north):
    from pxr import Gf, Usd, UsdGeom
    # Expected direction is independent of the production transform helper.
    angle = math.radians(bearing - north)
    expected = np.array([-math.sin(angle), -math.cos(angle), 0.])
    alpha = rotation_to_plus_x(wind_vector_model(bearing, north))
    path = tmp_path / 'vectors.usdc'
    result = write_result_layer(out_path=path, run_id='arrows', pedestrian_plane=plane(),
                                building_surface=None, streamlines=None, solver_rotation_alpha_rad=alpha,
                                building_bbox_solver_frame=([0,0,0],[10,10,10]), presentation_version=2)
    stage = Usd.Stage.Open(str(path))
    root = result['run_prim']
    inst = UsdGeom.PointInstancer(stage.GetPrimAtPath(root+'/PedestrianWindVectors'))
    assert inst and len(inst.GetPositionsAttr().Get()) > 0
    for rotation in inst.GetOrientationsAttr().Get():
        actual = Gf.Rotation(Gf.Quatd(rotation)).TransformDir(Gf.Vec3d(1,0,0))
        assert np.allclose(actual, expected, atol=.002)
    assert np.allclose(np.array(inst.GetPositionsAttr().Get())[:,2], 1.55)
    assert np.allclose(np.array(inst.GetScalesAttr().Get())[:,0], .9 * 2 * 2 / 5)
    assert len(UsdGeom.PrimvarsAPI(inst).GetPrimvar('displayColor').Get()) == len(inst.GetPositionsAttr().Get())
    arrow = stage.GetPrimAtPath(root+'/WindDirectionArrow')
    assert np.allclose(arrow.GetCustomDataByKey('cfd:flow_direction_model'), expected)
    assert np.array(UsdGeom.Mesh(arrow).GetPointsAttr().Get())[:,2].min() > 10
    for name in ('WindDirectionArrow','PedestrianWindVectors'):
        assert UsdGeom.Imageable(stage.GetPrimAtPath(root+'/'+name)).ComputeVisibility() == 'inherited'
        assert any(p['name']==name and p['default_visible'] for p in result['presentation']['prims'])
    assert 'PedestrianWindVectors' in result['legend']['U']['prims']


def test_legacy_writer_does_not_add_presentation_arrows(tmp_path):
    result = write_result_layer(out_path=tmp_path/'legacy.usdc', run_id='legacy', pedestrian_plane=plane(),
                               building_surface=None, streamlines=None, solver_rotation_alpha_rad=0)
    assert 'PedestrianWindVectors' not in result['prims']
    assert 'WindDirectionArrow' not in result['prims']
