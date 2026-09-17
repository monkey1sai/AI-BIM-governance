"""Fly-speed settings tests with injected settings; not evidence of camera motion."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from fly_navigation import VELOCITY, VELOCITY_MAX, VELOCITY_MIN, FlyNavigationController  # noqa: E402


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


def test_apply_reports_readback_mismatch():
    settings = FakeSettings({VELOCITY: 1.0})
    settings.ignore_writes = True
    with pytest.raises(ValueError):
        FlyNavigationController(settings).apply(3.0)
