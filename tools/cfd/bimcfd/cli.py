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
    shell = stats["shell"]
    if not shell["watertight"]:
        return 2
    if shell.get("sealing_suspect"):
        print(f"sealing suspect: leak_fraction={shell['leak_fraction']} > {shell['leak_fraction_limit']} (openings wider than the closing radius)", file=sys.stderr)
        return 7
    return 0


def _true_north_from_geo(geo_path: Path | None) -> tuple[float | None, list[str]]:
    """True north (degrees) from geo_reference.json plus the assumptions it implies."""
    if geo_path is None or not Path(geo_path).exists():
        return None, ["geo_reference_file_missing"]
    geo = _load_json(geo_path)
    value = geo.get("true_north_degrees")
    assumptions = [w for w in (geo.get("warnings") or []) if w in ("true_north_default_direction", "true_north_missing")]
    return (float(value) if value is not None else None), assumptions


def cmd_make_case(args: argparse.Namespace) -> int:
    true_north, assumptions = _true_north_from_geo(Path(args.geo_reference) if args.geo_reference else None)
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


def postprocess_case(case: Path, model_usdc: Path, run_id: str, out_dir: Path) -> dict:
    """Sampled VTK -> USD overlay layer + wrapper stage. Raises if nothing was sampled."""
    case = Path(case)
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
        raise FileNotFoundError(f"no sampled surfaces found under {case / 'postProcessing' / 'samples'}")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    layer_stem = run_id if run_id.startswith("cfd_") else f"cfd_{run_id}"
    layer = out_dir / f"{layer_stem}.usdc"
    summary = write_result_layer(
        out_path=layer,
        run_id=run_id,
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
    wrapper = write_wrapper_stage(out_path=out_dir / f"{layer_stem}_view.usda", model_usdc=Path(model_usdc), result_layer=layer)
    summary["wrapper_stage"] = str(wrapper)
    summary["samples_dir"] = str(samples) if samples else None
    summary["streamlines_dir"] = str(tracks_dir) if tracks_dir else None
    (out_dir / "postprocess_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def cmd_postprocess(args: argparse.Namespace) -> int:
    try:
        summary = postprocess_case(Path(args.case), Path(args.model_usdc), args.run_id, Path(args.out))
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 4
    print(json.dumps(summary, indent=2))
    return 0


def record_case(
    *,
    run_id: str,
    case_dir: Path,
    conversion_dir: Path,
    preprocess_dir: Path,
    out_dir: Path,
    operator: str,
    source_ifc_sha256: str | None,
    conversion_reference: str | None,
    image: str,
) -> dict:
    """Assemble, validate and write ``cfd-run-record/v1``; returns the record."""
    case = Path(case_dir)
    conversion = Path(conversion_dir)
    pre = Path(preprocess_dir)
    out = Path(out_dir)
    meta = _load_json(case / "case_meta.json")
    run_summary = _load_json(case / "run_summary.json") if (case / "run_summary.json").exists() else {"image": image, "image_digest": None}
    solver_info_file = _latest_dir(case / "postProcessing" / "solverInfo")
    solver_info = parse_solver_info(solver_info_file / "solverInfo.dat") if solver_info_file and (solver_info_file / "solverInfo.dat").exists() else {}
    simple_log = parse_simple_foam_log(case / "log.simpleFoam") if (case / "log.simpleFoam").exists() else {}
    check_mesh = parse_check_mesh_log(case / "log.checkMesh") if (case / "log.checkMesh").exists() else {}
    geo = _load_json(conversion / "geo_reference.json") if (conversion / "geo_reference.json").exists() else {}
    stats = _load_json(pre / "preprocess_stats.json")
    outputs = {p.stem: p for p in out.glob("cfd_*.usd*")}
    outputs.update({f"case_{name}": case / name for name in ("case_meta.json", "log.simpleFoam", "log.checkMesh", "log.snappyHexMesh") if (case / name).exists()})
    record = build_run_record(
        run_id=run_id,
        operator=operator,
        model_usdc=conversion / "model.usdc",
        sidecar_paths={name: conversion / f"{name}.json" for name in SIDECAR_NAMES},
        source_ifc_sha256=source_ifc_sha256,
        conversion_reference=conversion_reference,
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
    record["run_record_path"] = str(write_run_record(record, out / "run_record.json"))
    return record


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
    )
    problems = record["validation_problems"]
    print(json.dumps({"run_record": record["run_record_path"], "problems": problems, "iterations": record["solver"].get("iterations"), "final_initial_residuals": record["solver"].get("final_initial_residuals")}, indent=2))
    return 0 if not problems else 5


def cmd_batch(args: argparse.Namespace) -> int:
    from .batch import run_batch, wind_directions

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
    }
    true_north, assumptions = _true_north_from_geo(Path(args.conversion_dir) / "geo_reference.json")
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
    batch.add_argument("--image", default=DEFAULT_IMAGE)
    batch.add_argument("--operator", default=os.environ.get("BIMCFD_OPERATOR", "unknown"))
    batch.add_argument("--source-ifc-sha256", default=None)
    batch.add_argument("--conversion-reference", default=None)
    batch.set_defaults(func=cmd_batch)
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
