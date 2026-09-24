"""Compare a 'before' and an 'after' CFD run capture (cfd-case-run-adr.md Verification item 4).

Usage: compare_runs.py <before_dir> <after_dir> <out_json> <schema_path>
Compares the normalised request (idempotency_key and origin excluded), per-direction metrics, the run-level
documents' structural keys, validates both results against the frozen result schema, and writes compare.json.
Only numbers, sha256 values and key names are recorded.
"""
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

before_dir, after_dir, out_path, schema_path = (Path(p) for p in sys.argv[1:5])


def load(d: Path, name: str) -> dict:
    return json.loads((d / name).read_text(encoding="utf-8"))


def request_of(status_doc: dict) -> dict:
    st = status_doc.get("status") or {}
    req = dict(st.get("request") or {})
    req.pop("idempotency_key", None)
    req.pop("requested_by", None)
    return req


def direction_metrics(d: dict) -> dict:
    ped = d.get("pedestrian_1p5m") or {}
    bp = d.get("building_pressure") or {}
    return {
        "wind_from_degrees": d.get("wind_from_degrees"),
        "status": d.get("status"),
        "converged_by_residual_control": d.get("converged_by_residual_control"),
        "iterations": d.get("iterations"),
        "end_time_extended_to": d.get("end_time_extended_to"),
        "mesh_cells": d.get("mesh_cells"),
        "U_magnitude_max": ped.get("U_magnitude_max"),
        "polygons": ped.get("polygons"),
        "p_min": bp.get("p_min"),
        "p_max": bp.get("p_max"),
        "overlay_artifact_id": (d.get("overlay_layer") or {}).get("artifact_id"),
        "overlay_sha256": (d.get("overlay_layer") or {}).get("sha256"),
    }


def rel(a, b):
    if a is None or b is None or not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return None
    return None if a == 0 else abs(b - a) / abs(a)


schema = Draft202012Validator(json.loads(schema_path.read_text(encoding="utf-8")))
report = {"before": {}, "after": {}, "request_equal": None, "request_diff": {}, "directions": [], "schema_errors": {}, "document_keys": {}}
caps = {}
for label, d in (("before", before_dir), ("after", after_dir)):
    status, result = load(d, "status.json"), load(d, "result.json")
    caps[label] = (status, result)
    st = status.get("status") or {}
    report[label] = {
        "run_id": result.get("run_id"),
        "status": result.get("status"),
        "created_at": st.get("created_at"), "started_at": st.get("started_at"), "finished_at": st.get("finished_at"),
        "converged_count": st.get("converged_count"), "sealing_suspect": result.get("preprocess", {}).get("sealing_suspect"),
        "leak_fraction": result.get("preprocess", {}).get("leak_fraction"),
        "run_record_sha256": (result.get("run_record") or {}).get("sha256"),
        "exclusions_sha256": (result.get("exclusions") or {}).get("sha256"),
        "exclusion_counts": (result.get("exclusions") or {}).get("counts"),
        "assumptions": result.get("assumptions"), "limitations": result.get("limitations"),
        "validation_level": result.get("validation_level"),
    }
    report["schema_errors"][label] = [e.message for e in schema.iter_errors(result)]
    report["document_keys"][label] = {"result": sorted(result), "status": sorted(st)}
    rr = d / "run_record.json"
    if rr.exists():
        record = json.loads(rr.read_text(encoding="utf-8"))
        report["document_keys"][label]["run_record"] = sorted(record)
        report[label]["run_record_direction_keys"] = [sorted(x) for x in record.get("directions", [])]
        report[label]["run_record_solver"] = [{k: (x.get("solver") or {}).get(k) for k in ("iterations", "converged_by_residual_control", "end_time_effective", "extended_once", "exit_code")} for x in record.get("directions", [])]

rb, ra = request_of(caps["before"][0]), request_of(caps["after"][0])
report["request_equal"] = rb == ra
report["request_diff"] = {k: {"before": rb.get(k), "after": ra.get(k)} for k in sorted(set(rb) | set(ra)) if rb.get(k) != ra.get(k)}
db = {d.get("wind_from_degrees"): direction_metrics(d) for d in caps["before"][1].get("directions", [])}
da = {d.get("wind_from_degrees"): direction_metrics(d) for d in caps["after"][1].get("directions", [])}
for wind in sorted(set(db) | set(da), key=lambda x: (x is None, x)):
    b, a = db.get(wind, {}), da.get(wind, {})
    row = {"wind_from_degrees": wind, "before": b, "after": a, "relative_delta": {}}
    for k in ("iterations", "mesh_cells", "U_magnitude_max", "polygons", "p_min", "p_max"):
        row["relative_delta"][k] = rel(b.get(k), a.get(k))
    row["same_status"] = b.get("status") == a.get("status")
    row["same_convergence"] = b.get("converged_by_residual_control") == a.get("converged_by_residual_control")
    report["directions"].append(row)
report["document_keys"]["result_keys_added_after"] = sorted(set(report["document_keys"]["after"]["result"]) - set(report["document_keys"]["before"]["result"]))
report["document_keys"]["result_keys_removed_after"] = sorted(set(report["document_keys"]["before"]["result"]) - set(report["document_keys"]["after"]["result"]))
out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"request_equal": report["request_equal"], "request_diff": report["request_diff"], "schema_errors": report["schema_errors"],
                  "directions": [{"wind": r["wind_from_degrees"], "same_status": r["same_status"], "same_convergence": r["same_convergence"], "relative_delta": r["relative_delta"]} for r in report["directions"]],
                  "result_keys_added_after": report["document_keys"]["result_keys_added_after"]}, ensure_ascii=False, indent=2))
