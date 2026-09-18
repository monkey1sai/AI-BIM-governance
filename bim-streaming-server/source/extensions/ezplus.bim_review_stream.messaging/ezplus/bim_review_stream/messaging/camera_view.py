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
