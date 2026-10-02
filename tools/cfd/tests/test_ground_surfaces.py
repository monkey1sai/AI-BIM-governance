from __future__ import annotations

import hashlib

import numpy as np
import pytest
from pxr import Gf, Sdf, Usd, UsdGeom

from bimcfd.ground_surfaces import GroundFaceSelection, read_selected_ground_faces


GUID = "0000000000000000000000"
ELEMENT = "/World/Elements/IfcSlab/G_" + GUID
MESH = ELEMENT + "/Mesh"


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _stage(path, *, points=None, counts=None, indices=None, orientation="rightHanded", scale=None, units=1.0):
    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, "Z")
    UsdGeom.SetStageMetersPerUnit(stage, units)
    element = UsdGeom.Xform.Define(stage, ELEMENT)
    element.GetPrim().SetCustomDataByKey("bim", {"ifc_guid": GUID, "ifc_type": "IfcSlab"})
    if scale:
        element.AddScaleOp().Set(Gf.Vec3f(*scale))
    mesh = UsdGeom.Mesh.Define(stage, MESH)
    mesh.CreatePointsAttr(points if points is not None else [(0, 0, 0.63), (2, 0, 0.63), (0, 2, 0.63)])
    mesh.CreateFaceVertexCountsAttr(counts if counts is not None else [3])
    mesh.CreateFaceVertexIndicesAttr(indices if indices is not None else [0, 1, 2])
    mesh.CreateOrientationAttr(orientation)
    stage.GetRootLayer().Save()
    return stage, mesh


def _read(path, *selections):
    return read_selected_ground_faces(path, _sha(path), selections or [GroundFaceSelection(GUID, MESH, 0)])


def test_face_is_source_bound_authored_geometry_not_verified_walkable(tmp_path):
    path = tmp_path / "source.usdc"
    _stage(path)
    face = _read(path)[0]
    assert face.model_usdc_sha256 == _sha(path)
    assert (face.ifc_guid, face.ifc_type, face.mesh_prim_path, face.polygon_face_index) == (GUID, "IfcSlab", MESH, 0)
    assert face.point_indices == (0, 1, 2)
    assert np.array(face.vertices_m) == pytest.approx(np.array([(0, 0, 0.63), (2, 0, 0.63), (0, 2, 0.63)]))
    assert face.normal == pytest.approx((0, 0, 1))
    assert face.area_m2 == pytest.approx(2)
    assert face.geometry_sha256 == _read(path)[0].geometry_sha256
    assert face.actual_ground_verified is False
    assert face.geometry_representation == "authored_triangle"
    assert face.subdivision_scheme == "catmullClark"


def test_original_face_index_and_multiple_meshes_are_not_compacted(tmp_path):
    path = tmp_path / "source.usdc"
    stage, mesh = _stage(path, points=[(0, 0, 0), (2, 0, 0), (0, 2, 0), (0, 0, 5), (2, 0, 5), (0, 2, 5)], counts=[3, 3], indices=list(range(6)))
    mesh.CreateHoleIndicesAttr([0])
    another = UsdGeom.Mesh.Define(stage, ELEMENT + "/Other")
    another.CreatePointsAttr([(0, 0, -2), (2, 0, -2), (0, 2, -2)])
    another.CreateFaceVertexCountsAttr([3])
    another.CreateFaceVertexIndicesAttr([0, 1, 2])
    stage.GetRootLayer().Save()
    faces = _read(path, GroundFaceSelection(GUID, MESH, 1), GroundFaceSelection(GUID, ELEMENT + "/Other", 0))
    assert faces[0].polygon_face_index == 1
    assert faces[0].point_indices == (3, 4, 5)
    assert [face.vertices_m[0][2] for face in faces] == [5, -2]
    assert faces[0].geometry_sha256 != faces[1].geometry_sha256
    assert all(face.actual_ground_verified is False for face in faces)
    with pytest.raises(ValueError, match="hole_face"):
        _read(path)


@pytest.mark.parametrize("orientation,mirror,indices", [
    ("rightHanded", 1, [0, 1, 2]), ("rightHanded", -1, [0, 1, 2]),
    ("leftHanded", 1, [0, 2, 1]), ("leftHanded", -1, [0, 2, 1]),
])
def test_usd_orientation_and_mirror_preserve_outward_upward_normal(tmp_path, orientation, mirror, indices):
    path = tmp_path / "source.usdc"
    _stage(path, orientation=orientation, scale=(mirror * 2, 3, 4), indices=indices)
    face = _read(path)[0]
    assert face.normal == pytest.approx((0, 0, 1))
    assert face.area_m2 == pytest.approx(12)
    assert face.vertices_m[0][2] == pytest.approx(2.52)


def test_parent_transform_units_and_slope_use_world_metres(tmp_path):
    path = tmp_path / "source.usdc"
    stage, _ = _stage(path, points=[(0, 0, 0), (100, 0, 100), (0, 100, 0)], units=0.01)
    parent = UsdGeom.Xform.Define(stage, "/World")
    parent.AddTranslateOp().Set(Gf.Vec3d(10, 20, 30))
    parent.AddRotateZOp().Set(90)
    stage.GetRootLayer().Save()
    face = _read(path)[0]
    assert np.array(face.vertices_m) == pytest.approx(np.array([(0.1, 0.2, 0.3), (0.1, 1.2, 1.3), (-0.9, 0.2, 0.3)]))
    assert face.normal == pytest.approx((0, -2 ** -0.5, 2 ** -0.5))


@pytest.mark.parametrize("points,indices,reason", [
    ([(0, 0, 0), (2, 0, 0), (0, 2, 0)], [0, 2, 1], "not_upward"),
    ([(0, 0, 0), (0, 1, 0), (0, 0, 1)], [0, 1, 2], "not_upward"),
    ([(0, 0, 0), (1, 0, 0), (2, 0, 0)], [0, 1, 2], "degenerate_face"),
    ([(0, 0, 0), (2, 0, 0), (0, 2, float("nan"))], [0, 1, 2], "nonfinite_geometry"),
])
def test_invalid_or_downward_geometry_is_not_flipped_to_ground(tmp_path, points, indices, reason):
    path = tmp_path / "source.usdc"
    _stage(path, points=points, indices=indices)
    with pytest.raises(ValueError, match=reason):
        _read(path)


@pytest.mark.parametrize("counts,indices,reason", [
    ([3], [0, 1], "invalid_topology"), ([3], [0, 1, 3], "invalid_topology"),
    ([3], [0, 1, -1], "invalid_topology"), ([-3], [], "invalid_topology"),
    ([4], [0, 1, 2, 0], "unsupported_polygon"),
])
def test_topology_never_fan_triangulates_or_silently_reindexes(tmp_path, counts, indices, reason):
    path = tmp_path / "source.usdc"
    _stage(path, counts=counts, indices=indices)
    with pytest.raises(ValueError, match=reason):
        _read(path)


def test_concave_face_and_out_of_range_hole_are_explicitly_rejected(tmp_path):
    path = tmp_path / "source.usdc"
    stage, mesh = _stage(path, points=[(0, 0, 0), (2, 0, 0), (1, 1, 0), (2, 2, 0), (0, 2, 0)], counts=[5], indices=list(range(5)))
    with pytest.raises(ValueError, match="unsupported_polygon"):
        _read(path)
    mesh.CreateHoleIndicesAttr([9])
    stage.GetRootLayer().Save()
    with pytest.raises(ValueError, match="invalid_topology"):
        _read(path)


@pytest.mark.parametrize("mutation,reason", [
    (lambda stage, mesh: stage.ClearMetadata("upAxis"), "unknown_coordinate_frame"),
    (lambda stage, mesh: UsdGeom.SetStageUpAxis(stage, "Y"), "unsupported_up_axis"),
    (lambda stage, mesh: stage.ClearMetadata("metersPerUnit"), "unknown_coordinate_frame"),
    (lambda stage, mesh: UsdGeom.SetStageMetersPerUnit(stage, 0), "invalid_units"),
    (lambda stage, mesh: stage.GetPrimAtPath(ELEMENT).ClearCustomDataByKey("bim"), "missing_identity"),
    (lambda stage, mesh: mesh.GetPointsAttr().Set([(0, 0, 0), (2, 0, 0), (0, 2, 0)], 1), "animated_geometry"),
    (lambda stage, mesh: UsdGeom.Xformable(stage.GetPrimAtPath(ELEMENT)).AddScaleOp().Set(Gf.Vec3f(0, 1, 1)), "invalid_transform"),
])
def test_missing_frame_identity_or_unsupported_time_variation_fails_closed(tmp_path, mutation, reason):
    path = tmp_path / "source.usdc"
    stage, mesh = _stage(path)
    mutation(stage, mesh)
    stage.GetRootLayer().Save()
    with pytest.raises(ValueError, match=reason):
        _read(path)


def test_sha_mismatch_duplicate_selection_and_bool_index_fail_closed(tmp_path):
    path = tmp_path / "source.usdc"
    _stage(path)
    selection = GroundFaceSelection(GUID, MESH, 0)
    with pytest.raises(ValueError, match="source_sha_mismatch"):
        read_selected_ground_faces(path, "a" * 64, [selection])
    with pytest.raises(ValueError, match="duplicate_face"):
        _read(path, selection, selection)
    with pytest.raises(ValueError, match="invalid_selection"):
        _read(path, GroundFaceSelection(GUID, MESH, True))
    with pytest.raises(ValueError, match="identity_mismatch"):
        _read(path, GroundFaceSelection("1" * 22, MESH, 0))
    with pytest.raises(ValueError, match="empty_selection"):
        read_selected_ground_faces(path, _sha(path), iter([]))
    assert read_selected_ground_faces(path, _sha(path), iter([selection]))[0].polygon_face_index == 0


@pytest.mark.parametrize("dependency", ["sublayer", "reference", "payload", "clips"])
def test_external_composition_is_rejected_before_stage_composition(tmp_path, monkeypatch, dependency):
    path = tmp_path / "source.usdc"
    stage, _ = _stage(path)
    root = stage.GetRootLayer()
    prim = root.GetPrimAtPath(ELEMENT)
    if dependency == "sublayer":
        root.subLayerPaths = ["unbound.usda"]
    elif dependency == "reference":
        prim.referenceList.prependedItems = [Sdf.Reference("unbound.usda")]
    elif dependency == "payload":
        prim.payloadList.prependedItems = [Sdf.Payload("unbound.usda")]
    else:
        prim.SetInfo("clips", {"default": {"templateAssetPath": "unbound.#.usda"}})
    root.Save()
    def forbidden(*args, **kwargs):
        pytest.fail("Stage composition must not happen with unbound layers")
    monkeypatch.setattr(Usd.Stage, "Open", forbidden)
    with pytest.raises(ValueError, match="unsupported_composition"):
        _read(path)


def test_replacing_source_does_not_reuse_or_reload_a_live_cached_layer(tmp_path):
    path, replacement = tmp_path / "source.usdc", tmp_path / "replacement.usdc"
    held, _ = _stage(path)
    _stage(replacement, points=[(0, 0, 9), (2, 0, 9), (0, 2, 9)])
    replacement.replace(path)
    face = _read(path)[0]
    assert face.vertices_m[0][2] == 9
    assert UsdGeom.Mesh(held.GetPrimAtPath(MESH)).GetPointsAttr().Get()[0][2] == pytest.approx(0.63)


def test_source_change_after_snapshot_still_binds_exact_parsed_bytes(tmp_path, monkeypatch):
    path = tmp_path / "source.usdc"
    _stage(path)
    expected = _sha(path)
    original_open = Sdf.Layer.OpenAsAnonymous
    def open_snapshot(snapshot):
        assert str(snapshot) != str(path)
        path.write_bytes(b"changed after snapshot")
        return original_open(snapshot)
    monkeypatch.setattr(Sdf.Layer, "OpenAsAnonymous", open_snapshot)
    face = read_selected_ground_faces(path, expected, [GroundFaceSelection(GUID, MESH, 0)])[0]
    assert face.model_usdc_sha256 == expected
    assert face.vertices_m[0][2] == pytest.approx(0.63)


def test_single_sample_parent_transform_does_not_fall_back_to_default_pose(tmp_path):
    path = tmp_path / "source.usdc"
    stage, _ = _stage(path)
    parent = UsdGeom.Xform.Define(stage, "/World")
    parent.AddTranslateOp().Set(Gf.Vec3d(0, 0, 10), 1)
    stage.GetRootLayer().Save()
    with pytest.raises(ValueError, match="animated_geometry"):
        _read(path)


def test_winding_signed_zero_and_selection_identity_hash_are_stable(tmp_path):
    path = tmp_path / "source.usdc"
    _stage(path, points=[(-0.0, 0, 0), (2, 0, 0), (0, 2, 0)])
    face = _read(path)[0]
    assert not np.signbit(face.vertices_m[0][0])
    assert len(face.geometry_sha256) == 64
    assert len(face.face_id) == 64
    assert face.face_id == _read(path)[0].face_id
    positive = tmp_path / "positive.usdc"
    _stage(positive, points=[(0.0, 0, 0), (2, 0, 0), (0, 2, 0)])
    assert face.geometry_sha256 == _read(positive)[0].geometry_sha256
