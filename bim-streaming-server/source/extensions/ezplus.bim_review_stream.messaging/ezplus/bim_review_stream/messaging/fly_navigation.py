"""Official Kit fly-speed setting; readback is not evidence of camera motion."""
import math

VELOCITY = "/persistent/app/viewport/camMoveVelocity"
VELOCITY_MIN = "/persistent/app/viewport/camVelocityMin"
VELOCITY_MAX = "/persistent/app/viewport/camVelocityMax"
MIN_SPEED = 0.01
MAX_SPEED = 1000.0


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


class FlyNavigationController:
    def __init__(self, settings):
        self._settings = settings

    def read(self):
        value = self._settings.get(VELOCITY)
        # omni.kit.manipulator.camera treats a missing speed as 1.
        return float(value) if _finite(value) and value > 0 else 1.0

    def apply(self, speed):
        if not _finite(speed) or not MIN_SPEED <= speed <= MAX_SPEED:
            raise ValueError("Invalid fly speed.")
        target = float(speed)
        low, high = self._settings.get(VELOCITY_MIN), self._settings.get(VELOCITY_MAX)
        if _finite(low):
            target = max(float(low), target)
        if _finite(high):
            target = min(float(high), target)
        self._settings.set_float(VELOCITY, target)
        actual = self.read()
        if not math.isclose(actual, target, rel_tol=1e-6, abs_tol=1e-9):
            raise ValueError("Fly speed readback mismatch.")
        return actual
