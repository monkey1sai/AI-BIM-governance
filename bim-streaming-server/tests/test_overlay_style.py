"""Session-layer opacity override for CFD overlay prims (real pxr, in-memory stage)."""
import sys
from pathlib import Path

import pytest

pytest.importorskip("pxr")
from pxr import Sdf, Usd, UsdGeom, UsdShade, Vt  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from overlay_style import OverlayStyleController, material_path_for, parse_display_opacity, parse_prim_path  # noqa: E402

RUN = "/World/Overlays/Cfd/run_1"
PLANE = f"{RUN}/PedestrianWind_1p5m"
PLANE_MATERIAL = f"{RUN}/OverlayStyle/PedestrianWind_1p5m"


def _stage_with_overlay_sublayer():
    """Mirror stage_loading: the CFD layer is a sublayer of the session layer, plane opacity 0.6 authored there."""
    stage = Usd.Stage.CreateInMemory()
    UsdGeom.Xform.Define(stage, "/World")
    overlay = Sdf.Layer.CreateAnonymous("cfd_overlay.usda")
    overlay_stage = Usd.Stage.Open(overlay)
    UsdGeom.Xform.Define(overlay_stage, RUN)
    plane = UsdGeom.Mesh.Define(overlay_stage, PLANE)
    plane.CreateDisplayOpacityPrimvar(UsdGeom.Tokens.constant).Set(Vt.FloatArray([0.6]))
    plane.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex)
    UsdGeom.Mesh.Define(overlay_stage, f"{RUN}/BuildingSurfacePressure")
    UsdGeom.Points.Define(overlay_stage, f"{RUN}/FlowParticles")
    stage.GetSessionLayer().subLayerPaths.append(overlay.identifier)
    return stage, overlay


def _bound(stage, path):
    material, _rel = UsdShade.MaterialBindingAPI(stage.GetPrimAtPath(path)).ComputeBoundMaterial()
    return str(material.GetPath()) if material else None


def test_parse_prim_path_only_accepts_cfd_overlay_prims():
    assert parse_prim_path(PLANE) == PLANE
    for bad in ("/World/Elements/Wall", "/World/Overlays/Cfd", "/World/Overlays/Cfd/", RUN + "/../x", 12, None,
                "/World/Overlays/Cfd/run 1", "/World/Overlays/Cfd/" + "a" * 400):
        with pytest.raises(ValueError):
            parse_prim_path(bad)
    assert material_path_for(PLANE) == PLANE_MATERIAL


@pytest.mark.parametrize("value", [-0.1, 1.1, float("nan"), float("inf"), True, "0.5", None])
def test_parse_display_opacity_rejects_out_of_range_and_non_numbers(value):
    with pytest.raises(ValueError):
        parse_display_opacity(value)


def test_apply_binds_a_session_layer_material_reading_display_color_and_leaves_artifact_untouched():
    stage, overlay = _stage_with_overlay_sublayer()
    result = OverlayStyleController(lambda: stage).apply(PLANE, 0.25)
    assert result == {"prim_path": PLANE, "display_opacity": 0.25, "prims": 1, "materials": [PLANE_MATERIAL]}
    assert _bound(stage, PLANE) == PLANE_MATERIAL
    surface = UsdShade.Shader(stage.GetPrimAtPath(f"{PLANE_MATERIAL}/Surface"))
    assert surface.GetIdAttr().Get() == "UsdPreviewSurface"
    assert surface.GetInput("opacity").Get() == pytest.approx(0.25)
    assert surface.GetInput("ior").Get() == pytest.approx(1.0)
    assert surface.GetInput("opacityThreshold").Get() == pytest.approx(0.0)
    source = surface.GetInput("diffuseColor").GetConnectedSource()
    assert source and str(source[0].GetPath()) == f"{PLANE_MATERIAL}/DisplayColor"
    reader = UsdShade.Shader(stage.GetPrimAtPath(f"{PLANE_MATERIAL}/DisplayColor"))
    assert reader.GetIdAttr().Get() == "UsdPrimvarReader_float3"
    assert reader.GetInput("varname").Get() == "displayColor"
    composed = UsdGeom.Gprim(stage.GetPrimAtPath(PLANE)).GetDisplayOpacityPrimvar().Get()
    assert list(composed) == pytest.approx([0.25])
    # The artifact layer still says 0.6 and has no material; everything lives on the session layer only.
    assert list(overlay.GetAttributeAtPath(f"{PLANE}.primvars:displayOpacity").default) == pytest.approx([0.6])
    assert overlay.GetPrimAtPath(PLANE_MATERIAL) is None
    assert overlay.GetPrimAtPath(PLANE).properties.get("material:binding") is None
    session = stage.GetSessionLayer()
    assert session.GetPrimAtPath(PLANE_MATERIAL) is not None
    assert list(session.GetAttributeAtPath(f"{PLANE}.primvars:displayOpacity").default) == pytest.approx([0.25])
    assert stage.GetRootLayer().GetPrimAtPath(PLANE) is None


def test_reapply_replaces_the_override_and_opacity_one_removes_it():
    stage, _overlay = _stage_with_overlay_sublayer()
    controller = OverlayStyleController(lambda: stage)
    controller.apply(PLANE, 0.25)
    controller.apply(PLANE, 0.8)
    assert UsdShade.Shader(stage.GetPrimAtPath(f"{PLANE_MATERIAL}/Surface")).GetInput("opacity").Get() == pytest.approx(0.8)
    assert len(stage.GetPrimAtPath(f"{RUN}/OverlayStyle").GetChildren()) == 1
    result = controller.apply(PLANE, 1.0)
    assert result["materials"] == [] and result["display_opacity"] == 1.0
    assert _bound(stage, PLANE) is None
    session = stage.GetSessionLayer()
    assert session.GetPrimAtPath(PLANE_MATERIAL) is None
    assert session.GetPrimAtPath(f"{RUN}/OverlayStyle") is None
    assert session.GetAttributeAtPath(f"{PLANE}.primvars:displayOpacity") is None
    # Back to the authored look.
    assert list(UsdGeom.Gprim(stage.GetPrimAtPath(PLANE)).GetDisplayOpacityPrimvar().Get()) == pytest.approx([0.6])


def test_apply_on_run_prim_styles_every_drawable_descendant():
    stage, _overlay = _stage_with_overlay_sublayer()
    result = OverlayStyleController(lambda: stage).apply(RUN, 0.5)
    assert result["prims"] == 3 and len(result["materials"]) == 3
    for name in ("PedestrianWind_1p5m", "BuildingSurfacePressure", "FlowParticles"):
        assert _bound(stage, f"{RUN}/{name}") == f"{RUN}/OverlayStyle/{name}"
        values = UsdGeom.Gprim(stage.GetPrimAtPath(f"{RUN}/{name}")).GetDisplayOpacityPrimvar().Get()
        assert list(values) == pytest.approx([0.5])


def test_apply_rejects_missing_prim_no_stage_and_bad_inputs_without_writing():
    stage, _overlay = _stage_with_overlay_sublayer()
    controller = OverlayStyleController(lambda: stage)
    with pytest.raises(ValueError):
        controller.apply(f"{RUN}/Missing", 0.5)
    with pytest.raises(ValueError):
        controller.apply("/World", 0.5)
    with pytest.raises(ValueError):
        controller.apply(PLANE, 1.5)
    with pytest.raises(ValueError):
        OverlayStyleController(lambda: None).apply(PLANE, 0.5)
    session = stage.GetSessionLayer()
    assert session.GetAttributeAtPath(f"{PLANE}.primvars:displayOpacity") is None
    assert session.GetPrimAtPath(f"{RUN}/OverlayStyle") is None
