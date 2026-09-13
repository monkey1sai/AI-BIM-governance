"""Owned RTX section settings; readback is not GPU visibility evidence."""
import math

ENABLED = "/rtx/sectionPlane/enabled"
PLANE = "/rtx/sectionPlane/plane"


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _snapshot(settings):
    enabled, plane = settings.get(ENABLED), settings.get(PLANE)
    if not isinstance(enabled, bool) or not isinstance(plane, (list, tuple)):
        raise ValueError("Section renderer unavailable.")
    # Installed Kit 110.1 initializes an inactive plane as five zeros after
    # renderer startup. Preserve this opaque empty state for exact restoration;
    # it is not an authored five-coefficient clipping plane.
    empty_sentinel = not enabled and len(plane) == 5 and all(value == 0 for value in plane)
    if (len(plane) % 4 and not empty_sentinel) or not all(_finite(value) for value in plane):
        raise ValueError("Section renderer unavailable.")
    return enabled, list(plane)


def _matches(actual, expected):
    return actual[0] == expected[0] and len(actual[1]) == len(expected[1]) and all(
        math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-6)
        for a, b in zip(actual[1], expected[1]))


def _restore(settings, snapshot):
    # Disable while replacing coefficients; never expose a half-written plane.
    settings.set_bool(ENABLED, False)
    settings.set_float_array(PLANE, snapshot[1])
    settings.set_bool(ENABLED, snapshot[0])
    if not _matches(_snapshot(settings), snapshot):
        raise ValueError("Section restore readback mismatch.")


class SectionPlaneController:
    def __init__(self, settings):
        self._settings = settings
        self._original = None
        self._last_owned = None
        self._stage = None

    def _release(self):
        self._original = self._last_owned = self._stage = None

    def _assert_owned(self, current):
        # Compare the actual previous readback exactly, not the requested float.
        if self._last_owned is not None and current != self._last_owned:
            self._release()
            raise ValueError("Section settings changed outside this controller.")

    def sync_stage(self, stage):
        if self._stage is not None and stage != self._stage:
            self.restore()

    def apply(self, stage, payload):
        if not stage:
            raise ValueError("No stage.")
        axis, normal = payload.get("axis"), payload.get("normal")
        enabled, position = payload.get("enabled"), payload.get("position")
        if (axis not in ("x", "y", "z") or not isinstance(enabled, bool)
                or not _finite(position) or abs(position) > 3.4028234663852886e38
                or not isinstance(normal, (list, tuple))
                or len(normal) != 3 or not all(_finite(v) for v in normal)):
            raise ValueError("Invalid section plane.")
        index = ("x", "y", "z").index(axis)
        if abs(normal[index]) != 1 or any(normal[i] != 0 for i in range(3) if i != index):
            raise ValueError("Invalid section normal.")
        self.sync_stage(stage)
        before = _snapshot(self._settings)
        self._assert_owned(before)
        # An already-active plane belongs to another operator/extension.
        if self._original is None and before[0]:
            raise ValueError("Section settings are already in use.")
        if not enabled:
            self.restore()
            actual = _snapshot(self._settings)
        else:
            expected = True, [*normal, -position * normal[index]]
            try:
                _restore(self._settings, expected)
                actual = _snapshot(self._settings)
            except Exception:
                self._rollback_owned_write(before, expected)
                raise
            if self._original is None:
                self._original = before
            self._last_owned, self._stage = actual, stage
        return {"enabled": actual[0],
                "planes": [] if len(actual[1]) % 4 else
                [actual[1][i:i + 4] for i in range(0, len(actual[1]), 4)]}

    def _rollback_owned_write(self, before, expected):
        current = _snapshot(self._settings)
        # Only rollback values this synchronous operation could have written.
        if current[1] != before[1] and not _matches((current[0], current[1]), (current[0], expected[1])):
            self._release()
            raise ValueError("Section settings changed during update.")
        _restore(self._settings, before)
        if self._original is not None:
            self._last_owned = _snapshot(self._settings)

    def restore(self):
        if self._original is None:
            return
        before = _snapshot(self._settings)
        self._assert_owned(before)
        try:
            _restore(self._settings, self._original)
        except Exception:
            self._rollback_owned_write(before, self._original)
            raise
        self._release()
