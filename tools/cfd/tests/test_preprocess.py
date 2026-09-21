from __future__ import annotations

import json

import numpy as np
import pytest

from bimcfd.preprocess import (
    REASON_CLASS_EXCLUDED,
    REASON_CLASS_UNLISTED,
    REASON_NO_GEOMETRY,
    REASON_OUTLIER,
    classify_elements,
    detect_outliers,
    run_preprocess,
)
from bimcfd.profiles import get_profile
from bimcfd.usd_geometry import ElementGeometry, load_elements

from test_voxel_shell import box_triangles


def _element(guid, ifc_type, tris=None):
    return ElementGeometry(
        ifc_guid=guid,
        ifc_type=ifc_type,
        prim_path=f"/World/Elements/{ifc_type}/G_{guid}",
        triangles=np.zeros((0, 3, 3)) if tris is None else tris,
    )


def test_classify_by_profile_lists_every_exclusion_with_reason():
    profile = get_profile("exterior-wind/v1")
    elements = [
        _element("W1", "IfcWall", box_triangles((0, 0, 0), (1, 1, 1))),
        _element("D1", "IfcDoor", box_triangles((0, 0, 0), (1, 1, 1))),
        _element("X1", "IfcWeirdThing", box_triangles((0, 0, 0), (1, 1, 1))),
        _element("W2", "IfcWall"),
    ]
    kept, excluded = classify_elements(elements, profile)
    assert [e.ifc_guid for e in kept] == ["W1"]
    reasons = {item["ifc_guid"]: item["reason"] for item in excluded}
    assert reasons == {"D1": REASON_CLASS_EXCLUDED, "X1": REASON_CLASS_UNLISTED, "W2": REASON_NO_GEOMETRY}
    assert all({"ifc_guid", "ifc_type", "usd_prim_path", "reason"} <= set(item) for item in excluded)


def test_outlier_far_from_core_is_dropped_with_distance():
    rng = np.random.default_rng(0)
    elements = []
    for i in range(40):
        origin = rng.uniform([0, 0, 0], [60, 50, 20])
        elements.append(_element(f"E{i}", "IfcWall", box_triangles(origin, origin + 1)))
    far = _element("FAR", "IfcBeam", box_triangles((300, 0, 0), (302, 1, 1)))
    kept, excluded, rule = detect_outliers(elements + [far], core_percentile=5.0, margin_heights=1.0)
    assert len(kept) == 40
    assert excluded[0]["ifc_guid"] == "FAR"
    assert excluded[0]["reason"] == REASON_OUTLIER
    assert excluded[0]["detail"]["distance_to_core_m"] > 100
    assert rule["rule"] == "bbox_outside_expanded_core"
    assert rule["core_height_m"] > 1.0


def test_outlier_rule_keeps_elements_touching_expanded_core():
    elements = [_element(f"E{i}", "IfcWall", box_triangles((i, 0, 0), (i + 1, 1, 10))) for i in range(20)]
    # Slightly outside the percentile core but within one core height: kept.
    near = _element("NEAR", "IfcSlab", box_triangles((25, 0, 0), (26, 1, 1)))
    kept, excluded, _ = detect_outliers(elements + [near], core_percentile=5.0, margin_heights=1.0)
    assert any(e.ifc_guid == "NEAR" for e in kept)
    assert excluded == []


@pytest.fixture
def small_usdc(tmp_path):
    """Identity-style stage: two walls, a door, a light fixture and a far beam."""
    from pxr import Gf, Sdf, Usd, UsdGeom

    path = tmp_path / "model.usdc"
    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    for scope in ("Elements", "Overlays"):
        UsdGeom.Xform.Define(stage, f"/World/{scope}")

    def add(ifc_type, guid, lo, hi, translate=(0, 0, 0)):
        root = UsdGeom.Xform.Define(stage, f"/World/Elements/{ifc_type}/G_{guid}")
        root.GetPrim().SetCustomDataByKey("bim", {"ifc_guid": guid, "ifc_type": ifc_type})
        mesh = UsdGeom.Mesh.Define(stage, f"{root.GetPath()}/Body_000")
        tris = box_triangles(lo, hi)
        pts = tris.reshape(-1, 3)
        mesh.CreatePointsAttr([Gf.Vec3f(*map(float, p)) for p in pts])
        mesh.CreateFaceVertexCountsAttr([3] * tris.shape[0])
        mesh.CreateFaceVertexIndicesAttr(list(range(pts.shape[0])))
        xf = Gf.Matrix4d(1.0)
        xf.SetTranslateOnly(Gf.Vec3d(*translate))
        mesh.AddTransformOp().Set(xf)

    # Front wall with a 1 m door opening between x=4 and x=5 (the door leaf itself is excluded).
    add("IfcWall", "WALL_A", (0, 0, 0), (4, 0.3, 6))
    add("IfcWall", "WALL_A2", (5, 0, 0), (10, 0.3, 6))
    add("IfcWall", "WALL_B", (0, 0, 0), (10, 0.3, 6), translate=(0, 7.7, 0))
    add("IfcSlab", "SLAB", (0, 0, 5.7), (10, 8, 6))
    add("IfcSlab", "FLOOR", (0, 0, -0.3), (10, 8, 0))
    add("IfcWall", "WALL_C", (0, 0, 0), (0.3, 8, 6))
    add("IfcWall", "WALL_D", (9.7, 0, 0), (10, 8, 6))
    add("IfcDoor", "DOOR", (4, 0, 0), (5, 0.3, 2.2))
    add("IfcLightFixture", "LAMP", (5, 4, 5), (5.3, 4.3, 5.6))
    add("IfcBeam", "FAR_BEAM", (0, 0, 0), (3, 0.3, 0.3), translate=(200, 0, 0))
    stage.GetRootLayer().Save()
    return path


def test_load_elements_applies_mesh_transform(small_usdc):
    elements = {e.ifc_guid: e for e in load_elements(small_usdc)}
    assert set(elements) == {"WALL_A", "WALL_A2", "WALL_B", "SLAB", "FLOOR", "WALL_C", "WALL_D", "DOOR", "LAMP", "FAR_BEAM"}
    far = elements["FAR_BEAM"]
    assert far.triangle_count == 12
    assert far.bbox[0][0] == pytest.approx(200.0)
    assert elements["WALL_B"].bbox[0][1] == pytest.approx(7.7)


def test_run_preprocess_writes_shell_exclusions_and_stats(small_usdc, tmp_path):
    out = tmp_path / "pre"
    stats = run_preprocess(model_usdc=small_usdc, out_dir=out, profile_id="exterior-wind/v1", voxel_pitch_m=0.5, closing_radius_voxels=1)

    assert (out / "shell.stl").exists()
    exclusions = json.loads((out / "exclusions.json").read_text(encoding="utf-8"))
    reasons = {item["ifc_guid"]: item["reason"] for item in exclusions["items"]}
    assert reasons == {"DOOR": REASON_CLASS_EXCLUDED, "LAMP": REASON_CLASS_EXCLUDED, "FAR_BEAM": REASON_OUTLIER}
    assert exclusions["counts"] == {REASON_CLASS_EXCLUDED: 2, REASON_OUTLIER: 1}
    assert exclusions["source_model_usdc_sha256"] == stats["source_model_usdc_sha256"]

    assert stats["element_count_total"] == 10
    assert stats["element_count_kept"] == 7
    assert stats["shell"]["watertight"] is True
    assert stats["shell"]["boundary_edge_count"] == 0
    # The door opening (1 m) is sealed by a 0.5 m closing radius: no leak against the reference wrap.
    assert stats["shell"]["sealing_suspect"] is False
    assert stats["shell"]["leak_fraction"] <= 0.10
    assert stats["shell"]["kept_volume_m3"] > 0
    # The far beam must not stretch the shell.
    assert stats["shell_bbox_m"]["max"][0] < 20
    assert stats["shell_bbox_m"]["max"][2] == pytest.approx(6.0, abs=1.0)
    assert stats["outputs"]["shell_stl"]["sha256"]
    written = json.loads((out / "preprocess_stats.json").read_text(encoding="utf-8"))
    assert written["profile"]["profile_id"] == "exterior-wind/v1"
    assert written["effective"] == {"voxel_pitch_m": 0.5, "closing_radius_voxels": 1}


def test_run_preprocess_flags_leak_when_closing_cannot_seal_openings(small_usdc, tmp_path):
    # With no closing the 1 m door opening lets the exterior flood the interior.
    stats = run_preprocess(model_usdc=small_usdc, out_dir=tmp_path / "leaky", profile_id="exterior-wind/v1", voxel_pitch_m=0.5, closing_radius_voxels=0)

    shell = stats["shell"]
    assert shell["watertight"] is True  # by construction, hence not a sealing proof
    assert shell["leak_volume_m3"] > 0
    assert shell["leak_fraction"] > 0.10
    assert shell["sealing_suspect"] is True
