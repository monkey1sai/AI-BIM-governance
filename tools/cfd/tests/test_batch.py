"""``bimcfd batch``: one CFD Case Run per direction, ``batch_summary.json`` rewritten after every direction."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from bimcfd.batch import BATCH_SCHEMA, direction_tag, run_batch, summarize_batch, wind_directions

from test_case_run import _conversion, _preprocess, _runner, _shell

TOOLS_CFD = Path(__file__).resolve().parents[1]


def test_wind_directions_even_split():
    dirs = wind_directions(16)
    assert len(dirs) == 16
    assert dirs[0] == 0.0 and dirs[1] == 22.5 and dirs[-1] == 337.5
    assert wind_directions(4, start_degrees=45.0) == [45.0, 135.0, 225.0, 315.0]
    with pytest.raises(ValueError):
        wind_directions(0)


def test_direction_tag_rounds_to_whole_degrees():
    assert [direction_tag(d) for d in (0.0, 22.5, 90.0, 337.5, 359.6)] == ["w000", "w022", "w090", "w338", "w000"]


def test_summarize_batch_counts_and_peak():
    entries = [
        {"wind_from_degrees": 0.0, "status": "ok", "elapsed_seconds": 10, "pedestrian": {"U_magnitude_max": 2.0}, "solver": {"converged_by_residual_control": True}},
        {"wind_from_degrees": 90.0, "status": "ok", "elapsed_seconds": 12, "pedestrian": {"U_magnitude_max": 3.5}, "solver": {"converged_by_residual_control": False}},
        {"wind_from_degrees": 180.0, "status": "failed", "elapsed_seconds": 1, "error": "boom"},
    ]
    summary = summarize_batch(entries)
    assert summary["direction_count"] == 3
    assert summary["ok_count"] == 2
    assert summary["failed_directions"] == [180.0]
    assert summary["converged_count"] == 1
    assert summary["pedestrian_peak"] == {"wind_from_degrees": 90.0, "U_magnitude_max": 3.5}
    assert summary["total_elapsed_seconds"] == 23.0


def _inputs(tmp_path: Path) -> dict:
    shell, conversion, pre = _shell(tmp_path), _conversion(tmp_path), _preprocess(tmp_path)
    return dict(shell_stl=shell, model_usdc=conversion / "model.usdc", conversion_dir=conversion, preprocess_dir=pre, true_north_degrees=0.0,
                case_overrides={"n_procs": 2, "end_time": 5}, operator="tester", conversion_reference="conv_1")


def test_run_batch_records_failures_and_continues(tmp_path):
    calls = []
    summary = run_batch(**_inputs(tmp_path), out_root=tmp_path / "batch", directions=[0.0, 90.0, 180.0], run_case_fn=_runner(calls, fail_wind=90.0))

    run_id = summary["run_id"]
    assert re.fullmatch(r"cfd_\d{8}T\d{6}Z_[0-9a-f]{6}", run_id) and summary["batch_id"] == run_id.replace("cfd_", "cfdbatch_", 1)
    # every container is named after its case run id (cfd-case-run-adr.md §4)
    assert [c["container_name"] for c in calls] == [f"{run_id}_w000", f"{run_id}_w090", f"{run_id}_w180"]
    assert summary["schema"] == BATCH_SCHEMA and summary["direction_count"] == 3
    assert summary["ok_count"] == 2 and summary["failed_count"] == 1 and summary["failed_directions"] == [90.0]
    assert summary["converged_count"] == 2 and summary["pedestrian_peak"] == pytest.approx({"wind_from_degrees": 0.0, "U_magnitude_max": 4.0})

    ok, failed = summary["entries"][0], summary["entries"][1]
    assert ok["status"] == "ok" and ok["run_id"] == f"{run_id}_w000" and ok["case_dir"].endswith("case_w000")
    assert ok["pedestrian"]["U_magnitude_max"] == pytest.approx(4.0) and ok["building_pressure"] is not None
    assert ok["solver"]["iterations"] == 2 and ok["solver"]["converged_by_residual_control"] is True and "final_initial_residuals" in ok["solver"]
    assert ok["mesh"]["cells"] == 2000 and ok["record_problems"] == [] and ok["result_layer"].endswith(f"{run_id}_w000.usdc")
    assert ok["mesh_cells_background"] > 0 and ok["solver_exit_code"] == 0 and ok["elapsed_seconds"] >= 0
    assert failed["status"] == "failed" and failed["failure_kind"] == "solver_failed" and failed["error"] == "Allrun exit 1"
    assert failed["solver_exit_code"] == 1 and failed["mesh_cells_background"] > 0 and "pedestrian" not in failed

    written = json.loads((tmp_path / "batch" / "batch_summary.json").read_text(encoding="utf-8"))
    assert written["run_id"] == run_id and written["direction_count"] == 3 and [e["status"] for e in written["entries"]] == ["ok", "failed", "ok"]
    assert (tmp_path / "batch" / "results_w000" / "run_record.json").exists() and (tmp_path / "batch" / "case_w090" / "case_meta.json").exists()
    assert not (tmp_path / "batch" / "results_w090").exists()


def test_run_batch_writes_the_summary_after_every_direction(tmp_path):
    seen = []
    inner = _runner([])

    def run(*, case_dir, **kwargs):
        path = tmp_path / "batch" / "batch_summary.json"
        seen.append(len(json.loads(path.read_text(encoding="utf-8"))["entries"]) if path.exists() else 0)
        return inner(case_dir=case_dir, **kwargs)

    run_batch(**_inputs(tmp_path), out_root=tmp_path / "batch", directions=[0.0, 90.0], run_case_fn=run)
    assert seen == [0, 1]


def test_run_batch_records_a_runner_error_and_a_case_write_failure_without_stopping(tmp_path):
    inputs = _inputs(tmp_path)
    calls = []
    summary = run_batch(**inputs, out_root=tmp_path / "batch", directions=[0.0, 90.0, 180.0], run_case_fn=_runner(calls, raise_wind=90.0))
    assert [e["status"] for e in summary["entries"]] == ["ok", "failed", "ok"] and len(calls) == 3
    assert summary["entries"][1]["failure_kind"] == "runner_failed" and summary["entries"][1]["error"] == "OSError: docker daemon went away"

    bad = run_batch(**{**inputs, "case_overrides": {"n_procs": 2, "end_time": 5, "ground_z_m": 50.0}}, out_root=tmp_path / "bad", directions=[0.0],
                    run_case_fn=_runner(calls))
    assert bad["failed_count"] == 1 and bad["entries"][0]["failure_kind"] == "case_write_failed" and bad["entries"][0]["error"].startswith("ValueError")
    assert len(calls) == 3 and "solver_exit_code" not in bad["entries"][0]


def test_two_batches_started_in_the_same_second_get_distinct_run_ids(tmp_path):
    inputs = _inputs(tmp_path)
    ids = {run_batch(**inputs, out_root=tmp_path / name, directions=[0.0], run_case_fn=_runner([]))["run_id"] for name in ("a", "b")}
    assert len(ids) == 2


def test_drivers_do_not_import_the_cli():
    """cfd-case-run-adr.md §3: batch, convergence and the AIJ benchmark hold their own drivers; ``cli.py`` only parses."""
    code = "import sys, bimcfd.batch, bimcfd.convergence, bimcfd.aij_case_c; assert 'bimcfd.cli' not in sys.modules"
    subprocess.run([sys.executable, "-c", code], check=True, cwd=str(TOOLS_CFD), timeout=120)
