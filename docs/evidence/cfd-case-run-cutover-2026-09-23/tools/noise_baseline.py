"""Run-to-run noise baseline for the CFD Case Run cutover evidence (#917 review F1–F3, same-version repeats 2026-09-24).

Usage: noise_baseline.py <evidence_dir> <out_json>
Reads <dir>/<label>/{status,result,run_record}.json for `before` and every same-version run present (after, after2, …) and
<dir>/field_stats.json. For every metric it writes the before value next to the same-version values, their median and
range (max − min), and two checks decided before the repeats were captured:
  within_noise: |before − median(same version)| <= range(same version)   (the verdict criterion)
  inside_range: min(same version) <= before <= max(same version)          (stricter; reported, not used for the verdict)
Numbers only.
"""
import json
import statistics
import sys
from datetime import datetime
from pathlib import Path

ev, out_path = Path(sys.argv[1]), Path(sys.argv[2])
SAME_VERSION = [label for label in ("after", "after2", "after3", "after4", "after5") if (ev / label / "result.json").exists()]
LABELS = ["before", *SAME_VERSION]


def load(label: str, name: str) -> dict:
    return json.loads((ev / label / name).read_text(encoding="utf-8"))


def direction(label: str) -> dict:
    return load(label, "result.json")["directions"][0]


def record_direction(label: str) -> dict:
    return load(label, "run_record.json")["directions"][0]


def job_seconds(label: str) -> float:
    st = load(label, "status.json")["status"]
    started = datetime.fromisoformat(st["started_at"].replace("Z", "+00:00"))
    finished = datetime.fromisoformat(st["finished_at"].replace("Z", "+00:00"))
    return (finished - started).total_seconds()


metrics: dict[str, dict] = {}
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


def numeric(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


rows = []
for key in metrics["before"]:
    before = metrics["before"][key]
    values = {label: metrics[label][key] for label in SAME_VERSION}
    row = {"metric": key, "before": before, "same_version": values}
    if numeric(before) and all(numeric(v) for v in values.values()):
        seq = list(values.values())
        median, low, high = statistics.median(seq), min(seq), max(seq)
        spread = high - low
        distance = abs(before - median)
        row.update({
            "same_version_median": median, "same_version_min": low, "same_version_max": high, "same_version_range": spread,
            "before_minus_median_abs": distance,
            "before_minus_median_rel": (distance / abs(median)) if median else None,
            "within_noise": distance <= spread if spread > 0 else distance == 0,
            "inside_range": low <= before <= high,
        })
    else:
        same = all(v == before for v in values.values())
        row.update({"all_equal": same, "within_noise": same, "inside_range": same})
    rows.append(row)

report = {
    "criterion": {
        "within_noise": "|before - median(same_version)| <= max(same_version) - min(same_version); equality for non-numeric metrics",
        "inside_range": "min(same_version) <= before <= max(same_version); reported only",
        "decided_before_capturing": ["after3", "after4", "after5"],
    },
    "runs": {label: load(label, "result.json")["run_id"] for label in LABELS},
    "same_version_labels": SAME_VERSION,
    "rows": rows,
}
out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
for row in rows:
    print(f"{row['metric']:42s} before={row['before']!s:>14} range={row.get('same_version_range')!s:>12} "
          f"dist={row.get('before_minus_median_abs')!s:>12} within={row['within_noise']} inside={row['inside_range']}")
