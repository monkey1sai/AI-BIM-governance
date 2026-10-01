"""Offline pilot guards; fake runner never starts Docker."""
import importlib.util
import json
from pathlib import Path

import pytest

from test_case_run import _shell
from test_foam_parsers import LEGACY_CELL_SCALARS, LEGACY_POLY
from bimcfd.openfoam_case import CaseParams, build_case

spec = importlib.util.spec_from_file_location("transient_probe", Path(__file__).parents[1] / "probes/transient_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


@pytest.fixture
def source(tmp_path):
    case = tmp_path / "source"
    build_case(shell_stl=_shell(tmp_path), out_dir=case,
               params=CaseParams(0, 0, presentation_version=2, n_procs=4))
    (case / "run_summary.json").write_text(json.dumps({"exit_code": 0}))
    (case / "483").mkdir()
    (case / "constant/polyMesh").mkdir()
    (case / "constant/polyMesh/points").write_text("mesh fixture")
    for name in probe.FIELDS:
        (case / "483" / name).write_bytes(b"unchanged field fixture")
    return case


def test_prepare_isolated_physical_time_and_input_immutability(source, tmp_path):
    before = {str(path): probe.sha256(path) for path in source.rglob("*") if path.is_file()}
    case = tmp_path / "pilot"
    manifest = probe.prepare(source, case)
    assert before == {str(path): probe.sha256(path) for path in source.rglob("*") if path.is_file()}
    assert manifest["source_iteration"] == "483"
    assert manifest["physical_time_origin_s"] == 0
    control = (case / "system/controlDict").read_text()
    assert "application pimpleFoam" in control and "endTime 10;" in control
    assert "maxCo 1;" in control and "writeInterval 0.5;" in control
    assert "onEnd" not in control and "streamlines" not in control
    assert "Euler" in (case / "system/fvSchemes").read_text()
    assert "PIMPLE" in (case / "system/fvSolution").read_text()
    assert "timeout --signal=KILL 1680s" in (case / "Alltransient").read_text()
    assert not (case / "Allrun").exists()
    with pytest.raises(ValueError, match="new and outside"):
        probe.prepare(source, case)


@pytest.mark.parametrize("duration,interval", [(11, .5), (10, .1), (float("nan"), .5), (10, 0)])
def test_refuse_unbounded_sampling(source, tmp_path, duration, interval):
    with pytest.raises(ValueError):
        probe.prepare(source, tmp_path / "pilot", duration_s=duration, interval_s=interval)


def test_reject_failed_or_nested_case(source):
    with pytest.raises(ValueError, match="outside"):
        probe.prepare(source, source / "pilot")
    (source / "run_summary.json").write_text('{"exit_code": 1}')
    with pytest.raises(ValueError, match="successfully"):
        probe.prepare(source, source.parent / "pilot")


def frame(case, time, *, pressure=True):
    path = case / "postProcessing/samples" / time
    path.mkdir(parents=True)
    for name in ("pedestrian_1p5m", "near_wall_speed"):
        (path / (name + ".vtk")).write_text(LEGACY_POLY)
    if pressure:
        (path / "building.vtk").write_text(LEGACY_CELL_SCALARS)


def test_never_mix_timestamps_or_carry_pressure_forward(tmp_path):
    frame(tmp_path, "0.5")
    frame(tmp_path, "1", pressure=False)
    frame(tmp_path, "1.5")
    result = probe.collect(tmp_path)
    assert [item["time_s"] for item in result["frames"]] == [.5, 1.5]
    assert result["incomplete_frames"][0]["time_s"] == 1
    assert result["time_series_available"] and not result["engineering_validated"]
    assert all(set(item["fields"]) == set(probe.SURFACES) for item in result["frames"])


def test_single_attempt_hard_budget_keeps_partial_outputs(source, tmp_path):
    case = tmp_path / "pilot"
    probe.prepare(source, case)
    calls = []
    def fake(**kwargs):
        calls.append(kwargs)
        frame(case, "0.5")
        return {"exit_code": 137, "timed_out": True}
    report = probe.execute(case, runner=fake, has_image=lambda image: True)
    assert calls[0]["timeout_s"] == 1680 < probe.WALL_CAP_SECONDS
    assert calls[0]["cpus"] == 4 and calls[0]["script"] == "Alltransient"
    assert calls[0]["should_stop"]() is False
    assert report["same_time_pairs"] == 1 and not report["time_series_available"]
    assert (case / "postProcessing/samples/0.5/building.vtk").exists()
    with pytest.raises(FileExistsError):
        probe.execute(case, runner=fake, has_image=lambda image: True)
    assert len(calls) == 1


def test_missing_image_never_starts_or_spends_attempt(source, tmp_path):
    case = tmp_path / "pilot"
    probe.prepare(source, case)
    with pytest.raises(RuntimeError, match="no automatic pull"):
        probe.execute(case, runner=lambda **kw: pytest.fail("must not run"), has_image=lambda image: False)
    assert not (case / "pilot_started.json").exists()
