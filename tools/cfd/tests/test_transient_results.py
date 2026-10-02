import copy
from pathlib import Path

import numpy as np
import pytest
from pxr import Usd, UsdGeom

from bimcfd.foam_vtk import VtkSurface
from bimcfd.transient_results import validate_series, write_transient_layer


def test_transient_tracks_share_surface_clock_without_invented_growth(tmp_path):
    rows, times = samples(), [.5, 1., 1.5]
    tracks = [VtkSurface(np.array([[-20., i, 1.], [0., i, 1.], [20., i, 1.]]),
                        lines=[np.arange(3)], point_data={"U":np.tile([i+1., 0., 0.], (3, 1))}) for i in range(3)]
    result = write_transient_layer(out_path=tmp_path/"tracks.usdc",run_id="cfd_tracks_test",times=times,samples=rows,
        rotation_alpha_rad=np.pi/2,interval_s=.5,footprint=[[0,0],[4,0],[0,4]],ground_z=0,building_height=4,
        near_wall={"distance_m":1.,"surface_cell_m":.5,"reference":"computation_shell","interpolation":"cellPoint"},
        provenance={}, streamlines=tracks)
    stage = Usd.Stage.Open(str(tmp_path/"tracks.usdc"))
    root = "/World/Overlays/Cfd/cfd_tracks_test_w000"
    assert any(p["role"] == "streamlines" for p in result["presentation"]["prims"])
    assert "Streamlines" in result["legend"]["U"]["prims"]
    for code, expected in [(0,0),(11.9,0),(12,1),(23.9,1),(24,2),(36,2)]:
        for name in ("Streamlines", "BuildingSurfacePressure", "PedestrianWindVectors"):
            visible = [p for p in stage.GetPrimAtPath(root+"/"+name).GetChildren()
                       if UsdGeom.Imageable(p).ComputeVisibility(Usd.TimeCode(code)) != "invisible"]
            assert len(visible) == 1
            assert visible[0].GetCustomDataByKey("cfd:physical_time_s") == times[expected]
            if name == "Streamlines":
                curves = UsdGeom.BasisCurves(visible[0])
                points = np.asarray(curves.GetPointsAttr().Get())
                assert np.max(np.abs(points[:,0])) <= 8 and np.max(np.abs(points[:,1])) <= 8
                assert np.asarray(UsdGeom.PrimvarsAPI(visible[0]).GetPrimvar("U").ComputeFlattened())[0] == pytest.approx([0,-expected-1,0])
                assert not curves.GetPointsAttr().GetTimeSamples()  # whole snapshot, no fabricated vertex interpolation
    assert not stage.GetPrimAtPath(root+"/StreamlineGrowth")
    assert not stage.GetPrimAtPath(root+"/FlowParticles")
    assert tracks[0].points[0,0] == -20.  # caller's original tracks remain unchanged


@pytest.mark.parametrize("bad", ["count", "velocity", "index", "empty"])
def test_invalid_transient_tracks_never_create_an_artifact(tmp_path, bad):
    tracks = [VtkSurface(np.array([[0.,0.,1.],[1.,0.,1.]]), lines=[np.arange(2)],
                        point_data={"U":np.ones((2,3))}) for _ in range(3)]
    if bad == "count": tracks.pop()
    if bad == "velocity": tracks[1].point_data["U"][0,0] = np.nan
    if bad == "index": tracks[1].lines[0][1] = 2
    if bad == "empty": tracks[1].lines = []
    with pytest.raises(ValueError,match="streamline"):
        write_transient_layer(out_path=tmp_path/"bad.usdc",run_id="cfd_tracks_test",times=[.5,1,1.5],samples=samples(),
            rotation_alpha_rad=0,interval_s=.5,footprint=[[0,0],[4,0],[0,4]],ground_z=0,building_height=4,
            near_wall={"distance_m":1.,"surface_cell_m":.5,"reference":"computation_shell","interpolation":"cellPoint"},
            provenance={},streamlines=tracks)
    assert not (tmp_path/"bad.usdc").exists()


def samples():
    points = np.array([[0.,0.,0.],[4.,0.,0.],[0.,4.,0.]])
    return [{"pedestrian_1p5m":VtkSurface(points, [np.array([0,1,2])], point_data={"U":np.tile([i+1.,0.,0.],(3,1))}),
             "near_wall_speed":VtkSurface(points.copy(), [np.array([0,1,2])], point_data={"U":np.tile([0.,i+1.,0.],(3,1))}),
             "building":VtkSurface(points.copy(), [np.array([0,1,2])], cell_data={"p":np.array([i*2.])})}
            for i in range(3)]


@pytest.mark.parametrize("corruption", ["geometry","topology","missing","nan","time"])
def test_refuse_inconsistent_or_incomplete_paired_data(corruption):
    rows, times = samples(), [.5,1.,1.5]
    if corruption == "geometry": rows[1]["building"].points[0,0] += .1
    if corruption == "topology": rows[1]["building"].polygons[0] = np.array([0,2,1])
    if corruption == "missing": rows[1]["building"].cell_data.clear()
    if corruption == "nan": rows[1]["near_wall_speed"].point_data["U"][0,0] = np.nan
    if corruption == "time": times[1] = times[0]
    with pytest.raises(ValueError): validate_series(times,rows)


def test_transient_reference_uses_actual_shared_plane_not_legacy_prim_name(tmp_path):
    rows = samples()
    for row in rows:
        row['pedestrian_1p5m'].points[:, 2] = 2.5
    result = write_transient_layer(out_path=tmp_path/'ground.usdc',run_id='cfd_ground_test',
        times=[.5,1.,1.5],samples=rows,rotation_alpha_rad=0,interval_s=.5,
        footprint=[[0,0],[4,0],[0,4]],ground_z=1,building_height=4,
        near_wall={'distance_m':1.,'surface_cell_m':.5,'reference':'computation_shell','interpolation':'cellPoint'}, provenance={})
    reference = result['presentation']['ground_reference']
    assert reference['ground_z_m'] == 1
    assert reference['sampling_plane_z_m'] == 2.5
    assert reference['height_above_calculation_ground_m'] == 1.5
    assert reference['vector_display_lift_m'] == .05
    assert reference['actual_ground_verified'] is False


def test_zero_velocity_series_keeps_empty_vectors_without_claiming_display_lift(tmp_path):
    rows = samples()
    for row in rows:
        row['pedestrian_1p5m'].point_data['U'][:] = 0
    out = tmp_path/'zero.usdc'
    result = write_transient_layer(out_path=out,run_id='cfd_zero_test',
        times=[.5,1.,1.5],samples=rows,rotation_alpha_rad=0,interval_s=.5,
        footprint=[[0,0],[4,0],[0,4]],ground_z=0,building_height=4,
        near_wall={'distance_m':1.,'surface_cell_m':.5,'reference':'computation_shell','interpolation':'cellPoint'}, provenance={})
    assert result['presentation']['ground_reference']['vector_display_lift_m'] is None
    stage = Usd.Stage.Open(str(out))
    parent = '/World/Overlays/Cfd/cfd_zero_test_w000/PedestrianWindVectors'
    for index in range(3):
        vectors = UsdGeom.PointInstancer(stage.GetPrimAtPath(f'{parent}/Frame_{index:03d}'))
        assert vectors
        assert len(vectors.GetPositionsAttr().Get()) == 0


def test_actual_usd_hold_has_one_common_physical_sample_and_shared_fixed_geometry(tmp_path):
    rows, times = samples(), [.5,1.,1.5]
    original = copy.deepcopy(rows)
    out = tmp_path/"paired.usdc"
    result = write_transient_layer(out_path=out,run_id="cfd_temporal_test",times=times,samples=rows,
        rotation_alpha_rad=np.pi/2,interval_s=.5,footprint=[[0,0],[4,0],[0,4]],ground_z=0,building_height=4,
        near_wall={"distance_m":1.,"surface_cell_m":.5,"reference":"computation_shell","interpolation":"cellPoint"},
        provenance={"source_run_id":"cfd_source_test","manifest_sha256":"a"*64,"requested_duration_s":10.,"complete_requested_duration":False})
    assert result["presentation"]["temporal"]["sample_times_s"] == times
    assert result["legend"]["p"]["min"] == 0. and result["legend"]["p"]["max"] == 4.
    stage = Usd.Stage.Open(str(out))
    root = "/World/Overlays/Cfd/cfd_temporal_test_w000"
    for code, expected in [(0,0),(6,0),(12,1),(18,1),(24,2),(36,2)]:
        for name,quantity in [("PedestrianWind_1p5m","U"),("NearWallWindSpeed","U"),("BuildingSurfacePressure","p")]:
            visible = [child for child in stage.GetPrimAtPath(root+"/"+name).GetChildren()
                       if UsdGeom.Imageable(child).ComputeVisibility(Usd.TimeCode(code)) != "invisible"]
            assert len(visible) == 1
            prim = visible[0]
            assert prim.GetCustomDataByKey("cfd:physical_time_s") == times[expected]
            values = np.asarray(UsdGeom.PrimvarsAPI(prim).GetPrimvar(quantity).ComputeFlattened(Usd.TimeCode(code)))
            assert values[0] == pytest.approx(expected*2 if quantity == "p" else ([0.,-expected-1.,0.] if name.startswith("Pedestrian") else [expected+1.,0.,0.]))
            assert len(UsdGeom.Mesh(prim).GetPointsAttr().Get()) == 3
    assert stage.GetInterpolationType() == Usd.InterpolationTypeLinear  # no global interpolation side effect
    assert not stage.GetPrimAtPath(root+"/Streamlines")  # no steady-flow animation mislabeled transient
    for a,b in zip(rows,original):
        for key in a: assert np.array_equal(a[key].points,b[key].points)
    with pytest.raises(ValueError,match="new artifact"):
        write_transient_layer(out_path=out,run_id="cfd_temporal_test",times=times,samples=rows,
            rotation_alpha_rad=0,interval_s=.5,footprint=[[0,0],[4,0],[0,4]],ground_z=0,building_height=4,
            near_wall={"distance_m":1.,"surface_cell_m":.5,"reference":"computation_shell","interpolation":"cellPoint"},provenance={})
