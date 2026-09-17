"""Camera math and controller tests with an injected camera API; not GPU evidence."""
import math
import sys
from pathlib import Path

import pytest
from pxr import Gf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from camera_view import (  # noqa: E402
    APERTURE_UNITS_PER_WORLD_UNIT,
    PRESET_FORWARD,
    CameraViewController,
    camera_state_from,
    look_at_camera_to_world,
    parse_camera_view_request,
    vertical_fov_deg,
)


class FakeCameraApi:
    def __init__(self, matrix=None, coi=None, attrs=None, aspect=16 / 9):
        self.path = "/OmniverseKit_Persp"
        self.matrix = matrix or look_at_camera_to_world(Gf.Vec3d(0, -10, 2), PRESET_FORWARD["front"], "front")
        self.coi = coi or Gf.Vec3d(0, 0, -10)
        self.attrs = attrs or {"projection": "perspective", "focalLength": 18.147562, "horizontalAperture": 20.955,
                               "verticalAperture": 15.2908}
        self.aspect = aspect
        self.writes = []

    def camera_path(self):
        return self.path

    def camera_to_world(self, stage, path):
        return Gf.Matrix4d(self.matrix)

    def center_of_interest(self, stage, path):
        return Gf.Vec3d(self.coi)

    def get_camera_attr(self, stage, path, name):
        return self.attrs.get(name)

    def set_camera_attr(self, stage, path, name, value):
        self.writes.append((name, value))
        self.attrs[name] = value

    def set_camera_to_world(self, stage, path, matrix):
        self.writes.append(("transform", Gf.Matrix4d(matrix)))
        self.matrix = Gf.Matrix4d(matrix)

    def aspect_ratio(self):
        return self.aspect


def _close(actual, expected, tol=1e-6):
    return all(math.isclose(a, b, abs_tol=tol) for a, b in zip(actual, expected))


@pytest.mark.parametrize("payload,expected", [
    ({"action": "preset", "view": "iso", "scope": "all"}, {"action": "preset", "view": "iso", "scope": "all"}),
    ({"action": "projection", "projection": "orthographic"}, {"action": "projection", "projection": "orthographic"}),
])
def test_parse_accepts_closed_actions(payload, expected):
    assert parse_camera_view_request({**payload, "request_id": "r", "trace_id": "t"}) == expected


@pytest.mark.parametrize("payload", [
    {"action": "preset", "view": "bottom", "scope": "all"},
    {"action": "preset", "view": "top"},
    {"action": "preset", "view": "top", "scope": "all", "projection": "perspective"},
    {"action": "projection", "projection": "fisheye"},
    {"action": "projection", "projection": "orthographic", "view": "top"},
    {"action": "apply_state"},
    {},
])
def test_parse_rejects_open_or_mixed_actions(payload):
    with pytest.raises(ValueError):
        parse_camera_view_request(payload)


@pytest.mark.parametrize("view", sorted(PRESET_FORWARD))
def test_look_at_matrix_points_camera_along_preset_forward(view):
    matrix = look_at_camera_to_world(Gf.Vec3d(1, 2, 3), PRESET_FORWARD[view], view)
    forward = matrix.TransformDir(Gf.Vec3d(0, 0, -1)).GetNormalized()
    up = matrix.TransformDir(Gf.Vec3d(0, 1, 0)).GetNormalized()
    assert _close(forward, PRESET_FORWARD[view])
    assert abs(Gf.Dot(forward, up)) < 1e-9
    assert _close(matrix.Transform(Gf.Vec3d(0, 0, 0)), (1, 2, 3))
    assert all(math.isfinite(v) for row in range(4) for v in matrix.GetRow(row))


def test_top_view_keeps_model_y_up_on_screen():
    matrix = look_at_camera_to_world(Gf.Vec3d(0, 0, 50), PRESET_FORWARD["top"], "top")
    assert _close(matrix.TransformDir(Gf.Vec3d(0, 1, 0)).GetNormalized(), (0, 1, 0))


def test_vertical_fov_uses_horizontal_aperture_fit():
    fov = vertical_fov_deg(horizontal_aperture=20.955, focal_length=18.147562, aspect=16 / 9)
    expected = math.degrees(2 * math.atan((20.955 / (16 / 9)) / (2 * 18.147562)))
    assert math.isclose(fov, expected)


def test_camera_state_reports_position_direction_distance_and_perspective_fov():
    api = FakeCameraApi()
    state = CameraViewController(api).read_state(object())
    assert state["projection"] == "perspective"
    assert _close(state["position"], (0, -10, 2))
    assert _close(state["direction"], (0, 1, 0))
    assert _close(state["up"], (0, 0, 1))
    assert math.isclose(state["target_distance"], 10)
    assert state["ortho_height"] is None and 0 < state["fov_deg"] < 180


def test_camera_state_reports_ortho_height_in_world_units():
    api = FakeCameraApi(attrs={"projection": "orthographic", "focalLength": 50.0, "horizontalAperture": 400.0,
                               "verticalAperture": 225.0}, aspect=16 / 9)
    state = camera_state_from(api.camera_to_world(None, None), api.center_of_interest(None, None),
                              "orthographic", 400.0, 50.0, 16 / 9, 225.0)
    assert state["fov_deg"] is None
    assert math.isclose(state["ortho_height"], 400.0 / (16 / 9) / APERTURE_UNITS_PER_WORLD_UNIT)


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_camera_state_refuses_non_finite_readback(bad):
    api = FakeCameraApi(coi=Gf.Vec3d(0, 0, bad))
    with pytest.raises(ValueError):
        CameraViewController(api).read_state(object())


def test_orient_keeps_position_and_writes_one_transform():
    api = FakeCameraApi()
    controller = CameraViewController(api)
    controller.orient(object(), "top")
    kinds = [write[0] for write in api.writes]
    assert kinds == ["transform"]
    assert _close(api.matrix.Transform(Gf.Vec3d(0, 0, 0)), (0, -10, 2))
    assert _close(api.matrix.TransformDir(Gf.Vec3d(0, 0, -1)).GetNormalized(), (0, 0, -1))


def test_orthographic_matches_current_view_width_and_restores_perspective():
    api = FakeCameraApi()
    controller = CameraViewController(api)
    stage = object()
    controller.set_projection(stage, "orthographic")
    width = 10 * 20.955 / 18.147562
    assert api.attrs["projection"] == "orthographic"
    assert math.isclose(api.attrs["horizontalAperture"], width * APERTURE_UNITS_PER_WORLD_UNIT)
    assert math.isclose(api.attrs["verticalAperture"], width / (16 / 9) * APERTURE_UNITS_PER_WORLD_UNIT)
    controller.set_projection(stage, "orthographic")
    assert [w for w in api.writes if w[0] == "projection"] == [("projection", "orthographic")]
    controller.set_projection(stage, "perspective")
    assert api.attrs == {"projection": "perspective", "focalLength": 18.147562,
                         "horizontalAperture": 20.955, "verticalAperture": 15.2908}


def test_stage_change_drops_perspective_backup():
    api = FakeCameraApi()
    controller = CameraViewController(api)
    first, second = object(), object()
    controller.sync_stage(first)
    controller.set_projection(first, "orthographic")
    controller.sync_stage(second)
    api.attrs["horizontalAperture"] = 999.0
    controller.set_projection(second, "perspective")
    assert api.attrs["projection"] == "perspective"
    assert api.attrs["horizontalAperture"] == 999.0


def test_unknown_view_or_projection_is_rejected_without_writes():
    api = FakeCameraApi()
    controller = CameraViewController(api)
    with pytest.raises(ValueError):
        controller.orient(object(), "bottom")
    with pytest.raises(ValueError):
        controller.set_projection(object(), "fisheye")
    assert api.writes == []
