"""Camera view presets and camera-state/v1 readback.

Readback proves camera settings only; the rendered result needs real-browser evidence.
Directions use model axes (Z up), not true north.
"""
import math

try:
    from .kit_command_vocabulary import CAMERA_PROJECTIONS, CAMERA_VIEW_SCOPES
except ImportError:  # pragma: no cover - test modules import this file directly.
    from kit_command_vocabulary import CAMERA_PROJECTIONS, CAMERA_VIEW_SCOPES

# pxr is imported inside functions: stage_management host tests import this module
# while Kit stub modules (including a bare `pxr`) are installed.
_S = 1.0 / math.sqrt(3.0)
PRESET_FORWARD = {
    "top": (0.0, 0.0, -1.0),
    "front": (0.0, 1.0, 0.0),
    "back": (0.0, -1.0, 0.0),
    "left": (1.0, 0.0, 0.0),
    "right": (-1.0, 0.0, 0.0),
    "iso": (-_S, _S, -_S),
}
_PRESET_UP = {"top": (0.0, 1.0, 0.0)}
_WORLD_UP = (0.0, 0.0, 1.0)
PROJECTIONS = CAMERA_PROJECTIONS
SCOPES = CAMERA_VIEW_SCOPES
# UsdGeomCamera: orthographic apertures are expressed in tenths of a world unit.
APERTURE_UNITS_PER_WORLD_UNIT = 10.0
_MAX_ABS = 1e9


def parse_camera_view_request(payload):
    action = payload.get("action")
    if action == "restore":
        if any(key in payload for key in ("projection", "view", "scope")):
            raise ValueError("Invalid camera restore.")
        return {"action": "restore", "camera": validate_restore_state(payload.get("camera"))}
    if action == "preset":
        view, scope = payload.get("view"), payload.get("scope")
        if view not in PRESET_FORWARD or scope not in SCOPES or "projection" in payload:
            raise ValueError("Invalid camera preset.")
        return {"action": "preset", "view": view, "scope": scope}
    if action == "projection":
        projection = payload.get("projection")
        if projection not in PROJECTIONS or "view" in payload or "scope" in payload:
            raise ValueError("Invalid camera projection.")
        return {"action": "projection", "projection": projection}
    raise ValueError("Invalid camera action.")


def look_at_camera_to_world(position, forward, view):
    from pxr import Gf
    up = Gf.Vec3d(*_PRESET_UP.get(view, _WORLD_UP))
    eye = Gf.Vec3d(position)
    return Gf.Matrix4d(1.0).SetLookAt(eye, eye + Gf.Vec3d(*forward), up).GetInverse()


def validate_restore_state(value):
    required = {"projection", "position", "direction", "up", "target_distance", "fov_deg", "ortho_height"}
    if not isinstance(value, dict) or not required <= set(value) or set(value) - required - {"center_of_interest"}:
        raise ValueError("Invalid camera restore state.")
    for key in ("position", "direction", "up", "center_of_interest"):
        vector = value.get(key)
        if key == "center_of_interest" and vector is None:
            continue
        if not isinstance(vector, (list, tuple)) or len(vector) != 3 or any(
                isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > _MAX_ABS for v in vector):
            raise ValueError("Invalid restore vector.")
    direction, up = value["direction"], value["up"]
    if any(abs(sum(v * v for v in vector) - 1) > 1e-5 for vector in (direction, up)) or abs(sum(d * u for d, u in zip(direction, up))) > 1e-5:
        raise ValueError("Restore direction/up must be an orthonormal basis.")
    distance = value["target_distance"]
    if isinstance(distance, bool) or not isinstance(distance, (int, float)) or not math.isfinite(distance) or not 0 < distance <= _MAX_ABS:
        raise ValueError("Invalid restore distance.")
    coi = value.get("center_of_interest", [0, 0, -distance])
    if abs(math.sqrt(sum(v * v for v in coi)) - distance) > 1e-5 * max(1, distance):
        raise ValueError("Restore center of interest and distance differ.")
    scalar = value["fov_deg"] if value["projection"] == "perspective" else value["ortho_height"]
    if isinstance(scalar, bool) or not isinstance(scalar, (int, float)) or not math.isfinite(scalar) or scalar <= 0:
        raise ValueError("Invalid restore projection size.")
    if value["projection"] == "perspective":
        if scalar >= 180 or value["ortho_height"] is not None:
            raise ValueError("Invalid restore field of view.")
    elif value["projection"] != "orthographic" or value["fov_deg"] is not None or scalar > _MAX_ABS:
        raise ValueError("Invalid restore projection.")
    return {**value, "center_of_interest": list(coi)}


def vertical_fov_deg(horizontal_aperture, focal_length, aspect):
    # Kit fits the aperture horizontally to the render resolution.
    return math.degrees(2.0 * math.atan((horizontal_aperture / aspect) / (2.0 * focal_length)))


def _finite_vec(vector):
    values = [float(v) for v in vector]
    if not all(math.isfinite(v) and abs(v) <= _MAX_ABS for v in values):
        raise ValueError("Camera readback is not finite.")
    return values


def camera_state_from(camera_to_world, center_of_interest, projection, horizontal_aperture,
                      focal_length, aspect, vertical_aperture):
    from pxr import Gf
    if projection not in PROJECTIONS:
        raise ValueError("Unsupported camera projection.")
    position = camera_to_world.Transform(Gf.Vec3d(0.0, 0.0, 0.0))
    direction = camera_to_world.TransformDir(Gf.Vec3d(0.0, 0.0, -1.0))
    up = camera_to_world.TransformDir(Gf.Vec3d(0.0, 1.0, 0.0))
    target = camera_to_world.Transform(Gf.Vec3d(center_of_interest))
    distance = (target - position).GetLength()
    if direction.GetLength() == 0 or up.GetLength() == 0 or not math.isfinite(distance) or distance <= 0:
        raise ValueError("Camera readback is degenerate.")
    ratio = aspect if aspect and math.isfinite(aspect) and aspect > 0 else horizontal_aperture / vertical_aperture
    state = {
        "projection": projection,
        "position": _finite_vec(position),
        "direction": _finite_vec(direction.GetNormalized()),
        "up": _finite_vec(up.GetNormalized()),
        "target_distance": _finite_vec([distance])[0],
        "center_of_interest": _finite_vec(center_of_interest),
        "fov_deg": None,
        "ortho_height": None,
    }
    if projection == "perspective":
        fov = vertical_fov_deg(horizontal_aperture, focal_length, ratio)
        if not (math.isfinite(fov) and 0 < fov < 180):
            raise ValueError("Camera field of view is invalid.")
        state["fov_deg"] = fov
    else:
        height = horizontal_aperture / ratio / APERTURE_UNITS_PER_WORLD_UNIT
        if not (math.isfinite(height) and 0 < height <= _MAX_ABS):
            raise ValueError("Camera orthographic height is invalid.")
        state["ortho_height"] = height
    return state


class CameraViewController:
    def __init__(self, api):
        self._api = api
        self._stage = None
        self._perspective_backup = None

    def sync_stage(self, stage):
        if stage is not self._stage:
            self._stage = stage
            self._perspective_backup = None

    def orient(self, stage, view):
        if view not in PRESET_FORWARD:
            raise ValueError("Invalid camera preset.")
        from pxr import Gf
        path = self._api.camera_path()
        current = self._api.camera_to_world(stage, path)
        position = current.Transform(Gf.Vec3d(0.0, 0.0, 0.0))
        self._api.set_camera_to_world(stage, path, look_at_camera_to_world(position, PRESET_FORWARD[view], view))

    def set_projection(self, stage, projection):
        if projection not in PROJECTIONS:
            raise ValueError("Invalid camera projection.")
        api, path = self._api, self._api.camera_path()
        current = api.get_camera_attr(stage, path, "projection")
        if current == projection:
            return
        if projection == "orthographic":
            state = self.read_state(stage)
            focal = float(api.get_camera_attr(stage, path, "focalLength"))
            horizontal = float(api.get_camera_attr(stage, path, "horizontalAperture"))
            vertical = float(api.get_camera_attr(stage, path, "verticalAperture"))
            aspect = api.aspect_ratio() or horizontal / vertical
            width = state["target_distance"] * horizontal / focal
            self._perspective_backup = (path, horizontal, vertical)
            api.set_camera_attr(stage, path, "projection", "orthographic")
            api.set_camera_attr(stage, path, "horizontalAperture", width * APERTURE_UNITS_PER_WORLD_UNIT)
            api.set_camera_attr(stage, path, "verticalAperture", width / aspect * APERTURE_UNITS_PER_WORLD_UNIT)
            return
        api.set_camera_attr(stage, path, "projection", "perspective")
        backup, self._perspective_backup = self._perspective_backup, None
        if backup is not None and backup[0] == path:
            api.set_camera_attr(stage, path, "horizontalAperture", backup[1])
            api.set_camera_attr(stage, path, "verticalAperture", backup[2])

    def read_state(self, stage):
        api, path = self._api, self._api.camera_path()
        projection = api.get_camera_attr(stage, path, "projection") or "perspective"
        return camera_state_from(
            api.camera_to_world(stage, path),
            api.center_of_interest(stage, path),
            projection,
            float(api.get_camera_attr(stage, path, "horizontalAperture")),
            float(api.get_camera_attr(stage, path, "focalLength")),
            api.aspect_ratio(),
            float(api.get_camera_attr(stage, path, "verticalAperture")),
        )

    def restore_state(self, stage, value):
        from pxr import Gf
        value = validate_restore_state(value)
        api, path = self._api, self._api.camera_path()
        names = ("projection", "horizontalAperture", "verticalAperture", "focalLength")
        old_attrs = {name: api.get_camera_attr(stage, path, name) for name in names}
        old_matrix, old_coi = api.camera_to_world(stage, path), api.center_of_interest(stage, path)
        eye = Gf.Vec3d(*value["position"])
        matrix = Gf.Matrix4d(1).SetLookAt(eye, eye + Gf.Vec3d(*value["direction"]), Gf.Vec3d(*value["up"])).GetInverse()
        aspect = api.aspect_ratio() or float(old_attrs["horizontalAperture"]) / float(old_attrs["verticalAperture"])
        horizontal = float(old_attrs["horizontalAperture"])
        if value["projection"] == "orthographic":
            horizontal = value["ortho_height"] * aspect * APERTURE_UNITS_PER_WORLD_UNIT
            focal = float(old_attrs["focalLength"])
        else:
            if self._perspective_backup is not None and self._perspective_backup[0] == path:
                horizontal = self._perspective_backup[1]
            focal = horizontal / aspect / (2 * math.tan(math.radians(value["fov_deg"]) / 2))
        try:
            api.set_camera_to_world(stage, path, matrix)
            api.set_camera_attr(stage, path, "omni:kit:centerOfInterest", Gf.Vec3d(*value["center_of_interest"]))
            for name, setting in {"projection": value["projection"], "horizontalAperture": horizontal,
                                  "verticalAperture": horizontal / aspect, "focalLength": focal}.items():
                api.set_camera_attr(stage, path, name, setting)
        except Exception:
            api.set_camera_to_world(stage, path, old_matrix)
            api.set_camera_attr(stage, path, "omni:kit:centerOfInterest", old_coi)
            for name, setting in old_attrs.items():
                api.set_camera_attr(stage, path, name, setting)
            raise
        self._perspective_backup = None


class KitCameraApi:
    """Official Kit camera access; authored on the session layer like resetStage."""

    def camera_path(self):
        from omni.kit.viewport.utility import get_active_viewport_camera_string
        return get_active_viewport_camera_string()

    def _camera(self, stage, path):
        from pxr import UsdGeom
        camera = UsdGeom.Camera(stage.GetPrimAtPath(path))
        if not camera:
            raise ValueError("Viewport camera unavailable.")
        return camera

    def camera_to_world(self, stage, path):
        from pxr import Usd
        return self._camera(stage, path).ComputeLocalToWorldTransform(Usd.TimeCode.Default())

    def center_of_interest(self, stage, path):
        from pxr import Gf
        value = self._camera(stage, path).GetPrim().GetAttribute("omni:kit:centerOfInterest").Get()
        if value is None:
            raise ValueError("Camera center of interest unavailable.")
        return Gf.Vec3d(value)

    def get_camera_attr(self, stage, path, name):
        return self._camera(stage, path).GetPrim().GetAttribute(name).Get()

    def set_camera_attr(self, stage, path, name, value):
        from pxr import Usd
        attribute = self._camera(stage, path).GetPrim().GetAttribute(name)
        with Usd.EditContext(stage, Usd.EditTarget(stage.GetSessionLayer())):
            if not attribute.Set(value):
                raise ValueError("Camera attribute could not be set.")

    def set_camera_to_world(self, stage, path, matrix):
        from pxr import Gf, Usd
        import omni.kit.commands
        camera = self._camera(stage, path)
        parent = camera.ComputeParentToWorldTransform(Usd.TimeCode.Default())
        old_local = camera.ComputeLocalToWorldTransform(Usd.TimeCode.Default()) * parent.GetInverse()
        new_local = Gf.Matrix4d(matrix) * parent.GetInverse()
        with Usd.EditContext(stage, Usd.EditTarget(stage.GetSessionLayer())):
            omni.kit.commands.execute(
                "TransformPrimCommand",
                path=path,
                new_transform_matrix=new_local,
                old_transform_matrix=old_local,
            )

    def aspect_ratio(self):
        from omni.kit.viewport.utility import get_active_viewport
        viewport = get_active_viewport()
        resolution = getattr(viewport, "resolution", None) if viewport is not None else None
        if not resolution or len(resolution) != 2 or not resolution[1]:
            return None
        return float(resolution[0]) / float(resolution[1])
