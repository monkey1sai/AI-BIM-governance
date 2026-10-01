"""Configure the pinned Kit native camera; never write model/CFD artifacts.

Kit 110 exposes the camera model through the viewport's layer lookup. Keep this
version-dependent access here; gestures and camera transforms remain owned by Kit.
"""
import math

# Native ZoomScrollGesture defaults to 0.025 per axis. It already scales with
# focus distance, so increase its coefficient instead of changing fly speed.
SCROLL_SPEED = (0.075, 0.075, 0.075)


def configure_native_navigation(window=None):
    if window is None:
        from omni.kit.viewport.utility import get_active_viewport_window
        window = get_active_viewport_window()
    if window is None:
        raise ValueError("Navigation viewport unavailable.")
    camera = window._find_viewport_layer("Camera", "manipulator")
    if camera is None:
        raise ValueError("Native camera manipulator unavailable.")
    model = camera.layer.manipulator.model
    model.set_floats("scroll_speed", SCROLL_SPEED)
    # Use the camera center authored by existing building framing, never a
    # picked CFD plane/line. Pan moves this focus; Building resets it.
    model.set_ints("object_centric_movement", [0])
    model.set_ints("ground_centric_movement", [0])
    model.set_ints("enable_orthographic_rotations", [1])
    actual = list(model.get_as_floats("scroll_speed"))
    if len(actual) != 3 or not all(math.isfinite(v) and math.isclose(v, wanted, rel_tol=1e-6)
                                  for v, wanted in zip(actual, SCROLL_SPEED)):
        raise ValueError("Navigation scroll-speed readback mismatch.")
    for name, expected in (("object_centric_movement", 0), ("ground_centric_movement", 0),
                           ("enable_orthographic_rotations", 1)):
        if list(model.get_as_ints(name)) != [expected]:
            raise ValueError("Navigation camera-mode readback mismatch.")
    return actual
