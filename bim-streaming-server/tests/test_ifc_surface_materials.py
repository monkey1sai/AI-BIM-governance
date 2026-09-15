"""Real IFC -> reopened USDC appearance, with review overlay round trips."""

from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

ifcopenshell = pytest.importorskip("ifcopenshell")
pytest.importorskip("pxr")
import ifcopenshell.util.element
from pxr import Usd, UsdGeom, UsdShade

from test_conversion_validation_facts import write_real_ifc

MODULE = Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"
sys.path.insert(0, str(MODULE))
from conversion_authority import ConversionAuthorityError
from highlight_overlay import HighlightOverlay
from ifc_openusd_identity_author import IfcOpenUsdIdentityAuthor
from ifc2usdc_powershell_adapter import Ifc2UsdcPowershellConverterAdapter
from ifc_surface_materials import IfcSurfaceMaterials


def surface(prim):
    material = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    assert material, str(prim.GetPath())
    shader = UsdShade.Shader(prim.GetStage().GetPrimAtPath(material.GetPath().AppendChild("Shader")))
    return tuple(shader.GetInput("diffuseColor").Get()), shader.GetInput("opacity").Get()


@pytest.mark.parametrize("profile", ["identity", "fallback"])
def test_source_surface_and_unstyled_geometry_survive_reload_and_review(tmp_path, profile):
    source = tmp_path / "source.ifc"
    write_real_ifc(source)
    model = ifcopenshell.open(str(source))
    color = model.create_entity("IfcColourRgb", Red=0.8, Green=0.2, Blue=0.1)
    shading = model.create_entity("IfcSurfaceStyleShading", SurfaceColour=color, Transparency=0.25)
    style = model.create_entity("IfcSurfaceStyle", Name="Original surface", Side="BOTH", Styles=[shading])
    model.create_entity("IfcStyledItem", Item=model.by_type("IfcExtrudedAreaSolid")[0], Styles=[style])
    # Two differently styled solids within one IFC element exercise real
    # IfcOpenShell per-triangle material IDs, not just one color per object.
    second_solid = ifcopenshell.util.element.copy_deep(model, model.by_type("IfcExtrudedAreaSolid")[0])
    second_solid.Depth = 4.0
    blue = model.create_entity("IfcColourRgb", Red=0.1, Green=0.3, Blue=0.9)
    blue_shading = model.create_entity("IfcSurfaceStyleShading", SurfaceColour=blue, Transparency=0.0)
    blue_style = model.create_entity("IfcSurfaceStyle", Name="Second surface", Side="BOTH", Styles=[blue_shading])
    model.create_entity("IfcStyledItem", Item=second_solid, Styles=[blue_style])
    representation = model.by_type("IfcWall")[0].Representation.Representations[0]
    representation.Items = tuple(representation.Items) + (second_solid,)
    model.write(str(source))
    source_bytes = source.read_bytes()
    out = tmp_path / "out"
    if profile == "identity":
        IfcOpenUsdIdentityAuthor(ifc_path=source, output_dir=out).author()
    else:
        adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, work_dir=tmp_path, storage_root=tmp_path)
        adapter._run_ifcopenshell_openusd_fallback(ifc_path=source, output_dir=out,
            primary_error=ConversionAuthorityError("test_import_failure", "fixture"))

    stage = Usd.Stage.Open(str(out / "model.usdc"))
    assert source.read_bytes() == source_bytes
    meshes = [p for p in stage.Traverse() if p.IsA(UsdGeom.Mesh)]
    assert len(meshes) == 2
    targets = list(meshes)
    for mesh in meshes:
        targets.extend(s.GetPrim() for s in UsdShade.MaterialBindingAPI(mesh).GetMaterialBindSubsets())
    assert len(targets) > len(meshes), "real IFC multi-material surface assignments were lost"
    original = [surface(p) for p in targets]
    assert any(rgb == pytest.approx((0.8, 0.2, 0.1)) and alpha == pytest.approx(0.75)
               for rgb, alpha in original)
    assert any(rgb == pytest.approx((0.1, 0.3, 0.9)) and alpha == 1 for rgb, alpha in original)
    assert all(len(rgb) == 3 and 0 <= alpha <= 1 for rgb, alpha in original)
    before = stage.GetRootLayer().ExportToString()
    overlay = HighlightOverlay()
    result = overlay.replace(stage, [{"prim_path": str(p.GetPath()), "color": [1, 0, 0, 1]} for p in meshes])
    assert len(result["applied_paths"]) == 2
    assert all(surface(p)[0] == (1, 0, 0) for p in targets)
    overlay.clear()
    assert [surface(p) for p in targets] == original
    assert stage.GetRootLayer().ExportToString() == before


def test_per_face_styles_invalid_faces_and_review_restore(tmp_path):
    path = tmp_path / "faces.usdc"
    stage = Usd.Stage.CreateNew(str(path))
    mesh = UsdGeom.Mesh.Define(stage, "/World/Wall")
    mesh.CreatePointsAttr([(0, 0, 0), (1, 0, 0), (0, 1, 0)])
    mesh.CreateFaceVertexCountsAttr([3, 3, 3])
    mesh.CreateFaceVertexIndicesAttr([0, 1, 2] * 3)
    styles = [SimpleNamespace(diffuse=(0, 0, 0), transparency=0),
              SimpleNamespace(diffuse=(0.2, 0.4, 0.8), transparency=1)]
    geometry = SimpleNamespace(materials=styles, material_ids=[0, 0, 1, -1],
                               faces=[0, 1, 2, 99, 1, 2, 0, 1, 2, 0, 1, 2])
    IfcSurfaceMaterials(stage).bind(mesh, geometry, "IfcWall")
    stage.GetRootLayer().Save()
    stage = Usd.Stage.Open(str(path))
    mesh = UsdGeom.Mesh(stage.GetPrimAtPath("/World/Wall"))
    subsets = UsdShade.MaterialBindingAPI(mesh).GetMaterialBindSubsets()
    assert UsdGeom.Subset.ValidateFamily(mesh, UsdGeom.Tokens.face, "materialBind")[0]
    assert [list(s.GetIndicesAttr().Get()) for s in subsets] == [[0], [1], [2]]
    original = [surface(s.GetPrim()) for s in subsets]
    assert original[0] == ((0, 0, 0), 1)
    assert original[1][0] == pytest.approx((0.2, 0.4, 0.8))
    assert original[1][1] == 0
    assert original[2][0] == pytest.approx((0.72, 0.68, 0.60))
    overlay = HighlightOverlay()
    assert overlay.replace(stage, [{"prim_path": "/World/Wall", "color": [1, 0, 0, 1]}])["applied_paths"]
    assert all(surface(s.GetPrim())[0] == (1, 0, 0) for s in subsets)
    overlay.clear()
    assert [surface(s.GetPrim()) for s in subsets] == original


def test_missing_and_nonfinite_style_get_visible_defaults_and_shared_materials():
    stage = Usd.Stage.CreateInMemory()
    writer = IfcSurfaceMaterials(stage)
    paths = []
    for index, styles in enumerate([(), [SimpleNamespace(diffuse=(float("nan"), 0, 0), transparency=float("nan"))]]):
        mesh = UsdGeom.Mesh.Define(stage, f"/World/Wall{index}")
        mesh.CreatePointsAttr([(0, 0, 0), (1, 0, 0), (0, 1, 0)])
        mesh.CreateFaceVertexCountsAttr([3])
        mesh.CreateFaceVertexIndicesAttr([0, 1, 2])
        writer.bind(mesh, SimpleNamespace(materials=styles, material_ids=[0], faces=[0, 1, 2]), "IfcWall")
        rgb, opacity = surface(mesh.GetPrim())
        assert rgb == pytest.approx((0.72, 0.68, 0.60))
        assert opacity == 1
        paths.append(UsdShade.MaterialBindingAPI(mesh).ComputeBoundMaterial()[0].GetPath())
    assert paths[0] == paths[1]


@pytest.mark.parametrize("ids", [(), (-1,), (99,), (None,), ("0",)])
def test_missing_or_invalid_face_material_id_uses_default_without_guessing(ids):
    stage = Usd.Stage.CreateInMemory()
    mesh = UsdGeom.Mesh.Define(stage, "/World/Wall")
    mesh.CreatePointsAttr([(0, 0, 0), (1, 0, 0), (0, 1, 0)])
    mesh.CreateFaceVertexCountsAttr([3])
    mesh.CreateFaceVertexIndicesAttr([0, 1, 2])
    geometry = SimpleNamespace(materials=[SimpleNamespace(diffuse=(1, 0, 0), transparency=0)],
                               material_ids=ids, faces=[0, 1, 2])
    IfcSurfaceMaterials(stage).bind(mesh, geometry, "IfcWall")
    rgb, opacity = surface(mesh.GetPrim())
    assert rgb == pytest.approx((0.72, 0.68, 0.60))
    assert opacity == 1
