"""A visual region of interest, independent of the solver geometry and domain."""
from __future__ import annotations

import itertools

import numpy as np

from .wind import rotate_z

ENVELOPE_CLASSES = frozenset({"IfcWall", "IfcWallStandardCase", "IfcCurtainWall", "IfcRoof", "IfcColumn"})


def envelope_roi(elements) -> dict | None:
    """Prefer envelope bounds; omit optional ROI when all geometry is planar."""
    usable = [element for element in elements if element.triangle_count]
    selected = [element for element in usable if element.ifc_type in ENVELOPE_CLASSES]
    for source, candidates in (("ifc_envelope", selected), ("retained_geometry", usable)):
        if not candidates:
            continue
        bounds = [element.bbox for element in candidates]
        lo = np.min([pair[0] for pair in bounds], axis=0)
        hi = np.max([pair[1] for pair in bounds], axis=0)
        if not np.isfinite([lo, hi]).all():
            raise ValueError("visual ROI must have finite extents")
        if np.all(hi > lo):
            return {"source": source, "min": lo.tolist(), "max": hi.tolist()}
    return None


def solver_roi(roi: dict, alpha: float, full_bbox, ground_z: float) -> dict:
    """Rotate all eight corners, clamp to the physical shell, retain provenance."""
    lo, hi = np.asarray(roi["min"], dtype=float), np.asarray(roi["max"], dtype=float)
    if lo.shape != (3,) or hi.shape != (3,) or not np.isfinite([lo, hi]).all() or np.any(hi <= lo):
        raise ValueError("visual ROI must have finite positive extents")
    if roi["source"] not in {"ifc_envelope", "retained_geometry"} or not np.isfinite(alpha):
        raise ValueError("invalid visual ROI source or rotation")
    corners = np.array(list(itertools.product(*zip(lo, hi))))
    rotated = rotate_z(corners, alpha)
    low = np.maximum(rotated.min(axis=0), full_bbox[0])
    high = np.minimum(rotated.max(axis=0), full_bbox[1])
    if np.any(high <= low) or high[2] <= ground_z:
        raise ValueError("visual ROI does not overlap the above-ground computation shell")
    return {"source": roi["source"], "min": low.tolist(), "max": high.tolist()}
