"""CFD Case Run (docs/architecture/cfd-case-run-adr.md): solve, direction case and the direction loop.

The runner port is faked; case writing, sampling parsing, USD overlay export and the run record
are the real implementations over fixture VTK and log files.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from bimcfd.case_run import (
    MESSAGE_LIMIT,
    OUTCOME_KINDS,
    PROGRESS_STAGES,
    SOLVE_KINDS,
    CaseOutcome,
    CaseProgress,
    CaseRunPorts,
    CaseRunSpec,
    CaseSolveSpec,
    SolveOutcome,
    direction_tag,
    latest_samples_dir,
    run_direction_case,
    run_wind_directions,
    solve_case,
    solver_log_path,
)
from bimcfd.openfoam_case import CONTINUE_SCRIPT, CaseParams
from bimcfd.stl import write_binary_stl

from test_foam_parsers import LEGACY_CELL_SCALARS, LEGACY_POLY
from test_voxel_shell import box_triangles

CONVERGED = "Time = 267\nSIMPLE solution converged in 267 iterations\nEnd\n"
UNCONVERGED = "Time = 4\n...\nTime = 5\nEnd\n"
CHECK_MESH = (
    "Mesh stats\n    points:           1234\n    faces:            5000\n    cells:            2000\n"
    "    Max non-orthogonality = 61.2 average: 8.1\n    Max skewness = 3.1 OK.\n\nMesh OK.\n"
)
SOLVER_INFO = (
    "# Solver information\n"
    "# Time  p_solver p_initial p_final p_iters p_converged\n"
    "1 GAMG 1 0.01 5 false\n"
    "2 GAMG 0.0009 0.00001 3 true\n"
)
SERVICE_STOP_ON = frozenset({"case_write_failed", "runner_failed", "postprocess_failed"})  # cfd-case-run-adr.md §4


def _shell(tmp_path: Path) -> Path:
    tris = box_triangles((0, 0, 0), (20, 30, 10))
    vertices = tris.reshape(-1, 3)
    shell = tmp_path / "shell.stl"
    write_binary_stl(shell, vertices, np.arange(vertices.shape[0]).reshape(-1, 3))
    return shell


def _conversion(tmp_path: Path) -> Path:
    from pxr import Usd, UsdGeom

    conversion = tmp_path / "conversion"
    conversion.mkdir()
    stage = Usd.Stage.CreateNew(str(conversion / "model.usdc"))
    UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(stage.GetPrimAtPath("/World"))
    stage.GetRootLayer().Save()
    (conversion / "geo_reference.json").write_text(
        json.dumps({"available": True, "true_north_degrees": 12.0, "true_north_source": "ifc", "warnings": []}), encoding="utf-8"
    )
    return conversion


def _preprocess(tmp_path: Path) -> Path:
    pre = tmp_path / "pre"
    pre.mkdir()
    (pre / "exclusions.json").write_text(json.dumps({"schema": "cfd-exclusion-list/v1", "counts": {}, "items": []}), encoding="utf-8")
    (pre / "preprocess_stats.json").write_text(
        json.dumps(
            {
                "schema": "cfd-preprocess-stats/v1",
                "profile": {"profile_id": "exterior-wind/v1"},
                "effective": {"voxel_pitch_m": 0.5, "closing_radius_voxels": 4},
                "element_count_total": 3,
                "element_count_kept": 3,
                "excluded_by_reason": {},
                "shell": {"watertight": True, "leak_fraction": 0.05, "leak_fraction_limit": 0.15, "sealing_suspect": False},
            }
        ),
        encoding="utf-8",
    )
    return pre


def _params(wind_from: float = 0.0, **overrides) -> CaseParams:
    return CaseParams(wind_from_degrees=wind_from, true_north_degrees=0.0, n_procs=2, end_time=5, **overrides)


def _solve_spec(tmp_path: Path, shell: Path, *, run_id: str = "cfd_test", tag: str = "w000", wind_from: float = 0.0, cpus=None, **overrides) -> CaseSolveSpec:
    return CaseSolveSpec(
        run_id=run_id, tag=tag, case_dir=tmp_path / f"case_{tag or 'single'}", shell_stl=shell,
        params=_params(wind_from, **overrides), image="img", cpus=cpus,
    )


def _run_spec(tmp_path: Path, shell: Path, conversion: Path, pre: Path, *, tag: str = "w000", wind_from: float = 0.0) -> CaseRunSpec:
    return CaseRunSpec(
        run_id="cfd_test", tag=tag, case_dir=tmp_path / f"case_{tag}", shell_stl=shell,
        params=_params(wind_from), image="img", cpus=None,
        results_dir=tmp_path / f"results_{tag}", model_usdc=conversion / "model.usdc",
        conversion_dir=conversion, preprocess_dir=pre,
        operator="tester", conversion_reference="conv_1", source_ifc_sha256=None,
    )


def _runner(calls: list, *, exit_code: int = 0, log: str | None = CONVERGED, samples: bool = True, cancelled: bool = False,
            image_digest: str | None = "img@sha256:00", fail_wind: float | None = None, raises: BaseException | None = None,
            raise_wind: float | None = None):
    """Fake Docker adapter: writes what the solver and the sampling function objects would leave behind."""

    def run(*, case_dir, script="Allrun", **kwargs):
        case = Path(case_dir)
        calls.append({"script": script, "case_dir": case, **kwargs})
        if raises is not None:
            raise raises
        meta = json.loads((case / "case_meta.json").read_text(encoding="utf-8"))
        if raise_wind is not None and meta["wind"]["wind_from_degrees"] == raise_wind:
            raise OSError("docker daemon went away")
        code = exit_code
        if fail_wind is not None and meta["wind"]["wind_from_degrees"] == fail_wind:
            code = 1
        if script == CONTINUE_SCRIPT:
            (case / "log.simpleFoam.continue").write_text(CONVERGED, encoding="utf-8")
        elif log is not None:
            (case / "log.simpleFoam").write_text(log, encoding="utf-8")
        (case / "log.checkMesh").write_text(CHECK_MESH, encoding="utf-8")
        if samples and code == 0:
            sample_dir = case / "postProcessing" / "samples" / "5"
            sample_dir.mkdir(parents=True, exist_ok=True)
            (sample_dir / "pedestrian_1p5m.vtk").write_text(LEGACY_POLY, encoding="utf-8")
            (sample_dir / "building.vtk").write_text(LEGACY_CELL_SCALARS, encoding="utf-8")
            info_dir = case / "postProcessing" / "solverInfo" / "0"
            info_dir.mkdir(parents=True, exist_ok=True)
            (info_dir / "solverInfo.dat").write_text(SOLVER_INFO, encoding="utf-8")
        return {
            "image": kwargs.get("image"), "image_digest": image_digest, "exit_code": code, "elapsed_seconds": 1.5,
            "cancelled": cancelled, "timed_out": False, "script": script, "log": str(case / "docker_run.log"),
        }

    return run


class _StopAfter:
    """``should_stop`` that turns true from the n-th call on (``n`` counts the calls made so far)."""

    def __init__(self, true_from_call: int):
        self.true_from_call = true_from_call
        self.calls = 0

    def __call__(self) -> bool:
        self.calls += 1
        return self.calls >= self.true_from_call


# --------------------------------------------------------------------------- vocabulary


def test_vocabulary_is_closed_and_checked_at_construction(tmp_path):
    from typing import get_args

    from bimcfd.case_run import OutcomeKind, ProgressStage, SolveKind

    assert SOLVE_KINDS == ("solved", "case_write_failed", "mesh_failed", "solver_failed", "runner_failed", "cancelled")
    assert OUTCOME_KINDS == ("ready", "case_write_failed", "mesh_failed", "solver_failed", "runner_failed", "postprocess_failed", "cancelled")
    assert PROGRESS_STAGES == ("meshing", "solving", "solver_finished", "postprocessing", "direction_done")
    assert (get_args(SolveKind), get_args(OutcomeKind), get_args(ProgressStage)) == (SOLVE_KINDS, OUTCOME_KINDS, PROGRESS_STAGES)
    assert SERVICE_STOP_ON < set(OUTCOME_KINDS)
    spec = _solve_spec(tmp_path, _shell(tmp_path))
    with pytest.raises(ValueError, match="solve outcome kind"):
        SolveOutcome("exploded", spec)
    with pytest.raises(ValueError, match="case outcome kind"):
        CaseOutcome("solved", spec)
    with pytest.raises(ValueError, match="progress stage"):
        CaseProgress("dancing", "w000")


def test_case_run_id_and_container_name_follow_the_tag(tmp_path):
    shell = _shell(tmp_path)
    tagged = _solve_spec(tmp_path, shell, run_id="cfd_2026-09-23", tag="w090")
    assert tagged.case_run_id == "cfd_2026-09-23_w090" and tagged.container_name == "cfd_2026_09_23_w090"
    untagged = _solve_spec(tmp_path, shell, run_id="aij-baseline", tag="")
    assert untagged.case_run_id == "aij-baseline" and untagged.container_name == "aij_baseline"


def test_direction_tag_rounds_to_whole_degrees():
    assert [direction_tag(d) for d in (0.0, 22.5, 90.0, 337.5, 359.6)] == ["w000", "w022", "w090", "w338", "w000"]


def test_layout_helpers_prefer_the_continue_log_and_the_latest_sample_time(tmp_path):
    case = tmp_path / "case"
    (case / "postProcessing" / "samples" / "9").mkdir(parents=True)
    (case / "postProcessing" / "samples" / "10").mkdir()
    assert latest_samples_dir(case) == case / "postProcessing" / "samples" / "10"  # numeric, not lexical, order
    assert latest_samples_dir(tmp_path / "nowhere") is None
    assert solver_log_path(case) == case / "log.simpleFoam"  # the path need not exist yet
    (case / "log.simpleFoam").write_text(UNCONVERGED, encoding="utf-8")
    (case / "log.simpleFoam.continue").write_text(CONVERGED, encoding="utf-8")
    assert solver_log_path(case) == case / "log.simpleFoam.continue"  # the extension pass has the final verdict


# --------------------------------------------------------------------------- solve_case


def test_solve_case_writes_the_case_solves_it_and_records_the_summary(tmp_path):
    shell = _shell(tmp_path)
    calls, events = [], []
    spec = _solve_spec(tmp_path, shell)

    out = solve_case(spec, CaseRunPorts(run_case_fn=_runner(calls), on_progress=events.append))

    assert out.kind == "solved" and out.exit_code == 0 and out.error is None and out.message is None
    assert out.case_meta["wind"]["wind_from_degrees"] == 0.0
    assert out.run_summary["extended_to"] is None and out.run_summary["exit_code"] == 0
    assert json.loads((spec.case_dir / "run_summary.json").read_text(encoding="utf-8"))["exit_code"] == 0
    assert calls == [{"script": "Allrun", "case_dir": spec.case_dir, "image": "img", "container_name": "cfd_test_w000"}]
    assert [(e.stage, e.container) for e in events] == [("meshing", None), ("solving", "cfd_test_w000"), ("solver_finished", None)]
    assert all(isinstance(e, CaseProgress) and e.tag == "w000" for e in events)


def test_solve_case_forwards_cpus_and_should_stop_only_when_given(tmp_path):
    shell = _shell(tmp_path)
    calls = []
    stop = lambda: False  # noqa: E731
    spec = _solve_spec(tmp_path, shell, cpus=4.0)
    solve_case(spec, CaseRunPorts(run_case_fn=_runner(calls), should_stop=stop))
    assert calls[0]["cpus"] == 4.0 and calls[0]["should_stop"] is stop


def test_solve_case_extension_runs_the_continue_container_and_reports_it(tmp_path):
    shell = _shell(tmp_path)
    calls, events = [], []
    out = solve_case(_solve_spec(tmp_path, shell), CaseRunPorts(run_case_fn=_runner(calls, log=UNCONVERGED), on_progress=events.append))
    assert out.kind == "solved" and out.run_summary["extended_to"] == 10
    assert [c["script"] for c in calls] == ["Allrun", CONTINUE_SCRIPT]
    assert calls[1]["container_name"] == "cfd_test_w000_x"
    assert [(e.stage, e.container, e.extended_to) for e in events if e.stage == "solving"] == [
        ("solving", "cfd_test_w000", None), ("solving", "cfd_test_w000_x", 10)]


def test_solve_case_reports_a_case_write_failure_without_running_the_container(tmp_path):
    shell = _shell(tmp_path)
    calls = []
    out = solve_case(_solve_spec(tmp_path, shell, ground_z_m=50.0), CaseRunPorts(run_case_fn=_runner(calls)))
    assert out.kind == "case_write_failed"
    assert isinstance(out.error, ValueError) and out.message == f"ValueError: {out.error}" and "below ground" in out.message
    assert calls == [] and out.run_summary is None and out.exit_code is None and out.case_meta is None


@pytest.mark.parametrize("log, kind", [(None, "mesh_failed"), (UNCONVERGED, "solver_failed")])
def test_solve_case_classifies_a_container_failure_by_the_solver_log(tmp_path, log, kind):
    shell = _shell(tmp_path)
    calls = []
    out = solve_case(_solve_spec(tmp_path, shell), CaseRunPorts(run_case_fn=_runner(calls, exit_code=3, log=log)))
    assert out.kind == kind and out.exit_code == 3 and out.message == "Allrun exit 3"
    assert out.run_summary["exit_code"] == 3 and (out.case_dir / "run_summary.json").exists()
    assert len(calls) == 1  # a failed first pass is never extended


def test_solve_case_turns_a_runner_that_cannot_run_into_an_outcome(tmp_path):
    shell = _shell(tmp_path)
    calls = []
    boom = FileNotFoundError("docker: command not found " + "x" * 600)
    out = solve_case(_solve_spec(tmp_path, shell), CaseRunPorts(run_case_fn=_runner(calls, raises=boom)))
    assert out.kind == "runner_failed" and out.error is boom and out.run_summary is None and out.exit_code is None
    assert out.case_meta is not None and len(calls) == 1
    assert out.message.startswith("FileNotFoundError: docker: command not found") and len(out.message) == MESSAGE_LIMIT
    assert not (out.case_dir / "run_summary.json").exists()


def test_solve_case_cancels_before_the_case_is_written(tmp_path):
    shell = _shell(tmp_path)
    calls = []
    out = solve_case(_solve_spec(tmp_path, shell), CaseRunPorts(run_case_fn=_runner(calls), should_stop=_StopAfter(1)))
    assert out.kind == "cancelled" and out.message == "cancelled before the case was written"
    assert calls == [] and out.case_meta is None and not (out.case_dir / "case_meta.json").exists()


def test_solve_case_cancels_between_writing_the_case_and_starting_the_container(tmp_path):
    shell = _shell(tmp_path)
    calls, events = [], []
    out = solve_case(_solve_spec(tmp_path, shell), CaseRunPorts(run_case_fn=_runner(calls), should_stop=_StopAfter(2), on_progress=events.append))
    assert out.kind == "cancelled" and out.message == "cancelled before the container started"
    assert calls == [] and out.case_meta is not None and (out.case_dir / "case_meta.json").exists()
    assert [e.stage for e in events] == ["meshing"]


def test_solve_case_cancels_when_the_container_was_killed_or_stop_was_requested_meanwhile(tmp_path):
    shell = _shell(tmp_path)
    calls = []
    killed = solve_case(_solve_spec(tmp_path, shell, tag="w090", wind_from=90.0), CaseRunPorts(run_case_fn=_runner(calls, cancelled=True)))
    assert killed.kind == "cancelled" and killed.message == "container cancelled" and killed.run_summary["cancelled"] is True
    # exit 0, but the supervisor asked to stop while the container was running (the fake ignores should_stop).
    late = solve_case(_solve_spec(tmp_path, shell, tag="w180", wind_from=180.0), CaseRunPorts(run_case_fn=_runner(calls), should_stop=_StopAfter(3)))
    assert late.kind == "cancelled" and late.message == "container cancelled" and late.run_summary["exit_code"] == 0
    assert (late.case_dir / "run_summary.json").exists() and len(calls) == 2


# --------------------------------------------------------------------------- run_direction_case


def test_run_direction_case_exports_the_overlay_and_writes_the_record(tmp_path):
    shell, conversion, pre = _shell(tmp_path), _conversion(tmp_path), _preprocess(tmp_path)
    calls, events = [], []
    spec = _run_spec(tmp_path, shell, conversion, pre)

    out = run_direction_case(spec, CaseRunPorts(run_case_fn=_runner(calls), on_progress=events.append))

    assert out.kind == "ready" and out.record_problems == []
    assert out.overlay_layer == spec.results_dir / "cfd_test_w000.usdc" and out.overlay_layer.exists()
    assert (spec.results_dir / "cfd_test_w000_view.usda").exists()
    assert (spec.results_dir / "run_record.json").exists() and out.record["run_id"] == "cfd_test_w000"
    assert out.record["solver"]["converged_by_residual_control"] is True and out.record["solver"]["iterations"] == 2
    assert out.record["mesh"]["cells"] == 2000
    assert out.record["case"]["wind"]["wind_from_degrees"] == 0.0
    assert set(out.postprocess["prims"]) >= {"PedestrianWind_1p5m", "BuildingSurfacePressure"}
    assert [e.stage for e in events] == ["meshing", "solving", "solver_finished", "postprocessing"]


def test_run_direction_case_reports_postprocess_failure_when_nothing_was_sampled(tmp_path):
    shell, conversion, pre = _shell(tmp_path), _conversion(tmp_path), _preprocess(tmp_path)
    out = run_direction_case(_run_spec(tmp_path, shell, conversion, pre), CaseRunPorts(run_case_fn=_runner([], samples=False)))
    assert out.kind == "postprocess_failed" and isinstance(out.error, FileNotFoundError)
    assert "no sampled surfaces" in out.message and out.run_summary["exit_code"] == 0
    assert out.record is None and out.overlay_layer is None


def test_run_direction_case_carries_record_problems_instead_of_failing(tmp_path):
    shell, conversion, pre = _shell(tmp_path), _conversion(tmp_path), _preprocess(tmp_path)
    out = run_direction_case(_run_spec(tmp_path, shell, conversion, pre), CaseRunPorts(run_case_fn=_runner([], image_digest=None)))
    assert out.kind == "ready" and out.record_problems == ["missing:solver.image_digest"]


def test_run_direction_case_passes_solve_failures_through_unchanged(tmp_path):
    shell, conversion, pre = _shell(tmp_path), _conversion(tmp_path), _preprocess(tmp_path)
    out = run_direction_case(_run_spec(tmp_path, shell, conversion, pre), CaseRunPorts(run_case_fn=_runner([], exit_code=2, log=None)))
    assert out.kind == "mesh_failed" and out.exit_code == 2 and out.record is None and out.message == "Allrun exit 2"


# --------------------------------------------------------------------------- run_wind_directions


def _three_specs(tmp_path):
    shell, conversion, pre = _shell(tmp_path), _conversion(tmp_path), _preprocess(tmp_path)
    return [
        _run_spec(tmp_path, shell, conversion, pre, tag=f"w{int(w):03d}", wind_from=float(w)) for w in (0, 90, 180)
    ]


def test_loop_continues_past_a_failed_direction_when_stop_on_is_empty(tmp_path):
    specs = _three_specs(tmp_path)
    calls, events = [], []
    outcomes = run_wind_directions(specs, CaseRunPorts(run_case_fn=_runner(calls, fail_wind=90.0), on_progress=events.append), stop_on=frozenset())
    assert [o.kind for o in outcomes] == ["ready", "solver_failed", "ready"]
    assert [o.spec.tag for o in outcomes] == ["w000", "w090", "w180"]
    done = [e for e in events if e.stage == "direction_done"]
    assert [(e.tag, e.outcome_kind) for e in done] == [("w000", "ready"), ("w090", "solver_failed"), ("w180", "ready")]
    assert [e.outcome for e in done] == outcomes  # the event carries the direction's outcome (record, layer, ...)
    assert done[0].outcome.record["solver"]["converged_by_residual_control"] is True


def test_loop_stops_at_the_first_outcome_kind_listed_in_stop_on(tmp_path):
    specs = _three_specs(tmp_path)
    calls = []
    outcomes = run_wind_directions(specs, CaseRunPorts(run_case_fn=_runner(calls, fail_wind=90.0)), stop_on=frozenset({"solver_failed"}))
    assert [o.kind for o in outcomes] == ["ready", "solver_failed"]
    assert len(calls) == 2


def test_loop_with_the_service_policy_continues_past_solver_failures_and_stops_on_postprocess_failures(tmp_path):
    specs = _three_specs(tmp_path)
    continued = run_wind_directions(specs, CaseRunPorts(run_case_fn=_runner([], fail_wind=90.0)), stop_on=SERVICE_STOP_ON)
    assert [o.kind for o in continued] == ["ready", "solver_failed", "ready"]
    for spec in specs:  # fresh case dirs for the second run
        spec.case_dir.rename(spec.case_dir.with_name(spec.case_dir.name + "_first"))
    stopped = run_wind_directions(specs, CaseRunPorts(run_case_fn=_runner([], samples=False)), stop_on=SERVICE_STOP_ON)
    assert [o.kind for o in stopped] == ["postprocess_failed"]


def test_loop_treats_a_runner_exception_by_policy(tmp_path):
    """A runner that raises mid-run: the batch policy records it and continues, the service policy aborts."""
    specs = _three_specs(tmp_path)
    calls = []
    batch = run_wind_directions(specs, CaseRunPorts(run_case_fn=_runner(calls, raise_wind=90.0)), stop_on=frozenset())
    assert [o.kind for o in batch] == ["ready", "runner_failed", "ready"]
    assert isinstance(batch[1].error, OSError) and batch[1].message == "OSError: docker daemon went away" and len(calls) == 3
    for spec in specs:
        spec.case_dir.rename(spec.case_dir.with_name(spec.case_dir.name + "_first"))
    service = run_wind_directions(specs, CaseRunPorts(run_case_fn=_runner([], raise_wind=90.0)), stop_on=SERVICE_STOP_ON)
    assert [o.kind for o in service] == ["ready", "runner_failed"]


def test_loop_stops_on_cancellation_between_directions(tmp_path):
    specs = _three_specs(tmp_path)
    seen = []

    def should_stop() -> bool:
        return len(seen) >= 1

    def on_progress(event: CaseProgress) -> None:
        if event.stage == "direction_done":
            seen.append(event.tag)

    outcomes = run_wind_directions(specs, CaseRunPorts(run_case_fn=_runner([]), should_stop=should_stop, on_progress=on_progress), stop_on=frozenset())
    assert [o.kind for o in outcomes] == ["ready", "cancelled"]
    assert outcomes[1].spec.tag == "w090" and outcomes[1].run_summary is None
    assert outcomes[1].message == "cancelled before the direction started"


def test_loop_rejects_an_unknown_stop_on_kind():
    with pytest.raises(ValueError, match="stop_on has unknown outcome kinds \\['exploded'\\]"):
        run_wind_directions([], CaseRunPorts(run_case_fn=_runner([])), stop_on=frozenset({"exploded"}))
