"""Fly-speed settings tests with injected settings; not evidence of camera motion."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from fly_navigation import (  # noqa: E402
    ACCELERATION,
    SPEED_ONE_MPS,
    VELOCITY,
    VELOCITY_MAX,
    VELOCITY_MIN,
    WALKING_SPEED_MPS,
    FlyNavigationController,
    speed_one_acceleration,
)


class FakeSettings:
    def __init__(self, values=None):
        self.values = dict(values or {})
        self.ignore_writes = False

    def get(self, key):
        return self.values.get(key)

    def set_float(self, key, value):
        if not self.ignore_writes:
            self.values[key] = value


def test_read_uses_kit_fallback_when_unset():
    assert FlyNavigationController(FakeSettings()).read() == 1.0


def test_apply_writes_official_setting_and_reads_back():
    settings = FakeSettings({VELOCITY: 1.0})
    assert FlyNavigationController(settings).apply(2.5) == 2.5
    assert settings.values[VELOCITY] == 2.5


def test_apply_respects_kit_speed_limits():
    settings = FakeSettings({VELOCITY_MIN: 0.5, VELOCITY_MAX: 4.0})
    controller = FlyNavigationController(settings)
    assert controller.apply(10) == 4.0
    assert controller.apply(0.1) == 0.5


@pytest.mark.parametrize("bad", [0, 0.001, 1000.5, float("nan"), float("inf"), True, "2", None])
def test_apply_rejects_invalid_speed_without_writing(bad):
    settings = FakeSettings()
    with pytest.raises(ValueError):
        FlyNavigationController(settings).apply(bad)
    assert VELOCITY not in settings.values


def _steady_travel_per_second(speed, acceleration, ticks=600):
    # Mirrors omni.kit.manipulator.camera.model.Velocity.apply for one held key.
    velocity, travelled = 0.0, 0.0
    for _ in range(ticks):
        velocity += 5.0 * speed * acceleration * 0.0166
        velocity -= velocity * min(10.0 * 0.0166, 0.75)
        travelled = velocity * 0.0166 * 60.0
    return travelled


@pytest.mark.parametrize("meters_per_unit", [1.0, 0.01])
def test_calibrate_makes_speed_one_five_times_walking_pace(meters_per_unit):
    settings = FakeSettings()
    acceleration = FlyNavigationController(settings).calibrate(meters_per_unit)
    assert settings.values[ACCELERATION] == acceleration
    travelled = _steady_travel_per_second(1.0, acceleration) * meters_per_unit
    assert travelled == pytest.approx(SPEED_ONE_MPS, rel=1e-3)
    assert SPEED_ONE_MPS == pytest.approx(5 * WALKING_SPEED_MPS)
    assert SPEED_ONE_MPS == pytest.approx(7.0)


def test_calibrate_scales_with_stage_units():
    assert speed_one_acceleration(0.01) == pytest.approx(speed_one_acceleration(1.0) * 100)
    assert speed_one_acceleration(1.0) == pytest.approx(16.854, abs=1e-3)


@pytest.mark.parametrize("bad", [0, -1, float("nan"), float("inf"), True, None])
def test_calibrate_rejects_invalid_units_without_writing(bad):
    settings = FakeSettings()
    with pytest.raises(ValueError):
        FlyNavigationController(settings).calibrate(bad)
    assert ACCELERATION not in settings.values


def test_calibrate_reports_readback_mismatch():
    settings = FakeSettings({ACCELERATION: 1000.0})
    settings.ignore_writes = True
    with pytest.raises(ValueError):
        FlyNavigationController(settings).calibrate(1.0)


def test_apply_reports_readback_mismatch():
    settings = FakeSettings({VELOCITY: 1.0})
    settings.ignore_writes = True
    with pytest.raises(ValueError):
        FlyNavigationController(settings).apply(3.0)
