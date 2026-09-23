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
    CaseProgress,
    CaseRunPorts,
    CaseRunSpec,
    CaseSolveSpec,
    OUTCOME_KINDS,
    run_direction_case,
    run_wind_directions,
    solve_case,
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


def _solve_spec(tmp_path: Path, shell: Path, *, tag: str = "w000", wind_from: float = 0.0, cpus=None, **overrides) -> CaseSolveSpec:
    return CaseSolveSpec(
        run_id="cfd_test", tag=tag, case_dir=tmp_path / f"case_{tag}", shell_stl=shell,
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
            image_digest: str | None = "img@sha256:00", fail_wind: float | None = None):
    """Fake Docker adapter: writes what the solver and the sampling function objects would leave behind."""

    def run(*, case_dir, script="Allrun", **kwargs):
        case = Path(case_dir)
        calls.append({"script": script, "case_dir": case, **kwargs})
        meta = json.loads((case / "case_meta.json").read_text(encoding="utf-8"))
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


# --------------------------------------------------------------------------- solve_case


def test_solve_case_writes_the_case_solves_it_and_records_the_summary(tmp_path):
    shell = _shell(tmp_path)
    calls, events = [], []
    spec = _solve_spec(tmp_path, shell)

    out = solve_case(spec, CaseRunPorts(run_case_fn=_runner(calls), on_progress=events.append))

    assert out.kind == "solved" and out.exit_code == 0 and out.error is None
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


def test_solve_case_extension_reports_the_continue_container(tmp_path):
    shell = _shell(tmp_path)
    calls, events = [], []
    out = solve_case(_solve_spec(tmp_path, shell), CaseRunPorts(run_case_fn=_runner(calls, log=UNCONVERGED), on_progress=events.append))
    assert out.kind == "solved" and out.run_summary["extended_to"] == 10
    assert [c["script"] for c in calls] == ["Allrun", CONTINUE_SCRIPT]
    assert [(e.stage, e.container, e.extended_to) for e in events if e.stage == "solving"] == [
        ("solving", "cfd_test_w000", None), ("solving", "cfd_test_w000_x", 10)]


def test_solve_case_reports_a_case_write_failure_without_running_the_container(tmp_path):
    shell = _shell(tmp_path)
    calls = []
    out = solve_case(_solve_spec(tmp_path, shell, ground_z_m=50.0), CaseRunPorts(run_case_fn=_runner(calls)))
    assert out.kind == "case_write_failed"
    assert isinstance(out.error, ValueError) and "below ground" in out.message
    assert calls == [] and out.run_summary is None and out.exit_code is None


@pytest.mark.parametrize("log, kind", [(None, "mesh_failed"), (UNCONVERGED, "solver_failed")])
def test_solve_case_classifies_a_container_failure_by_the_solver_log(tmp_path, log, kind):
    shell = _shell(tmp_path)
    calls = []
    out = solve_case(_solve_spec(tmp_path, shell), CaseRunPorts(run_case_fn=_runner(calls, exit_code=3, log=log)))
    assert out.kind == kind and out.exit_code == 3
    assert out.run_summary["exit_code"] == 3 and (out.case_dir / "run_summary.json").exists()
    assert len(calls) == 1  # a failed first pass is never extended


def test_solve_case_cancels_before_the_container_and_when_the_container_was_killed(tmp_path):
    shell = _shell(tmp_path)
    calls = []
    early = solve_case(_solve_spec(tmp_path, shell, tag="w000"), CaseRunPorts(run_case_fn=_runner(calls), should_stop=lambda: True))
    assert early.kind == "cancelled" and calls == []
    killed = solve_case(_solve_spec(tmp_path, shell, tag="w090", wind_from=90.0), CaseRunPorts(run_case_fn=_runner(calls, cancelled=True)))
    assert killed.kind == "cancelled" and len(calls) == 1 and killed.run_summary["cancelled"] is True


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
    assert out.kind == "mesh_failed" and out.exit_code == 2 and out.record is None


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
    assert [(e.tag, e.outcome_kind) for e in events if e.stage == "direction_done"] == [("w000", "ready"), ("w090", "solver_failed"), ("w180", "ready")]


def test_loop_stops_at_the_first_outcome_kind_listed_in_stop_on(tmp_path):
    specs = _three_specs(tmp_path)
    calls = []
    outcomes = run_wind_directions(specs, CaseRunPorts(run_case_fn=_runner(calls, fail_wind=90.0)), stop_on=frozenset({"solver_failed"}))
    assert [o.kind for o in outcomes] == ["ready", "solver_failed"]
    assert len(calls) == 2


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


def test_loop_rejects_an_unknown_stop_on_kind():
    with pytest.raises(ValueError):
        run_wind_directions([], CaseRunPorts(run_case_fn=_runner([])), stop_on=frozenset({"exploded"}))
    assert "ready" in OUTCOME_KINDS and "case_write_failed" in OUTCOME_KINDS
