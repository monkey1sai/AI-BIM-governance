"""Run-to-run noise baseline for the CFD Case Run cutover evidence (#917 review F1–F3).

Usage: noise_baseline.py <evidence_dir> <out_json>
Reads <dir>/{before,after,after2}/{status,result,run_record}.json and <dir>/field_stats.json and writes, for every
metric, the before→after delta (across the cutover) next to the after→after2 delta (same deployed version, same request).
Numbers only.
"""
import json
import sys
from pathlib import Path

ev, out_path = Path(sys.argv[1]), Path(sys.argv[2])
LABELS = ("before", "after", "after2")


def load(label: str, name: str) -> dict:
    return json.loads((ev / label / name).read_text(encoding="utf-8"))


def direction(label: str) -> dict:
    return load(label, "result.json")["directions"][0]


def record_direction(label: str) -> dict:
    return load(label, "run_record.json")["directions"][0]


def job_seconds(label: str) -> float:
    from datetime import datetime

    st = load(label, "status.json")["status"]
    started = datetime.fromisoformat(st["started_at"].replace("Z", "+00:00"))
    finished = datetime.fromisoformat(st["finished_at"].replace("Z", "+00:00"))
    return (finished - started).total_seconds()


metrics = {}
for label in LABELS:
    d, r = direction(label), record_direction(label)
    mesh, solver = r.get("mesh") or {}, r.get("solver") or {}
    metrics[label] = {
        "iterations": d.get("iterations"),
        "converged_by_residual_control": d.get("converged_by_residual_control"),
        "mesh_cells": d.get("mesh_cells"),
        "mesh_faces": mesh.get("faces"),
        "mesh_points": mesh.get("points"),
        "max_non_orthogonality": mesh.get("max_non_orthogonality"),
        "max_skewness": mesh.get("max_skewness"),
        "U_magnitude_max": (d.get("pedestrian_1p5m") or {}).get("U_magnitude_max"),
        "pedestrian_polygons": (d.get("pedestrian_1p5m") or {}).get("polygons"),
        "p_min": (d.get("building_pressure") or {}).get("p_min"),
        "p_max": (d.get("building_pressure") or {}).get("p_max"),
        "solver_elapsed_seconds": solver.get("elapsed_seconds"),
        "job_wall_seconds": job_seconds(label),
        "case_meta_sha256": ((r.get("outputs") or {}).get("case_case_meta.json") or {}).get("sha256"),
    }

fields = json.loads((ev / "field_stats.json").read_text(encoding="utf-8"))["layers"]
for label in LABELS:
    for prim, stats in fields[label].items():
        for key in ("n", "faces", "points", "p05", "mean", "p50", "p95"):
            metrics[label][f"{prim}.{key}"] = stats[key]


def delta(a, b):
    if isinstance(a, bool) or isinstance(b, bool) or not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return {"abs": None, "rel": None, "same": a == b}
    return {"abs": abs(b - a), "rel": (abs(b - a) / abs(a)) if a else None, "same": a == b}


rows = []
for key in metrics["before"]:
    across = delta(metrics["before"][key], metrics["after"][key])
    repeat = delta(metrics["after"][key], metrics["after2"][key])
    within = None
    if across["abs"] is not None and repeat["abs"] is not None:
        within = across["abs"] <= repeat["abs"] if repeat["abs"] > 0 else across["abs"] == 0
    rows.append({"metric": key, "before": metrics["before"][key], "after": metrics["after"][key], "after2": metrics["after2"][key],
                 "cutover_delta": across, "repeat_delta": repeat, "cutover_within_repeat": within})
report = {"runs": {label: load(label, "result.json")["run_id"] for label in LABELS}, "rows": rows}
out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
for row in rows:
    c, r = row["cutover_delta"], row["repeat_delta"]
    print(f"{row['metric']:42s} before={row['before']!s:>14} after={row['after']!s:>14} after2={row['after2']!s:>14} "
          f"cut_abs={c['abs']!s:>10} rep_abs={r['abs']!s:>10} within={row['cutover_within_repeat']}")
