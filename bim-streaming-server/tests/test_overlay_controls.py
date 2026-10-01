"""CP2 controls: real USD session opinions, timeline readback and artifact preservation."""
import sys
from pathlib import Path

import pytest

pytest.importorskip("pxr")
from pxr import Sdf, Usd, UsdGeom  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from overlay_controls import OverlayControlsController, clear_overlay_visibility_overrides  # noqa: E402

RUN = "/World/Overlays/Cfd/run_1"
PRIM = f"{RUN}/FlowParticles"


class Timeline:
    def __init__(self):
        self.time = 2.0
        self.end = 239 / 24
        self.playing = True

    def get_current_time(self): return self.time
    def set_current_time(self, value): self.time = value
    def set_end_time(self, value): self.end = value
    def is_playing(self): return self.playing
    def play(self): self.playing = True
    def pause(self): self.playing = False
    def commit(self): pass


def scene():
    stage = Usd.Stage.CreateInMemory()
    layer = Sdf.Layer.CreateAnonymous("cfd_overlay.usda")
    overlay = Usd.Stage.Open(layer)
    UsdGeom.Xform.Define(overlay, RUN)
    UsdGeom.Points.Define(overlay, PRIM).CreateVisibilityAttr().Set("invisible")
    layer.customLayerData = {"cfd:animation": {"fps": 24.0, "frames": 240, "loop": True}}
    # Keep an unrelated layer/offset to prove playback only changes the animated CFD layer.
    other = Sdf.Layer.CreateAnonymous("unrelated.usda")
    session = stage.GetSessionLayer()
    session.subLayerPaths = [other.identifier, layer.identifier]
    session.subLayerOffsets[0] = Sdf.LayerOffset(7, 2)
    timeline = Timeline()
    return stage, layer, other, timeline, OverlayControlsController(lambda: stage, lambda: timeline)


def test_visibility_uses_explicit_session_opinions_and_clear_restores_authored_default():
    stage, layer, _other, _timeline, control = scene()
    before = layer.ExportToString()
    assert control.visibility([{"prim_path": PRIM, "visible": True}]) == [{"prim_path": PRIM, "visible": True, "present": True}]
    assert stage.GetSessionLayer().GetAttributeAtPath(f"{PRIM}.visibility").default == "inherited"
    assert control.visibility([{"prim_path": PRIM, "visible": False}])[0]["visible"] is False
    assert stage.GetSessionLayer().GetAttributeAtPath(f"{PRIM}.visibility").default == "invisible"
    assert layer.ExportToString() == before
    assert clear_overlay_visibility_overrides(stage) == 1
    assert stage.GetSessionLayer().GetAttributeAtPath(f"{PRIM}.visibility") is None
    assert UsdGeom.Imageable(stage.GetPrimAtPath(PRIM)).GetVisibilityAttr().Get() == "invisible"


def test_missing_prim_is_read_back_as_absent_without_creating_geometry():
    stage, _layer, _other, _timeline, control = scene()
    missing = f"{RUN}/Missing"
    assert control.visibility([{"prim_path": missing, "visible": True}]) == [{"prim_path": missing, "visible": False, "present": False}]
    assert not stage.GetPrimAtPath(missing)


@pytest.mark.parametrize("items", [[], [{}] * 33, "bad", [{"prim_path": PRIM, "visible": 1}],
    [{"prim_path": PRIM, "visible": True}, {"prim_path": "/World/Elements/Wall", "visible": False}],
    [{"prim_path": PRIM, "visible": True}, {"prim_path": PRIM, "visible": False}]])
def test_invalid_batch_is_rejected_before_any_opinion(items):
    stage, _layer, _other, _timeline, control = scene()
    before = stage.GetSessionLayer().ExportToString()
    with pytest.raises(ValueError): control.visibility(items)
    assert stage.GetSessionLayer().ExportToString() == before


@pytest.mark.parametrize("rate", [0.25, 4.0, 1.0])
def test_rate_preserves_overlay_frame_artifacts_and_unrelated_offset(rate):
    stage, layer, other, timeline, control = scene()
    root_before, artifact_before = stage.GetRootLayer().ExportToString(), layer.ExportToString()
    reply = control.playback("set_rate", rate)
    assert reply == {"playing": True, "rate": rate, "time_seconds": pytest.approx(2.0 / rate)}
    assert timeline.time * rate * 24 == pytest.approx(48)
    assert timeline.end == pytest.approx(239 / (24 * rate))
    assert stage.GetSessionLayer().subLayerOffsets[0] == Sdf.LayerOffset(7, 2)
    assert stage.GetSessionLayer().subLayerPaths[0] == other.identifier
    assert stage.GetRootLayer().ExportToString() == root_before
    assert layer.ExportToString() == artifact_before


def test_pause_resume_restart_and_return_to_one_use_timeline_readback():
    _stage, _layer, _other, timeline, control = scene()
    control.playback("set_rate", 4.0)
    assert control.playback("pause") == {"playing": False, "rate": 4.0, "time_seconds": 0.5}
    assert control.playback("play")["playing"] is True
    assert control.playback("restart") == {"playing": True, "rate": 4.0, "time_seconds": 0.0}
    timeline.time = 0.75
    assert control.playback("set_rate", 1.0)["time_seconds"] == 3.0


@pytest.mark.parametrize("action,rate", [("query", None), ("set_rate", None), ("set_rate", True),
    ("set_rate", 0.24), ("set_rate", 4.1), ("set_rate", float("nan")), ("pause", 2)])
def test_invalid_playback_does_not_change_session_or_timeline(action, rate):
    stage, _layer, _other, timeline, control = scene()
    before = stage.GetSessionLayer().ExportToString()
    with pytest.raises(ValueError): control.playback(action, rate)
    assert timeline.time == 2.0 and timeline.playing is True
    assert stage.GetSessionLayer().ExportToString() == before


def test_removed_or_unanimated_overlay_refuses_playback():
    stage, layer, _other, _timeline, control = scene()
    layer.customLayerData = {}
    with pytest.raises(ValueError): control.playback("play")
    stage.GetSessionLayer().subLayerPaths = []
    with pytest.raises(ValueError): control.playback("pause")


def test_remove_and_recompose_layer_resets_rate_and_visibility():
    stage, layer, other, _timeline, control = scene()
    control.playback("set_rate", 4)
    control.visibility([{"prim_path": PRIM, "visible": True}])
    clear_overlay_visibility_overrides(stage)
    session = stage.GetSessionLayer()
    session.subLayerPaths = [other.identifier]
    session.subLayerPaths.append(layer.identifier)
    assert control.playback("pause")["rate"] == 1
    assert UsdGeom.Imageable(stage.GetPrimAtPath(PRIM)).ComputeVisibility() == "invisible"
    assert session.subLayerOffsets[0] == Sdf.LayerOffset(7, 2)
