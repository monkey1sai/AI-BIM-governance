import hashlib
import json
from pathlib import Path
import sys

import pytest
ifcopenshell = pytest.importorskip("ifcopenshell")
pytest.importorskip("pxr")
from pxr import Gf, Usd, UsdGeom

MODULE_DIR = Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"
sys.path.insert(0, str(MODULE_DIR))
import conversion_validation_facts as facts_module
from conversion_source_fingerprint import capture_source
from ifc2usdc_powershell_adapter import Ifc2UsdcPowershellConverterAdapter

GUIDS = ["0000000000000000000001", "0000000000000000000002"]


def write_real_ifc(path, *, centimetres=False, nested_rotation=False):
    """Analytic two-wall IFC fixture; not a domain acceptance model."""
    model = ifcopenshell.file(schema="IFC4")
    point = model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
    axis = model.create_entity("IfcAxis2Placement3D", Location=point)
    context = model.create_entity("IfcGeometricRepresentationContext", ContextType="Model",
                                  CoordinateSpaceDimension=3, Precision=0.00001, WorldCoordinateSystem=axis)
    unit = model.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE", Prefix="CENTI" if centimetres else None)
    assignment = model.create_entity("IfcUnitAssignment", Units=[unit])
    model.create_entity("IfcProject", GlobalId="0000000000000000000003", Name="Analytic fixture",
                        RepresentationContexts=[context], UnitsInContext=assignment)
    model.create_entity("IfcBuilding", GlobalId="0000000000000000000004", Name="No geometry")
    for index, guid in enumerate(GUIDS):
        origin = model.create_entity("IfcCartesianPoint", Coordinates=(index * 5.0, 0.0, 0.0))
        placement = model.create_entity("IfcAxis2Placement3D", Location=origin)
        profile = model.create_entity("IfcRectangleProfileDef", ProfileType="AREA", XDim=2.0, YDim=1.0)
        direction = model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0))
        solid = model.create_entity("IfcExtrudedAreaSolid", SweptArea=profile, Position=axis,
                                   ExtrudedDirection=direction, Depth=3.0)
        shape = model.create_entity("IfcShapeRepresentation", ContextOfItems=context,
                                   RepresentationIdentifier="Body", RepresentationType="SweptSolid", Items=[solid])
        representation = model.create_entity("IfcProductDefinitionShape", Representations=[shape])
        parent = None
        if nested_rotation:
            parent_axis = model.create_entity("IfcAxis2Placement3D",
                Location=model.create_entity("IfcCartesianPoint", Coordinates=(1000., 2000., 3000.)),
                RefDirection=model.create_entity("IfcDirection", DirectionRatios=(0., 1., 0.)))
            parent = model.create_entity("IfcLocalPlacement", RelativePlacement=parent_axis)
        model.create_entity("IfcWall", GlobalId=guid, Name=f"Wall {index + 1}",
                            ObjectPlacement=model.create_entity("IfcLocalPlacement", RelativePlacement=placement, PlacementRelTo=parent),
                            Representation=representation)
    model.write(str(path))


def convert_fixture(root, **fixture_options):
    root.mkdir(parents=True, exist_ok=True)
    source = root / "analytic.ifc"
    write_real_ifc(source, **fixture_options)
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=root, work_dir=root, storage_root=root)
    result = adapter.convert(job={"conversion_job_id": "facts_job", "model_version_id": "facts_v1",
                                   "conversion_profile": "ifcopenshell_openusd_identity"},
        ifc_ready_event={"model_version_id": "facts_v1", "conversion_profile": "ifcopenshell_openusd_identity",
                         "ifc_artifact": {"artifact_id": "ifc_fixture", "format": "ifc",
                                          "filename": "analytic.ifc", "url": "edge-local://analytic.ifc"}},
        output_dir=root / "out")
    return source, result


@pytest.fixture
def converted(tmp_path):
    return convert_fixture(tmp_path)


def read_facts(result):
    return json.loads(Path(result["metadata_path"]).read_text(encoding="utf-8"))["conversion_validation"]


def recollect(source, result):
    return facts_module.collect_conversion_facts(source, Path(result["model_path"]),
        Path(result["mapping_path"]), capture_source(source), "facts_v1")


def check(facts, name):
    return next(item for item in facts["checks"] if item["id"] == name)


def test_identity_author_preserves_source_placement(converted):
    _, result = converted
    stage = Usd.Stage.Open(str(result["model_path"]))
    bounds = []
    for mesh in (UsdGeom.Mesh(p) for p in stage.Traverse() if p.IsA(UsdGeom.Mesh)):
        matrix = UsdGeom.Xformable(mesh).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        xs = [matrix.Transform(Gf.Vec3d(p))[0] for p in mesh.GetPointsAttr().Get()]
        bounds.append((min(xs), max(xs)))
    assert sorted(bounds) == [(-1.0, 1.0), (4.0, 6.0)]


def test_real_cpu_conversion_has_independent_inventory_and_bound_bytes(converted):
    source, result = converted
    facts = read_facts(result)
    assert facts["inventory"] == {"observation": "observed", "expectedRenderable": 2, "convertedRenderable": 2,
        "missing": [], "excluded": [{"guid": "0000000000000000000004", "reason": "non_renderable"}]}
    assert facts["byClass"] == [{"ifcType": "IfcWall", "expected": 2, "converted": 2}]
    assert {item["guid"] for item in facts["correspondence"]} == set(GUIDS)
    assert facts["sourceSha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert facts["artifacts"]["usdcSha256"] == hashlib.sha256(Path(result["model_path"]).read_bytes()).hexdigest()
    assert facts["artifacts"]["mappingSha256"] == hashlib.sha256(Path(result["mapping_path"]).read_bytes()).hexdigest()
    for name in ("source_inventory", "usd_artifact", "mesh_geometry", "mapping", "units"):
        assert check(facts, name)["state"] == "pass", (name, facts)
    assert check(facts, "coordinates")["state"] == "pass_with_limits"
    assert facts["coordinateEvidence"]["checkedCount"] == 2
    assert facts["coordinateEvidence"]["maxDeltaM"] <= 0.001
    assert check(facts, "reference_measurement")["state"] == "not_run"


def test_missing_mapping_does_not_shrink_source_denominator(converted):
    source, result = converted
    path = Path(result["mapping_path"])
    mapping = json.loads(path.read_text())
    missing_guid = mapping["items"].pop()["ifc_guid"]
    path.write_text(json.dumps(mapping), encoding="utf-8")
    facts = recollect(source, result)
    assert facts["inventory"]["expectedRenderable"] == 2
    assert facts["inventory"]["convertedRenderable"] == 1
    assert facts["inventory"]["missing"] == [{"guid": missing_guid, "reasonCodes": ["renderable_not_corresponded"]}]
    assert check(facts, "inventory_completeness")["state"] == "pass_with_limits"


@pytest.mark.parametrize("change", ["foreign_guid", "duplicate_path", "missing_prim", "mock"])
def test_mapping_claims_require_actual_source_and_usd_identity(converted, change):
    source, result = converted
    path = Path(result["mapping_path"])
    mapping = json.loads(path.read_text())
    if change == "foreign_guid":
        mapping["items"][0]["ifc_guid"] = "not_in_source"
    elif change == "duplicate_path":
        mapping["items"][1]["usd_prim_path"] = mapping["items"][0]["usd_prim_path"]
    elif change == "missing_prim":
        mapping["items"][0]["usd_prim_path"] = "/World/Missing"
    else:
        mapping["mock"] = True
    path.write_text(json.dumps(mapping), encoding="utf-8")
    facts = recollect(source, result)
    assert facts["inventory"]["expectedRenderable"] == 2
    assert facts["inventory"]["convertedRenderable"] is None
    assert facts["correspondence"] is None
    assert check(facts, "mapping")["state"] == "fail"


def test_source_changed_while_checking_output_is_rejected(converted, monkeypatch):
    source, result = converted
    original = facts_module._usd_observation
    def changed(path):
        observed = original(path)
        source.write_bytes(source.read_bytes() + b"\n/* changed */")
        return observed
    monkeypatch.setattr(facts_module, "_usd_observation", changed)
    with pytest.raises(ValueError, match="source changed"):
        recollect(source, result)


def test_unreadable_source_is_unknown_not_success(converted):
    source, result = converted
    source.write_bytes(b"not an IFC")
    facts = recollect(source, result)
    assert facts["inventory"]["expectedRenderable"] is None
    assert facts["inventory"]["convertedRenderable"] is None
    assert check(facts, "source_inventory")["state"] == "execution_failed"


def test_missing_unit_metadata_is_not_inferred_from_usd_default(converted):
    source, result = converted
    stage = Usd.Stage.Open(str(result["model_path"]))
    stage.ClearMetadata("metersPerUnit")
    stage.GetRootLayer().Save()
    del stage
    facts = recollect(source, result)
    assert facts["units"]["usdMetersPerUnit"] is None
    assert check(facts, "units")["state"] == "unknown"


def test_corrupt_mesh_is_failed_even_when_stage_opens(converted):
    source, result = converted
    stage = Usd.Stage.Open(str(result["model_path"]))
    mesh = next(UsdGeom.Mesh(prim) for prim in stage.Traverse() if prim.IsA(UsdGeom.Mesh))
    mesh.GetFaceVertexIndicesAttr().Set([999999])
    stage.GetRootLayer().Save()
    del stage
    facts = recollect(source, result)
    assert check(facts, "usd_artifact")["state"] == "pass"
    assert check(facts, "mesh_geometry")["state"] == "fail"


def test_centimetre_nested_rotation_and_root_bbox(tmp_path):
    _, result = convert_fixture(tmp_path, centimetres=True, nested_rotation=True)
    facts = read_facts(result)
    assert facts["units"]["ifcLengthScaleM"] == 0.01
    assert check(facts, "coordinates")["state"] == "pass_with_limits"
    stage = Usd.Stage.Open(str(result["model_path"]))
    boxes = json.loads((Path(result["model_path"]).parent / "bbox_index.json").read_text())
    for item in boxes["items"]:
        prim = stage.GetPrimAtPath(item["usd_prim_path"])
        mesh = UsdGeom.Mesh(next(p for p in Usd.PrimRange(prim) if p.IsA(UsdGeom.Mesh)))
        matrix = UsdGeom.Xformable(mesh).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        vertices = [matrix.Transform(Gf.Vec3d(p)) for p in mesh.GetPointsAttr().Get()]
        bounds = [min(p[i] for p in vertices) for i in range(3)] + [max(p[i] for p in vertices) for i in range(3)]
        assert item["bbox_local"] == pytest.approx(bounds, abs=1e-8)
        offset = 0.05 if item["ifc_guid"] == GUIDS[1] else 0.
        assert bounds == pytest.approx([9.995, 19.99 + offset, 30., 10.005, 20.01 + offset, 30.03], abs=1e-7)
        # Mesh extent stays in mesh-local coordinates; root bbox includes placement.
        assert list(mesh.GetExtentAttr().Get()[0]) == pytest.approx([-0.01, -0.005, 0.], abs=1e-8)


@pytest.mark.parametrize("mutation", ["translation", "scale"])
def test_world_bounds_reject_wrong_placement_and_scale(converted, mutation):
    source, result = converted
    stage = Usd.Stage.Open(str(result["model_path"]))
    if mutation == "translation":
        UsdGeom.Xformable(stage.GetDefaultPrim()).AddTranslateOp().Set(Gf.Vec3d(0.01, 0., 0.))
    else:
        UsdGeom.SetStageMetersPerUnit(stage, 0.01)
    stage.GetRootLayer().Save()
    facts = recollect(source, result)
    assert check(facts, "coordinates")["state"] == "fail"
    assert facts["coordinateEvidence"]["mismatchedGuids"]
    assert facts["coordinateEvidence"]["maxDeltaM"] > 0.001


def test_reference_failure_is_not_coordinate_success(converted, monkeypatch):
    source, result = converted
    import ifcopenshell.geom
    def fail(*args, **kwargs):
        raise RuntimeError("reference parser failed")
    monkeypatch.setattr(ifcopenshell.geom, "iterator", fail)
    facts = recollect(source, result)
    assert check(facts, "coordinates")["state"] == "execution_failed"
    assert facts["coordinateEvidence"] is None


def test_unsupported_coordinate_frame_is_unknown(converted):
    source, result = converted
    stage = Usd.Stage.Open(str(result["model_path"]))
    UsdGeom.SetStageUpAxis(stage, "Y")
    stage.GetRootLayer().Save()
    assert check(recollect(source, result), "coordinates")["state"] == "unknown"
