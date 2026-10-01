"""Bounded, offline URANS pilot; never updates service runs or published artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sys
import time
import uuid

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bimcfd.foam_vtk import parse_legacy_vtk
from bimcfd.openfoam_case import DEFAULT_IMAGE, _foam_header, _fv_schemes, image_available, run_case

WALL_CAP_SECONDS = 1800
# Leave two minutes for host cancellation and Docker cleanup; never extend.
SOLVE_CAP_SECONDS = 1680
MAX_BYTES = 8 * 1024**3
FIELDS = ("U", "p", "k", "omega", "nut")
SURFACES = ("pedestrian_1p5m", "building", "near_wall_speed")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_bytes(root: Path) -> int:
    total = 0
    for path in root.rglob("*"):
        try:
            if path.is_file():
                total += path.stat().st_size
        except FileNotFoundError:
            continue  # solver may rename temporary output between listing and stat
    return total


def _no_links(path: Path) -> None:
    for part in (path, *path.parents):
        if part.is_symlink() or part.is_junction():
            raise ValueError("source links and junctions are not accepted")


def _regular_files(path: Path):
    # Check directory entries before descending; rglob/is_file alone misses directory links.
    _no_links(path)
    if path.is_dir():
        for child in path.iterdir():
            yield from _regular_files(child)
    elif path.is_file():
        yield path
    else:
        raise ValueError("source input must be a regular file or directory")


def _samples_block(control: str) -> str:
    match = re.search(r"\n    samples\s*\{", control)
    if match is None:
        raise ValueError("source case has no samples function")
    start = control.index("{", match.start())
    depth = 1
    end = start + 1
    while end < len(control) and depth:
        depth += (control[end] == "{") - (control[end] == "}")
        end += 1
    if depth:
        raise ValueError("unbalanced samples dictionary")
    block = control[match.start():end]
    if any(name not in block for name in SURFACES):
        raise ValueError("pilot requires pedestrian, building and near-wall samples")
    return block


def prepare(source: Path, destination: Path, *, duration_s: float = 10, interval_s: float = .5) -> dict:
    """Copy only a completed case's mesh and latest fields into a NEW directory."""
    _no_links(source)
    source, destination = source.resolve(), destination.resolve()
    if destination.exists() or destination.is_relative_to(source) or source.is_relative_to(destination):
        raise ValueError("destination must be new and outside the source case")
    if not (math.isfinite(duration_s) and math.isfinite(interval_s) and 0 < interval_s <= duration_s <= 10):
        raise ValueError("pilot duration must be <= 10 physical seconds")
    if duration_s / interval_s > 20:
        raise ValueError("pilot permits at most 20 output frames")
    for path in (source / "run_summary.json", source / "case_meta.json", source / "system/controlDict"):
        _no_links(path)
    summary = json.loads((source / "run_summary.json").read_text(encoding="utf-8"))
    if summary.get("exit_code") != 0 or summary.get("cancelled") or summary.get("timed_out"):
        raise ValueError("source solve must have completed successfully")
    meta = json.loads((source / "case_meta.json").read_text(encoding="utf-8"))
    if meta.get("params", {}).get("turbulence_model") != "kOmegaSST":
        raise ValueError("pilot requires the existing kOmegaSST case")
    if not (source / "constant/polyMesh/points").is_file():
        raise ValueError("source requires reconstructed constant mesh")
    times = [path for path in source.iterdir() if path.is_dir() and re.fullmatch(r"\d+(?:\.\d+)?", path.name)]
    latest = max(times, key=lambda path: float(path.name))
    if float(latest.name) <= 0 or not all((latest / name).is_file() for name in FIELDS):
        raise ValueError("source requires reconstructed latest U,p,k,omega,nut")
    samples = _samples_block((source / "system/controlDict").read_text(encoding="utf-8"))
    samples = re.sub(r"executeControl\s+onEnd;", "executeControl writeTime;", samples)
    samples = re.sub(r"writeControl\s+onEnd;", "writeControl writeTime;", samples)
    inputs = [source / "constant", source / "system/decomposeParDict", *[latest / name for name in FIELDS]]
    if (latest / "phi").is_file():
        inputs.append(latest / "phi")
    files = [file for item in inputs for file in _regular_files(item)]
    if sum(path.stat().st_size for path in files) > MAX_BYTES // 2:
        raise ValueError("source exceeds pilot copy budget")
    hashes = {str(path.relative_to(source)): sha256(path) for path in files}
    destination.mkdir(parents=True)
    shutil.copytree(source / "constant", destination / "constant")
    (destination / "system").mkdir()
    shutil.copy2(source / "system/decomposeParDict", destination / "system/decomposeParDict")
    (destination / "0").mkdir()
    for path in inputs[2:]:
        shutil.copy2(path, destination / "0" / path.name)
    control = _foam_header("dictionary", "controlDict", "system") + f"""application pimpleFoam;
libs (atmosphericModels);
startFrom startTime;
startTime 0;
stopAt endTime;
endTime {duration_s:g};
deltaT 0.01;
adjustTimeStep yes;
maxCo 1;
maxDeltaT 0.02;
writeControl adjustableRunTime;
writeInterval {interval_s:g};
purgeWrite 0;
writeFormat binary;
writePrecision 8;
writeCompression off;
timeFormat general;
timePrecision 10;
runTimeModifiable false;
functions
{{{samples}
}}
"""
    (destination / "system/controlDict").write_text(control, encoding="utf-8")
    # Euler is a first-order cost/synchronization baseline, not temporal convergence evidence.
    schemes = _fv_schemes().replace("steadyState", "Euler").replace("bounded Gauss", "Gauss")
    (destination / "system/fvSchemes").write_text(schemes, encoding="utf-8")
    (destination / "system/fvSolution").write_text(_foam_header("dictionary", "fvSolution", "system") + """
solvers
{
    p { solver GAMG; smoother GaussSeidel; tolerance 1e-7; relTol 0.01; }
    pFinal { $p; relTol 0; }
    "(U|k|omega)" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.1; }
    "(U|k|omega)Final" { $U; relTol 0; }
}
PIMPLE { nOuterCorrectors 2; nCorrectors 2; nNonOrthogonalCorrectors 0; }
""", encoding="utf-8")
    script = """#!/bin/bash
# OpenFOAM RunFunctions reads optional unset environment variables; keep errexit, not nounset.
set -e
cd /case
export OMPI_ALLOW_RUN_AS_ROOT=1 OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1
export OMPI_MCA_btl_vader_single_copy_mechanism=none
. "${WM_PROJECT_DIR:?}/bin/tools/RunFunctions"
runApplication decomposePar
# Independent in-container deadline, including decomposition. Host supervisor also caps this run.
runParallel pimpleFoam
echo TRANSIENT_PILOT_COMPLETE
"""
    (destination / "TransientBody").write_text(script, encoding="utf-8", newline="\n")
    (destination / "Alltransient").write_text(
        f"#!/bin/bash\nexec timeout --signal=KILL {SOLVE_CAP_SECONDS}s bash ./TransientBody\n", encoding="utf-8", newline="\n")
    manifest = {
        "schema": "cfd-transient-pilot/v1", "solver": "pimpleFoam", "turbulence": "URANS kOmegaSST",
        "source_case": str(source), "source_iteration": latest.name, "source_input_sha256": hashes,
        "source_case_meta": meta, "physical_time_origin_s": 0, "duration_s": duration_s,
        "output_interval_s": interval_s, "max_courant": 1, "max_delta_t_s": .02,
        "wall_cap_s": WALL_CAP_SECONDS, "solve_cap_s": SOLVE_CAP_SECONDS, "storage_cap_bytes": MAX_BYTES,
        "container_name": "cfd_transient_probe_" + uuid.uuid4().hex,
        "limitations": ["fixed geometry", "no statistics or time-step convergence claim", "not a published service run"],
    }
    (destination / "pilot_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def collect(case: Path) -> dict:
    """Only publish complete same-directory timestamps; never carry fields forward."""
    samples = case / "postProcessing/samples"
    frames, incomplete = [], []
    paths = sorted(samples.iterdir(), key=lambda p: p.name) if samples.is_dir() else []
    for path in paths:
        if not path.is_dir() or not re.fullmatch(r"\d+(?:\.\d+)?", path.name):
            continue
        fields = {}
        try:
            for name in SURFACES:
                vtk = path / (name + ".vtk")
                surface = parse_legacy_vtk(vtk)
                key = "p" if name == "building" else "U"
                values = surface.cell_data.get(key) if name == "building" else surface.point_data.get(key)
                if values is None or np.asarray(values).size == 0 or not np.isfinite(values).all():
                    raise ValueError(f"{name} missing finite {key}")
                fields[name] = {"path": str(vtk.relative_to(case)), "sha256": sha256(vtk),
                                "quantity": key, "count": len(values),
                                "min": float(np.min(values)), "max": float(np.max(values))}
        except (OSError, ValueError, IndexError) as exc:
            incomplete.append({"time_s": float(path.name), "reason": str(exc)[:200]})
            continue
        frames.append({"time_s": float(path.name), "fields": fields})
    frames.sort(key=lambda frame: frame["time_s"])
    return {"frames": frames, "incomplete_frames": incomplete, "same_time_pairs": len(frames),
            "time_series_available": len(frames) >= 2, "engineering_validated": False}


def execute(case: Path, *, runner=run_case, has_image=image_available) -> dict:
    started = time.monotonic()
    case = case.resolve()
    manifest = json.loads((case / "pilot_manifest.json").read_text(encoding="utf-8"))
    if not re.fullmatch(r"cfd_transient_probe_[0-9a-f]{32}", manifest["container_name"]):
        raise ValueError("unexpected task container identity")
    if not has_image(DEFAULT_IMAGE):
        raise RuntimeError("existing OpenFOAM image required; no automatic pull")
    marker = case / "pilot_started.json"
    with marker.open("x", encoding="utf-8") as stream:
        json.dump({"container": manifest["container_name"], "single_attempt": True}, stream)
    disk_limited = False
    def stop_for_disk():
        nonlocal disk_limited
        disk_limited = tree_bytes(case) >= MAX_BYTES
        return disk_limited
    result = runner(case_dir=case, image=DEFAULT_IMAGE, container_name=manifest["container_name"],
                    cpus=4, timeout_s=SOLVE_CAP_SECONDS, poll_interval_s=1,
                    script="Alltransient", should_stop=stop_for_disk)
    report = {"solve": result, "storage_limited": disk_limited, **collect(case)}
    report["execute_wall_seconds"] = round(time.monotonic() - started, 3)
    (case / "pilot_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--case", type=Path, required=True)
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    if args.source:
        prepare(args.source, args.case)
    if args.run:
        report = execute(args.case)
        print(json.dumps(report, indent=2))
        sys.exit(0 if report["solve"].get("exit_code") == 0 else 2)
    else:
        print(json.dumps(collect(args.case), indent=2))
