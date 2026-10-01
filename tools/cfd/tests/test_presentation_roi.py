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


def test_flat_roof_falls_back_to_solid_retained_geometry():
    roof = element("IfcRoof", (0, 0, 10), (20, 30, 10))
    slab = element("IfcSlab", (0, 0, 0), (20, 30, 10))
    assert envelope_roi([roof, slab]) == {
        "source": "retained_geometry", "min": [0, 0, 0], "max": [20, 30, 10],
    }


def test_flat_retained_geometry_omits_optional_roi():
    assert envelope_roi([element("IfcRoof", (0, 0, 10), (20, 30, 10))]) is None


def test_nonfinite_geometry_is_still_rejected():
    with pytest.raises(ValueError, match="finite"):
        envelope_roi([element("IfcWall", (0, 0, 0), (float("nan"), 30, 10))])


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


def test_seed_spacing_narrows_without_moving_into_physical_geometry():
    from bimcfd.openfoam_case import CaseParams, domain_kwargs, streamline_seed_points
    from bimcfd.wind import domain_from_building
    bbox = ([-100, -100, 0], [100, 100, 20])
    params = CaseParams(270, 0, presentation_version=2)
    domain = domain_from_building(*bbox, ground_z=0, **domain_kwargs(params))
    full = np.array(streamline_seed_points(params, domain, 1.5, bbox))
    focused = np.array(streamline_seed_points(params, domain, 1.5, bbox,
                       {"min": [-25, -30, 0], "max": [25, 30, 20]}))
    assert full.shape == focused.shape == (240, 3)
    assert focused[1, 1] - focused[0, 1] < full[1, 1] - full[0, 1]
    assert np.all(focused[:, 0] < bbox[0][0])
    assert focused[:, 2].max() == pytest.approx(22)


def test_track_display_bounds_drop_excess_height_but_interpolate_real_velocity():
    from bimcfd.foam_vtk import VtkSurface
    from bimcfd.streamline_presentation import clip_tracks
    tracks = VtkSurface(points=np.array([[-100., 0, 5], [100, 0, 5], [-100, 0, 30], [100, 0, 30]]),
                        lines=[np.array([0, 1]), np.array([2, 3])], point_data={"U": np.tile([2., 0, 0], (4, 1))})
    clipped = clip_tracks(tracks, ([-10, -10, 0], [10, 10, 20]), 0, horizontal_heights=1, top_heights=.25)
    assert len(clipped.lines) == 1
    assert clipped.points[:, 0].tolist() == [-30, 30]
    assert np.allclose(clipped.point_data["U"], [[2, 0, 0], [2, 0, 0]])
