"""Real USD: flow-only shadow suppression, immutable artifacts, reversible session opinions."""
import sys
from pathlib import Path

import pytest
pytest.importorskip("pxr")
from pxr import Sdf, Usd, UsdGeom

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from overlay_shadows import ATTRIBUTE, ROOT, clear_flow_shadow_overrides, suppress_flow_shadows


def test_flow_only_and_source_layers_immutable_with_hidden_growth():
    stage = Usd.Stage.CreateInMemory()
    source = Sdf.Layer.CreateAnonymous("overlay.usda")
    overlay = Usd.Stage.Open(source)
    run = ROOT + "/run_1"
    targets = [run + "/Streamlines", run + "/StreamlineGrowth/Seg_001", run + "/FlowParticles", run + "/PedestrianWindVectors", run + "/WindDirectionArrow"]
    for path in targets:
        schema = UsdGeom.Points if path.endswith("FlowParticles") else UsdGeom.BasisCurves if "Streamline" in path else UsdGeom.Mesh
        schema.Define(overlay, path).CreateVisibilityAttr().Set("invisible")
    untouched = [run + "/BuildingSurfacePressure", run + "/NearWallWindSpeed", run + "/PedestrianWind_1p5m", "/World/Building", "/World/Overlays/CfdOther/run_1/Streamlines"]
    for path in untouched:
        UsdGeom.Mesh.Define(overlay, path).GetPrim().CreateAttribute(ATTRIBUTE, Sdf.ValueTypeNames.Bool).Set(False)
    original = source.ExportToString()
    stage.GetSessionLayer().subLayerPaths.append(source.identifier)
    assert suppress_flow_shadows(stage) == 5
    assert all(stage.GetPrimAtPath(path).GetAttribute(ATTRIBUTE).Get() is True for path in targets)
    assert all(stage.GetPrimAtPath(path).GetAttribute(ATTRIBUTE).Get() is False for path in untouched)
    assert source.ExportToString() == original
    assert not stage.GetRootLayer().GetPrimAtPath(run)
    with Usd.EditContext(stage, stage.GetSessionLayer()):
        stage.GetPrimAtPath(untouched[0]).GetAttribute(ATTRIBUTE).Set(True)
        stage.GetPrimAtPath(targets[0]).GetAttribute("visibility").Set("inherited")
    assert clear_flow_shadow_overrides(stage) == 5
    assert stage.GetPrimAtPath(untouched[0]).GetAttribute(ATTRIBUTE).Get() is True
    assert stage.GetPrimAtPath(targets[0]).GetAttribute("visibility").Get() == "inherited"
    assert all(not stage.GetPrimAtPath(path).GetAttribute(ATTRIBUTE).HasAuthoredValueOpinion() for path in targets)
    assert source.ExportToString() == original
    assert suppress_flow_shadows(stage) == 5


def test_empty_stage_is_noop():
    stage = Usd.Stage.CreateInMemory()
    assert suppress_flow_shadows(stage) == 0
    assert clear_flow_shadow_overrides(stage) == 0
