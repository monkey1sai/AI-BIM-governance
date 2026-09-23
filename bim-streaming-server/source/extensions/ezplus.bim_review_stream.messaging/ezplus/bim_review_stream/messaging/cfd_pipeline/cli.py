"""Command line entry: ``python -m bimcfd <subcommand>``.

Parsing and exit-code mapping only: every solve runs through CFD Case Run (``case_run.py``,
``docs/architecture/cfd-case-run-adr.md``) via the ``batch``, ``convergence`` and ``aij_case_c`` drivers.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from .aij_case_c import run_aij_case_c
from .batch import run_batch, wind_directions
from .case_run import postprocess_case, record_case
from .convergence import run_convergence_study
from .openfoam_case import DEFAULT_IMAGE, CaseParams, build_case, run_case_with_extension
from .preprocess import run_preprocess
from .wind import true_north_from_geo


def cmd_preprocess(args: argparse.Namespace) -> int:
    stats = run_preprocess(
        model_usdc=Path(args.model_usdc),
        out_dir=Path(args.out),
        profile_id=args.profile,
        voxel_pitch_m=args.pitch,
        closing_radius_voxels=args.closing,
    )
    print(json.dumps({k: stats[k] for k in ("element_count_total", "element_count_kept", "excluded_by_reason", "shell")}, indent=2))
    shell = stats["shell"]
    if not shell["watertight"]:
        return 2
    if shell.get("sealing_suspect"):
        print(f"sealing suspect: leak_fraction={shell['leak_fraction']} > {shell['leak_fraction_limit']} (openings wider than the closing radius)", file=sys.stderr)
        return 7
    return 0


def cmd_make_case(args: argparse.Namespace) -> int:
    true_north, assumptions = true_north_from_geo(Path(args.geo_reference) if args.geo_reference else None)
    params = CaseParams(
        wind_from_degrees=args.wind_from,
        true_north_degrees=true_north,
        assumptions=assumptions,
        uref_m_s=args.uref,
        zref_m=args.zref,
        z0_m=args.z0,
        ground_z_m=args.ground_z,
        background_cell_m=args.cell,
        surface_refinement_level=args.surface_level,
        region_refinement_level=args.region_level,
        end_time=args.end_time,
        n_procs=args.np,
    )
    meta = build_case(shell_stl=Path(args.shell), out_dir=Path(args.out), params=params)
    print(json.dumps({k: meta[k] for k in ("wind", "domain", "background_mesh", "assumptions")}, indent=2))
    return 0


def cmd_run_case(args: argparse.Namespace) -> int:
    meta_path = Path(args.case) / "case_meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    end_time = int(meta.get("params", {}).get("end_time") or 300)
    # Same policy as the job service (R-A4): one automatic endTime extension when residualControl is not reached.
    summary = run_case_with_extension(case_dir=Path(args.case), end_time=end_time, image=args.image)
    (Path(args.case) / "run_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if summary["exit_code"] == 0 else 3


def cmd_postprocess(args: argparse.Namespace) -> int:
    try:
        summary = postprocess_case(Path(args.case), Path(args.model_usdc), args.run_id, Path(args.out))
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 4
    print(json.dumps(summary, indent=2))
    return 0


def cmd_record(args: argparse.Namespace) -> int:
    record = record_case(
        run_id=args.run_id,
        case_dir=Path(args.case),
        conversion_dir=Path(args.conversion_dir),
        preprocess_dir=Path(args.preprocess_dir),
        out_dir=Path(args.out),
        operator=args.operator,
        source_ifc_sha256=args.source_ifc_sha256,
        conversion_reference=args.conversion_reference,
        image=args.image,
        validation_level=args.validation_level,
        validation_evidence=Path(args.validation_evidence) if args.validation_evidence else None,
    )
    problems = record["validation_problems"]
    print(json.dumps({"run_record": record["run_record_path"], "problems": problems, "iterations": record["solver"].get("iterations"), "final_initial_residuals": record["solver"].get("final_initial_residuals")}, indent=2))
    return 0 if not problems else 5


def cmd_batch(args: argparse.Namespace) -> int:
    directions = wind_directions(args.directions, start_degrees=args.start) if args.only is None else [float(v) for v in args.only.split(",")]
    overrides = {
        "uref_m_s": args.uref,
        "zref_m": args.zref,
        "z0_m": args.z0,
        "ground_z_m": args.ground_z,
        "background_cell_m": args.cell,
        "surface_refinement_level": args.surface_level,
        "region_refinement_level": args.region_level,
        "end_time": args.end_time,
        "n_procs": args.np,
        "refinement_box_mode": args.refinement_box,
    }
    true_north, assumptions = true_north_from_geo(Path(args.conversion_dir) / "geo_reference.json")
    overrides["assumptions"] = assumptions
    summary = run_batch(
        shell_stl=Path(args.shell),
        model_usdc=Path(args.model_usdc),
        conversion_dir=Path(args.conversion_dir),
        preprocess_dir=Path(args.preprocess_dir),
        out_root=Path(args.out),
        directions=directions,
        true_north_degrees=true_north,
        case_overrides=overrides,
        image=args.image,
        operator=args.operator,
        source_ifc_sha256=args.source_ifc_sha256,
        conversion_reference=args.conversion_reference,
    )
    print(json.dumps({k: summary[k] for k in ("batch_id", "direction_count", "ok_count", "failed_count", "failed_directions", "converged_count", "pedestrian_peak", "total_elapsed_seconds")}, indent=2))
    return 0 if summary["failed_count"] == 0 else 6


def cmd_converge(args: argparse.Namespace) -> int:
    cells = [float(v) for v in args.cells.split(",")]
    true_north, assumptions = true_north_from_geo(Path(args.conversion_dir) / "geo_reference.json")
    overrides = {"uref_m_s": args.uref, "zref_m": args.zref, "z0_m": args.z0, "ground_z_m": args.ground_z,
                 "surface_refinement_level": args.surface_level, "region_refinement_level": args.region_level,
                 "end_time": args.end_time, "n_procs": args.np}
    document = run_convergence_study(
        shell_stl=Path(args.shell), conversion_dir=Path(args.conversion_dir), preprocess_dir=Path(args.preprocess_dir),
        out_root=Path(args.out), cells_m=cells, direction=args.direction, true_north_degrees=true_north, assumptions=assumptions,
        case_overrides=overrides, image=args.image, operator=args.operator, run_id=args.run_id,
        conversion_reference=args.conversion_reference, cpus=args.cpus, refinement_box_mode=args.refinement_box,
    )
    print(json.dumps({"run_id": document["run_id"], "levels": [{k: l.get(k) for k in ("background_cell_m", "mesh_cells", "iterations",
                      "converged_by_residual_control", "end_time_extended_to", "elapsed_seconds", "metrics")} for l in document["levels"]],
                      "verdict": document["verdict"], "outputs": document["outputs"]}, indent=2))
    return 0


def cmd_aij_case_c(args: argparse.Namespace) -> int:
    overrides = {"surface_refinement_level": args.surface_level, "region_refinement_level": args.region_level,
                 "end_time": args.end_time, "n_procs": args.np}
    document = run_aij_case_c(data_dir=Path(args.data_dir), out_dir=Path(args.out), run_id=args.run_id, center=args.center,
                              wind_direction=args.wind_direction, scale=args.scale, cell=args.cell, case_overrides=overrides,
                              image=args.image, operator=args.operator, refinement_box_mode=args.refinement_box,
                              wall_z0_m=args.wall_z0, inlet_turbulence=args.inlet_turbulence, intensity_from_af=args.intensity_from_af,
                              experiment=args.experiment)
    print(json.dumps({"run_id": document["run_id"], "metrics": document["metrics"], "inflow": document["inflow"],
                      "solver": document["case_summary"]["solver"], "mesh_cells": (document["case_summary"].get("mesh") or {}).get("cells"),
                      "outputs": document["outputs"]}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="bimcfd", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    pre = sub.add_parser("preprocess", help="class filter + outlier removal + voxel wrap -> shell.stl")
    pre.add_argument("--model-usdc", required=True)
    pre.add_argument("--out", required=True)
    pre.add_argument("--profile", default="exterior-wind/v1")
    pre.add_argument("--pitch", type=float, default=None)
    pre.add_argument("--closing", type=int, default=None)
    pre.set_defaults(func=cmd_preprocess)

    case = sub.add_parser("make-case", help="write an OpenFOAM case from shell.stl")
    case.add_argument("--shell", required=True)
    case.add_argument("--out", required=True)
    case.add_argument("--geo-reference", default=None, help="geo_reference.json (true north)")
    case.add_argument("--wind-from", type=float, required=True, help="meteorological wind direction, degrees from north")
    case.add_argument("--uref", type=float, default=5.0)
    case.add_argument("--zref", type=float, default=10.0)
    case.add_argument("--z0", type=float, default=0.5)
    case.add_argument("--ground-z", type=float, default=0.0)
    case.add_argument("--cell", type=float, default=None)
    case.add_argument("--surface-level", type=int, default=2)
    case.add_argument("--region-level", type=int, default=1)
    case.add_argument("--end-time", type=int, default=300)
    case.add_argument("--np", type=int, default=8)
    case.set_defaults(func=cmd_make_case)

    run = sub.add_parser("run-case", help="run Allrun inside the OpenFOAM container")
    run.add_argument("--case", required=True)
    run.add_argument("--image", default=DEFAULT_IMAGE)
    run.set_defaults(func=cmd_run_case)

    post = sub.add_parser("postprocess", help="sampled VTK -> USD overlay layer + wrapper stage")
    post.add_argument("--case", required=True)
    post.add_argument("--model-usdc", required=True)
    post.add_argument("--run-id", required=True)
    post.add_argument("--out", required=True)
    post.set_defaults(func=cmd_postprocess)

    rec = sub.add_parser("record", help="write cfd-run-record/v1")
    rec.add_argument("--run-id", required=True)
    rec.add_argument("--case", required=True)
    rec.add_argument("--conversion-dir", required=True)
    rec.add_argument("--preprocess-dir", required=True)
    rec.add_argument("--out", required=True)
    rec.add_argument("--operator", default=os.environ.get("BIMCFD_OPERATOR", "unknown"))
    rec.add_argument("--source-ifc-sha256", default=None)
    rec.add_argument("--conversion-reference", default=None)
    rec.add_argument("--image", default=DEFAULT_IMAGE)
    rec.add_argument("--validation-level", default="screening", choices=("screening", "mesh_convergence_checked", "benchmark_compared"),
                     help="contract S5: above 'screening' requires --validation-evidence")
    rec.add_argument("--validation-evidence", default=None, help="mesh_convergence.json / benchmark comparison document backing the level")
    rec.set_defaults(func=cmd_record)

    batch = sub.add_parser("batch", help="one case per wind direction (default 16) + batch_summary.json")
    batch.add_argument("--shell", required=True)
    batch.add_argument("--model-usdc", required=True)
    batch.add_argument("--conversion-dir", required=True)
    batch.add_argument("--preprocess-dir", required=True)
    batch.add_argument("--out", required=True)
    batch.add_argument("--directions", type=int, default=16)
    batch.add_argument("--start", type=float, default=0.0)
    batch.add_argument("--only", default=None, help="comma separated directions to run instead of the even split")
    batch.add_argument("--uref", type=float, default=5.0)
    batch.add_argument("--zref", type=float, default=10.0)
    batch.add_argument("--z0", type=float, default=0.5)
    batch.add_argument("--ground-z", type=float, default=0.0)
    batch.add_argument("--cell", type=float, default=None)
    batch.add_argument("--surface-level", type=int, default=2)
    batch.add_argument("--region-level", type=int, default=1)
    batch.add_argument("--end-time", type=int, default=300)
    batch.add_argument("--np", type=int, default=8)
    batch.add_argument("--refinement-box", default="isotropic", choices=("bbox", "isotropic"), help="isotropic (default since S5c); bbox = P1 behaviour")
    batch.add_argument("--image", default=DEFAULT_IMAGE)
    batch.add_argument("--operator", default=os.environ.get("BIMCFD_OPERATOR", "unknown"))
    batch.add_argument("--source-ifc-sha256", default=None)
    batch.add_argument("--conversion-reference", default=None)
    batch.set_defaults(func=cmd_batch)

    conv = sub.add_parser("converge", help="S5b: one direction on three background cell sizes -> mesh_convergence.json/.svg (Celik 2008 GCI)")
    conv.add_argument("--shell", required=True)
    conv.add_argument("--conversion-dir", required=True)
    conv.add_argument("--preprocess-dir", required=True)
    conv.add_argument("--out", required=True)
    conv.add_argument("--run-id", required=True)
    conv.add_argument("--cells", default="8,6,4.5", help="three background cell sizes in metres, any order")
    conv.add_argument("--direction", type=float, default=0.0, help="meteorological wind-from direction (deg)")
    conv.add_argument("--uref", type=float, default=5.0)
    conv.add_argument("--zref", type=float, default=10.0)
    conv.add_argument("--z0", type=float, default=0.5)
    conv.add_argument("--ground-z", type=float, default=0.0)
    conv.add_argument("--surface-level", type=int, default=2)
    conv.add_argument("--region-level", type=int, default=1)
    conv.add_argument("--end-time", type=int, default=600)
    conv.add_argument("--np", type=int, default=8)
    conv.add_argument("--image", default=DEFAULT_IMAGE)
    conv.add_argument("--operator", default=os.environ.get("BIMCFD_OPERATOR", "unknown"))
    conv.add_argument("--conversion-reference", default=None)
    conv.add_argument("--cpus", type=float, default=None, help="docker --cpus cap for the solver (leave headroom for Kit on a shared host)")
    conv.add_argument("--refinement-box", default="isotropic", choices=("bbox", "isotropic"), help="isotropic (default since S5c) = same box for every wind direction; bbox = P1 behaviour")
    conv.set_defaults(func=cmd_converge)

    aij = sub.add_parser("aij-case-c", help="S5b-2: AIJ Case C blocks benchmark -> aij_case_c_comparison.json/.svg (data CSVs from a local directory)")
    aij.add_argument("--data-dir", required=True, help="directory holding RS_caseC.csv and AF_caseC.csv (Zenodo 10.5281/zenodo.15401792, not committed)")
    aij.add_argument("--out", required=True)
    aij.add_argument("--run-id", required=True)
    aij.add_argument("--center", default="1D", choices=("0D", "1D", "2D"))
    aij.add_argument("--wind-direction", type=float, default=0.0, help="AIJ WD (0, 22.5, 45); only 0 is mapped to the pipeline in S5b-2")
    aij.add_argument("--scale", type=float, default=75.0, help="model->pipeline scale; 75 puts the 1.5 m plane at 0.1D")
    aij.add_argument("--cell", type=float, default=None, help="background cell (m); default D/5")
    aij.add_argument("--surface-level", type=int, default=2)
    aij.add_argument("--region-level", type=int, default=1)
    aij.add_argument("--end-time", type=int, default=600)
    aij.add_argument("--np", type=int, default=8)
    aij.add_argument("--refinement-box", default="bbox", choices=("bbox", "isotropic"),
                     help="bbox (default) keeps the S5b-2 baseline mesh so S6 one-factor runs stay comparable")
    aij.add_argument("--image", default=DEFAULT_IMAGE)
    aij.add_argument("--operator", default=os.environ.get("BIMCFD_OPERATOR", "unknown"))
    # S6 prerequisite: one-factor root-cause knobs (defaults = S5b-2 baseline)
    aij.add_argument("--experiment", default="baseline", help="label recorded in the comparison document")
    aij.add_argument("--wall-z0", type=float, default=None, help="ground atmNutkWallFunction z0 (m, pipeline scale); default = inlet ABL z0")
    aij.add_argument("--inlet-turbulence", default="abl", choices=("abl", "fixed"), help="fixed = uniform k/omega from turbulence intensity")
    aij.add_argument("--intensity-from-af", action="store_true", help="take the turbulence intensity from the tunnel u_rms/U at z = D")
    aij.set_defaults(func=cmd_aij_case_c)
    return parser


def default_run_id(wind_from: float) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"cfd_{stamp}_w{int(round(wind_from)) % 360:03d}"


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
