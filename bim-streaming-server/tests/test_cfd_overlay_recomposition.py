"""Real USD composition: removing a flow overlay must leave no orphan session prims."""
import pytest

pytest.importorskip("pxr")
from pxr import Sdf, Usd, UsdGeom

from test_stage_loading_stage_composition import make_manager, stage_loading
from overlay_controls import OverlayControlsController


ROOT = "/World/Overlays/Cfd"


def _overlay(name):
    layer = Sdf.Layer.CreateAnonymous(name + ".usda")
    stage = Usd.Stage.Open(layer)
    run = f"{ROOT}/{name}"
    instancer = UsdGeom.PointInstancer.Define(stage, run + "/PedestrianWindVectors")
    prototype = UsdGeom.Mesh.Define(stage, run + "/PedestrianWindVectors/Prototypes/Arrow")
    instancer.CreatePrototypesRel().SetTargets([prototype.GetPath()])
    instancer.CreatePositionsAttr().Set([(0, 0, 1.5)])
    instancer.CreateProtoIndicesAttr().Set([0])
    UsdGeom.Mesh.Define(stage, run + "/NearWallWindSpeed")
    layer.customLayerData = {"cfd:animation": {"fps": 24.0, "frames": 2}}
    return layer, run


def _context(layer=None):
    return {"secondary_bindings": [] if layer is None else [
        {"artifact_id": "cfd:fixture:w000", "url": layer.identifier, "load_order": 1}
    ]}


@pytest.mark.parametrize("replace", [False, True], ids=["hide", "replace-run"])
def test_recomposition_removes_flow_session_overs_without_touching_sources(monkeypatch, replace):
    stage = Usd.Stage.CreateInMemory()
    UsdGeom.Mesh.Define(stage, "/World/Building")
    other = Sdf.Layer.CreateAnonymous("unmanaged.usda")
    UsdGeom.Xform.Define(Usd.Stage.Open(other), "/World/Other")
    session = stage.GetSessionLayer()
    session.subLayerPaths.append(other.identifier)
    with Usd.EditContext(stage, session):
        UsdGeom.Xform.Define(stage, "/World/OperatorState").GetPrim().CreateAttribute(
            "fixture:keep", Sdf.ValueTypeNames.Bool, custom=True).Set(True)
    first, old_run = _overlay("first")
    second, new_run = _overlay("second")
    original = {layer.identifier: layer.ExportToString()
                for layer in (stage.GetRootLayer(), first, second, other)}

    manager = make_manager()
    monkeypatch.setattr(stage_loading, "Sdf", Sdf)
    monkeypatch.setattr(manager, "_process_stage_url", lambda url: url)
    monkeypatch.setattr(manager, "_sync_cfd_animation_playback", lambda layers: None)
    monkeypatch.setattr(manager, "_update_cfd_building_framing", lambda *args: None)
    manager._compose_secondary_artifact_bindings(stage, _context(first))
    vector_path = old_run + "/PedestrianWindVectors"
    prototype_path = vector_path + "/Prototypes/Arrow"
    assert stage.GetPrimAtPath(prototype_path).GetAttribute("primvars:doNotCastShadows").Get() is True
    controls = OverlayControlsController(lambda: stage, lambda: None)
    controls.visibility([{"prim_path": old_run + "/NearWallWindSpeed", "visible": False}])

    manager._compose_secondary_artifact_bindings(stage, _context(second if replace else None))
    assert session.GetPrimAtPath(old_run) is None
    assert not stage.GetPrimAtPath(old_run)
    assert not stage.GetPrimAtPath(prototype_path)
    assert first.identifier not in session.subLayerPaths
    assert other.identifier in session.subLayerPaths
    assert stage.GetPrimAtPath("/World/OperatorState").GetAttribute("fixture:keep").Get() is True
    assert stage.GetPrimAtPath("/World/Building")
    if replace:
        assert second.identifier in session.subLayerPaths
        assert stage.GetPrimAtPath(new_run + "/PedestrianWindVectors").IsA(UsdGeom.PointInstancer)
        assert stage.GetPrimAtPath(new_run + "/PedestrianWindVectors/Prototypes/Arrow").GetAttribute(
            "primvars:doNotCastShadows").Get() is True
    else:
        assert session.GetPrimAtPath(ROOT) is None
    assert original == {layer.identifier: layer.ExportToString()
                        for layer in (stage.GetRootLayer(), first, second, other)}
