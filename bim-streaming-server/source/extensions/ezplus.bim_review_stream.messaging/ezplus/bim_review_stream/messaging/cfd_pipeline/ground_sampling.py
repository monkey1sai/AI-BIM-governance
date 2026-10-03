"""Bounded source-triangle positions only; no velocity, fluid or ground proof."""
from __future__ import annotations

from collections import Counter
import math
import re

import numpy as np

from .ground_surfaces import GroundFaceSelection, GroundSurfaceFace, _face_identity

MAX_POINTS = 10_000
MAX_FACES = 100
HEIGHT_M = 1.5


def _numbers(values, count):
    try:
        return (isinstance(values, (list, tuple)) and len(values) == count
                and all(isinstance(v, (int, float)) and not isinstance(v, bool)
                        and math.isfinite(v) for v in values))
    except (TypeError, OverflowError):
        return False


def ground_sample_grid(bounds_m, spacing_m):
    """Include xmin/ymin; include maxima only when reached by an integer step."""
    if (not _numbers(bounds_m, 4) or not _numbers([spacing_m], 1) or spacing_m <= 0):
        raise ValueError("invalid_grid")
    xmin, ymin, xmax, ymax = bounds_m
    if xmax < xmin or ymax < ymin:
        raise ValueError("invalid_grid")
    ratios = [(xmax - xmin) / spacing_m, (ymax - ymin) / spacing_m]
    if any(not math.isfinite(r) or r >= MAX_POINTS for r in ratios):
        raise ValueError("point_budget_exceeded")
    nx, ny = [math.floor(r) + 1 for r in ratios]
    if nx * ny > MAX_POINTS:
        raise ValueError("point_budget_exceeded")
    axes = []
    for low, high, n in ((xmin, xmax, nx), (ymin, ymax, ny)):
        values = [low + i * spacing_m for i in range(n) if low + i * spacing_m <= high]
        if any(b <= a or not math.isclose(b - a, spacing_m, rel_tol=1e-9, abs_tol=1e-9)
               for a, b in zip(values, values[1:])):
            raise ValueError("grid_precision_unsupported")
        axes.append(values)
    return [(x, y) for y in axes[1] for x in axes[0]]


def sample_ground_points(faces, expected_sha256, queries_xy_m):
    """Each requested XY needs exactly one hit, including shared boundaries.

    The caller must obtain faces through a fresh source read. Identity checks
    here detect stale/mutated objects, not coordinator approval or walkability.
    No extrapolation, snapping, terrain repair or previously solved fields.
    """
    if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("invalid_source_sha")
    if not isinstance(faces, (list, tuple)) or not 1 <= len(faces) <= MAX_FACES:
        raise ValueError("invalid_faces")
    if not isinstance(queries_xy_m, (list, tuple)) or not queries_xy_m:
        raise ValueError("invalid_queries")
    if len(queries_xy_m) > MAX_POINTS:
        raise ValueError("point_budget_exceeded")
    if not all(_numbers(p, 2) for p in queries_xy_m):
        raise ValueError("invalid_queries")
    prepared, seen = [], set()
    for face in sorted(faces, key=lambda f: f.face_id if isinstance(f, GroundSurfaceFace) else ""):
        if not isinstance(face, GroundSurfaceFace):
            raise ValueError("invalid_faces")
        if face.model_usdc_sha256 != expected_sha256:
            raise ValueError("source_sha_mismatch")
        if face.face_id in seen:
            raise ValueError("duplicate_face")
        seen.add(face.face_id)
        if (len(face.vertices_m) != 3 or not all(_numbers(p, 3) for p in face.vertices_m)
                or not _numbers(face.normal, 3) or face.normal[2] <= 0):
            raise ValueError("unsupported_xy_projection")
        identity = _face_identity(expected_sha256, GroundFaceSelection(
            face.ifc_guid, face.mesh_prim_path, face.polygon_face_index), face.vertices_m, face.normal)
        if identity != (face.geometry_sha256, face.face_id):
            raise ValueError("face_identity_mismatch")
        xyz = np.asarray(face.vertices_m, dtype=np.float64)
        ab, ac = xyz[1] - xyz[0], xyz[2] - xyz[0]
        denominator = float(ab[0] * ac[1] - ab[1] * ac[0])
        scale_m2 = max(float(np.dot(ab[:2], ab[:2])), float(np.dot(ac[:2], ac[:2])))
        # Relative conditioning plus a 1e-12 m² absolute projection floor.
        if (not math.isfinite(denominator) or not math.isfinite(scale_m2)
                or abs(denominator) <= max(1e-12, scale_m2 * 1e-12)):
            raise ValueError("unsupported_xy_projection")
        # Include cancellation in the two products and rounded edge subtraction.
        coordinate_error = 4 * max(math.ulp(float(t)) for t in xyz[:, :2].flat)
        denominator_error = (8 * math.ulp(1.0) * (abs(float(ab[0] * ac[1])) + abs(float(ab[1] * ac[0])))
                             + coordinate_error * sum(abs(float(t)) for t in (*ab[:2], *ac[:2]))
                             + 2 * coordinate_error * coordinate_error)
        if not math.isfinite(denominator_error) or denominator_error >= abs(denominator):
            raise ValueError("unsupported_xy_projection")
        prepared.append((face, xyz, ab, ac, denominator, denominator_error, coordinate_error))
    points = []
    rejected = Counter()
    for index, (x, y) in enumerate(queries_xy_m):
        hits = []
        numeric_failure = False
        for face, xyz, ab, ac, denominator, denominator_error, coordinate_error in prepared:
            dx, dy = x - float(xyz[0, 0]), y - float(xyz[0, 1])
            u = (dx * float(ac[1]) - dy * float(ac[0])) / denominator
            v = (float(ab[0]) * dy - float(ab[1]) * dx) / denominator
            w = 1.0 - u - v
            if not all(math.isfinite(t) for t in (u, v, w)):
                numeric_failure = True
                continue
            # Reject numerical edge uncertainty, never clamp outside weights.
            # Include possible edge hits in ambiguity detection so transformed
            # shared edges cannot accidentally select just one of their faces.
            xy_error = max(coordinate_error, 4 * max(math.ulp(float(t)) for t in (x, y)))
            errors_uv = []
            for weight, edge in ((u, ac), (v, ab)):
                numerator_error = (8 * math.ulp(1.0) * (abs(dx * float(edge[1])) + abs(dy * float(edge[0])))
                                   + xy_error * (abs(dx) + abs(dy) + abs(float(edge[0])) + abs(float(edge[1]))))
                error = (numerator_error + 2 * xy_error * xy_error + abs(weight) * denominator_error) / (abs(denominator) - denominator_error)
                errors_uv.append(max(1e-12, error))
            u_error, v_error = errors_uv
            errors = (u_error, v_error, u_error + v_error + 8 * math.ulp(1.0) * (1 + abs(u) + abs(v)))
            if not all(math.isfinite(error) for error in errors):
                numeric_failure = True
                continue
            if any(t < -error for t, error in zip((u, v, w), errors)):
                continue
            if any(t <= error for t, error in zip((u, v, w), errors)):
                hits.append((face.face_id, None))
                continue
            z = float(w * xyz[0, 2] + u * xyz[1, 2] + v * xyz[2, 2])
            hits.append((face.face_id, z))
        row = {"query_index": index, "xy_m": [x, y]}
        if numeric_failure:
            row["status"] = "precision_unsupported"
        elif not hits:
            row["status"] = "uncovered"
        elif len(hits) != 1:
            row.update(status="ambiguous", candidate_count=len(hits), candidate_face_ids=[h[0] for h in hits[:2]])
        else:
            face_id, z = hits[0]
            target = z + HEIGHT_M if z is not None else None
            if target is None or not math.isfinite(target) or abs((target - z) - HEIGHT_M) > 1e-9:
                row["status"] = "precision_unsupported"
            else:
                row.update(status="point_generated", face_id=face_id, ground_z_m=z, target_m=[x, y, target])
        if row["status"] != "point_generated":
            rejected[row["status"]] += 1
        points.append(row)
    return {"schema": "cfd-ground-sample-points/v1", "algorithm": "authored-triangle-vertical/v1",
            "coordinate_frame": "model_world_Z_up_metres", "model_usdc_sha256": expected_sha256,
            "source_faces": [{"face_id": face.face_id, "geometry_sha256": face.geometry_sha256} for face, *_ in prepared],
            "height_above_surface_m": HEIGHT_M, "display_lift_m": 0,
            "actual_ground_verified": False, "fluid_region_verified": False, "velocity_sampled": False,
            "query_count": len(points), "generated_count": len(points) - sum(rejected.values()),
            "rejected_by_reason": dict(sorted(rejected.items())), "points": points}
