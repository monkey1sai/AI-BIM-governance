import hashlib

import pytest
from pxr import Gf, UsdGeom

from bimcfd.ground_surfaces import catalog_ground_faces
from test_ground_surfaces import ELEMENT, GUID, MESH, _stage


def catalog(path, **kwargs):
    return catalog_ground_faces(path, hashlib.sha256(path.read_bytes()).hexdigest(), ELEMENT, **kwargs)


def test_catalog_pages_original_faces_and_reports_rejections(tmp_path):
    path = tmp_path / "model.usdc"
    stage, mesh = _stage(path, counts=[3, 3, 3], indices=[0, 2, 1, 0, 1, 2, 0, 1, 2])
    mesh.CreateHoleIndicesAttr([2])
    other = UsdGeom.Mesh.Define(stage, ELEMENT + "/Other")
    other.CreatePointsAttr([(0, 0, 2), (2, 0, 2), (0, 2, 2)])
    other.CreateFaceVertexCountsAttr([3])
    other.CreateFaceVertexIndicesAttr([0, 1, 2])
    stage.GetRootLayer().Save()
    first = catalog(path, limit=1)
    assert first["faces"][0]["polygon_face_index"] == 1
    assert first["faces"][0]["mesh_prim_path"] == MESH
    assert first["rejected_faces"] == {"not_upward": 1}
    assert first["next_cursor"] and not first["complete"]
    second = catalog(path, cursor=first["next_cursor"], limit=1)
    assert second["faces"][0]["mesh_prim_path"] == ELEMENT + "/Other"
    assert second["rejected_faces"] == {"hole_face": 1}
    assert second["complete"] and second["next_cursor"] is None
    assert second["faces"][0]["vertices_m"][0][2] == 2
    assert not any(face["actual_ground_verified"] for face in first["faces"] + second["faces"])


def test_catalog_cursor_cannot_cross_source_or_scope(tmp_path):
    path = tmp_path / "model.usdc"
    stage, _ = _stage(path, counts=[3, 3], indices=[0, 1, 2] * 2)
    cursor = catalog(path, limit=1)["next_cursor"]
    with pytest.raises(ValueError, match="invalid_cursor"):
        catalog_ground_faces(path, hashlib.sha256(path.read_bytes()).hexdigest(), MESH, cursor=cursor)
    UsdGeom.Xformable(stage.GetPrimAtPath(ELEMENT)).AddTranslateOp().Set(Gf.Vec3d(0, 0, 1))
    stage.GetRootLayer().Save()
    with pytest.raises(ValueError, match="invalid_cursor"):
        catalog(path, cursor=cursor)


def test_catalog_never_automatically_expands_to_whole_model(tmp_path):
    path = tmp_path / "model.usdc"
    _stage(path)
    for scope in ("/World", "/World/Elements", "/World/Elements/IfcSlab", "/World/Elements/../Secrets"):
        with pytest.raises(ValueError, match="invalid_scope"):
            catalog_ground_faces(path, hashlib.sha256(path.read_bytes()).hexdigest(), scope)
    with pytest.raises(ValueError, match="invalid_limit"):
        catalog(path, limit=True)
    with pytest.raises(ValueError, match="missing_scope"):
        catalog_ground_faces(path, hashlib.sha256(path.read_bytes()).hexdigest(), ELEMENT + "/Missing")


def test_catalog_copies_source_once_and_validates_mesh_once(tmp_path, monkeypatch):
    from bimcfd import ground_surfaces
    path = tmp_path / "model.usdc"
    _stage(path, counts=[3] * 60, indices=[0, 1, 2] * 60)
    calls = {"snapshot": 0, "mesh": 0}
    snapshot, prepare = ground_surfaces._snapshot, ground_surfaces._prepare_mesh
    def counted_snapshot(*args):
        calls["snapshot"] += 1
        return snapshot(*args)
    def counted_prepare(*args):
        calls["mesh"] += 1
        return prepare(*args)
    monkeypatch.setattr(ground_surfaces, "_snapshot", counted_snapshot)
    monkeypatch.setattr(ground_surfaces, "_prepare_mesh", counted_prepare)
    assert len(catalog(path)["faces"]) == 50
    assert calls == {"snapshot": 1, "mesh": 1}


def test_large_mesh_rejected_before_numpy_world_array(tmp_path, monkeypatch):
    from bimcfd import ground_surfaces
    path = tmp_path / "model.usdc"
    _stage(path, points=[(0, 0, 0)] * 200001)
    def forbidden(*args):
        pytest.fail("world array allocated before input budget")
    monkeypatch.setattr(ground_surfaces, "transform_points", forbidden)
    result = catalog(path, limit=1)
    assert not result["faces"]
    assert result["rejected_meshes"] == [{"mesh_prim_path": MESH, "reason": "mesh_budget_exceeded"}]


def test_mesh_traversal_stops_before_prepare_when_scope_budget_exceeded(tmp_path, monkeypatch):
    from bimcfd import ground_surfaces
    path = tmp_path / "model.usdc"
    stage, _ = _stage(path)
    for index in range(256):
        UsdGeom.Mesh.Define(stage, ELEMENT + "/Extra_" + str(index))
    stage.GetRootLayer().Save()
    monkeypatch.setattr(ground_surfaces, "_prepare_mesh", lambda *args: pytest.fail("prepared an excessive scope"))
    with pytest.raises(ValueError, match="scope_mesh_budget_exceeded"):
        catalog(path)


def test_scope_array_budget_rejects_before_transform(tmp_path, monkeypatch):
    from bimcfd import ground_surfaces
    path = tmp_path / "model.usdc"
    _stage(path)
    with ground_surfaces._source_stage(path, hashlib.sha256(path.read_bytes()).hexdigest()) as (stage, units, xcache):
        monkeypatch.setattr(ground_surfaces, "transform_points", lambda *args: pytest.fail("world array allocated after scope limit"))
        with pytest.raises(ValueError, match="scope_budget_exceeded"):
            ground_surfaces._prepare_mesh(stage, ground_surfaces.GroundFaceSelection(GUID, MESH, 0), units, xcache, [1000000, 0, 0])


@pytest.mark.parametrize("holes,expected", [([0] * 200001, "hole_budget_exceeded"), ([0, 0], "invalid_topology")])
def test_holes_are_bounded_by_faces_and_unique_before_world_allocation(tmp_path, monkeypatch, holes, expected):
    from bimcfd import ground_surfaces
    path = tmp_path / "model.usdc"
    stage, mesh = _stage(path, counts=[3] * 3, indices=[0, 1, 2] * 3)
    mesh.CreateHoleIndicesAttr(holes)
    stage.GetRootLayer().Save()
    monkeypatch.setattr(ground_surfaces, "transform_points", lambda *args: pytest.fail("world array allocated before hole rejection"))
    assert catalog(path)["rejected_meshes"] == [{"mesh_prim_path": MESH, "reason": expected}]
