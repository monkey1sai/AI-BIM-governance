"""Native model configuration guards; actual input still requires headed Chrome."""
import sys
import tomllib
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from blender_navigation import configure_native_navigation  # noqa: E402


class Model:
    def __init__(self):
        self.values = {"fly_speed": [2], "center_of_interest": [0, 0, -80]}

    def set_floats(self, name, values):
        self.values[name] = list(values)

    set_ints = set_floats

    def get_as_floats(self, name):
        return self.values.get(name, [])

    get_as_ints = get_as_floats

    def get_item(self, name):
        return name


def window_for(model):
    camera = SimpleNamespace(layer=SimpleNamespace(manipulator=SimpleNamespace(model=model)))
    return SimpleNamespace(_find_viewport_layer=lambda name, category: camera if (name, category) == ("Camera", "manipulator") else None)


def test_configures_native_scroll_and_ortho_without_changing_fly_or_pivot():
    model = Model()
    assert configure_native_navigation(window_for(model)) == [0.075] * 3
    assert model.values["object_centric_movement"] == [0]
    assert model.values["ground_centric_movement"] == [0]
    assert model.values["enable_orthographic_rotations"] == [1]
    assert model.values["fly_speed"] == [2]
    assert model.values["center_of_interest"] == [0, 0, -80]


def test_repeated_gesture_end_never_falls_back_to_picked_point_preference():
    model = Model()
    configure_native_navigation(window_for(model))
    guarded_read = model.get_as_ints
    for _ in range(3):
        # Kit gesturebase.on_ended clears mode; the next native _on_began
        # uses persistent type=2 only if the mode read is empty.
        model.set_ints("object_centric_movement", [])
        model.set_ints("ground_centric_movement", [])
        read = model.get_as_ints(model.get_item("object_centric_movement"))
        mode = read[0] if read else 2
        assert mode == 0
        assert model.get_as_ints("ground_centric_movement") == [0]
        assert model.get_as_ints("fly_speed") == [2]
        assert model.values["center_of_interest"] == [0, 0, -80]
    configure_native_navigation(window_for(model))
    assert model.get_as_ints is guarded_read


@pytest.mark.parametrize("bad", [[], [0.025] * 3, [float("nan")] * 3])
def test_refuses_unconfirmed_scroll_speed(bad):
    model = Model()
    model.get_as_floats = lambda name: bad
    with pytest.raises(ValueError, match="scroll-speed readback mismatch"):
        configure_native_navigation(window_for(model))


def test_refuses_missing_camera_and_unconfirmed_mode():
    with pytest.raises(ValueError, match="manipulator unavailable"):
        configure_native_navigation(SimpleNamespace(_find_viewport_layer=lambda *args: None))
    model = Model()
    model.get_as_ints = lambda name: []
    with pytest.raises(ValueError, match="camera-mode readback mismatch"):
        configure_native_navigation(window_for(model))


def test_streaming_app_inherits_exact_middle_orbit_and_shift_pan_without_fly_override():
    app = tomllib.loads((ROOT / "source/apps/ezplus.bim_review_stream.kit").read_text(encoding="utf-8"))
    # Kit's pre-existing generated lock repeats [settings.app.exts], which its
    # loader permits. The dependency being checked is in the authored prefix.
    streaming_source = (ROOT / "source/apps/ezplus.bim_review_stream_streaming.kit").read_text(encoding="utf-8")
    streaming = tomllib.loads(streaming_source.split("# BEGIN GENERATED PART", 1)[0])
    assert "ezplus.bim_review_stream" in streaming["dependencies"]
    bindings = app["settings"]["exts"]["omni.kit.viewport.window"]["bindings"]["camera"]
    assert bindings == {"TumbleGesture": "MiddleButton", "PanGesture": "Shift MiddleButton"}
