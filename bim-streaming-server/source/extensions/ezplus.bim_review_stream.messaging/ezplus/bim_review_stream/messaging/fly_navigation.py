"""Official Kit fly-speed setting; readback is not evidence of camera motion."""
import math

VELOCITY = "/persistent/app/viewport/camMoveVelocity"
VELOCITY_MIN = "/persistent/app/viewport/camVelocityMin"
VELOCITY_MAX = "/persistent/app/viewport/camVelocityMax"
ACCELERATION = "/persistent/app/viewport/manipulator/camera/flyAcceleration"
MIN_SPEED = 0.01
MAX_SPEED = 1000.0

# Fly speed 1 means five times human walking speed.
WALKING_SPEED_MPS = 1.4
SPEED_ONE_WALKING_MULTIPLE = 5.0
SPEED_ONE_MPS = WALKING_SPEED_MPS * SPEED_ONE_WALKING_MULTIPLE
# omni.kit.manipulator.camera fly model: a held key contributes 5 * speed,
# velocity grows by acceleration * dt and is damped by dampening * dt each
# tick, dt is clamped to clampUpdates, and livestream limits the loop to 60 Hz.
KEY_SCALE = 5.0
DAMPENING = 10.0
CLAMP_DT = 0.0166
LOOP_HZ = 60.0


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def travel_per_acceleration():
    """Steady stage units per second at speed 1 for each unit of acceleration."""
    terminal_velocity = KEY_SCALE * (1.0 - DAMPENING * CLAMP_DT) / DAMPENING
    return terminal_velocity * CLAMP_DT * LOOP_HZ


def speed_one_acceleration(meters_per_unit):
    if not _finite(meters_per_unit) or meters_per_unit <= 0:
        raise ValueError("Invalid stage meters per unit.")
    return SPEED_ONE_MPS / (travel_per_acceleration() * float(meters_per_unit))


class FlyNavigationController:
    def __init__(self, settings):
        self._settings = settings

    def read(self):
        value = self._settings.get(VELOCITY)
        # omni.kit.manipulator.camera treats a missing speed as 1.
        return float(value) if _finite(value) and value > 0 else 1.0

    def calibrate(self, meters_per_unit):
        target = speed_one_acceleration(meters_per_unit)
        self._settings.set_float(ACCELERATION, target)
        actual = self._settings.get(ACCELERATION)
        if not _finite(actual) or not math.isclose(actual, target, rel_tol=1e-6):
            raise ValueError("Fly acceleration readback mismatch.")
        return float(actual)

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
