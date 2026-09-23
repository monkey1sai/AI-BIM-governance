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
``run_aij_case_c`` solves the one case through CFD Case Run's ``solve_case`` (``case_run.py``).
"""

from __future__ import annotations

import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np

from .case_run import CaseRunPorts, CaseSolveSpec, latest_samples_dir, solve_case, solver_log_path
from .foam_log import parse_check_mesh_log, parse_simple_foam_log
from .foam_vtk import parse_legacy_vtk
from .openfoam_case import CaseParams, run_case

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


def _limitations(case_summary: dict, scale: float, inflow: dict, cfd_reference_speed: float) -> list[str]:
    plane = float(case_summary.get("pedestrian_plane_z_m") or MEASUREMENT_Z_OVER_D * BLOCK_D_M * scale)
    inlet = case_summary.get("inlet_turbulence") or "abl"
    af_ref = float(inflow.get("u_ref_measurement_height_m_s") or 0.0)
    gap = (af_ref - float(cfd_reference_speed)) / af_ref * 100.0 if af_ref else float("nan")
    items = [
        "Normalisation bases differ in kind: the measurement uses the wind-tunnel approach flow at the model position (AF at z = 0.1D), "
        f"the CFD uses the inlet log law at the sampling height {plane:g} m (5H upstream of the array, before the profile develops over the "
        f"rough ground); here the inlet value is {gap:.1f} % below AF(0.1D), so normalising the CFD by the AF value instead would shift every "
        "cfd_ratio by that amount. An upstream probe or an empty-domain run would give a second reference.",
    ]
    if inlet == "fixed":
        intensity = (case_summary.get("params") or {}).get("turbulence_intensity")
        items.append(f"Inlet k/omega are uniform fixedValue from turbulence intensity {intensity} (tunnel u_rms/U at z = D) and a 0.07H length "
                     "scale: a single-height, non-equilibrium inlet paired with the ABL velocity profile, not the measured u_rms profile.")
    else:
        items.append("Inlet turbulence follows atmBoundaryLayerInletK/Omega from (Uref, Zref, z0); the measured u_rms profile is read but not imposed.")
    if abs(float(scale) - 1.0) < 1e-9:
        items.append(f"Model scale (D = {BLOCK_D_M} m): Reynolds number matches the tunnel; the sampling plane is {plane:g} m = 0.1D.")
    else:
        items.append(f"Geometry scaled by {scale:g} (D = {BLOCK_D_M * scale:g} m) so the sampling plane {plane:g} m equals 0.1D; Reynolds independence assumed.")
    wall_z0 = case_summary.get("wall_z0_m_effective")
    if wall_z0 is not None and inflow.get("z0_m") is not None and abs(float(wall_z0) - float(inflow["z0_m"])) > 1e-12:
        items.append(f"Ground wall-function z0 {float(wall_z0):g} m differs from the inlet ABL z0 {float(inflow['z0_m']):g} m: the inlet profile "
                     "is no longer in equilibrium with the ground, so part of any change may come from profile development over the 5H fetch.")
    return items


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
                 "pedestrian_plane_m": float(case_summary.get("pedestrian_plane_z_m") or MEASUREMENT_Z_OVER_D * BLOCK_D_M * scale)},
        "inflow": inflow,
        "normalisation": {"measured_by": "approach-flow U at z = 0.1D from AF_caseC.csv", "cfd_by": "inlet |U| at the pedestrian plane height",
                          "cfd_reference_speed_m_s": float(cfd_reference_speed)},
        "metrics": validation_metrics(measured_ratio, predicted_ratio),
        "points": points,
        "case_summary": case_summary,
        "limitations": _limitations(case_summary, scale, inflow, cfd_reference_speed) + [
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


# --------------------------------------------------------------------------- benchmark driver (CFD Case Run adapter)


def run_aij_case_c(*, data_dir: Path, out_dir: Path, run_id: str, center: str, wind_direction: float, scale: float,
                   cell: float | None, case_overrides: dict, image: str, operator: str, refinement_box_mode: str = "bbox",
                   wall_z0_m: float | None = None, inlet_turbulence: str = "abl", intensity_from_af: bool = False,
                   experiment: str = "baseline", run_case_fn: Callable[..., dict] | None = None) -> dict:
    """Build the 3x3 block geometry, solve one direction through CFD Case Run's ``solve_case``, sample the
    measurement points and compare (S5b-2). A failed solve raises ``RuntimeError``; a case that cannot be
    written or a runner that cannot run raises its own exception. ``run_case_fn`` is the container port.
    """
    if float(wind_direction) != 0.0:
        raise ValueError("S5b-2 maps only AIJ WD 0 (approach flow along +x); 22.5/45 need the block array rotated, not the inflow")
    data_dir, out_dir = Path(data_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    profile = read_approach_flow(data_dir / "AF_caseC.csv")
    measurements = read_measurements(data_dir / "RS_caseC.csv", wind_direction=wind_direction, center_config=center)
    inflow = inflow_case_params(profile, scale=scale)
    shell = out_dir / "blocks.stl"
    geometry = write_blocks_stl(shell, center, scale=scale)
    # Pipeline convention: wind_from 270 deg with true north = +Y blows towards +x, i.e. the AIJ approach flow.
    # The benchmark runs a single direction, so the isotropic box buys nothing there; it stays on `bbox` (the
    # S5b-2 baseline mesh) unless the caller opts in, so S6 one-factor experiments stay comparable.
    # The measurement plane is z/D = 0.1: at scale 75 that is the pipeline's 1.5 m, at any other scale it must follow.
    pedestrian_height_m = MEASUREMENT_Z_OVER_D * BLOCK_D_M * scale
    knobs = {}
    if intensity_from_af:
        # Turbulence intensity from the tunnel profile at z = D (u_rms / U); used by the "fixed" inlet and the initial field.
        zs = [p[0] for p in profile]
        rms = [p[2] for p in profile]
        u_rms_at_d = float(np.interp(BLOCK_D_M, zs, rms))
        intensity = u_rms_at_d / float(inflow["uref_m_s"])
        if not math.isfinite(intensity) or intensity <= 0:
            raise ValueError("AF profile has no usable u_rms for --intensity-from-af")
        knobs["turbulence_intensity"] = intensity
    params = CaseParams(wind_from_degrees=270.0, true_north_degrees=0.0, uref_m_s=inflow["uref_m_s"], zref_m=inflow["zref_m"],
                        z0_m=inflow["z0_m"], background_cell_m=float(cell) if cell else BLOCK_D_M * scale / 5.0,
                        assumptions=["aij_case_c_benchmark"], refinement_box_mode=refinement_box_mode,
                        pedestrian_height_m=pedestrian_height_m, wall_z0_m=wall_z0_m, inlet_turbulence=inlet_turbulence,
                        **knobs, **case_overrides)
    spec = CaseSolveSpec(run_id=run_id, tag="", case_dir=out_dir / "case", shell_stl=shell, params=params, image=image)
    outcome = solve_case(spec, CaseRunPorts(run_case_fn=run_case_fn or run_case))
    if outcome.error is not None:  # case_write_failed / runner_failed
        raise outcome.error
    if outcome.kind != "solved":
        raise RuntimeError(f"AIJ case solver failed ({outcome.kind}, exit {outcome.exit_code}); see {spec.case_dir / 'docker_run.log'}")
    case_dir, meta, summary = spec.case_dir, outcome.case_meta, outcome.run_summary
    samples = latest_samples_dir(case_dir)
    plane_file = samples / "pedestrian_1p5m.vtk" if samples else None
    if plane_file is None or not plane_file.exists():
        raise FileNotFoundError("no pedestrian plane sampled")
    plane = parse_legacy_vtk(plane_file)
    xy = np.array([[r["x_m"] * scale, r["y_m"] * scale] for r in measurements])
    predicted = sample_plane_speed(plane, xy)
    # Inlet log law as written to ABLConditions: U(z) = u*/kappa ln((z + z0)/z0), u* from Uref at zref.
    z0 = float(params.z0_m)
    u_star = float(params.uref_m_s) * KAPPA / math.log((float(params.zref_m) + z0) / z0)
    cfd_reference = u_star / KAPPA * math.log((pedestrian_height_m + z0) / z0)
    log_path = solver_log_path(case_dir)
    simple_log = parse_simple_foam_log(log_path) if log_path.exists() else {}
    check_mesh = parse_check_mesh_log(case_dir / "log.checkMesh") if (case_dir / "log.checkMesh").exists() else {}
    document = build_comparison_document(
        run_id=run_id, operator=operator, wind_direction=wind_direction, center_config=center, scale=scale, inflow=inflow,
        measurements=measurements, predicted_speed=predicted, cfd_reference_speed=cfd_reference,
        case_summary={"experiment": experiment, "geometry": geometry, "params": meta["params"], "domain": meta["domain"], "background_mesh": meta["background_mesh"],
                      "inlet_turbulence": meta.get("inlet_turbulence"), "wall_z0_m_effective": meta.get("wall_z0_m_effective"),
                      "pedestrian_plane_z_m": meta.get("pedestrian_plane_z_m"),
                      "mesh": check_mesh, "solver": {"exit_code": summary["exit_code"], "elapsed_seconds": summary["elapsed_seconds"],
                      "extended_to": summary.get("extended_to"), "converged_by_residual_control": simple_log.get("converged_by_residual_control"),
                      "last_time": simple_log.get("last_time"), "image": image, "image_digest": summary.get("image_digest")},
                      "measurement_z_over_d": MEASUREMENT_Z_OVER_D})
    paths = write_comparison_outputs(document, out_dir)
    document["outputs"] = {k: str(v) for k, v in paths.items()}
    return document
