"""A visual region of interest, independent of the solver geometry and domain."""
from __future__ import annotations

import itertools

import numpy as np

from .wind import rotate_z

ENVELOPE_CLASSES = frozenset({"IfcWall", "IfcWallStandardCase", "IfcCurtainWall", "IfcRoof", "IfcColumn"})


def envelope_roi(elements) -> dict:
    """Use retained envelope elements; fall back to all retained geometry."""
    usable = [element for element in elements if element.triangle_count]
    selected = [element for element in usable if element.ifc_type in ENVELOPE_CLASSES]
    source = "ifc_envelope" if selected else "retained_geometry"
    selected = selected or usable
    if not selected:
        raise ValueError("visual ROI requires retained geometry")
    bounds = [element.bbox for element in selected]
    lo = np.min([pair[0] for pair in bounds], axis=0)
    hi = np.max([pair[1] for pair in bounds], axis=0)
    if not np.isfinite([lo, hi]).all() or np.any(hi <= lo):
        raise ValueError("visual ROI must have finite positive extents")
    return {"source": source, "min": lo.tolist(), "max": hi.tolist()}


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
