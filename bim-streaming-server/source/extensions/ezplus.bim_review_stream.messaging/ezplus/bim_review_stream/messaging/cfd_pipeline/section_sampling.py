"""Model-axis CFD sections; sampling never changes the solver domain or mesh."""
from __future__ import annotations

import itertools
import math

import numpy as np

from .wind import rotate_z


def validate_requested_sections(value) -> list[dict]:
    if not isinstance(value, list) or len(value) > 8:
        raise ValueError("sampling.sections must be an array of at most 8 planes")
    result = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"axis", "position_m"}:
            raise ValueError("each sampling section requires only axis and position_m")
        axis, position = item["axis"], item["position_m"]
        if axis not in ("x", "y", "z") or isinstance(position, bool) or not isinstance(position, (int, float)):
            raise ValueError("section axis must be x/y/z and position_m must be a number")
        if not math.isfinite(position) or abs(position) > 1e9:
            raise ValueError("section position_m must be finite and within +/-1e9 m")
        result.append({"axis": axis, "position_m": float(position)})
    return result


def domain_model_bounds(domain, alpha: float) -> tuple[np.ndarray, np.ndarray]:
    # Use precisely the six-significant-digit coordinates written to blockMesh.
    corners = np.array(list(itertools.product(
        [domain.xmin, domain.xmax], [domain.ymin, domain.ymax], [domain.zmin, domain.zmax])))
    corners = np.array([[float(f"{v:.6g}") for v in row] for row in corners])
    points = rotate_z(corners, -alpha)
    return points.min(axis=0), points.max(axis=0)


def check_section_domain(sections: list[dict], domain, alpha: float) -> None:
    lo, hi = domain_model_bounds(domain, alpha)
    for item in sections:
        i = "xyz".index(item["axis"])
        if not lo[i] <= item["position_m"] <= hi[i]:
            raise ValueError(f"section {item['axis']}={item['position_m']:g} m is outside the computational domain")


def footprint_centroid(footprint) -> tuple[float, float]:
    points = np.asarray(footprint, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 3 or not np.isfinite(points).all():
        raise ValueError("sections require a finite building footprint polygon")
    following = np.roll(points, -1, axis=0)
    cross = points[:, 0] * following[:, 1] - following[:, 0] * points[:, 1]
    twice_area = float(cross.sum())
    if abs(twice_area) < 1e-12:
        raise ValueError("sections require a non-degenerate building footprint")
    centroid = ((points + following) * cross[:, None]).sum(axis=0) / (3 * twice_area)
    return float(centroid[0]), float(centroid[1])


def plan_sections(*, footprint, height: float, ground: float, requested, domain, alpha: float) -> list[dict]:
    custom = validate_requested_sections(requested)
    cx, cy = footprint_centroid(footprint)
    standard = [(f"z{int(fraction * 100)}", "z", ground + fraction * height, f"Z {fraction:g}H")
                for fraction in (.25, .5, .75)]
    standard += [("x_centroid", "x", cx, "X centroid"), ("y_centroid", "y", cy, "Y centroid")]
    result = [{"id": key, "axis": axis, "position_m": position, "label": label, "source": "standard"}
              for key, axis, position, label in standard]
    result += [{"id": f"custom_{i + 1}", **item, "label": f"{item['axis'].upper()} {item['position_m']:g} m",
                "source": "requested"} for i, item in enumerate(custom)]
    check_section_domain(result, domain, alpha)
    return result


def foam_section_surfaces(sections, alpha: float) -> str:
    text = ""
    for item in sections:
        i = "xyz".index(item["axis"])
        point, normal = np.zeros(3), np.zeros(3)
        point[i], normal[i] = item["position_m"], 1.0
        point, normal = rotate_z(np.array([point, normal]), alpha)
        vector = lambda values: "(" + " ".join(f"{v:.12g}" for v in values) + ")"
        text += f"""
            section_{item['id']}
            {{
                type            cuttingPlane;
                planeType       pointAndNormal;
                pointAndNormalDict
                {{
                    point   {vector(point)};
                    normal  {vector(normal)};
                }}
                interpolate     true;
            }}"""
    return text
