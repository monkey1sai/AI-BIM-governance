"""Record calculation coordinates; never certify an IFC walkable surface."""
from __future__ import annotations

import math
import numpy as np


def calculation_ground_reference(ground_z: float, points, vector_lift: float | None) -> dict:
    ground = float(ground_z)
    if not math.isfinite(ground):
        raise ValueError('calculation ground must be finite')
    if vector_lift is not None and (not math.isfinite(vector_lift) or vector_lift < 0):
        raise ValueError('vector display lift must be finite and nonnegative')
    elevation = None
    if points is not None:
        values = np.asarray(points, dtype=float)
        if values.ndim == 2 and values.shape[1] == 3 and len(values) and np.isfinite(values).all():
            z = values[:, 2]
            # This is a flat sampled plane, not a fit to terrain. Nonplanar data stays unknown.
            if float(np.ptp(z)) <= 1e-6:
                elevation = float(z[0])
    return {'schema': 'cfd-ground-reference/v1', 'reference': 'assumed_flat_plane',
            'units': 'm', 'up_axis': 'Z', 'ground_z_m': ground,
            'sampling_plane_z_m': elevation,
            'height_above_calculation_ground_m': None if elevation is None else elevation - ground,
            'actual_ground_verified': False, 'vector_display_lift_m': vector_lift}
