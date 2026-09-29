"""Pedestrian Wind Field (docs/architecture/pedestrian-wind-field-adr.md).

One wind direction's sampled wind field at pedestrian height, as a queryable thing: its statistics, the
connected zones above any threshold with their location, and the building elements each zone belongs to.
The module is pure numpy over the sampled plane and the model's element geometry; the streaming job service
loads both, caches them and serves the exceedance query, and the CFD Run Workflow decides what a zone means.

Statistics are area-weighted over the plane polygons because the cutting plane is sampled at mesh cells and
its point density follows the refinement; the maximum stays a point value. ``plane_metrics`` is the same
function the convergence study uses, so a result's ``U_mean`` is the study's ``U_mean``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np

from .foam_vtk import VtkSurface, parse_legacy_vtk
from .usd_geometry import ElementGeometry
from .wind import rotate_z

# Attribution rule (Grilling Record Q2, amended after bullet 4): elements whose z-range meets the pedestrian band,
# footprint distance in XY within MAX_DISTANCE_M, the nearest MAX_ELEMENTS; zones smaller than MIN_AREA_M2 are noise.
BAND_HEIGHT_M = 3.0
MAX_DISTANCE_M = 2.0
MAX_ELEMENTS = 3
MIN_AREA_M2 = 1.0
# Bullet 4 on a real model: the ground slabs meet the band and contain every zone (distance 0), so they took all
# three slots and no wall, door or column was ever named. A flat element of a ground class is not a candidate;
# "flat" is judged by its own box (z extent smaller than both plan extents), so a slab standing on edge, a thick
# footing block or a sloped site mesh still counts.
GROUND_ELEMENT_TYPES = frozenset({"IfcSlab", "IfcSite", "IfcFooting", "IfcCovering", "IfcGeographicElement"})


def polygon_areas(points: np.ndarray, polygons: list[np.ndarray]) -> np.ndarray:
    """Planar polygon areas by fan triangulation (the cuttingPlane sample is planar)."""
    areas = np.zeros(len(polygons), dtype=float)
    for index, poly in enumerate(polygons):
        idx = np.asarray(poly, dtype=int)
        if idx.size < 3:
            continue
        p0 = points[idx[0]]
        v1 = points[idx[1:-1]] - p0
        v2 = points[idx[2:]] - p0
        areas[index] = 0.5 * np.linalg.norm(np.cross(v1, v2), axis=1).sum()
    return areas


def weighted_percentile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    order = np.argsort(values)
    cumulative = np.cumsum(weights[order])
    return float(values[order][np.searchsorted(cumulative, q / 100.0 * cumulative[-1])])


def plane_metrics(plane, *, clip_box: tuple[float, float, float, float] | None = None) -> dict:
    """|U| statistics on the sampled pedestrian plane, optionally clipped to (xmin, xmax, ymin, ymax).

    The mean and the 95th percentile are area-weighted over the plane polygons (a plain point average would
    just measure where the mesh is fine). The maximum stays a point value. Without polygons the metrics fall
    back to unweighted point statistics and say so.
    """
    velocity = plane.point_data.get("U")
    if velocity is None:
        raise ValueError("pedestrian plane has no U point data")
    points = np.asarray(plane.points, dtype=float)
    magnitude = np.linalg.norm(np.asarray(velocity, dtype=float), axis=1)
    inside = np.ones(points.shape[0], dtype=bool)
    clip_applied = False
    if clip_box is not None:
        xmin, xmax, ymin, ymax = clip_box
        candidate = (points[:, 0] >= xmin) & (points[:, 0] <= xmax) & (points[:, 1] >= ymin) & (points[:, 1] <= ymax)
        if candidate.any():
            inside = candidate
            clip_applied = True
    polygons = [np.asarray(poly, dtype=int) for poly in (getattr(plane, "polygons", None) or []) if len(poly) >= 3]
    kept_polys = [poly for poly in polygons if inside[poly].all()]
    if kept_polys:
        areas = polygon_areas(points, kept_polys)
        poly_values = np.array([magnitude[poly].mean() for poly in kept_polys])
        total = float(areas.sum())
        return {"U_max": float(magnitude[inside].max()), "U_mean": float((poly_values * areas).sum() / total),
                "U_p95": weighted_percentile(poly_values, areas, 95.0), "U_min": float(magnitude[inside].min()),
                "points": int(inside.sum()), "polygons": len(kept_polys), "area_m2": total, "weighting": "area",
                "clip_applied": clip_applied}
    sample = magnitude[inside]
    return {"U_max": float(sample.max()), "U_mean": float(sample.mean()), "U_p95": float(np.percentile(sample, 95)),
            "U_min": float(sample.min()), "points": int(sample.size), "polygons": 0, "area_m2": None,
            "weighting": "points", "clip_applied": clip_applied}


@dataclass(frozen=True)
class FieldStats:
    u_max: float
    u_mean: float
    u_p95: float
    u_min: float
    polygons: int
    area_m2: float | None
    weighting: str


def field_stats(plane, *, clip_box: tuple[float, float, float, float] | None = None) -> FieldStats:
    m = plane_metrics(plane, clip_box=clip_box)
    return FieldStats(u_max=m["U_max"], u_mean=m["U_mean"], u_p95=m["U_p95"], u_min=m["U_min"],
                      polygons=int(m["polygons"]), area_m2=m["area_m2"], weighting=str(m["weighting"]))


@dataclass(frozen=True)
class ZoneElement:
    ifc_guid: str
    ifc_type: str
    usd_prim_path: str
    distance_m: float


@dataclass(frozen=True)
class ExceedanceZone:
    area_m2: float
    centroid_xy: tuple[float, float]
    u_max: float
    polygons: int
    elements: tuple[ZoneElement, ...]


def _rect_distance(points_xy: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> float:
    """Smallest XY distance from any of ``points_xy`` to the axis-aligned rectangle [lo, hi] (0 inside)."""
    dx = np.maximum(np.maximum(lo[0] - points_xy[:, 0], 0.0), points_xy[:, 0] - hi[0])
    dy = np.maximum(np.maximum(lo[1] - points_xy[:, 1], 0.0), points_xy[:, 1] - hi[1])
    return float(np.sqrt(dx * dx + dy * dy).min())


def is_flat_ground_element(element: ElementGeometry) -> bool:
    """A ground-class element (``GROUND_ELEMENT_TYPES``) lying flat: its z extent is smaller than both plan extents."""
    if element.ifc_type not in GROUND_ELEMENT_TYPES:
        return False
    box = element.bbox
    if box is None:
        return False
    extent = box[1] - box[0]
    return bool(extent[2] < extent[0] and extent[2] < extent[1])


def band_candidates(elements: Sequence[ElementGeometry], *, ground_z: float, band_height_m: float = BAND_HEIGHT_M) -> list[ElementGeometry]:
    """Elements whose z-range meets the pedestrian band [ground, ground + band]: any class, doors included, except
    flat ground elements (``is_flat_ground_element``), which would otherwise take every slot of every zone."""
    lo_z, hi_z = float(ground_z), float(ground_z) + float(band_height_m)
    out = []
    for element in elements:
        box = element.bbox
        if box is None or is_flat_ground_element(element):
            continue
        if box[0][2] <= hi_z and box[1][2] >= lo_z:
            out.append(element)
    return out


def exceedance(
    plane: VtkSurface,
    threshold_u_m_s: float,
    elements: Sequence[ElementGeometry],
    *,
    ground_z: float = 0.0,
    band_height_m: float = BAND_HEIGHT_M,
    max_distance_m: float = MAX_DISTANCE_M,
    max_elements: int = MAX_ELEMENTS,
    min_area_m2: float = MIN_AREA_M2,
) -> tuple[ExceedanceZone, ...]:
    """Connected zones of polygons whose mean |U| exceeds the threshold, each attributed to its nearest elements.

    ``plane`` and ``elements`` must share one frame (the model frame; see ``load_direction_plane``). A zone is a
    set of over-threshold polygons connected through shared vertices; its centroid is the area-weighted mean of the
    polygon centroids and its peak the largest vertex |U| in it. Zones below ``min_area_m2`` are dropped. Zones are
    returned by descending peak.
    """
    if not threshold_u_m_s > 0:
        raise ValueError("threshold_u_m_s must be positive")
    velocity = plane.point_data.get("U")
    if velocity is None:
        raise ValueError("pedestrian plane has no U point data")
    points = np.asarray(plane.points, dtype=float)
    magnitude = np.linalg.norm(np.asarray(velocity, dtype=float), axis=1)
    polygons = [np.asarray(poly, dtype=int) for poly in plane.polygons if len(poly) >= 3]
    over = [poly for poly in polygons if magnitude[poly].mean() > threshold_u_m_s]
    if not over:
        return ()

    # Union-find over polygons that share a vertex.
    parent = list(range(len(over)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    first_polygon_of_vertex: dict[int, int] = {}
    for index, poly in enumerate(over):
        for vertex in poly.tolist():
            owner = first_polygon_of_vertex.setdefault(vertex, index)
            if owner != index:
                a, b = find(owner), find(index)
                if a != b:
                    parent[b] = a
    groups: dict[int, list[int]] = {}
    for index in range(len(over)):
        groups.setdefault(find(index), []).append(index)

    candidates = band_candidates(elements, ground_z=ground_z, band_height_m=band_height_m)
    zones: list[ExceedanceZone] = []
    for members in groups.values():
        polys = [over[i] for i in members]
        areas = polygon_areas(points, polys)
        area = float(areas.sum())
        if area < min_area_m2:
            continue
        centroids = np.array([points[poly][:, :2].mean(axis=0) for poly in polys])
        weights = areas if area > 0 else np.ones(len(polys))
        centroid = (centroids * weights[:, None]).sum(axis=0) / weights.sum()
        vertices = np.unique(np.concatenate(polys))
        zone_xy = points[vertices][:, :2]
        attributed: list[ZoneElement] = []
        for element in candidates:
            lo, hi = element.bbox  # type: ignore[misc]
            distance = _rect_distance(zone_xy, lo[:2], hi[:2])
            if distance <= max_distance_m:
                attributed.append(ZoneElement(ifc_guid=element.ifc_guid, ifc_type=element.ifc_type,
                                              usd_prim_path=element.prim_path, distance_m=round(distance, 3)))
        attributed.sort(key=lambda item: (item.distance_m, item.ifc_guid))
        zones.append(ExceedanceZone(
            area_m2=round(area, 3),
            centroid_xy=(round(float(centroid[0]), 3), round(float(centroid[1]), 3)),
            u_max=round(float(magnitude[vertices].max()), 4),
            polygons=len(polys),
            elements=tuple(attributed[:max_elements]),
        ))
    zones.sort(key=lambda zone: (-zone.u_max, -zone.area_m2))
    return tuple(zones)


def load_direction_plane(case_dir: Path) -> tuple[VtkSurface, dict]:
    """The sampled pedestrian plane of a solved case in the model frame, clipped like the authored layer.

    Returns the plane and the case metadata. The sample is written in the solver frame (wind along +X); the
    points and the velocity vectors are rotated back by ``-alpha`` after the same bbox ± 3H clip the layer uses,
    so zones and statistics describe what the reviewer sees in Kit.
    """
    from .case_run import latest_samples_dir
    from .usd_results import clip_surface_to_xy_box, plane_clip_box

    case_dir = Path(case_dir)
    meta = json.loads((case_dir / "case_meta.json").read_text(encoding="utf-8"))
    samples = latest_samples_dir(case_dir)
    if samples is None or not (samples / "pedestrian_1p5m.vtk").exists():
        raise FileNotFoundError(f"no pedestrian plane sampled under {case_dir}")
    plane = parse_legacy_vtk(samples / "pedestrian_1p5m.vtk")
    bbox = meta.get("building_bbox_solver_frame") or {}
    ground_z = float(meta["params"].get("ground_z_m", 0.0))
    if "min" in bbox and "max" in bbox:
        clipped = clip_surface_to_xy_box(plane, *plane_clip_box(bbox["min"], bbox["max"], ground_z=ground_z))
        if clipped.polygon_count:
            plane = clipped
    back = -float(meta["wind"]["solver_rotation_alpha_rad"])
    point_data = dict(plane.point_data)
    if "U" in point_data:
        point_data["U"] = rotate_z(np.asarray(point_data["U"], dtype=float), back)
    model_frame = VtkSurface(points=rotate_z(np.asarray(plane.points, dtype=float), back), polygons=list(plane.polygons),
                             lines=list(plane.lines), point_data=point_data, cell_data=dict(plane.cell_data))
    return model_frame, meta
