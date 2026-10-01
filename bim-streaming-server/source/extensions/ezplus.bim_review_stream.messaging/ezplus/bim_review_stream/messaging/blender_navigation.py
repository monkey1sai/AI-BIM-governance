"""Configure the pinned Kit native camera; never write model/CFD artifacts.

Kit 110 exposes the camera model through the viewport's layer lookup. Keep this
version-dependent access here; gestures and camera transforms remain owned by Kit.
"""
import math
import weakref

# Native ZoomScrollGesture defaults to 0.025 per axis. It already scales with
# focus distance, so increase its coefficient instead of changing fly speed.
SCROLL_SPEED = (0.075, 0.075, 0.075)


def _keep_camera_focus_after_gesture(model):
    if getattr(model, "_bim_navigation_focus_read", None) is not None:
        return
    names = ("object_centric_movement", "ground_centric_movement")
    items = {model.get_item(name) for name in names}
    if None in items:
        raise ValueError("Navigation focus modes unavailable.")
    keys = items | set(names)
    original = weakref.WeakMethod(model.get_as_ints)

    def read_ints(item):
        read = original()
        if read is None:
            raise ValueError("Navigation camera unavailable.")
        values = read(item)
        # Native gesture end clears these modes. Keep the next gesture on the
        # camera COI instead of falling back to persistent picked-point prefs.
        return [0] if item in keys and not values else values

    # Scoped to this model; no class/vendor or persistent-settings change.
    # WeakMethod avoids retaining a retired viewport through its own getter.
    model.get_as_ints = read_ints
    model._bim_navigation_focus_read = read_ints


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
    _keep_camera_focus_after_gesture(model)
    return actual
