"""Mesh-convergence study (contract S5b): the same wind direction on three background cell sizes.

Metrics are taken on the sampled pedestrian plane (|U| max, mean and 95th percentile inside the
building bbox + 3H box the overlay also uses) and on the building surface (p min / max). The
grid convergence index follows Celik et al. (2008, J. Fluids Eng. 130): apparent order ``p``
from the three solutions, Richardson extrapolation ``f_ext`` and ``GCI_fine`` with Fs = 1.25.
Cell size ``h`` is the background cell (the surface/region refinement levels are identical on
every level, so the whole mesh scales with it). Output: ``cfd-mesh-convergence/v1`` JSON and an
SVG curve per metric; no plotting dependency.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

SCHEMA = "cfd-mesh-convergence/v1"
SAFETY_FACTOR = 1.25
METRICS = ("U_max", "U_mean", "U_p95", "p_min", "p_max")


def compute_gci(h: list[float], f: list[float], *, safety_factor: float = SAFETY_FACTOR) -> dict:
    """Celik et al. (2008) three-grid procedure. ``h``/``f`` ordered fine → coarse (h1 < h2 < h3).

    Returns apparent order ``p``, extrapolated value ``f_ext``, relative errors and the fine-grid
    GCI. ``convergence`` is ``monotonic`` (0 < R < 1), ``oscillatory`` (R < 0), ``divergent``
    (R > 1) or ``exact`` (no change between grids); ``p`` is None unless monotonic.
    """
    if len(h) != 3 or len(f) != 3:
        raise ValueError("three grid levels are required")
    h1, h2, h3 = (float(v) for v in h)
    f1, f2, f3 = (float(v) for v in f)
    if not (0 < h1 < h2 < h3):
        raise ValueError("cell sizes must be ordered fine -> coarse (h1 < h2 < h3)")
    r21, r32 = h2 / h1, h3 / h2
    e21, e32 = f2 - f1, f3 - f2
    result: dict = {"h": [h1, h2, h3], "f": [f1, f2, f3], "r21": r21, "r32": r32, "e21": e21, "e32": e32,
                    "p": None, "f_ext": None, "e21_relative": None, "e_ext_relative": None, "gci_fine": None}
    if e21 == 0 and e32 == 0:
        result.update(convergence="exact", f_ext=f1, e21_relative=0.0, e_ext_relative=0.0, gci_fine=0.0)
        return result
    if e21 == 0 or e32 == 0:
        result["convergence"] = "oscillatory" if (e21 == 0) != (e32 == 0) else "exact"
        return result
    ratio = e21 / e32
    if ratio < 0:
        result["convergence"] = "oscillatory"
        return result
    if ratio >= 1:
        result["convergence"] = "divergent"
        return result
    result["convergence"] = "monotonic"
    # Fixed-point iteration for p (Celik eq. 3); s = sign(e32/e21) = +1 here.
    p = abs(math.log(abs(e32 / e21)) / math.log(r21))
    for _ in range(50):
        q = math.log((r21 ** p - 1.0) / (r32 ** p - 1.0)) if not math.isclose(r21, r32) else 0.0
        p_next = abs(math.log(abs(e32 / e21)) + q) / math.log(r21)
        if abs(p_next - p) < 1e-10:
            p = p_next
            break
        p = p_next
    f_ext = (r21 ** p * f1 - f2) / (r21 ** p - 1.0)
    e21_rel = abs((f1 - f2) / f1) if f1 else float("nan")
    e_ext_rel = abs((f_ext - f1) / f_ext) if f_ext else float("nan")
    gci = safety_factor * e21_rel / (r21 ** p - 1.0)
    result.update(p=p, f_ext=f_ext, e21_relative=e21_rel, e_ext_relative=e_ext_rel, gci_fine=gci)
    return result


def _polygon_areas(points: np.ndarray, polygons: list[np.ndarray]) -> np.ndarray:
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


def _weighted_percentile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    order = np.argsort(values)
    cumulative = np.cumsum(weights[order])
    return float(values[order][np.searchsorted(cumulative, q / 100.0 * cumulative[-1])])


def plane_metrics(plane, *, clip_box: tuple[float, float, float, float] | None = None) -> dict:
    """|U| statistics on the sampled pedestrian plane, optionally clipped to (xmin, xmax, ymin, ymax).

    The cutting plane is sampled at mesh cells, so its point density follows the refinement; the
    mean and the 95th percentile are therefore area-weighted over the plane polygons (a plain point
    average would just measure where the mesh is fine). The maximum stays a point value. Without
    polygons the metrics fall back to unweighted point statistics and say so.
    """
    velocity = plane.point_data.get("U")
    if velocity is None:
        raise ValueError("pedestrian plane has no U point data")
    points = np.asarray(plane.points, dtype=float)
    magnitude = np.linalg.norm(np.asarray(velocity, dtype=float), axis=1)
    inside = np.ones(points.shape[0], dtype=bool)
    if clip_box is not None:
        xmin, xmax, ymin, ymax = clip_box
        candidate = (points[:, 0] >= xmin) & (points[:, 0] <= xmax) & (points[:, 1] >= ymin) & (points[:, 1] <= ymax)
        if candidate.any():
            inside = candidate
    polygons = [np.asarray(poly, dtype=int) for poly in (getattr(plane, "polygons", None) or []) if len(poly) >= 3]
    kept_polys = [poly for poly in polygons if inside[poly].all()]
    if kept_polys:
        areas = _polygon_areas(points, kept_polys)
        poly_values = np.array([magnitude[poly].mean() for poly in kept_polys])
        total = float(areas.sum())
        return {"U_max": float(magnitude[inside].max()), "U_mean": float((poly_values * areas).sum() / total),
                "U_p95": _weighted_percentile(poly_values, areas, 95.0), "points": int(inside.sum()),
                "polygons": len(kept_polys), "area_m2": total, "weighting": "area"}
    sample = magnitude[inside]
    return {"U_max": float(sample.max()), "U_mean": float(sample.mean()), "U_p95": float(np.percentile(sample, 95)),
            "points": int(sample.size), "polygons": 0, "area_m2": None, "weighting": "points"}


def surface_pressure_metrics(surface) -> dict:
    """Patch samples carry p as cell data (one value per face); point data is accepted as a fallback."""
    if surface is None:
        return {"p_min": None, "p_max": None}
    pressure = surface.cell_data.get("p") if getattr(surface, "cell_data", None) else None
    if pressure is None:
        pressure = surface.point_data.get("p")
    if pressure is None:
        return {"p_min": None, "p_max": None}
    values = np.asarray(pressure, dtype=float)
    return {"p_min": float(values.min()), "p_max": float(values.max())}


def build_convergence_document(*, run_id: str, wind_from_degrees: float, levels: list[dict], operator: str,
                               safety_factor: float = SAFETY_FACTOR) -> dict:
    """``levels``: one entry per grid, any order, each with ``background_cell_m``, ``metrics`` (METRICS keys),
    ``mesh_cells``, ``iterations``, ``converged_by_residual_control``, ``end_time_extended_to``, ``elapsed_seconds``."""
    ordered = sorted(levels, key=lambda item: float(item["background_cell_m"]))  # fine -> coarse
    if len(ordered) != 3:
        raise ValueError("a mesh-convergence study needs exactly three grid levels")
    h = [float(item["background_cell_m"]) for item in ordered]
    gci = {}
    for metric in METRICS:
        values = [item["metrics"].get(metric) for item in ordered]
        if any(value is None for value in values):
            gci[metric] = None
            continue
        gci[metric] = compute_gci(h, values, safety_factor=safety_factor)
    monotonic = [m for m in METRICS if gci.get(m) and gci[m]["convergence"] == "monotonic"]
    worst = max((gci[m]["gci_fine"] for m in monotonic), default=None)
    verdict = {
        "fine_grid_gci_max": worst,
        "metrics_monotonic": monotonic,
        "metrics_not_monotonic": [m for m in METRICS if gci.get(m) and gci[m]["convergence"] != "monotonic"],
        # Design-comparison bar (owner D4): fine-grid uncertainty of the pedestrian metrics within 5 %.
        "pedestrian_within_5pct": all(gci.get(m) and gci[m]["convergence"] == "monotonic" and gci[m]["gci_fine"] is not None
                                      and gci[m]["gci_fine"] <= 0.05 for m in ("U_max", "U_mean")),
    }
    return {
        "schema": SCHEMA,
        "run_id": run_id,
        "created_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "operator": operator,
        "purpose": "design_comparison_only",
        "method": "Celik et al. 2008 three-grid GCI on background cell size; identical refinement levels per grid",
        "safety_factor": safety_factor,
        "wind_from_degrees": float(wind_from_degrees),
        "levels": ordered,
        "gci": gci,
        "verdict": verdict,
    }


def render_convergence_svg(document: dict, *, width: int = 720, height: int = 420) -> str:
    """One panel per metric: value vs background cell size (log-x), Richardson extrapolation as a dashed line."""
    metrics = [m for m in METRICS if document["gci"].get(m)]
    if not metrics:
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><text x="10" y="20">no metrics</text></svg>'
    cols = min(3, len(metrics))
    rows = math.ceil(len(metrics) / cols)
    pw, ph = width / cols, height / rows
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" font-family="sans-serif" font-size="11">',
             f'<rect width="{width}" height="{height}" fill="white"/>']
    for index, metric in enumerate(metrics):
        g = document["gci"][metric]
        ox, oy = (index % cols) * pw, (index // cols) * ph
        left, right, top, bottom = ox + 48, ox + pw - 12, oy + 24, oy + ph - 30
        xs = [math.log(v) for v in g["h"]]
        ys = list(g["f"]) + ([g["f_ext"]] if g.get("f_ext") is not None else [])
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        if math.isclose(y0, y1):
            y0, y1 = y0 - 1.0, y1 + 1.0
        pad = 0.08 * (y1 - y0)
        y0, y1 = y0 - pad, y1 + pad

        def sx(v: float) -> float:
            return left + (math.log(v) - x0) / (x1 - x0) * (right - left) if x1 > x0 else left

        def sy(v: float) -> float:
            return bottom - (v - y0) / (y1 - y0) * (bottom - top)

        parts.append(f'<text x="{left}" y="{oy + 14}" font-weight="bold">{metric}  ({g["convergence"]}'
                     + (f', GCI_fine {g["gci_fine"] * 100:.1f} %' if g.get("gci_fine") is not None else "") + ")</text>")
        parts.append(f'<line x1="{left}" y1="{bottom}" x2="{right}" y2="{bottom}" stroke="#444"/>'
                     f'<line x1="{left}" y1="{top}" x2="{left}" y2="{bottom}" stroke="#444"/>')
        pts = " ".join(f"{sx(h):.1f},{sy(f):.1f}" for h, f in zip(g["h"], g["f"]))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="#1f77b4" stroke-width="2"/>')
        for h, f in zip(g["h"], g["f"]):
            parts.append(f'<circle cx="{sx(h):.1f}" cy="{sy(f):.1f}" r="3.5" fill="#1f77b4"/>'
                         f'<text x="{sx(h):.1f}" y="{bottom + 14}" text-anchor="middle">{h:g} m</text>'
                         f'<text x="{sx(h) + 5:.1f}" y="{sy(f) - 6:.1f}">{f:.3g}</text>')
        if g.get("f_ext") is not None:
            parts.append(f'<line x1="{left}" y1="{sy(g["f_ext"]):.1f}" x2="{right}" y2="{sy(g["f_ext"]):.1f}" stroke="#d62728" stroke-dasharray="4 3"/>'
                         f'<text x="{right}" y="{sy(g["f_ext"]) - 4:.1f}" text-anchor="end" fill="#d62728">f_ext {g["f_ext"]:.3g}</text>')
        parts.append(f'<text x="{(left + right) / 2:.1f}" y="{bottom + 26}" text-anchor="middle" fill="#666">background cell (log)</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def write_convergence_outputs(document: dict, out_dir: Path) -> dict[str, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "mesh_convergence.json"
    svg_path = out_dir / "mesh_convergence.svg"
    json_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    svg_path.write_text(render_convergence_svg(document), encoding="utf-8")
    return {"json": json_path, "svg": svg_path}
