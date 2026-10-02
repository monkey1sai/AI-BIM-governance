import hashlib
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pxr import Gf, Usd, UsdGeom

MODULE = Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"
sys.path.insert(0, str(MODULE))
from ground_selection_service import GroundSelectionError, GroundSelectionService, register_ground_selection_routes

GUID = "0000000000000000000000"
ELEMENT = "/World/Elements/IfcSlab/G_" + GUID


@pytest.fixture
def service(tmp_path):
    root = tmp_path / "artifacts"
    folder = root / "stream_conv_test"
    folder.mkdir(parents=True)
    path = folder / "model.usdc"
    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, "Z")
    UsdGeom.SetStageMetersPerUnit(stage, 0.01)
    UsdGeom.Xform.Define(stage, "/World").AddTranslateOp().Set(Gf.Vec3d(10, 20, 30))
    element = UsdGeom.Xform.Define(stage, ELEMENT)
    element.GetPrim().SetCustomDataByKey("bim", {"ifc_guid": GUID, "ifc_type": "IfcSlab"})
    mesh = UsdGeom.Mesh.Define(stage, ELEMENT + "/Mesh")
    mesh.CreatePointsAttr([(0, 0, 63), (200, 0, 63), (0, 200, 63)])
    mesh.CreateFaceVertexCountsAttr([3])
    mesh.CreateFaceVertexIndicesAttr([0, 1, 2])
    stage.GetRootLayer().Save()
    source = {"ready": True, "artifacts": {"model_usdc": {"path": str(path), "checksum_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}}}
    conversions = SimpleNamespace(settings=SimpleNamespace(artifacts_root=root, internal_conversion_token="test-only-token"),
                                  get_conversion_job=lambda job: {"result": source} if job == "stream_conv_test" else None)
    return GroundSelectionService(conversions)


def draft(service):
    page = service.catalog("stream_conv_test", {"component_path": ELEMENT})
    return {"region_name": "入口明選面", "model_usdc_sha256": page["model_usdc_sha256"],
            "faces": [{key: page["faces"][0][key] for key in ("ifc_guid", "mesh_prim_path", "polygon_face_index", "face_id")}]}


def test_preview_exact_world_units_parent_transform_and_idempotent_version(service):
    body = draft(service)
    result = service.prepare("stream_conv_test", body)
    assert result == service.prepare("stream_conv_test", body)
    layer = Usd.Stage.Open(str(service._folder(result["selection_id"]) / "preview.usda"))
    mesh = next(UsdGeom.Mesh(prim) for prim in layer.Traverse() if prim.IsA(UsdGeom.Mesh))
    matrix = UsdGeom.XformCache().GetLocalToWorldTransform(mesh.GetPrim())
    points = [matrix.Transform(Gf.Vec3d(*point)) * UsdGeom.GetStageMetersPerUnit(layer) for point in mesh.GetPointsAttr().Get()]
    assert tuple(points[0]) == pytest.approx((0.1, 0.2, 0.94))
    assert result["faces"][0]["vertices_m"][0][2] == pytest.approx(0.93)
    assert result["display_lift_m"] == 0.01
    assert service.checked("stream_conv_test", result["selection_id"]) == result
    assert not (service._folder(result["selection_id"]) / "confirmed.json").exists()
    assert not result["actual_ground_verified"]


def test_large_double_translation_preserves_small_preview_triangle(service):
    import numpy as np
    source = service.conversions.get_conversion_job("stream_conv_test")["result"]["artifacts"]["model_usdc"]
    stage = Usd.Stage.Open(source["path"])
    UsdGeom.Xformable(stage.GetPrimAtPath("/World")).GetOrderedXformOps()[0].Set(Gf.Vec3d(1e11, 1e11, 30))
    stage.GetRootLayer().Save()
    source["checksum_sha256"] = hashlib.sha256(Path(source["path"]).read_bytes()).hexdigest()
    result = service.prepare("stream_conv_test", draft(service))
    layer = Usd.Stage.Open(str(service._folder(result["selection_id"]) / "preview.usda"))
    mesh = next(UsdGeom.Mesh(prim) for prim in layer.Traverse() if prim.IsA(UsdGeom.Mesh))
    matrix = UsdGeom.XformCache().GetLocalToWorldTransform(mesh.GetPrim())
    points = np.array([matrix.Transform(Gf.Vec3d(*point)) * 0.01 for point in mesh.GetPointsAttr().Get()])
    assert np.linalg.norm(np.cross(points[1] - points[0], points[2] - points[0])) / 2 == pytest.approx(2)
    assert points[0][0] == pytest.approx(1e9)
    assert points[:, 2] == pytest.approx([0.94] * 3)


def test_stale_face_source_and_unregistered_preview_rejected(service):
    body = draft(service)
    with pytest.raises(GroundSelectionError, match="face_identity_mismatch"):
        service.prepare("stream_conv_test", {**body, "faces": [{**body["faces"][0], "face_id": "0" * 64}]})
    with pytest.raises(GroundSelectionError, match="source_sha_mismatch"):
        service.prepare("stream_conv_test", {**body, "model_usdc_sha256": "0" * 64})
    with pytest.raises(GroundSelectionError, match="selection_not_found"):
        service.preview_bytes("ground_" + "0" * 64)
    with pytest.raises(GroundSelectionError, match="invalid_selection_id"):
        service.preview_bytes("../model.usdc")
    result = service.prepare("stream_conv_test", body)
    (service._folder(result["selection_id"]) / "preview.usda").write_text("tampered")
    with pytest.raises(GroundSelectionError, match="selection_integrity_violation"):
        service.preview_bytes(result["selection_id"])


def test_internal_routes_fail_closed_and_get_never_creates_preview(service):
    app = FastAPI()
    register_ground_selection_routes(app, service.conversions)
    client = TestClient(app)
    path = "/api/conversions/stream_conv_test/ground-surfaces/catalog"
    assert client.post(path, json={"component_path": ELEMENT}).status_code == 403
    assert not service.root.exists()
    page = client.post(path, json={"component_path": ELEMENT}, headers={"X-Internal-Conversion-Token": "test-only-token"})
    assert page.status_code == 200
    assert client.get("/ground-artifacts/ground_" + "0" * 64 + "/preview.usda").status_code == 404
    assert not service.root.exists()
    service.conversions.settings.internal_conversion_token = None
    assert client.post(path, json={"component_path": ELEMENT}).status_code == 503
