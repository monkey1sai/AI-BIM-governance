"""Source-bound vertical offsets, not an assertion of walkability or fluid."""
import hashlib
import json
from dataclasses import replace

import pytest
from pxr import Gf, Usd, UsdGeom

from bimcfd.ground_surfaces import GroundFaceSelection, read_ground_selection
from bimcfd.ground_sampling import sample_ground_points
from bimcfd.ground_sampling import ground_sample_grid
from bimcfd.cli import main


GUID = "0000000000000000000000"
MESH = "/World/Elements/IfcSlab/G_" + GUID + "/Mesh"


def source(tmp_path, triangles, units=1, offset=None, rotate=None):
    path = tmp_path / "model.usdc"
    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, "Z")
    UsdGeom.SetStageMetersPerUnit(stage, units)
    element = UsdGeom.Xform.Define(stage, MESH.rsplit("/", 1)[0])
    if offset:
        element.AddTranslateOp().Set(Gf.Vec3d(*offset))
    if rotate is not None:
        element.AddRotateZOp().Set(rotate)
    element.GetPrim().SetCustomDataByKey("bim", {"ifc_guid": GUID, "ifc_type": "IfcSlab"})
    mesh = UsdGeom.Mesh.Define(stage, MESH)
    mesh.CreatePointsAttr([p for tri in triangles for p in tri])
    mesh.CreateFaceVertexCountsAttr([3] * len(triangles))
    mesh.CreateFaceVertexIndicesAttr(list(range(3 * len(triangles))))
    stage.GetRootLayer().Save()
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    selections = [GroundFaceSelection(GUID, MESH, i) for i in range(len(triangles))]
    faces, _ = read_ground_selection(path, sha, selections)
    return path, sha, faces


def test_flat_uses_source_height_and_keeps_display_lift_out(tmp_path):
    _, sha, faces = source(tmp_path, [[(0, 0, 0.63), (2, 0, 0.63), (0, 2, 0.63)]])
    result = sample_ground_points(faces, sha, [(0.5, 0.5)])
    point = result["points"][0]
    assert point["target_m"] == pytest.approx([0.5, 0.5, 2.13])
    assert point["face_id"] == faces[0].face_id
    assert result["height_above_surface_m"] == 1.5
    assert result["display_lift_m"] == 0
    assert result["generated_count"] == 1
    assert result["actual_ground_verified"] is False
    assert result["fluid_region_verified"] is False
    assert result["velocity_sampled"] is False
    assert all("velocity" not in point and "U" not in point and "p" not in point for point in result["points"])


def test_slope_offset_is_vertical_not_surface_normal(tmp_path):
    _, sha, faces = source(tmp_path, [[(0, 0, 0), (2, 0, 2), (0, 2, 0)]])
    result = sample_ground_points(faces, sha, [(0.5, 0.5)])
    assert result["points"][0]["ground_z_m"] == pytest.approx(0.5)
    assert result["points"][0]["target_m"] == pytest.approx([0.5, 0.5, 2])


def test_parent_transform_and_centimetres_applied_only_once(tmp_path):
    _, sha, faces = source(tmp_path, [[(0, 0, 63), (200, 0, 63), (0, 200, 63)]],
                           units=0.01, offset=(100, 200, 30))
    result = sample_ground_points(faces, sha, [(1.5, 2.5)])
    assert result["points"][0]["target_m"] == pytest.approx([1.5, 2.5, 2.43])


def test_single_boundary_and_outside_never_clamped(tmp_path):
    _, sha, faces = source(tmp_path, [[(0, 0, 0), (2, 0, 0), (0, 2, 0)]])
    result = sample_ground_points(faces, sha, [(0, 0), (1, 1), (1, 1 + 1e-8)])
    assert [p["status"] for p in result["points"]] == ["precision_unsupported", "precision_unsupported", "uncovered"]


@pytest.mark.parametrize("offset,angle", [((37.11, 16.3, 0), 1), ((1e9, 1e9, 0), 23)])
def test_transformed_shared_edge_does_not_choose_one_face(tmp_path, offset, angle):
    _, sha, faces = source(tmp_path, [
        [(0, 0, 0), (2, 0, 0), (0, 2, 0)],
        [(2, 0, 0), (2, 2, 0), (0, 2, 0)],
    ], offset=offset, rotate=angle)
    a, b = faces[0].vertices_m[1:]
    midpoint = [(a[i] + b[i]) / 2 for i in range(2)]
    result = sample_ground_points(faces, sha, [midpoint])
    assert result["points"][0]["status"] == "ambiguous"
    assert "target_m" not in result["points"][0]


def test_multielevation_negative_and_gap_never_form_global_plane(tmp_path):
    _, sha, faces = source(tmp_path, [
        [(0, 0, -3), (2, 0, -3), (0, 2, -3)],
        [(4, 0, 0.93), (6, 0, 0.93), (4, 2, 0.93)],
    ])
    result = sample_ground_points(faces, sha, [(0.5, 0.5), (4.5, 0.5), (3, 0.5)])
    assert [p["status"] for p in result["points"]] == ["point_generated", "point_generated", "uncovered"]
    assert result["points"][0]["target_m"][2] == -1.5
    assert result["points"][1]["target_m"][2] == pytest.approx(2.43)
    assert "target_m" not in result["points"][2]
    assert result["rejected_by_reason"] == {"uncovered": 1}


@pytest.mark.parametrize("top", [0, 2])
def test_overlapping_xy_is_ambiguous_even_at_same_height(tmp_path, top):
    _, sha, faces = source(tmp_path, [
        [(0, 0, 0), (2, 0, 0), (0, 2, 0)],
        [(0, 0, top), (2, 0, top), (0, 2, top)],
    ])
    result = sample_ground_points(faces, sha, [(0.5, 0.5)])
    assert result["generated_count"] == 0
    assert result["points"][0]["status"] == "ambiguous"
    assert result["points"][0]["candidate_count"] == 2
    assert "target_m" not in result["points"][0]


def test_shared_boundary_is_conservatively_ambiguous(tmp_path):
    _, sha, faces = source(tmp_path, [
        [(0, 0, 0), (2, 0, 0), (0, 2, 0)],
        [(2, 0, 0), (2, 2, 0), (0, 2, 0)],
    ])
    result = sample_ground_points(faces, sha, [(1, 1), (0.5, 0.5)])
    assert [p["status"] for p in result["points"]] == ["ambiguous", "point_generated"]


def test_stale_model_geometry_and_duplicate_face_reject_atomically(tmp_path):
    _, sha, faces = source(tmp_path, [[(0, 0, 0), (2, 0, 0), (0, 2, 0)]])
    with pytest.raises(ValueError, match="source_sha_mismatch"):
        sample_ground_points(faces, "0" * 64, [(0.5, 0.5)])
    with pytest.raises(ValueError, match="face_identity_mismatch"):
        sample_ground_points([replace(faces[0], vertices_m=((0, 0, 4), (2, 0, 4), (0, 2, 4)))], sha, [(0.5, 0.5)])
    with pytest.raises(ValueError, match="duplicate_face"):
        sample_ground_points(faces * 2, sha, [(0.5, 0.5)])


@pytest.mark.parametrize("queries", [[], [(float("nan"), 0)], [(float("inf"), 0)], [(True, 0)], [(10**1000, 0)], [(1, 2, 3)], [(0, 0)] * 10001])
def test_invalid_or_unbounded_queries_refused_before_output(tmp_path, queries):
    _, sha, faces = source(tmp_path, [[(0, 0, 0), (2, 0, 0), (0, 2, 0)]])
    with pytest.raises(ValueError, match="invalid_queries|point_budget_exceeded"):
        sample_ground_points(faces, sha, queries)


def test_projection_with_unreliable_conditioning_is_refused(tmp_path):
    _, sha, faces = source(tmp_path, [[(0, 0, 0), (2, 0, 0), (0, 0.0000000000015, 0.5)]])
    with pytest.raises(ValueError, match="unsupported_xy_projection"):
        sample_ground_points(faces, sha, [(0.5, 0)])


@pytest.mark.parametrize("bounds,spacing", [
    ([0, 0, 10, 10], 0), ([0, 0, 10, 10], -1), ([1, 0, 0, 1], 1),
    ([0, 0, float("inf"), 1], 1), ([0, 0, 1e300, 1e300], 1e-300),
    ([0, 0, 100, 100], 1), ([True, 0, 1, 1], 1),
])
def test_grid_validation_precedes_allocation(bounds, spacing):
    with pytest.raises(ValueError, match="invalid_grid|point_budget_exceeded"):
        ground_sample_grid(bounds, spacing)


def test_grid_integer_steps_endpoints_and_precision():
    assert ground_sample_grid([0, 0, 1, 0], 0.3) == [(0, 0), (0.3, 0), (0.6, 0), (0.8999999999999999, 0)]
    with pytest.raises(ValueError, match="grid_precision_unsupported"):
        ground_sample_grid([1e16, 0, 1e16 + 2, 0], 0.25)
    with pytest.raises(ValueError, match="grid_precision_unsupported"):
        ground_sample_grid([1e16, 0, 1e16 + 4, 0], 1.1)


def cli_args(tmp_path, path, sha, faces, *, bounds=(0.5, 0.5, 0.5, 0.5)):
    selection = tmp_path / "selection.json"
    selection.write_text(json.dumps({"model_usdc_sha256": sha, "faces": [
        {key: getattr(face, key) for key in ("ifc_guid", "mesh_prim_path", "polygon_face_index", "face_id", "geometry_sha256")}
        for face in faces]}))
    return ["ground-sample-points", "--model-usdc", str(path), "--model-sha256", sha,
            "--selection", str(selection), "--bounds", *map(str, bounds), "--spacing", "0.5",
            "--out", str(tmp_path / "plan.json")]


def test_cli_fresh_source_identity_and_no_solver_or_overwrite(tmp_path, monkeypatch):
    import subprocess
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: pytest.fail("solver/process started"))
    path, sha, faces = source(tmp_path, [[(0, 0, 0.63), (2, 0, 0.63), (0, 2, 0.63)]])
    args = cli_args(tmp_path, path, sha, faces)
    originals = {p: p.read_bytes() for p in (path, tmp_path / "selection.json")}
    assert main(args) == 0
    output = tmp_path / "plan.json"
    result = json.loads(output.read_bytes())
    assert result["selection_authority"] == "local_identity_list"
    assert result["points"][0]["target_m"][2] == pytest.approx(2.13)
    originals[output] = output.read_bytes()
    assert main(args) == 4
    for p, body in originals.items():
        assert p.read_bytes() == body


def test_cli_partial_grid_writes_rejections_but_not_success_exit(tmp_path):
    path, sha, faces = source(tmp_path, [[(0, 0, 0), (2, 0, 0), (0, 2, 0)]])
    args = cli_args(tmp_path, path, sha, faces, bounds=(0, 0, 2, 2))
    assert main(args) == 2
    result = json.loads((tmp_path / "plan.json").read_bytes())
    assert result["query_count"] == 25
    assert result["rejected_by_reason"]["uncovered"] > 0


def test_real_module_cli_entrypoint_and_deterministic_output(tmp_path):
    import subprocess
    import sys
    from pathlib import Path
    path, sha, faces = source(tmp_path, [[(0, 0, 0.63), (2, 0, 0.63), (0, 2, 0.63)]])
    args = cli_args(tmp_path, path, sha, faces)
    assert main(args) == 0
    expected = (tmp_path / "plan.json").read_bytes()
    args[-1] = str(tmp_path / "second.json")
    run = subprocess.run([sys.executable, "-m", "bimcfd", *args],
                         cwd=Path(__file__).resolve().parents[1], capture_output=True, timeout=20)
    assert run.returncode == 0, run.stderr.decode()
    assert (tmp_path / "second.json").read_bytes() == expected


@pytest.mark.parametrize("mutate", ["face", "geometry", "model", "duplicate_key", "oversize", "invalid_usd", "json_depth"])
def test_cli_stale_or_invalid_selection_never_creates_output(tmp_path, mutate):
    path, sha, faces = source(tmp_path, [[(0, 0, 0), (2, 0, 0), (0, 2, 0)]])
    args = cli_args(tmp_path, path, sha, faces)
    selection = tmp_path / "selection.json"
    body = json.loads(selection.read_text())
    if mutate in ("face", "geometry"):
        body["faces"][0]["face_id" if mutate == "face" else "geometry_sha256"] = "0" * 64
        selection.write_text(json.dumps(body))
    elif mutate == "model":
        body["model_usdc_sha256"] = "0" * 64
        selection.write_text(json.dumps(body))
    elif mutate == "duplicate_key":
        selection.write_text('{"faces":[],"faces":[]}')
    elif mutate == "invalid_usd":
        path.write_bytes(b"not a USD file")
        new_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        args[args.index("--model-sha256") + 1] = new_sha
        body["model_usdc_sha256"] = new_sha
        selection.write_text(json.dumps(body))
    elif mutate == "json_depth":
        selection.write_text("[" * 2000 + "]" * 2000)
    else:
        selection.write_bytes(b" " * (512 * 1024 + 1))
    assert main(args) == 4
    assert not (tmp_path / "plan.json").exists()
