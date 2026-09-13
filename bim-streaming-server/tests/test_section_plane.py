"""Renderer-settings DI tests; these do not prove GPU clipping."""
import copy
import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from section_plane import SectionPlaneController, ENABLED, PLANE


class FakeSettings:
    def __init__(self, plane=None):
        self.values = {ENABLED: False, PLANE: [0, 0, 0, 0] if plane is None else plane}
        self.fail_once = None
        self.ignore_once = None

    def get(self, key):
        return copy.deepcopy(self.values.get(key))

    def _set(self, key, value):
        if self.fail_once == key:
            self.fail_once = None
            raise RuntimeError("private renderer exception")
        if self.ignore_once == key:
            self.ignore_once = None
            return
        self.values[key] = copy.deepcopy(value)

    def set_bool(self, key, value):
        self._set(key, value)

    def set_float_array(self, key, value):
        self._set(key, value)


def test_disabled_installed_kit_empty_sentinel_round_trip():
    settings = FakeSettings([0.0] * 5)
    original = copy.deepcopy(settings.values)
    controller = SectionPlaneController(settings)
    assert controller.apply(object(), payload(enabled=False)) == {"enabled": False, "planes": []}
    assert controller.apply(object(), payload()) == {"enabled": True, "planes": [[1, 0, 0, -3]]}
    controller.restore()
    assert settings.values == original


@pytest.mark.parametrize("enabled,plane", [(True, [0.0]*5), (False, [0,0,0,0,1]), (False, [False,0,0,0,0])])
def test_only_disabled_zero_sentinel_is_accepted(enabled, plane):
    settings = FakeSettings(plane)
    settings.values[ENABLED] = enabled
    original = copy.deepcopy(settings.values)
    with pytest.raises(ValueError):
        SectionPlaneController(settings).apply(object(), payload())
    assert settings.values == original


def payload(axis="x", sign=1, position=3, enabled=True):
    normal = [0, 0, 0]
    normal[{"x": 0, "y": 1, "z": 2}[axis]] = sign
    return dict(axis=axis, normal=normal, position=position, enabled=enabled)


@pytest.mark.parametrize("action", ["apply", "off", "restore", "new_stage"])
def test_external_writer_is_never_overwritten(action):
    settings = FakeSettings()
    controller, stage = SectionPlaneController(settings), object()
    controller.apply(stage, payload())
    settings.values = {ENABLED: True, PLANE: [0, 1, 0, -9]}
    foreign = copy.deepcopy(settings.values)
    with pytest.raises(ValueError, match="outside this controller"):
        if action == "restore":
            controller.restore()
        else:
            controller.apply(object() if action == "new_stage" else stage, payload(enabled=action != "off"))
    controller.restore()
    assert settings.values == foreign
    with pytest.raises(ValueError, match="already in use"):
        controller.apply(stage, payload())
    assert settings.values == foreign


@pytest.mark.parametrize("enabled", [True, False])
def test_preexisting_active_plane_cannot_be_acquired_or_disabled(enabled):
    settings = FakeSettings([0, 0, 1, -4])
    settings.values[ENABLED] = True
    before = copy.deepcopy(settings.values)
    with pytest.raises(ValueError, match="already in use"):
        SectionPlaneController(settings).apply(object(), payload(enabled=enabled))
    assert settings.values == before


def test_new_stage_does_not_inherit_previous_plane_and_off_releases_ownership():
    settings = FakeSettings([0.0] * 5)
    controller = SectionPlaneController(settings)
    controller.apply(object(), payload())
    assert controller.apply(object(), payload(enabled=False)) == {"enabled": False, "planes": []}
    assert settings.values == {ENABLED: False, PLANE: [0.0] * 5}
    settings.values[PLANE] = [0, 1, 0, -8]
    controller.restore()
    assert settings.values[PLANE] == [0, 1, 0, -8]


def test_failed_restore_rolls_back_own_effect_and_can_be_retried():
    settings, stage = FakeSettings(), object()
    controller = SectionPlaneController(settings)
    controller.apply(stage, payload())
    before = copy.deepcopy(settings.values)
    settings.fail_once = PLANE
    with pytest.raises(RuntimeError):
        controller.restore()
    assert settings.values == before
    controller.restore()
    assert settings.values == {ENABLED: False, PLANE: [0, 0, 0, 0]}


def test_foreign_write_during_apply_is_not_rolled_back():
    class ForeignSettings(FakeSettings):
        def set_float_array(self, key, value):
            self.values[PLANE] = [0, 1, 0, -99]
            raise RuntimeError("another writer changed settings")
    settings = ForeignSettings()
    with pytest.raises(ValueError, match="during update"):
        SectionPlaneController(settings).apply(object(), payload())
    assert settings.values[PLANE] == [0, 1, 0, -99]


@pytest.mark.parametrize("axis", ["x", "y", "z"])
@pytest.mark.parametrize("sign", [1, -1])
def test_axis_reverse_off_and_restore(axis, sign):
    settings = FakeSettings()
    before = copy.deepcopy(settings.values)
    controller = SectionPlaneController(settings)
    stage = object()
    command = payload(axis, sign, -2)
    expected = [*command["normal"], 2 * sign]
    assert controller.apply(stage, command) == {"enabled": True, "planes": [expected]}
    assert controller.apply(stage, {**command, "enabled": False}) == {"enabled": False, "planes": [[0, 0, 0, 0]]}
    assert controller._original is None
    controller.restore()
    controller.restore()
    assert settings.values == before


@pytest.mark.parametrize("plane", [[], [1, 0, 0, 0, 0, 1, 0, -4]])
def test_first_off_preserves_empty_or_multiple_planes(plane):
    settings = FakeSettings(plane)
    controller = SectionPlaneController(settings)
    result = controller.apply(object(), payload(enabled=False))
    assert result == {"enabled": False, "planes": [plane[i:i+4] for i in range(0, len(plane), 4)]}
    controller.restore()
    assert settings.values == {ENABLED: False, PLANE: plane}


@pytest.mark.parametrize("change", [
    {"position": float("nan")}, {"position": float("inf")}, {"position": True},
    {"axis": "w"}, {"normal": [0, 1, 0]}, {"normal": [2, 0, 0]},
    {"normal": [True, 0, 0]}, {"normal": [1, 0]}, {"enabled": 1},
])
def test_bad_input_preserves_settings(change):
    settings = FakeSettings()
    before = copy.deepcopy(settings.values)
    with pytest.raises(ValueError):
        SectionPlaneController(settings).apply(object(), {**payload(), **change})
    assert settings.values == before


@pytest.mark.parametrize("bad", [None, [1, 2, 3], [0, 0, float("inf"), 0], ["0"] * 4])
def test_unavailable_or_invalid_original_plane_fails_closed(bad):
    settings = FakeSettings()
    settings.values[PLANE] = bad
    before = copy.deepcopy(settings.values)
    with pytest.raises(ValueError):
        SectionPlaneController(settings).apply(object(), payload())
    assert settings.values == before


def test_no_stage_and_missing_enabled_do_not_write():
    settings = FakeSettings()
    controller = SectionPlaneController(settings)
    with pytest.raises(ValueError):
        controller.apply(None, payload())
    del settings.values[ENABLED]
    with pytest.raises(ValueError):
        controller.apply(object(), payload())
    assert ENABLED not in settings.values


@pytest.mark.parametrize("failure", ["fail_once", "ignore_once"])
def test_failed_replace_rolls_back_to_previous_effect(failure):
    settings = FakeSettings()
    controller = SectionPlaneController(settings)
    stage = object()
    controller.apply(stage, payload())
    before = copy.deepcopy(settings.values)
    setattr(settings, failure, PLANE)
    with pytest.raises((ValueError, RuntimeError)):
        controller.apply(stage, payload("z", -1, 4))
    assert settings.values == before
    controller.restore()
    assert settings.values == {ENABLED: False, PLANE: [0, 0, 0, 0]}


def test_float32_readback_is_reported_and_first_failure_does_not_capture_bad_state():
    class FloatSettings(FakeSettings):
        def set_float_array(self, key, value):
            super().set_float_array(key, [struct.unpack("f", struct.pack("f", v))[0] for v in value])
    settings = FloatSettings()
    controller = SectionPlaneController(settings)
    settings.fail_once = ENABLED
    with pytest.raises(RuntimeError):
        controller.apply(object(), payload(position=1 / 3))
    assert settings.values == {ENABLED: False, PLANE: [0, 0, 0, 0]}
    result = controller.apply(object(), payload(position=1 / 3))
    assert result["planes"][0] == settings.values[PLANE]
    assert result["planes"][0][-1] != -1 / 3
    controller.restore()
    assert settings.values == {ENABLED: False, PLANE: [0, 0, 0, 0]}
