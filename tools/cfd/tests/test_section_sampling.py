"""CP8 coordinate, sampling completeness and authored visibility regression guards."""
import json
import math
import re

import numpy as np
import pytest
from pxr import Usd, UsdGeom

from bimcfd.case_run import postprocess_case
from bimcfd.foam_vtk import VtkSurface
from bimcfd.openfoam_case import CaseParams, build_case
from bimcfd.section_sampling import footprint_centroid, validate_requested_sections
from bimcfd.stl import write_binary_stl
from bimcfd.usd_results import write_result_layer
from bimcfd.wind import rotate_z
from test_foam_parsers import LEGACY_POLY
from test_voxel_shell import box_triangles


@pytest.mark.parametrize("direction", [0, 90, 180, 270])
def test_sections_are_model_axes_after_wind_rotation_and_preserve_physics(tmp_path, direction):
    triangles = box_triangles((-20, 30, 12), (20, 60, 32))
    vertices = triangles.reshape(-1, 3)
    shell = tmp_path / "shell.stl"
    write_binary_stl(shell, vertices, np.arange(len(vertices)).reshape(-1, 3))
    base, custom = tmp_path / "base", tmp_path / "custom"
    params = dict(wind_from_degrees=direction, true_north_degrees=23, ground_z_m=10, presentation_version=2)
    baseline = build_case(shell_stl=shell, out_dir=base, params=CaseParams(**params))
    result = build_case(shell_stl=shell, out_dir=custom, params=CaseParams(**params,
        requested_sections=[{"axis": "x", "position_m": -7}, {"axis": "z", "position_m": 19}]))
    assert [s["position_m"] for s in result["sections"][:5]] == pytest.approx([15.5, 21, 26.5, 0, 45])
    assert result["domain"] == baseline["domain"]
    for path in base.rglob("*"):
        if path.is_file() and path.relative_to(base).as_posix() not in {"case_meta.json", "system/controlDict"}:
            assert path.read_bytes() == (custom / path.relative_to(base)).read_bytes()
    control = (custom / "system/controlDict").read_text()
    for section in result["sections"]:
        block = control.split("section_" + section["id"] + "\n", 1)[1].split("interpolate", 1)[0]
        vectors = [list(map(float, re.search(rf"{key}\s+\(([^)]+)\)", block).group(1).split())) for key in ("point", "normal")]
        point, normal = rotate_z(np.array(vectors), -result["wind"]["solver_rotation_alpha_rad"])
        i = "xyz".index(section["axis"])
        assert point[i] == pytest.approx(section["position_m"], abs=1e-9)
        assert normal == pytest.approx(np.eye(3)[i], abs=1e-9)


@pytest.mark.parametrize("value", [[{"axis": "z", "position_m": True}], [{"axis": "xy", "position_m": 0}],
    [{"axis": "x", "position_m": math.nan}], [{"axis": "x", "position_m": "1"}],
    [{"axis": "x", "position_m": 1, "normal": [1, 0, 0]}], [{"axis": "z", "position_m": 1}] * 9])
def test_custom_planes_are_bounded_and_closed(value):
    with pytest.raises(ValueError):
        validate_requested_sections(value)


def test_footprint_uses_area_centroid_not_vertex_average():
    assert footprint_centroid([[0, 0], [6, 0], [0, 3]]) == pytest.approx((2, 1))


def test_declared_section_missing_at_final_sampling_time_fails(tmp_path):
    samples = tmp_path / "case/postProcessing/samples/267"
    samples.mkdir(parents=True)
    (samples / "pedestrian_1p5m.vtk").write_text(LEGACY_POLY)
    (tmp_path / "case/case_meta.json").write_text(json.dumps({"sections": [{"id": "z25"}]}))
    with pytest.raises(FileNotFoundError, match="section z25"):
        postprocess_case(tmp_path / "case", tmp_path / "model.usdc", "run", tmp_path / "out")


def test_vertical_section_uses_real_rotated_velocity_and_explicit_hidden_opinions(tmp_path):
    alpha = .7
    points = np.array([[3, 0, 0], [3, 8, 0], [3, 8, 8], [3, 0, 8]], dtype=float)
    velocity = np.array([[0, 3, 1]] * 4, dtype=float)
    surface = VtkSurface(points=rotate_z(points, alpha), polygons=[np.array([0, 1, 2, 3])],
                         point_data={"U": rotate_z(velocity, alpha)})
    path = tmp_path / "section.usdc"
    descriptor = {"id": "x_centroid", "axis": "x", "position_m": 3, "label": "X centroid", "source": "standard"}
    result = write_result_layer(out_path=path, run_id="sections", pedestrian_plane=None, building_surface=None, streamlines=None,
        solver_rotation_alpha_rad=alpha, presentation_version=2, building_bbox_solver_frame=([-10, -10, 0], [10, 10, 10]),
        section_surfaces=[(descriptor, surface)])
    stage = Usd.Stage.Open(str(path))
    mesh = UsdGeom.Mesh(stage.GetPrimAtPath(result["prims"]["Section_x_centroid"]["path"]))
    assert np.asarray(mesh.GetPointsAttr().Get()) == pytest.approx(points, abs=1e-5)
    assert np.asarray(UsdGeom.PrimvarsAPI(mesh).GetPrimvar("U").Get()) == pytest.approx(velocity, abs=1e-5)
    arrow = UsdGeom.PointInstancer(stage.GetPrimAtPath(result["prims"]["Section_x_centroid_Vectors"]["path"]))
    assert np.asarray(arrow.GetPositionsAttr().Get())[:, 0] == pytest.approx(3.05)
    for name in ["Section_x_centroid", "Section_x_centroid_Vectors"]:
        prim = stage.GetPrimAtPath(result["prims"][name]["path"])
        assert prim.GetParent().GetPath() == mesh.GetPrim().GetParent().GetPath()
        assert UsdGeom.Imageable(prim).GetVisibilityAttr().Get() == "invisible"
    assert result["presentation"]["sections"] == [{**descriptor, "polygons": 1}]


def test_zero_velocity_keeps_a_declared_empty_vector_layer_instead_of_inventing_arrows(tmp_path):
    points = np.array([[0, 0, 2], [8, 0, 2], [8, 8, 2], [0, 8, 2]], dtype=float)
    surface = VtkSurface(points=points, polygons=[np.array([0, 1, 2, 3])], point_data={"U": np.zeros_like(points)})
    descriptor = {"id": "custom_1", "axis": "z", "position_m": 2, "label": "Z 2m", "source": "requested"}
    path = tmp_path / "zero.usdc"
    result = write_result_layer(out_path=path, run_id="zero", pedestrian_plane=None, building_surface=None, streamlines=None,
        solver_rotation_alpha_rad=0, presentation_version=2, building_bbox_solver_frame=([-10, -10, 0], [10, 10, 10]),
        section_surfaces=[(descriptor, surface)])
    assert result["prims"]["Section_custom_1_Vectors"]["arrows"] == 0
    stage = Usd.Stage.Open(str(path))
    arrow = UsdGeom.PointInstancer(stage.GetPrimAtPath(result["prims"]["Section_custom_1_Vectors"]["path"]))
    assert len(arrow.GetPositionsAttr().Get()) == 0
    assert any(p["name"] == "Section_custom_1_Vectors" for p in result["presentation"]["prims"])
