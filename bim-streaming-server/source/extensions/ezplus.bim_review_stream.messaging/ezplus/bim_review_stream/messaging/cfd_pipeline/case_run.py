"""CFD Case Run (docs/architecture/cfd-case-run-adr.md).

One wind-direction case, from the sealed shell to one closed outcome:

- ``solve_case`` writes the OpenFOAM case, runs it in the container with at most one
  automatic endTime extension (contract S5 / R-A4), writes ``run_summary.json`` and
  classifies a container failure as ``mesh_failed`` or ``solver_failed``;
- ``run_direction_case`` continues with sampling → USD overlay export
  (``postprocess_case``) and the ``cfd-run-record/v1`` document (``record_case``);
- ``run_wind_directions`` is the direction loop: cancellation checks between stages,
  progress reporting and a ``stop_on`` policy that says which outcome kinds abort the run.

The container is reached only through the ``run_case_fn`` port (Docker in production, a
fake in tests). The job service, the ``batch`` CLI, the convergence study and the AIJ
benchmark are adapters over these three functions; none of them repeats the sequence.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

from .foam_log import parse_check_mesh_log, parse_simple_foam_log, parse_solver_info
from .foam_vtk import parse_legacy_vtk, parse_vtk_any
from .openfoam_case import CaseParams, build_case, run_case, run_case_with_extension
from .run_record import build_run_record, sha256_of, validate_run_record, write_run_record

SIDECAR_NAMES = ("element_mapping", "entity_index", "metadata", "pset_index", "spatial_index", "bbox_index", "quality_metrics", "geo_reference")

SOLVE_KINDS = ("solved", "case_write_failed", "mesh_failed", "solver_failed", "cancelled")
OUTCOME_KINDS = ("ready", "case_write_failed", "mesh_failed", "solver_failed", "postprocess_failed", "cancelled")


# --------------------------------------------------------------------------- specs, ports, outcomes


@dataclass(frozen=True, kw_only=True)
class CaseSolveSpec:
    """Everything ``solve_case`` needs: one direction, one case directory, one image."""

    run_id: str
    tag: str
    case_dir: Path
    shell_stl: Path
    params: CaseParams
    image: str
    cpus: float | None = None
    container_name: str | None = None

    @property
    def case_run_id(self) -> str:
        """Identifier of this direction's case: ``<run_id>_<tag>``, or the run id alone when there is no tag."""
        return f"{self.run_id}_{self.tag}" if self.tag else self.run_id

    @property
    def effective_container_name(self) -> str:
        return self.container_name or self.case_run_id.replace("-", "_")


@dataclass(frozen=True, kw_only=True)
class CaseRunSpec(CaseSolveSpec):
    """``CaseSolveSpec`` plus what the overlay export and the run record need."""

    results_dir: Path
    model_usdc: Path
    conversion_dir: Path
    preprocess_dir: Path
    operator: str
    conversion_reference: str | None = None
    source_ifc_sha256: str | None = None
    validation_level: str = "screening"
    validation_evidence: Path | None = None


@dataclass(frozen=True)
class CaseProgress:
    """One progress event; ``stage`` is meshing, solving, solver_finished, postprocessing or direction_done."""

    stage: str
    tag: str
    container: str | None = None
    extended_to: int | None = None
    outcome_kind: str | None = None


@dataclass(frozen=True)
class CaseRunPorts:
    """The runner port plus the two callbacks a supervisor may supply."""

    run_case_fn: Callable[..., dict] = run_case
    on_progress: Callable[[CaseProgress], None] | None = None
    should_stop: Callable[[], bool] | None = None

    def progress(self, event: CaseProgress) -> None:
        if self.on_progress is not None:
            self.on_progress(event)

    def stop_requested(self) -> bool:
        return bool(self.should_stop is not None and self.should_stop())


@dataclass(frozen=True)
class SolveOutcome:
    """Closed outcome of ``solve_case``; ``kind`` is one of ``SOLVE_KINDS``."""

    kind: str
    spec: CaseSolveSpec
    case_meta: dict | None = None
    run_summary: dict | None = None
    exit_code: int | None = None
    message: str | None = None
    error: BaseException | None = None

    @property
    def case_dir(self) -> Path:
        return Path(self.spec.case_dir)


@dataclass(frozen=True)
class CaseOutcome(SolveOutcome):
    """Closed outcome of ``run_direction_case``; ``kind`` is one of ``OUTCOME_KINDS`` (never ``solved``)."""

    postprocess: dict | None = None
    record: dict | None = None
    record_problems: list[str] = field(default_factory=list)
    overlay_layer: Path | None = None


def _message(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------- solve


def solve_case(spec: CaseSolveSpec, ports: CaseRunPorts) -> SolveOutcome:
    """Write the case, run it (with the one-time extension) and write ``run_summary.json``."""
    if ports.stop_requested():
        return SolveOutcome("cancelled", spec, message="cancelled before the case was written")
    ports.progress(CaseProgress("meshing", spec.tag))
    try:
        meta = build_case(shell_stl=Path(spec.shell_stl), out_dir=Path(spec.case_dir), params=spec.params)
    except Exception as exc:  # noqa: BLE001 - the outcome carries it
        return SolveOutcome("case_write_failed", spec, message=_message(exc), error=exc)
    if ports.stop_requested():
        return SolveOutcome("cancelled", spec, case_meta=meta, message="cancelled before the container started")

    container = spec.effective_container_name
    ports.progress(CaseProgress("solving", spec.tag, container=container))
    run_kwargs: dict = {"image": spec.image, "container_name": container}
    if spec.cpus is not None:
        run_kwargs["cpus"] = spec.cpus
    if ports.should_stop is not None:
        run_kwargs["should_stop"] = ports.should_stop
    summary = run_case_with_extension(
        case_dir=Path(spec.case_dir),
        end_time=int(spec.params.end_time),
        run_case_fn=ports.run_case_fn,
        on_extend=lambda new_end: ports.progress(CaseProgress("solving", spec.tag, container=f"{container}_x", extended_to=new_end)),
        **run_kwargs,
    )
    (Path(spec.case_dir) / "run_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    ports.progress(CaseProgress("solver_finished", spec.tag))

    exit_code = summary.get("exit_code")
    if summary.get("cancelled") or ports.stop_requested():
        return SolveOutcome("cancelled", spec, case_meta=meta, run_summary=summary, exit_code=exit_code, message="container cancelled")
    if exit_code != 0:
        # No solver log means the run died in blockMesh/snappyHexMesh; with a log the solver itself failed.
        kind = "mesh_failed" if not (Path(spec.case_dir) / "log.simpleFoam").exists() else "solver_failed"
        return SolveOutcome(kind, spec, case_meta=meta, run_summary=summary, exit_code=exit_code,
                            message=f"{summary.get('script', 'Allrun')} exit {exit_code}")
    return SolveOutcome("solved", spec, case_meta=meta, run_summary=summary, exit_code=exit_code)


# --------------------------------------------------------------------------- direction case


def _as_case_outcome(solved: SolveOutcome) -> CaseOutcome:
    return CaseOutcome(solved.kind, solved.spec, case_meta=solved.case_meta, run_summary=solved.run_summary,
                       exit_code=solved.exit_code, message=solved.message, error=solved.error)


def run_direction_case(spec: CaseRunSpec, ports: CaseRunPorts) -> CaseOutcome:
    """``solve_case`` plus the USD overlay export and the run record; failures become outcomes, never exceptions."""
    solved = solve_case(spec, ports)
    if solved.kind != "solved":
        return _as_case_outcome(solved)
    ports.progress(CaseProgress("postprocessing", spec.tag))
    try:
        post = postprocess_case(spec.case_dir, spec.model_usdc, spec.case_run_id, spec.results_dir)
        record = record_case(
            run_id=spec.case_run_id,
            case_dir=spec.case_dir,
            conversion_dir=spec.conversion_dir,
            preprocess_dir=spec.preprocess_dir,
            out_dir=spec.results_dir,
            operator=spec.operator,
            source_ifc_sha256=spec.source_ifc_sha256,
            conversion_reference=spec.conversion_reference,
            image=spec.image,
            validation_level=spec.validation_level,
            validation_evidence=spec.validation_evidence,
        )
    except Exception as exc:  # noqa: BLE001 - the outcome carries it
        return CaseOutcome("postprocess_failed", spec, case_meta=solved.case_meta, run_summary=solved.run_summary,
                           exit_code=solved.exit_code, message=_message(exc), error=exc)
    return CaseOutcome(
        "ready", spec, case_meta=solved.case_meta, run_summary=solved.run_summary, exit_code=solved.exit_code,
        postprocess=post, record=record, record_problems=list(record.get("validation_problems") or []),
        overlay_layer=Path(post["layer"]),
    )


# --------------------------------------------------------------------------- direction loop


def run_wind_directions(specs: Sequence[CaseRunSpec], ports: CaseRunPorts, *, stop_on: frozenset[str]) -> list[CaseOutcome]:
    """Run the directions in order; stop after a cancellation or after any outcome kind listed in ``stop_on``."""
    unknown = set(stop_on) - set(OUTCOME_KINDS)
    if unknown:
        raise ValueError(f"stop_on has unknown outcome kinds {sorted(unknown)}; expected a subset of {OUTCOME_KINDS}")
    outcomes: list[CaseOutcome] = []
    for spec in specs:
        if ports.stop_requested():
            outcome = CaseOutcome("cancelled", spec, message="cancelled before the direction started")
        else:
            outcome = run_direction_case(spec, ports)
        outcomes.append(outcome)
        ports.progress(CaseProgress("direction_done", spec.tag, outcome_kind=outcome.kind))
        if outcome.kind == "cancelled" or outcome.kind in stop_on:
            break
    return outcomes


# --------------------------------------------------------------------------- artifact layout


def _load_json(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _latest_dir(parent: Path) -> Path | None:
    if not parent.exists():
        return None
    dirs = [p for p in parent.iterdir() if p.is_dir()]
    if not dirs:
        return None
    return sorted(dirs, key=lambda p: float(p.name) if p.name.replace(".", "", 1).isdigit() else -1)[-1]


def postprocess_case(case: Path, model_usdc: Path, run_id: str, out_dir: Path) -> dict:
    """Sampled VTK -> USD overlay layer + wrapper stage. Raises if nothing was sampled."""
    from .usd_results import write_result_layer, write_wrapper_stage  # pxr is only needed here

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
    bbox = meta.get("building_bbox_solver_frame") or {}
    bbox_pair = (bbox["min"], bbox["max"]) if "min" in bbox and "max" in bbox else None
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
            "pedestrian_plane_z_m": float(meta.get("pedestrian_plane_z_m", 1.5)),
        },
        building_bbox_solver_frame=bbox_pair,
        ground_z=float(meta["params"].get("ground_z_m", 0.0)),
    )
    wrapper = write_wrapper_stage(out_path=out_dir / f"{layer_stem}_view.usda", model_usdc=Path(model_usdc), result_layer=layer)
    summary["wrapper_stage"] = str(wrapper)
    summary["samples_dir"] = str(samples) if samples else None
    summary["streamlines_dir"] = str(tracks_dir) if tracks_dir else None
    (out_dir / "postprocess_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


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
    validation_level: str = "screening",
    validation_evidence: Path | None = None,
) -> dict:
    """Assemble, validate and write ``cfd-run-record/v1``; returns the record."""
    case = Path(case_dir)
    conversion = Path(conversion_dir)
    pre = Path(preprocess_dir)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    meta = _load_json(case / "case_meta.json")
    run_summary = _load_json(case / "run_summary.json") if (case / "run_summary.json").exists() else {"image": image, "image_digest": None}
    solver_info_file = _latest_dir(case / "postProcessing" / "solverInfo")
    solver_info = parse_solver_info(solver_info_file / "solverInfo.dat") if solver_info_file and (solver_info_file / "solverInfo.dat").exists() else {}
    # An automatic endTime extension (Allcontinue) writes log.simpleFoam.continue; its verdict is the final one.
    simple_log_file = case / "log.simpleFoam.continue" if (case / "log.simpleFoam.continue").exists() else case / "log.simpleFoam"
    simple_log = parse_simple_foam_log(simple_log_file) if simple_log_file.exists() else {}
    check_mesh = parse_check_mesh_log(case / "log.checkMesh") if (case / "log.checkMesh").exists() else {}
    geo = _load_json(conversion / "geo_reference.json") if (conversion / "geo_reference.json").exists() else {}
    stats = _load_json(pre / "preprocess_stats.json")
    outputs = {p.stem: p for p in out.glob("cfd_*.usd*")}
    outputs.update({f"case_{name}": case / name for name in ("case_meta.json", "log.simpleFoam", "log.simpleFoam.continue", "log.checkMesh", "log.snappyHexMesh") if (case / name).exists()})
    evidence = None
    if validation_evidence is not None:
        evidence_path = Path(validation_evidence)
        if not evidence_path.exists():
            raise FileNotFoundError(f"validation evidence not found: {evidence_path}")
        evidence = {"path": str(evidence_path), "sha256": sha256_of(evidence_path)}
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
        validation_level=validation_level,
        validation_evidence=evidence,
        solver_info=solver_info,
        simple_log=simple_log,
        weather={"epw_sha256": None, "uref_m_s": meta["params"]["uref_m_s"], "zref_m": meta["params"]["zref_m"], "z0_m": meta["params"]["z0_m"], "source": "manual_reference_wind"},
        output_files=outputs,
    )
    problems = validate_run_record(record)
    record["validation_problems"] = problems
    record["run_record_path"] = str(write_run_record(record, out / "run_record.json"))
    return record
