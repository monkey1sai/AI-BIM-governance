import math

import numpy as np
import pytest

from bimcfd.presentation_roi import envelope_roi, solver_roi
from bimcfd.usd_geometry import ElementGeometry
from test_voxel_shell import box_triangles


def element(kind, lo, hi):
    return ElementGeometry("test", kind, "/test", box_triangles(lo, hi))


def test_low_annex_does_not_dilute_envelope_visual_density():
    wall = element("IfcWall", (10, 20, 0), (40, 60, 20))
    annex = element("IfcSlab", (-100, -100, -1), (100, 100, 1))
    roi = envelope_roi([wall, annex])
    assert roi == {"source": "ifc_envelope", "min": [10, 20, 0], "max": [40, 60, 20]}
    assert annex.triangle_count == 12  # visual selection never mutates physical geometry


def test_unclassified_envelope_falls_back_honestly():
    assert envelope_roi([element("IfcSlab", (0, 0, 0), (10, 20, 2))])["source"] == "retained_geometry"


@pytest.mark.parametrize("angle", [0, math.pi / 2, math.pi / 4, -math.pi / 3])
def test_rotated_roi_contains_each_rotated_corner(angle):
    from bimcfd.wind import rotate_z
    roi = {"source": "ifc_envelope", "min": [-10, -20, 0], "max": [30, 40, 20]}
    rotated = solver_roi(roi, angle, ([-100, -100, -1], [100, 100, 30]), 0)
    corners = np.array([[x, y, z] for x in [-10, 30] for y in [-20, 40] for z in [0, 20]])
    points = rotate_z(corners, angle)
    assert np.all(points >= np.array(rotated["min"]) - 1e-9)
    assert np.all(points <= np.array(rotated["max"]) + 1e-9)


def test_invalid_or_disjoint_roi_is_not_silently_used():
    with pytest.raises(ValueError, match="overlap"):
        solver_roi({"source": "ifc_envelope", "min": [20, 20, 0], "max": [30, 30, 10]}, 0, ([0, 0, 0], [10, 10, 10]), 0)
    with pytest.raises(ValueError, match="finite"):
        solver_roi({"source": "ifc_envelope", "min": [float("nan"), 0, 0], "max": [30, 30, 10]}, 0, ([0, 0, 0], [10, 10, 10]), 0)
