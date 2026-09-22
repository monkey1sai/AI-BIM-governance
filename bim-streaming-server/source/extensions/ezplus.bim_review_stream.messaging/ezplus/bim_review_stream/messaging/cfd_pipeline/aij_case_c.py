"""AIJ UWE benchmark Case C (blocks) for validating the pipeline against wind-tunnel data (contract S5b-2).

Dataset: Nonomura et al., "Wind Tunnel Experiment for Flow within Simple Building Blocks",
Zenodo 10.5281/zenodo.15401792 (CC BY 4.0). 3×3 array of D = 0.2 m cubes, block pitch 2D
(0.4 m), streets 1D wide; the centre block is 0D (absent), 1D or 2D high. Scalar wind speed
``Vs`` measured at z/D = 0.1 on a 0.05 m grid for wind directions 0°, 22.5°, 45°. The approach
flow profile is ``AF_caseC.csv`` (z, U, u_rms).

Geometry scaling: the pipeline samples the pedestrian plane at 1.5 m and works in metres, so the
model is scaled by ``scale`` (default 75: D = 15 m, hence 1.5 m = 0.1D exactly). Velocities are
compared as ratios to the approach-flow speed at the measurement height, which is what the AIJ
guideline compares; Reynolds-number independence of the sharp-edged blocks is assumed and listed
as a limitation. The measurement CSVs are read from a local directory and are never committed.
"""

from __future__ import annotations

import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

SCHEMA = "cfd-aij-case-c-comparison/v1"
DATASET = {
    "title": "AIJ UWE Benchmark Dataset – Case C (Blocks): Wind Tunnel Experiment for Flow within Simple Building Blocks",
    "doi": "10.5281/zenodo.15401792",
    "license": "CC BY 4.0",
    "citation": "Nonomura, Kobayashi, Tominaga, Mochida (2003), JAWE 95, 83-84; Tominaga et al. (2008) JWEIA 96, 1749-1761",
}
BLOCK_D_M = 0.2
BLOCK_PITCH_M = 0.4
CENTER_HEIGHTS = {"0D": 0.0, "1D": 1.0, "2D": 2.0}
MEASUREMENT_Z_OVER_D = 0.1
KAPPA = 0.41
# Hit-rate acceptance (COST 732 / VDI 3783-9, as used in the AIJ cross-comparisons): relative deviation 25 %
# or absolute 0.05 on normalised speed, q >= 0.66. The AIJ guideline itself sets no hit-rate threshold.
HIT_RATE_RELATIVE = 0.25
HIT_RATE_ABSOLUTE = 0.05
HIT_RATE_TARGET = 0.66
HIT_RATE_TARGET_SOURCE = "COST 732 / VDI 3783 Part 9 (q >= 0.66, D 0.25, W 0.05)"


def block_footprints(center_config: str) -> list[dict]:
    """Nine cubes in model metres (x, y centre; half size; height); centre block per ``center_config``."""
    if center_config not in CENTER_HEIGHTS:
        raise ValueError(f"center_config must be one of {sorted(CENTER_HEIGHTS)}: {center_config!r}")
    blocks = []
    for iy in (-1, 0, 1):
        for ix in (-1, 0, 1):
            height = BLOCK_D_M * (CENTER_HEIGHTS[center_config] if (ix, iy) == (0, 0) else 1.0)
            if height <= 0:
                continue
            blocks.append({"cx": ix * BLOCK_PITCH_M, "cy": iy * BLOCK_PITCH_M, "half": BLOCK_D_M / 2.0, "height": height})
    return blocks


def _box_triangles(xmin, xmax, ymin, ymax, zmin, zmax) -> np.ndarray:
    v = np.array([[xmin, ymin, zmin], [xmax, ymin, zmin], [xmax, ymax, zmin], [xmin, ymax, zmin],
                  [xmin, ymin, zmax], [xmax, ymin, zmax], [xmax, ymax, zmax], [xmin, ymax, zmax]], dtype=float)
    faces = [(0, 2, 1), (0, 3, 2),  # bottom (outward -z)
             (4, 5, 6), (4, 6, 7),  # top
             (0, 1, 5), (0, 5, 4),  # -y
             (1, 2, 6), (1, 6, 5),  # +x
             (2, 3, 7), (2, 7, 6),  # +y
             (3, 0, 4), (3, 4, 7)]  # -x
    return v[np.array(faces)]


def blocks_triangles(center_config: str, *, scale: float) -> np.ndarray:
    """(n, 3, 3) outward-facing triangles of all blocks, scaled to pipeline metres, ground at z = 0."""
    if scale <= 0:
        raise ValueError("scale must be positive")
    tris = [_box_triangles((b["cx"] - b["half"]) * scale, (b["cx"] + b["half"]) * scale,
                           (b["cy"] - b["half"]) * scale, (b["cy"] + b["half"]) * scale, 0.0, b["height"] * scale)
            for b in block_footprints(center_config)]
    return np.concatenate(tris, axis=0)


def write_blocks_stl(path: Path, center_config: str, *, scale: float) -> dict:
    from .stl import write_binary_stl

    tris = blocks_triangles(center_config, scale=scale)
    vertices = tris.reshape(-1, 3)
    faces = np.arange(vertices.shape[0]).reshape(-1, 3)
    write_binary_stl(Path(path), vertices, faces, solid_name="aij_case_c")
    return {"triangles": int(tris.shape[0]), "blocks": len(block_footprints(center_config)), "scale": float(scale),
            "bbox_min": [float(v) for v in vertices.min(axis=0)], "bbox_max": [float(v) for v in vertices.max(axis=0)]}


def read_approach_flow(path: Path) -> list[tuple[float, float, float]]:
    rows = []
    for row in csv.DictReader(Path(path).read_text(encoding="utf-8-sig").splitlines()):
        z = float(row["z (m)"])
        rows.append((z, float(row["U (m/s)"]), float(row.get("u_rms (m/s)", "nan") or "nan")))
    if not rows:
        raise ValueError("approach flow file has no rows")
    return sorted(rows)


def interpolate_profile(profile: list[tuple[float, float, float]], z: float) -> float:
    zs = np.array([p[0] for p in profile])
    us = np.array([p[1] for p in profile])
    return float(np.interp(z, zs, us))


def fit_log_law(profile: list[tuple[float, float, float]], *, z_max: float | None = None) -> dict:
    """Least-squares log law U = (u*/κ) ln(z / z0) on the lower profile; returns u*, z0 and the fit error."""
    pts = [(z, u) for z, u, _ in profile if z > 0 and (z_max is None or z <= z_max)]
    if len(pts) < 3:
        raise ValueError("need at least three profile points for the log-law fit")
    z = np.array([p[0] for p in pts])
    u = np.array([p[1] for p in pts])
    slope, intercept = np.polyfit(np.log(z), u, 1)  # U = slope ln z + intercept
    if slope <= 0:
        raise ValueError("approach flow does not increase with height; log law not applicable")
    u_star = slope * KAPPA
    z0 = math.exp(-intercept / slope)
    fitted = slope * np.log(z) + intercept
    return {"u_star_m_s": float(u_star), "z0_m": float(z0), "rmse_m_s": float(np.sqrt(np.mean((fitted - u) ** 2))), "points": len(pts)}


def inflow_case_params(profile: list[tuple[float, float, float]], *, scale: float, zref_model_m: float = 0.2) -> dict:
    """Pipeline inflow parameters (uref at zref, z0) from the wind-tunnel profile, scaled to metres."""
    fit = fit_log_law(profile, z_max=3.0 * BLOCK_D_M)
    return {"uref_m_s": interpolate_profile(profile, zref_model_m), "zref_m": zref_model_m * scale, "z0_m": fit["z0_m"] * scale,
            "log_law_fit": {**fit, "note": "least-squares fit of the wind-tunnel approach flow; u_star here is the fit's, not the inlet's "
                                           "(the inlet u* follows from Uref at Zref and z0 in ABLConditions)"},
            "u_ref_measurement_height_m_s": interpolate_profile(profile, MEASUREMENT_Z_OVER_D * BLOCK_D_M)}


def read_measurements(path: Path, *, wind_direction: float, center_config: str) -> list[dict]:
    rows = []
    for row in csv.DictReader(Path(path).read_text(encoding="utf-8-sig").splitlines()):
        if float(row["WD (deg.)"]) != float(wind_direction) or row["CB"] != center_config:
            continue
        rows.append({"id": int(float(row["No."])), "x_m": float(row["x (m)"]), "y_m": float(row["y (m)"]),
                     "z_m": float(row["z (m)"]), "Vs_m_s": float(row["Vs (m/s)"])})
    if not rows:
        raise ValueError(f"no measurements for WD={wind_direction} CB={center_config}")
    return sorted(rows, key=lambda r: r["id"])


def sample_plane_speed(plane, xy: np.ndarray, *, k: int = 4) -> np.ndarray:
    """|U| at the given XY positions from the sampled cutting plane (inverse-distance over the k nearest points)."""
    points = np.asarray(plane.points, dtype=float)[:, :2]
    speed = np.linalg.norm(np.asarray(plane.point_data["U"], dtype=float), axis=1)
    out = np.empty(xy.shape[0])
    for index, target in enumerate(np.asarray(xy, dtype=float)):
        d2 = ((points - target) ** 2).sum(axis=1)
        nearest = np.argpartition(d2, min(k, d2.size - 1))[:k]
        w = 1.0 / np.maximum(d2[nearest], 1e-12)
        out[index] = float((speed[nearest] * w).sum() / w.sum())
    return out


def validation_metrics(measured: np.ndarray, predicted: np.ndarray) -> dict:
    """AIJ-style metrics on normalised speeds: hit rate q, FAC2, R, FB, NMSE, RMSE."""
    m = np.asarray(measured, dtype=float)
    p = np.asarray(predicted, dtype=float)
    if m.shape != p.shape or m.size == 0:
        raise ValueError("measured and predicted must be equal-length, non-empty")
    diff = p - m
    hit = np.abs(diff) <= np.maximum(HIT_RATE_RELATIVE * np.abs(m), HIT_RATE_ABSOLUTE)
    valid = m > 0
    ratio = p[valid] / m[valid]
    fac2 = float(np.mean((ratio >= 0.5) & (ratio <= 2.0))) if valid.any() else float("nan")
    corr = float(np.corrcoef(m, p)[0, 1]) if m.std() > 0 and p.std() > 0 else float("nan")
    mean_m, mean_p = float(m.mean()), float(p.mean())
    return {"n": int(m.size), "n_fac2_valid": int(valid.sum()), "hit_rate": float(hit.mean()), "fac2": float(fac2), "correlation_r": corr,
            "fractional_bias": float(2.0 * (mean_m - mean_p) / (mean_m + mean_p)) if (mean_m + mean_p) else float("nan"),
            "nmse": float(np.mean(diff ** 2) / (mean_m * mean_p)) if mean_m * mean_p else float("nan"),
            "rmse": float(np.sqrt(np.mean(diff ** 2))), "mean_measured": mean_m, "mean_predicted": mean_p,
            "acceptance": {"hit_rate_relative": HIT_RATE_RELATIVE, "hit_rate_absolute": HIT_RATE_ABSOLUTE,
                           "hit_rate_target": HIT_RATE_TARGET, "hit_rate_target_source": HIT_RATE_TARGET_SOURCE}}


def build_comparison_document(*, run_id: str, operator: str, wind_direction: float, center_config: str, scale: float,
                              inflow: dict, measurements: list[dict], predicted_speed: np.ndarray, cfd_reference_speed: float,
                              case_summary: dict) -> dict:
    measured_ratio = np.array([r["Vs_m_s"] for r in measurements]) / float(inflow["u_ref_measurement_height_m_s"])
    predicted_ratio = np.asarray(predicted_speed, dtype=float) / float(cfd_reference_speed)
    points = [{**r, "measured_ratio": float(mr), "cfd_speed_m_s": float(ps), "cfd_ratio": float(pr),
               "hit": bool(abs(pr - mr) <= max(HIT_RATE_RELATIVE * abs(mr), HIT_RATE_ABSOLUTE))}
              for r, mr, ps, pr in zip(measurements, measured_ratio, predicted_speed, predicted_ratio)]
    return {
        "schema": SCHEMA,
        "run_id": run_id,
        "created_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "operator": operator,
        "purpose": "pipeline_validation_only",
        "dataset": DATASET,
        "case": {"wind_direction_deg": float(wind_direction), "center_config": center_config, "block_d_m": BLOCK_D_M,
                 "block_pitch_m": BLOCK_PITCH_M, "measurement_z_over_d": MEASUREMENT_Z_OVER_D, "scale": float(scale),
                 "pedestrian_plane_m": 1.5},
        "inflow": inflow,
        "normalisation": {"measured_by": "approach-flow U at z = 0.1D from AF_caseC.csv", "cfd_by": "inlet |U| at the pedestrian plane height",
                          "cfd_reference_speed_m_s": float(cfd_reference_speed)},
        "metrics": validation_metrics(measured_ratio, predicted_ratio),
        "points": points,
        "case_summary": case_summary,
        "limitations": [
            "Normalisation bases differ in kind: the measurement uses the wind-tunnel approach flow at the model position (AF at z = 0.1D), "
            "the CFD uses the inlet log law at 1.5 m (5H upstream of the array, before the profile develops over the rough ground); "
            "with this run the inlet value is 4.5 % below AF(0.1D), so normalising the CFD by the AF value instead would lower every "
            "cfd_ratio by the same 4.5 % and raise FB. An upstream probe or an empty-domain run would give a second reference.",
            "Inlet turbulence follows atmBoundaryLayerInletK/Omega from (Uref, Zref, z0); the measured u_rms profile is read but not imposed.",
            "Geometry scaled to full scale (D = 0.2 m x scale) so the pipeline's fixed 1.5 m plane equals 0.1D; Reynolds independence assumed.",
            "Steady RANS k-omega SST with the pipeline's default wall treatment; the wind tunnel measured a 30 s scalar mean with a thermistor.",
            "Only the requested wind direction and centre-block configuration were compared.",
        ],
    }


def render_scatter_svg(document: dict, *, size: int = 520) -> str:
    pts = document["points"]
    if not pts:
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}"><text x="10" y="20">no points</text></svg>'
    vmax = max(max(p["measured_ratio"], p["cfd_ratio"]) for p in pts) * 1.1 or 1.0
    left, bottom, span = 56, size - 48, size - 56 - 24

    def sx(v):
        return left + v / vmax * span

    def sy(v):
        return bottom - v / vmax * span

    m = document["metrics"]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" font-family="sans-serif" font-size="11">',
             f'<rect width="{size}" height="{size}" fill="white"/>',
             f'<text x="{left}" y="16" font-weight="bold">AIJ Case C {document["case"]["center_config"]} WD {document["case"]["wind_direction_deg"]:g}°: '
             f'hit rate {m["hit_rate"] * 100:.0f} %, FAC2 {m["fac2"] * 100:.0f} %, R {m["correlation_r"]:.2f}, FB {m["fractional_bias"]:+.2f}</text>',
             f'<line x1="{left}" y1="{bottom}" x2="{left + span}" y2="{bottom}" stroke="#444"/><line x1="{left}" y1="{bottom}" x2="{left}" y2="{bottom - span}" stroke="#444"/>',
             f'<line x1="{sx(0)}" y1="{sy(0)}" x2="{sx(vmax)}" y2="{sy(vmax)}" stroke="#888"/>',
             f'<line x1="{sx(0)}" y1="{sy(0)}" x2="{sx(vmax)}" y2="{sy(vmax * 1.25)}" stroke="#bbb" stroke-dasharray="4 3"/>',
             f'<line x1="{sx(0)}" y1="{sy(0)}" x2="{sx(vmax)}" y2="{sy(vmax * 0.75)}" stroke="#bbb" stroke-dasharray="4 3"/>']
    for p in pts:
        color = "#1f77b4" if p["hit"] else "#d62728"
        parts.append(f'<circle cx="{sx(p["measured_ratio"]):.1f}" cy="{sy(p["cfd_ratio"]):.1f}" r="3" fill="{color}" fill-opacity="0.8"/>')
    parts.append(f'<text x="{left + span / 2:.0f}" y="{size - 12}" text-anchor="middle">measured Vs / U_ref(0.1D)</text>')
    parts.append(f'<text x="14" y="{bottom - span / 2:.0f}" text-anchor="middle" transform="rotate(-90 14 {bottom - span / 2:.0f})">CFD |U| / U_inlet(1.5 m)</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def write_comparison_outputs(document: dict, out_dir: Path) -> dict[str, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "aij_case_c_comparison.json"
    svg_path = out_dir / "aij_case_c_scatter.svg"
    json_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    svg_path.write_text(render_scatter_svg(document), encoding="utf-8")
    return {"json": json_path, "svg": svg_path}
