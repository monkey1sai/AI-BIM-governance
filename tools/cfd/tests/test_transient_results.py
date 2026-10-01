import copy
from pathlib import Path

import numpy as np
import pytest
from pxr import Usd, UsdGeom

from bimcfd.foam_vtk import VtkSurface
from bimcfd.transient_results import validate_series, write_transient_layer


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
