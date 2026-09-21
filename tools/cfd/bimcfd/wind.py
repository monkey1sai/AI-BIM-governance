"""Wind direction handling and COST 732 domain sizing.

Conventions
-----------
* Meteorological wind direction is the bearing the wind blows *from*, in
  degrees clockwise from true north.
* The IFC model's +Y axis is project north; ``true_north_degrees`` (from
  ``geo_reference.json``) rotates project north anticlockwise to true north.
* The solver always sees the wind along +X. The building shell is rotated
  about Z by ``alpha`` (radians, anticlockwise) before meshing and results
  are rotated back by ``-alpha``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


def wind_vector_model(wind_from_degrees: float, true_north_degrees: float) -> np.ndarray:
    """Unit wind velocity direction (where the air moves to) in model XY."""
    bearing = math.radians(wind_from_degrees)
    tn = math.radians(true_north_degrees)
    north = np.array([-math.sin(tn), math.cos(tn)])
    east = np.array([math.cos(tn), math.sin(tn)])
    from_direction = math.sin(bearing) * east + math.cos(bearing) * north
    vector = -from_direction
    return vector / np.linalg.norm(vector)


def rotation_to_plus_x(wind_vector_xy: np.ndarray) -> float:
    """Angle alpha (radians, anticlockwise) such that R(alpha) @ wind = +X."""
    return -math.atan2(float(wind_vector_xy[1]), float(wind_vector_xy[0]))


def rotate_z(points: np.ndarray, alpha: float) -> np.ndarray:
    """Rotate (n, 3) points about Z by ``alpha`` radians (anticlockwise)."""
    cos_a, sin_a = math.cos(alpha), math.sin(alpha)
    rotation = np.array([[cos_a, -sin_a, 0.0], [sin_a, cos_a, 0.0], [0.0, 0.0, 1.0]])
    return np.asarray(points, dtype=np.float64) @ rotation.T


@dataclass(frozen=True)
class Domain:
    """Rectangular flow domain in the solver frame (wind along +X)."""

    xmin: float
    xmax: float
    ymin: float
    ymax: float
    zmin: float
    zmax: float
    building_height_m: float
    blockage_ratio: float

    @property
    def size(self) -> tuple[float, float, float]:
        return (self.xmax - self.xmin, self.ymax - self.ymin, self.zmax - self.zmin)


def domain_from_building(
    bbox_min: np.ndarray,
    bbox_max: np.ndarray,
    *,
    ground_z: float,
    upstream_heights: float = 5.0,
    downstream_heights: float = 15.0,
    lateral_heights: float = 5.0,
    top_heights: float = 5.0,
    max_blockage_ratio: float = 0.03,
) -> Domain:
    """COST 732 best-practice domain: 5H inlet/sides/top, 15H outlet, blockage < 3%.

    ``bbox_*`` are the building shell bounds in the solver frame. Geometry
    below ``ground_z`` is ignored by the domain (it lies outside the mesh).
    When the 5H lateral margin still gives a blockage ratio above
    ``max_blockage_ratio`` (wide, low buildings) the lateral margin is widened
    until the ratio is met; the top margin stays at ``top_heights``.
    """
    bbox_min = np.asarray(bbox_min, dtype=np.float64)
    bbox_max = np.asarray(bbox_max, dtype=np.float64)
    height = float(bbox_max[2] - ground_z)
    if height <= 0:
        raise ValueError("building top is at or below ground level")
    width = float(bbox_max[1] - bbox_min[1])
    xmin = float(bbox_min[0] - upstream_heights * height)
    xmax = float(bbox_max[0] + downstream_heights * height)
    zmax = float(bbox_max[2] + top_heights * height)
    domain_height = zmax - ground_z
    frontal_area = width * height
    lateral_margin = lateral_heights * height
    required_width = frontal_area / (max_blockage_ratio * domain_height)
    if width + 2.0 * lateral_margin < required_width:
        lateral_margin = (required_width - width) / 2.0
    ymin = float(bbox_min[1] - lateral_margin)
    ymax = float(bbox_max[1] + lateral_margin)
    section_area = (ymax - ymin) * domain_height
    return Domain(
        xmin=xmin,
        xmax=xmax,
        ymin=ymin,
        ymax=ymax,
        zmin=float(ground_z),
        zmax=zmax,
        building_height_m=height,
        blockage_ratio=frontal_area / section_area,
    )
