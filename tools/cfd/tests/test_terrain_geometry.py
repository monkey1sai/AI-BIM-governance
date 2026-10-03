"""Separate authored terrain candidates: geometry fidelity, refusals, no solving."""
from dataclasses import asdict, replace
import hashlib
import json
import struct
import subprocess

import pytest
from pxr import Gf, Usd, UsdGeom

from bimcfd import terrain_geometry as terrain
from bimcfd.ground_surfaces import GroundFaceSelection, GroundSurfaceFace, _face_identity, read_ground_selection

GUID = "0000000000000000000000"
MESH = "/World/Elements/IfcSite/G_" + GUID + "/Mesh"
FLAT = [((0, 0, 0), (2, 0, 0), (0, 2, 0)),
        ((2, 0, 0), (2, 2, 0), (0, 2, 0))]


def source(tmp_path, triangles=FLAT, units=1, offset=None, angle=None, mirror=False):
    path = tmp_path / "model.usdc"
    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, "Z")
    UsdGeom.SetStageMetersPerUnit(stage, units)
    element = UsdGeom.Xform.Define(stage, MESH.rsplit("/", 1)[0])
    element.GetPrim().SetCustomDataByKey("bim", {"ifc_guid": GUID, "ifc_type": "IfcSite"})
    if offset:
        element.AddTranslateOp().Set(Gf.Vec3d(*offset))
    if angle is not None:
        element.AddRotateZOp().Set(angle)
    if mirror:
        element.AddScaleOp().Set(Gf.Vec3f(-1, 1, 1))
    mesh = UsdGeom.Mesh.Define(stage, MESH)
    mesh.CreatePointsAttr([p for t in triangles for p in t])
    mesh.CreateFaceVertexCountsAttr([3] * len(triangles))
    mesh.CreateFaceVertexIndicesAttr(list(range(3 * len(triangles))))
    stage.GetRootLayer().Save()
    del stage
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    faces, _ = read_ground_selection(path, sha, [GroundFaceSelection(GUID, MESH, i) for i in range(len(triangles))])
    return path, sha, faces


def identity_list(path, sha, faces):
    selected = {"model_usdc_sha256": sha, "faces": [
        {key: asdict(face)[key] for key in ("ifc_guid", "mesh_prim_path", "polygon_face_index", "face_id", "geometry_sha256")}
        for face in faces]}
    path.write_text(json.dumps(selected), encoding="utf-8")
    return path


def invoke(path, sha, selected, out):
    return terrain.main(["--model-usdc", str(path), "--model-sha256", sha,
                         "--selection", str(selected), "--out", str(out)])


def raw_face(vertices, index=0, sha="1" * 64):
    normal, area = terrain._normal(vertices)
    normal = normal if normal[2] > 0 else tuple(-v for v in normal)
    geometry_sha, face_id = _face_identity(sha, GroundFaceSelection(GUID, MESH, index), vertices, normal)
    return GroundSurfaceFace(sha, GUID, "IfcSite", MESH, index, (0, 1, 2),
                             vertices, normal, area, geometry_sha, face_id, "none")


def test_flat_keeps_exact_triangles_provenance_and_separate_held_authority(tmp_path):
    _, sha, faces = source(tmp_path)
    before = [asdict(face) for face in faces]
    stl, report = terrain.prepare_terrain_geometry(faces, sha)
    assert [asdict(face) for face in faces] == before
    assert len(stl) == 84 + 50 * 2
    assert struct.unpack_from("<I", stl, 80)[0] == 2
    assert report["terrain_stl"]["sha256"] == hashlib.sha256(stl).hexdigest()
    assert report["quality"]["connected_components"] == 1
    assert report["quality"]["open_boundary_edges"] == 4
    assert report["quality"]["topology_state"] == "single_open_patch"
    assert report["quality"]["boundary_loops"][0]["signed_xy_area_m2"] == 4
    assert report["authority"] == "in_memory_source_face_identity"
    assert report["status"] == "HELD"
    assert all(report[key] is False for key in ("actual_ground_verified", "coverage_verified", "fluid_region_verified", "solver_started"))
    assert all(face["ifc_type"] == "IfcSite" for face in report["source_faces"])
    for index, face_id in enumerate(report["triangle_to_face_id"]):
        record = struct.unpack_from("<12fH", stl, 84 + index * 50)
        original = next(face for face in faces if face.face_id == face_id)
        assert record[3:12] == tuple(v for p in original.vertices_m for v in p)
    # Input order never changes artifact identity.
    assert terrain.prepare_terrain_geometry(list(reversed(faces)), sha) == (stl, report)


@pytest.mark.parametrize("mirror", [False, True])
def test_units_transform_mirror_applied_once_and_winding_recorded(tmp_path, mirror):
    _, sha, faces = source(tmp_path, units=.01, offset=(100, 200, 30), angle=90, mirror=mirror)
    stl, report = terrain.prepare_terrain_geometry(faces, sha)
    assert all(report["export_winding_reversed"]) is mirror
    assert report["terrain_stl"]["max_coordinate_error_m"] <= terrain.MAX_STL_ERROR_M
    for i, face in enumerate(sorted(faces, key=lambda face: face.face_id)):
        record = struct.unpack_from("<12fH", stl, 84 + 50 * i)
        assert record[2] > 0
        assert set(tuple(record[j:j+3]) for j in (3, 6, 9)) == {
            tuple(struct.unpack("<f", struct.pack("<f", value))[0] for value in vertex)
            for vertex in face.vertices_m}
        assert record[5] == pytest.approx(.3)


def test_slope_and_disconnected_different_elevations_are_not_flattened(tmp_path):
    triangles = [((0, 0, -3), (2, 0, -1), (0, 2, -3)),
                 ((4, 0, .75), (6, 0, .75), (4, 2, .75))]
    _, sha, faces = source(tmp_path, triangles)
    _, report = terrain.prepare_terrain_geometry(faces, sha)
    assert report["quality"]["connected_components"] == 2
    assert report["quality"]["topology_state"] == "incomplete"
    assert "terrain_disconnected_patches" in report["reasons"]
    assert set(p[2] for f in report["source_faces"] for p in f["vertices_m"]) == {-3, -1, .75}


def test_ring_hole_reported_without_filling_or_extrapolation(tmp_path):
    outer = [(0, 0, 0), (4, 0, 0), (4, 4, 0), (0, 4, 0)]
    inner = [(1, 1, 0), (3, 1, 0), (3, 3, 0), (1, 3, 0)]
    triangles = []
    for i in range(4):
        j = (i + 1) % 4
        triangles += [(outer[i], outer[j], inner[j]), (outer[i], inner[j], inner[i])]
    _, sha, faces = source(tmp_path, triangles)
    stl, report = terrain.prepare_terrain_geometry(faces, sha)
    assert len(stl) == 84 + 8 * 50
    assert report["quality"]["connected_components"] == 1
    assert report["quality"]["interior_holes"] == 1
    assert sorted(loop["signed_xy_area_m2"] for loop in report["quality"]["boundary_loops"]) == [-4, 16]
    assert report["quality"]["topology_state"] == "incomplete"


@pytest.mark.parametrize("height", [0, 2])
def test_xy_overlap_and_multilayer_refused(tmp_path, height):
    _, sha, faces = source(tmp_path, [FLAT[0], ((.25, .25, height), (1.25, .25, height), (.25, 1.25, height))])
    with pytest.raises(ValueError, match="terrain_xy_overlap_or_multilayer"):
        terrain.prepare_terrain_geometry(faces, sha)


def test_duplicate_face_and_geometry_refused(tmp_path):
    _, sha, faces = source(tmp_path, [FLAT[0], FLAT[0]])
    with pytest.raises(ValueError, match="duplicate_terrain_face"):
        terrain.prepare_terrain_geometry([faces[0], faces[0]], sha)
    with pytest.raises(ValueError, match="duplicate_terrain_geometry"):
        terrain.prepare_terrain_geometry(faces, sha)


def test_nonmanifold_edge_and_vertex_contact_refused(tmp_path):
    _, sha, faces = source(tmp_path, [FLAT[0], FLAT[1], ((0, 2, 0), (2, 0, 0), (2, 2, 1))])
    with pytest.raises(ValueError, match="nonmanifold_terrain_edge"):
        terrain.prepare_terrain_geometry(faces, sha)
    other = raw_face(((2, 0, 0), (4, -2, 0), (4, 0, 0)), 1)
    with pytest.raises(ValueError, match="nonmanifold_terrain_boundary"):
        terrain.prepare_terrain_geometry([raw_face(FLAT[0]), other], "1" * 64)


@pytest.mark.parametrize("changes", [
    {"vertices_m": None}, {"normal": None}, {"point_indices": (0, 0, 1)},
    {"polygon_face_index": True}, {"area_m2": 0}, {"area_m2": True},
    {"actual_ground_verified": True}, {"geometry_representation": "triangulated_polygon"},
    {"face_id": None}, {"ifc_guid": "bad"}, {"normal": (0, 0, float("nan"))},
    {"vertices_m": ((10**1000, 0, 0), (2, 0, 0), (0, 2, 0))},
])
def test_malformed_face_controlled_refusal(tmp_path, changes):
    _, sha, faces = source(tmp_path)
    with pytest.raises(ValueError, match="invalid_terrain_face_or_source"):
        terrain.prepare_terrain_geometry([replace(faces[0], **changes)], sha)


def test_wrong_hash_area_and_budgets_refused(tmp_path):
    _, sha, faces = source(tmp_path)
    with pytest.raises(ValueError, match="invalid_terrain_face_or_source"):
        terrain.prepare_terrain_geometry(faces, "0" * 64)
    with pytest.raises(ValueError, match="identity_mismatch"):
        terrain.prepare_terrain_geometry([replace(faces[0], geometry_sha256="0" * 64)], sha)
    with pytest.raises(ValueError, match="area_mismatch"):
        terrain.prepare_terrain_geometry([replace(faces[0], area_m2=999)], sha)
    for selected in ([], faces * 51):
        with pytest.raises(ValueError, match="terrain_face_budget"):
            terrain.prepare_terrain_geometry(selected, sha)


def test_stl_precision_and_vertex_collision_refused():
    face = raw_face(((1000000.01, 0, 0), (1000002, 0, 0), (1000000, 2, 0)))
    with pytest.raises(ValueError, match="terrain_stl_precision_loss"):
        terrain.prepare_terrain_geometry([face], "1" * 64)
    face = raw_face(((1, 0, 0), (1 + 1e-8, 0, 0), (1, 2, 0)))
    with pytest.raises(ValueError, match="terrain_stl_vertex_identity_loss"):
        terrain.prepare_terrain_geometry([face], "1" * 64)


def test_cli_fresh_source_exclusive_artifact_no_case_or_subprocess(tmp_path, monkeypatch, capsys):
    path, sha, faces = source(tmp_path)
    selected = identity_list(tmp_path / "selection.json", sha, faces)
    original_bytes = path.read_bytes()
    def forbidden(*args, **kwargs):
        pytest.fail("terrain candidate must not invoke a subprocess / mesh / solver")
    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    out = tmp_path / "candidate"
    assert invoke(path, sha, selected, out) == 2
    assert json.loads(capsys.readouterr().out)["status"] == "HELD"
    assert {p.name for p in out.iterdir()} == {"terrain.stl", "manifest.json"}
    report = json.loads((out / "manifest.json").read_text())
    assert report["authority"] == "fresh_source_snapshot_face_identity"
    assert report["selection_input_sha256"] == hashlib.sha256(selected.read_bytes()).hexdigest()
    assert report["terrain_stl"]["sha256"] == hashlib.sha256((out / "terrain.stl").read_bytes()).hexdigest()
    artifact = {p.name: p.read_bytes() for p in out.iterdir()}
    assert invoke(path, sha, selected, out) == 4
    assert {p.name: p.read_bytes() for p in out.iterdir()} == artifact
    assert path.read_bytes() == original_bytes


@pytest.mark.parametrize("failure", ["wrong_sha", "wrong_face", "invalid_usd", "duplicate_json", "oversize", "polygon"])
def test_cli_invalid_source_creates_no_output(tmp_path, failure, capsys):
    path, sha, faces = source(tmp_path)
    selected = identity_list(tmp_path / "selection.json", sha, faces)
    if failure == "wrong_sha":
        sha = "0" * 64
    elif failure == "wrong_face":
        body = json.loads(selected.read_text())
        body["faces"][0]["face_id"] = "0" * 64
        selected.write_text(json.dumps(body))
    elif failure == "invalid_usd":
        path.write_bytes(b"not a USD file")
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        identity_list(selected, sha, faces)
    elif failure == "duplicate_json":
        selected.write_text('{"faces":[],"faces":[]}')
    elif failure == "oversize":
        selected.write_bytes(b" " * (512 * 1024 + 1))
    elif failure == "polygon":
        stage = Usd.Stage.Open(str(path))
        mesh = UsdGeom.Mesh(stage.GetPrimAtPath(MESH))
        mesh.GetFaceVertexCountsAttr().Set([6])
        stage.GetRootLayer().Save()
        del stage
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        identity_list(selected, sha, faces[:1])
    out = tmp_path / "candidate"
    assert invoke(path, sha, selected, out) == 4
    assert not out.exists()
    assert "Traceback" not in capsys.readouterr().err


def test_source_changed_after_snapshot_never_published(tmp_path, monkeypatch):
    path, sha, faces = source(tmp_path)
    selected = identity_list(tmp_path / "selection.json", sha, faces)
    fresh_read = terrain.read_ground_selection
    def changed(*args):
        result = fresh_read(*args)
        path.write_bytes(b"changed after fresh read")
        return result
    monkeypatch.setattr(terrain, "read_ground_selection", changed)
    out = tmp_path / "candidate"
    assert invoke(path, sha, selected, out) == 4
    assert not out.exists()
