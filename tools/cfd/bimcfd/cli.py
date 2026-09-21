"""Command line entry: ``python -m bimcfd <subcommand>``."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from .foam_log import parse_check_mesh_log, parse_simple_foam_log, parse_solver_info
from .foam_vtk import parse_legacy_vtk, parse_vtk_any
from .openfoam_case import DEFAULT_IMAGE, CaseParams, build_case, run_case
from .preprocess import run_preprocess
from .run_record import build_run_record, validate_run_record, write_run_record
from .usd_results import write_result_layer, write_wrapper_stage

SIDECAR_NAMES = ("element_mapping", "entity_index", "metadata", "pset_index", "spatial_index", "bbox_index", "quality_metrics", "geo_reference")


def _load_json(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def cmd_preprocess(args: argparse.Namespace) -> int:
    stats = run_preprocess(
        model_usdc=Path(args.model_usdc),
        out_dir=Path(args.out),
        profile_id=args.profile,
        voxel_pitch_m=args.pitch,
        closing_radius_voxels=args.closing,
    )
    print(json.dumps({k: stats[k] for k in ("element_count_total", "element_count_kept", "excluded_by_reason", "shell")}, indent=2))
    return 0 if stats["shell"]["watertight"] else 2


def _true_north_from_geo(geo_path: Path | None) -> float | None:
    if geo_path is None or not Path(geo_path).exists():
        return None
    geo = _load_json(geo_path)
    value = geo.get("true_north_degrees")
    return float(value) if value is not None else None


def cmd_make_case(args: argparse.Namespace) -> int:
    params = CaseParams(
        wind_from_degrees=args.wind_from,
        true_north_degrees=_true_north_from_geo(Path(args.geo_reference) if args.geo_reference else None),
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
    summary = run_case(case_dir=Path(args.case), image=args.image)
    (Path(args.case) / "run_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if summary["exit_code"] == 0 else 3


def _latest_dir(parent: Path) -> Path | None:
    if not parent.exists():
        return None
    dirs = [p for p in parent.iterdir() if p.is_dir()]
    if not dirs:
        return None
    return sorted(dirs, key=lambda p: float(p.name) if p.name.replace(".", "", 1).isdigit() else -1)[-1]


def cmd_postprocess(args: argparse.Namespace) -> int:
    case = Path(args.case)
    meta = _load_json(case / "case_meta.json")
    samples = _latest_dir(case / "postProcessing" / "samples")
    # streamLine writes under postProcessing/sets/<name>/ in v2412; older builds used postProcessing/<name>/.
    tracks_dir = _latest_dir(case / "postProcessing" / "sets" / "streamlines") or _latest_dir(case / "postProcessing" / "streamlines")
    plane = building = tracks = None
    if samples is not None:
        plane_file = samples / "pedestrian_1p5m.vtk"
        building_file = samples / "building.vtk"
        plane = parse_legacy_vtk(plane_file) if plane_file.exists() else None
        building = parse_legacy_vtk(building_file) if building_file.exists() else None
    if tracks_dir is not None:
        track_files = sorted(list(tracks_dir.glob("*.vtp")) + list(tracks_dir.glob("*.vtk")))
        if track_files:
            tracks = parse_vtk_any(track_files[0])
    if plane is None and building is None:
        print("no sampled surfaces found under postProcessing/samples", file=sys.stderr)
        return 4
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    layer_stem = args.run_id if args.run_id.startswith("cfd_") else f"cfd_{args.run_id}"
    layer = out_dir / f"{layer_stem}.usdc"
    summary = write_result_layer(
        out_path=layer,
        run_id=args.run_id,
        pedestrian_plane=plane,
        building_surface=building,
        streamlines=tracks,
        solver_rotation_alpha_rad=float(meta["wind"]["solver_rotation_alpha_rad"]),
        run_custom_data={
            "wind_from_degrees": float(meta["wind"]["wind_from_degrees"]),
            "uref_m_s": float(meta["params"]["uref_m_s"]),
            "true_north_degrees_used": float(meta["wind"]["true_north_degrees_used"]),
        },
    )
    wrapper = write_wrapper_stage(out_path=out_dir / f"{layer_stem}_view.usda", model_usdc=Path(args.model_usdc), result_layer=layer)
    summary["wrapper_stage"] = str(wrapper)
    summary["samples_dir"] = str(samples) if samples else None
    summary["streamlines_dir"] = str(tracks_dir) if tracks_dir else None
    (out_dir / "postprocess_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


def cmd_record(args: argparse.Namespace) -> int:
    case = Path(args.case)
    conversion = Path(args.conversion_dir)
    pre = Path(args.preprocess_dir)
    out = Path(args.out)
    meta = _load_json(case / "case_meta.json")
    run_summary = _load_json(case / "run_summary.json") if (case / "run_summary.json").exists() else {"image": args.image, "image_digest": None}
    solver_info_file = _latest_dir(case / "postProcessing" / "solverInfo")
    solver_info = parse_solver_info(solver_info_file / "solverInfo.dat") if solver_info_file and (solver_info_file / "solverInfo.dat").exists() else {}
    simple_log = parse_simple_foam_log(case / "log.simpleFoam") if (case / "log.simpleFoam").exists() else {}
    check_mesh = parse_check_mesh_log(case / "log.checkMesh") if (case / "log.checkMesh").exists() else {}
    geo = _load_json(conversion / "geo_reference.json") if (conversion / "geo_reference.json").exists() else {}
    stats = _load_json(pre / "preprocess_stats.json")
    outputs = {p.stem: p for p in out.glob("cfd_*.usd*")}
    outputs.update({f"case_{name}": case / name for name in ("case_meta.json", "log.simpleFoam", "log.checkMesh", "log.snappyHexMesh") if (case / name).exists()})
    record = build_run_record(
        run_id=args.run_id,
        operator=args.operator,
        model_usdc=conversion / "model.usdc",
        sidecar_paths={name: conversion / f"{name}.json" for name in SIDECAR_NAMES},
        source_ifc_sha256=args.source_ifc_sha256,
        conversion_reference=args.conversion_reference,
        geo_reference=geo,
        preprocess_stats=stats,
        exclusions_path=pre / "exclusions.json",
        case_meta=meta,
        check_mesh=check_mesh,
        solver_run=run_summary,
        solver_info=solver_info,
        simple_log=simple_log,
        weather={"epw_sha256": None, "uref_m_s": meta["params"]["uref_m_s"], "zref_m": meta["params"]["zref_m"], "z0_m": meta["params"]["z0_m"], "source": "manual_reference_wind"},
        output_files=outputs,
    )
    problems = validate_run_record(record)
    record["validation_problems"] = problems
    path = write_run_record(record, out / "run_record.json")
    print(json.dumps({"run_record": str(path), "problems": problems, "iterations": solver_info.get("iterations"), "final_initial_residuals": solver_info.get("final_initial_residuals")}, indent=2))
    return 0 if not problems else 5


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
    rec.set_defaults(func=cmd_record)
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
