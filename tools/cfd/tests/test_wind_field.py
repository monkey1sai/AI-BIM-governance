"""Pedestrian Wind Field (docs/architecture/pedestrian-wind-field-adr.md, tracer bullet 1): statistics, exceedance
zones and element attribution on synthetic planes and synthetic element geometry, at the module's own interface."""

from __future__ import annotations

import numpy as np
import pytest

from bimcfd.foam_vtk import VtkSurface
from bimcfd.usd_geometry import ElementGeometry
from bimcfd.wind_field import ExceedanceZone, exceedance, field_stats, plane_metrics


def _grid_plane(nx: int, ny: int, speed) -> VtkSurface:
    """A unit-cell quad grid at z = 1.5 with |U| = speed(x, y) at each vertex, U along +x."""
    xs, ys = np.meshgrid(np.arange(nx + 1, dtype=float), np.arange(ny + 1, dtype=float), indexing="ij")
    points = np.column_stack([xs.ravel(), ys.ravel(), np.full(xs.size, 1.5)])
    magnitude = np.array([speed(x, y) for x, y in zip(points[:, 0], points[:, 1])], dtype=float)
    velocity = np.column_stack([magnitude, np.zeros_like(magnitude), np.zeros_like(magnitude)])
    index = lambda i, j: i * (ny + 1) + j  # noqa: E731
    polygons = [np.array([index(i, j), index(i + 1, j), index(i + 1, j + 1), index(i, j + 1)]) for i in range(nx) for j in range(ny)]
    return VtkSurface(points=points, polygons=polygons, point_data={"U": velocity})


def _box(guid: str, ifc_type: str, lo, hi) -> ElementGeometry:
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = np.array([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], dtype=float)
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return ElementGeometry(ifc_guid=guid, ifc_type=ifc_type, prim_path=f"/World/Elements/{ifc_type}/G_{guid}", triangles=np.array([[v[a], v[b], v[c]] for a, b, c in faces]))


# Two over-threshold clusters (x in [0,3) and x in [7,10)) separated by calm cells, on a 10 × 4 grid.
def _two_clusters(x, y):
    return 6.0 if x <= 3 or x >= 7 else 1.0


def test_plane_metrics_are_area_weighted_and_carry_the_minimum():
    plane = _grid_plane(4, 2, lambda x, y: 1.0 + x)  # |U| grows with x: 1..5
    m = plane_metrics(plane)
    assert m["U_max"] == 5.0 and m["U_min"] == 1.0
    # Each unit cell's mean is its x-midpoint + 1: 1.5, 2.5, 3.5, 4.5 -> area-weighted mean 3.0.
    assert m["U_mean"] == pytest.approx(3.0)
    assert m["weighting"] == "area" and m["polygons"] == 8 and m["area_m2"] == pytest.approx(8.0)
    stats = field_stats(plane)
    assert (stats.u_max, stats.u_min, stats.u_mean, stats.polygons) == (5.0, 1.0, pytest.approx(3.0), 8)


def test_exceedance_zones_are_connected_polygons_above_the_threshold_by_descending_peak():
    plane = _grid_plane(10, 4, _two_clusters)
    zones = exceedance(plane, 4.0, [])
    assert len(zones) == 2 and all(isinstance(zone, ExceedanceZone) for zone in zones)
    # Cells whose mean exceeds 4 m/s: x < 3 cells [0,1,2] and x >= 7 cells [7,8,9] -> 3 × 4 cells each, 12 m².
    assert [zone.area_m2 for zone in zones] == [12.0, 12.0]
    assert sorted(round(zone.centroid_xy[0], 1) for zone in zones) == [1.5, 8.5]
    assert all(zone.u_max == 6.0 and zone.polygons == 12 and zone.elements == () for zone in zones)
    assert exceedance(plane, 6.5, []) == ()


def test_zones_below_the_minimum_area_are_dropped():
    plane = _grid_plane(6, 1, lambda x, y: 6.0 if 2.9 < x < 3.1 else 1.0)  # one vertex column only: cells 2 and 3 have mean 3.5
    assert exceedance(plane, 3.0, []) != ()
    # A single 0.25 m² cell over the threshold is below the 1 m² floor.
    small = _grid_plane(2, 2, lambda x, y: 1.0)
    small.points[:, :2] *= 0.5  # 0.5 m cells
    small.point_data["U"][0] = [9.0, 0.0, 0.0]
    assert exceedance(small, 2.0, []) == ()


def test_attribution_takes_the_nearest_band_elements_within_two_metres_and_at_most_three():
    plane = _grid_plane(10, 4, _two_clusters)  # cluster A spans x 0..3, y 0..4
    elements = [
        _box("DOOR", "IfcDoor", (3.0, -0.3, 0.0), (4.0, 0.0, 2.2)),        # touches the zone edge: distance 0
        _box("WALL_NEAR", "IfcWall", (-1.5, 0.0, 0.0), (-1.2, 4.0, 6.0)),   # 1.2 m west of the zone
        _box("WALL_FAR", "IfcWall", (-5.0, 0.0, 0.0), (-4.7, 4.0, 6.0)),    # 4.7 m: outside the 2 m rule
        _box("SLAB_UP", "IfcSlab", (0.0, 0.0, 5.7), (10.0, 4.0, 6.0)),      # above the pedestrian band
        _box("COLUMN", "IfcColumn", (0.5, 4.5, 0.0), (0.8, 4.8, 3.0)),      # 0.5 m north
        _box("PANEL", "IfcPlate", (1.0, 4.9, 0.0), (1.3, 5.2, 3.0)),        # 0.9 m north: fourth candidate, cut by the cap
        _box("BEAM_FAR", "IfcBeam", (200.0, 0.0, 0.0), (203.0, 0.3, 0.3)),
    ]
    zones = exceedance(plane, 4.0, elements, ground_z=0.0)
    west = next(zone for zone in zones if zone.centroid_xy[0] < 5)
    east = next(zone for zone in zones if zone.centroid_xy[0] > 5)
    # Distances are measured from the zone's vertices (grid corners) to the element footprint: the column is
    # 0.2 m past the corner (1, 4) in x and 0.5 m in y, the panel sits straight above it.
    assert [(item.ifc_guid, item.distance_m) for item in west.elements] == [("DOOR", 0.0), ("COLUMN", 0.539), ("PANEL", 0.9)]
    assert west.elements[0].ifc_type == "IfcDoor" and west.elements[0].usd_prim_path == "/World/Elements/IfcDoor/G_DOOR"
    # The eastern zone (x 7..10) is more than 2 m from every element: open ground.
    assert east.elements == ()
    # Raising the band excludes nothing here; lowering the ground puts the slab in reach only if it meets the band.
    assert exceedance(plane, 4.0, elements, ground_z=5.0)[0].elements[0].ifc_guid == "SLAB_UP"


def test_exceedance_refuses_a_plane_without_velocity_or_a_non_positive_threshold():
    plane = _grid_plane(2, 2, lambda x, y: 1.0)
    with pytest.raises(ValueError, match="threshold"):
        exceedance(plane, 0.0, [])
    with pytest.raises(ValueError, match="no U point data"):
        exceedance(VtkSurface(points=plane.points, polygons=plane.polygons), 1.0, [])
