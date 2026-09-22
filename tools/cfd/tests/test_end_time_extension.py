"""Contract S5 / R-A4: one automatic endTime extension when residualControl is not reached."""
import json
from pathlib import Path

import pytest

from bimcfd import openfoam_case
from bimcfd.openfoam_case import CONTINUE_SCRIPT, run_case_with_extension, write_continue_script
from bimcfd.run_record import VALIDATION_LEVELS, build_run_record, validate_run_record

UNCONVERGED = "Time = 299\n...\nTime = 300\nEnd\n"
CONVERGED = "Time = 267\nSIMPLE solution converged in 267 iterations\nEnd\n"


def _case(tmp_path: Path, log: str | None = UNCONVERGED, end_time: int = 300) -> Path:
    case = tmp_path / "case_w000"
    (case / "system").mkdir(parents=True)
    (case / "system/controlDict").write_text("endTime 300;\n", encoding="utf-8")
    (case / "case_meta.json").write_text(json.dumps({"schema": "cfd-case/v1", "params": {"end_time": end_time}}), encoding="utf-8")
    if log is not None:
        (case / "log.simpleFoam").write_text(log, encoding="utf-8")
    return case


def _fake_runner(calls: list, *, exit_codes=(0, 0), continue_log: str = CONVERGED):
    def run(case_dir, script="Allrun", **kwargs):
        index = len(calls)
        calls.append({"script": script, **kwargs})
        if script == CONTINUE_SCRIPT:
            (Path(case_dir) / "log.simpleFoam.continue").write_text(continue_log, encoding="utf-8")
        return {"exit_code": exit_codes[index], "elapsed_seconds": 10.0 * (index + 1), "cancelled": False, "timed_out": False, "script": script}
    return run


def test_write_continue_script_raises_end_time_and_records_the_extension(tmp_path):
    case = _case(tmp_path)
    path = write_continue_script(case, end_time=600)
    text = path.read_text(encoding="utf-8")
    assert path.name == CONTINUE_SCRIPT
    assert "foamDictionary -entry endTime -set 600 system/controlDict" in text
    assert "foamDictionary -entry writeInterval -set 600 system/controlDict" in text
    assert "runParallel -s continue $(getApplication)" in text
    assert "runApplication -s continue reconstructPar -latestTime" in text
    assert "ALLCONTINUE_COMPLETE" in text
    assert "blockMesh" not in text and "snappyHexMesh" not in text  # resume, never re-mesh
    meta = json.loads((case / "case_meta.json").read_text(encoding="utf-8"))
    assert meta["extension"] == {"end_time_initial": 300, "end_time_effective": 600, "script": CONTINUE_SCRIPT}
    with pytest.raises(ValueError):
        write_continue_script(case, end_time=0)


def test_unconverged_first_pass_is_extended_exactly_once(tmp_path):
    case = _case(tmp_path)
    calls, extended = [], []
    summary = run_case_with_extension(case_dir=case, end_time=300, run_case_fn=_fake_runner(calls), on_extend=extended.append,
                                      container_name="cfd_run_w000", cpus=4.0, image="img")
    assert [c["script"] for c in calls] == ["Allrun", CONTINUE_SCRIPT]
    assert calls[1]["container_name"] == "cfd_run_w000_x" and calls[1]["cpus"] == 4.0 and calls[1]["image"] == "img"
    assert calls[1]["log_path"] == case / "docker_run.continue.log"
    assert extended == [600]
    assert summary["extended_to"] == 600 and summary["exit_code"] == 0
    assert summary["elapsed_seconds"] == 30.0 and len(summary["passes"]) == 2
    assert (case / CONTINUE_SCRIPT).exists()


def test_converged_first_pass_is_not_extended(tmp_path):
    case = _case(tmp_path, log=CONVERGED)
    calls = []
    summary = run_case_with_extension(case_dir=case, end_time=300, run_case_fn=_fake_runner(calls))
    assert [c["script"] for c in calls] == ["Allrun"]
    assert summary["extended_to"] is None and len(summary["passes"]) == 1
    assert not (case / CONTINUE_SCRIPT).exists()


@pytest.mark.parametrize("first", [
    {"exit_code": 1, "elapsed_seconds": 1.0, "cancelled": False, "timed_out": False},
    {"exit_code": 0, "elapsed_seconds": 1.0, "cancelled": True, "timed_out": False},
    {"exit_code": 0, "elapsed_seconds": 1.0, "cancelled": False, "timed_out": True},
])
def test_failed_cancelled_or_timed_out_first_pass_is_never_extended(tmp_path, first):
    case = _case(tmp_path)
    calls = []

    def run(case_dir, script="Allrun", **kwargs):
        calls.append(script)
        return dict(first, script=script)

    summary = run_case_with_extension(case_dir=case, end_time=300, run_case_fn=run)
    assert calls == ["Allrun"] and summary["extended_to"] is None


def test_cancel_between_passes_does_not_start_the_second_container(tmp_path):
    case = _case(tmp_path)
    calls = []
    summary = run_case_with_extension(case_dir=case, end_time=300, run_case_fn=_fake_runner(calls), should_stop=lambda: True)
    assert [c["script"] for c in calls] == ["Allrun"]
    assert summary["cancelled"] is True and summary["extended_to"] is None
    assert not (case / CONTINUE_SCRIPT).exists()


def test_fatal_error_and_missing_log_are_not_extended(tmp_path):
    calls = []
    fatal = _case(tmp_path / "a", log="Time = 3\nFOAM FATAL ERROR\n")
    assert run_case_with_extension(case_dir=fatal, end_time=300, run_case_fn=_fake_runner(calls))["extended_to"] is None
    missing = _case(tmp_path / "b", log=None)
    assert run_case_with_extension(case_dir=missing, end_time=300, run_case_fn=_fake_runner(calls))["extended_to"] is None
    assert [c["script"] for c in calls] == ["Allrun", "Allrun"]


def test_second_pass_failure_is_reported_with_the_extension(tmp_path):
    case = _case(tmp_path)
    calls = []
    summary = run_case_with_extension(case_dir=case, end_time=300, run_case_fn=_fake_runner(calls, exit_codes=(0, 2)))
    assert summary["exit_code"] == 2 and summary["extended_to"] == 600 and [p["exit_code"] for p in summary["passes"]] == [0, 2]


def test_run_case_passes_the_script_name_to_the_container(tmp_path, monkeypatch):
    seen = {}

    class FakeProc:
        returncode = 0

        def wait(self, timeout=None):
            return 0

    def popen(command, **kwargs):
        seen["command"] = command
        return FakeProc()

    monkeypatch.setattr(openfoam_case.subprocess, "Popen", popen)
    monkeypatch.setattr(openfoam_case, "image_digest", lambda image: None)
    case = tmp_path / "case"
    case.mkdir()
    summary = openfoam_case.run_case(case_dir=case, script=CONTINUE_SCRIPT, poll_interval_s=0.01)
    assert seen["command"][-1] == f"cd /case && bash ./{CONTINUE_SCRIPT}" and summary["script"] == CONTINUE_SCRIPT
    default = openfoam_case.run_case(case_dir=case, poll_interval_s=0.01)
    assert seen["command"][-1] == "cd /case && bash ./Allrun" and default["script"] == "Allrun"


def _record(tmp_path: Path, **kwargs):
    model = tmp_path / "model.usdc"
    model.write_bytes(b"usdc")
    exclusions = tmp_path / "exclusions.json"
    exclusions.write_text("{}", encoding="utf-8")
    return build_run_record(
        run_id="cfd_test", operator="t", model_usdc=model, sidecar_paths={}, source_ifc_sha256=None, conversion_reference=None,
        geo_reference={}, preprocess_stats={}, exclusions_path=exclusions,
        case_meta=kwargs.pop("case_meta", {"params": {"end_time": 300, "n_procs": 8}}),
        check_mesh={}, solver_run={"image": "img", "image_digest": "sha256:" + "a" * 64}, solver_info={}, simple_log={}, weather={},
        output_files={}, **kwargs,
    )


def test_run_record_carries_validation_level_and_effective_end_time(tmp_path):
    record = _record(tmp_path)
    assert record["validation_level"] == "screening" and record["validation_evidence"] is None
    assert record["solver"]["end_time"] == 300 and record["solver"]["end_time_effective"] == 300 and record["solver"]["extended_once"] is False
    assert any("no grid-convergence study" in item for item in record["limitations"])
    assert validate_run_record(record) == []

    extended = _record(tmp_path, case_meta={"params": {"end_time": 300, "n_procs": 8},
                                            "extension": {"end_time_initial": 300, "end_time_effective": 600, "script": CONTINUE_SCRIPT}})
    assert extended["solver"]["end_time_effective"] == 600 and extended["solver"]["extended_once"] is True

    checked = _record(tmp_path, validation_level="mesh_convergence_checked", validation_evidence={"path": "mesh_convergence.json", "sha256": "0" * 64})
    assert checked["validation_level"] == "mesh_convergence_checked"
    assert not any("no grid-convergence study" in item for item in checked["limitations"])
    with pytest.raises(ValueError):
        _record(tmp_path, validation_level="mesh_convergence_checked")  # evidence required
    with pytest.raises(ValueError):
        _record(tmp_path, validation_level="certified")
    broken = dict(record, validation_level="bogus")
    assert "invalid:validation_level" in validate_run_record(broken)
    assert VALIDATION_LEVELS == ("screening", "mesh_convergence_checked", "benchmark_compared")
