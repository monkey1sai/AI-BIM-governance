"""CP9b massing geometry in model metres; no preprocessing, mesh or persistent writes.

Identity remains binary64; geometry uses binary32, the shared USD mesh/STL vertex
representation. The rounding error is exposed and collapsed cuboids are refused.
"""
from __future__ import annotations

import hashlib
import math
import struct
from pathlib import Path

import numpy as np

from cfd_context import validate_context

FACES = np.array([[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1],
                  [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]], dtype=np.int64)


class ContextGeometryError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def context_geometry(context: dict, model_usdc: Path) -> dict:
    """Validate the actual source frame, then retain every sorted manual cuboid.

    Converted IFC stages are Z-up. Y-up identity drafts remain valid, but the
    existing solver's Z-up contract cannot consume them; fail rather than rotate
    only the neighbors or mislabel the main geometry.
    """
    context = validate_context(context)
    try:
        from pxr import Usd, UsdGeom
        stage = Usd.Stage.Open(str(model_usdc))
        if stage is None:
            raise ValueError("stage unavailable")
        up_axis = str(UsdGeom.GetStageUpAxis(stage))
        scale = float(UsdGeom.GetStageMetersPerUnit(stage))
        if up_axis not in ("Y", "Z") or not math.isfinite(scale) or scale <= 0:
            raise ValueError("invalid stage frame")
    except Exception as exc:
        raise ContextGeometryError("context_frame_unavailable", "Cannot verify the model stage frame; no context estimate was produced.") from exc
    if context["frame"]["up_axis"] != up_axis:
        raise ContextGeometryError("context_frame_mismatch", "Context up_axis does not match the actual model stage.")
    if up_axis != "Z":
        raise ContextGeometryError("context_frame_not_supported", "The current solver geometry requires a Z-up model; Y-up context estimation is unavailable.")

    masses = []
    maximum_error = 0.0
    digest = hashlib.sha256(b"cfd-context-geometry/v1\x00Z\x00binary32\x00")
    for mass in context["masses"]:
        length, width, height = mass["dimensions_m"]
        local = np.array([[x, y, z] for x in (-length/2, length/2) for y in (-width/2, width/2) for z in (0, height)], dtype=np.float64)
        angle = mass["rotation_degrees"]
        if angle in (0, 90, 180, 270):
            cosine, sine = [(1, 0), (0, 1), (-1, 0), (0, -1)][int(angle/90)]
        else:
            cosine, sine = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        rotation = np.array([[cosine, -sine, 0], [sine, cosine, 0], [0, 0, 1]])
        precise = local @ rotation.T + np.array(mass["position_m"])
        vertices = precise.astype(np.float32).astype(np.float64)
        vertices[vertices == 0] = 0  # canonical positive zero
        triangles = vertices[FACES]
        normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        outward = np.einsum("ij,ij->i", normals, triangles.mean(axis=1) - vertices.mean(axis=0))
        if not np.all(np.isfinite(vertices)) or not np.all(outward > 0):
            raise ContextGeometryError("context_geometry_unrepresentable", f"Mass {mass['id']} cannot be represented as a noncollapsed binary32 cuboid at its coordinates.")
        error = float(np.max(np.abs(vertices - precise)))
        maximum_error = max(maximum_error, error)
        mass_id = mass["id"].encode("ascii")
        digest.update(struct.pack(">I", len(mass_id)) + mass_id)
        digest.update(vertices.astype(">f4").tobytes())
        digest.update(FACES.astype(">u4").tobytes())
        masses.append({"id": mass["id"], "vertices_m": vertices.tolist(), "faces": FACES.tolist(), "max_rounding_error_m": error})
    points = np.concatenate([np.array(m["vertices_m"]) for m in masses]) if masses else None
    return {"schema": "cfd-context-geometry/v1", "canonical_sha256": context["canonical_sha256"],
            "model_usdc_sha256": context["source"]["model_usdc_sha256"], "geometry_sha256": digest.hexdigest(),
            "source_frame": {"up_axis": up_axis, "meters_per_unit": scale}, "units": "m", "precision": "binary32",
            "mass_count": len(masses), "masses": masses, "max_rounding_error_m": maximum_error,
            "bbox_m": {"min": points.min(axis=0).tolist(), "max": points.max(axis=0).tolist()} if points is not None else None,
            "solver_submission_enabled": False,
            "limitations": ["Geometry/identity and common-domain estimate only; no mesh or solver result.",
                            "Cuboids are solid approximations; openings, intersections, terrain and ground compatibility are not validated.",
                            "Context masses bypass main-model class/outlier/largest-shell filtering; none are removed.",
                            "Source frame is verified; coordinates are already metres and are not scaled by stage metersPerUnit again."]}
