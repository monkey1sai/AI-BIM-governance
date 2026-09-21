from __future__ import annotations

import json

import numpy as np
import pytest

from bimcfd import batch as batch_module
from bimcfd.batch import BATCH_SCHEMA, run_batch, summarize_batch, wind_directions
from bimcfd.stl import write_binary_stl

from test_voxel_shell import box_triangles


def test_wind_directions_even_split():
    dirs = wind_directions(16)
    assert len(dirs) == 16
    assert dirs[0] == 0.0 and dirs[1] == 22.5 and dirs[-1] == 337.5
    assert wind_directions(4, start_degrees=45.0) == [45.0, 135.0, 225.0, 315.0]
    with pytest.raises(ValueError):
        wind_directions(0)


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


def test_run_batch_records_failures_and_continues(tmp_path, monkeypatch):
    tris = box_triangles((0, 0, 0), (20, 30, 10))
    vertices = tris.reshape(-1, 3)
    shell = tmp_path / "shell.stl"
    write_binary_stl(shell, vertices, np.arange(vertices.shape[0]).reshape(-1, 3))

    calls: list[float] = []

    def fake_run_case(*, case_dir, image):
        direction = json.loads((case_dir / "case_meta.json").read_text(encoding="utf-8"))["wind"]["wind_from_degrees"]
        calls.append(direction)
        return {"image": image, "image_digest": "img@sha256:00", "exit_code": 1 if direction == 90.0 else 0, "elapsed_seconds": 0.1}

    def fake_post(case_dir, model_usdc, run_id, out_dir):
        out_dir.mkdir(parents=True, exist_ok=True)
        return {"layer": str(out_dir / f"{run_id}.usdc"), "prims": {"PedestrianWind_1p5m": {"U_magnitude_max": 2.5}}}

    def fake_record(**kwargs):
        return {"solver": {"iterations": 100, "converged_by_residual_control": True, "final_initial_residuals": {"p": 1e-4}}, "mesh": {"cells": 10}, "validation_problems": []}

    monkeypatch.setattr(batch_module, "run_case", fake_run_case)

    summary = run_batch(
        shell_stl=shell,
        model_usdc=tmp_path / "model.usdc",
        conversion_dir=tmp_path,
        preprocess_dir=tmp_path,
        out_root=tmp_path / "batch",
        directions=[0.0, 90.0, 180.0],
        true_north_degrees=0.0,
        case_overrides={"n_procs": 2, "end_time": 5},
        postprocess_fn=fake_post,
        record_fn=fake_record,
    )

    assert calls == [0.0, 90.0, 180.0]
    assert summary["schema"] == BATCH_SCHEMA
    assert summary["ok_count"] == 2
    assert summary["failed_directions"] == [90.0]
    assert summary["entries"][1]["error"].startswith("RuntimeError")
    assert summary["pedestrian_peak"]["U_magnitude_max"] == 2.5
    written = json.loads((tmp_path / "batch" / "batch_summary.json").read_text(encoding="utf-8"))
    assert written["direction_count"] == 3
    assert (tmp_path / "batch" / "case_w090" / "case_meta.json").exists()
