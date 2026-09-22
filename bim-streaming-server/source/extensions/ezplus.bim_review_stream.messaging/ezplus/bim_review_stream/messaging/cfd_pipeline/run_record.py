"""``cfd-run-record/v1``: the traceability document of one simulation run."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "cfd-run-record/v1"

REQUIRED_TOP_LEVEL = (
    "schema",
    "run_id",
    "created_at_utc",
    "operator",
    "purpose",
    "source",
    "geo_reference",
    "preprocess",
    "case",
    "mesh",
    "solver",
    "weather",
    "outputs",
    "limitations",
    "validation_level",
)

# Contract S5: how far this run has been checked beyond a single solve.
VALIDATION_LEVELS = ("screening", "mesh_convergence_checked", "benchmark_compared")


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_run_record(
    *,
    run_id: str,
    operator: str,
    model_usdc: Path,
    sidecar_paths: dict[str, Path],
    source_ifc_sha256: str | None,
    conversion_reference: str | None,
    geo_reference: dict,
    preprocess_stats: dict,
    exclusions_path: Path,
    case_meta: dict,
    check_mesh: dict,
    solver_run: dict,
    solver_info: dict,
    simple_log: dict,
    weather: dict,
    output_files: dict[str, Path],
    limitations: list[str] | None = None,
    validation_level: str = "screening",
    validation_evidence: dict | None = None,
) -> dict:
    if validation_level not in VALIDATION_LEVELS:
        raise ValueError(f"validation_level must be one of {VALIDATION_LEVELS}: {validation_level!r}")
    if validation_level != "screening" and not validation_evidence:
        raise ValueError("validation_level above screening requires validation_evidence (path + sha256 of the study document)")
    extension = case_meta.get("extension") or {}
    record = {
        "schema": SCHEMA,
        "run_id": run_id,
        "created_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "operator": operator,
        "purpose": "design_comparison_only",
        "source": {
            "conversion_reference": conversion_reference,
            "model_usdc": {"path": str(model_usdc), "sha256": sha256_of(model_usdc)},
            "source_ifc_sha256": source_ifc_sha256,
            "sidecars": {name: {"path": str(path), "sha256": sha256_of(path)} for name, path in sidecar_paths.items() if Path(path).exists()},
        },
        "geo_reference": {
            "available": geo_reference.get("available"),
            "true_north_degrees": geo_reference.get("true_north_degrees"),
            "true_north_source": geo_reference.get("true_north_source"),
            "grid_north_degrees": geo_reference.get("grid_north_degrees"),
            "site_geolocation_present": geo_reference.get("site") is not None,
            "warnings": list(geo_reference.get("warnings") or []),
        },
        "preprocess": {
            "profile": preprocess_stats.get("profile", {}).get("profile_id"),
            "effective": preprocess_stats.get("effective"),
            "element_count_total": preprocess_stats.get("element_count_total"),
            "element_count_kept": preprocess_stats.get("element_count_kept"),
            "excluded_by_reason": preprocess_stats.get("excluded_by_reason"),
            "exclusion_list": {"path": str(exclusions_path), "sha256": sha256_of(exclusions_path)},
            "shell": preprocess_stats.get("shell"),
        },
        "case": {
            "wind": case_meta.get("wind"),
            "assumptions": case_meta.get("assumptions"),
            "domain": case_meta.get("domain"),
            "background_mesh": case_meta.get("background_mesh"),
            "refinement": {
                "surface_level": case_meta.get("params", {}).get("surface_refinement_level"),
                "region_level": case_meta.get("params", {}).get("region_refinement_level"),
            },
            "boundary_conditions": {
                "inlet": "atmBoundaryLayerInlet(U,k,omega)",
                "outlet": "inletOutlet / p fixedValue 0",
                "sides_top": "slip",
                "ground": "noSlip + atmNutkWallFunction(z0)",
                "building": "noSlip + wall functions",
            },
            "initial_conditions": case_meta.get("initial_conditions"),
        },
        "mesh": check_mesh,
        "solver": {
            "image": solver_run.get("image"),
            "image_digest": solver_run.get("image_digest"),
            "application": "simpleFoam",
            "turbulence_model": case_meta.get("params", {}).get("turbulence_model"),
            "end_time": case_meta.get("params", {}).get("end_time"),
            "end_time_effective": extension.get("end_time_effective") or case_meta.get("params", {}).get("end_time"),
            "extended_once": bool(extension),
            "n_procs": case_meta.get("params", {}).get("n_procs"),
            "exit_code": solver_run.get("exit_code"),
            "elapsed_seconds": solver_run.get("elapsed_seconds"),
            "iterations": solver_info.get("iterations"),
            "converged_by_residual_control": simple_log.get("converged_by_residual_control"),
            "final_initial_residuals": solver_info.get("final_initial_residuals"),
            "fatal_error": simple_log.get("fatal_error"),
        },
        "weather": weather,
        "outputs": {name: {"path": str(path), "sha256": sha256_of(path)} for name, path in output_files.items() if Path(path).exists()},
        "validation_level": validation_level,
        "validation_evidence": validation_evidence,
        "limitations": limitations
        or [
            "Results are for design comparison only; not a regulatory or certification basis.",
            *(["Coarse proof-of-concept mesh; no grid-convergence study."] if validation_level == "screening" else []),
            "Georeference unavailable: wind direction is relative to project north unless true north is provided.",
        ],
    }
    return record


def validate_run_record(record: dict) -> list[str]:
    problems = [f"missing:{key}" for key in REQUIRED_TOP_LEVEL if key not in record]
    if record.get("schema") != SCHEMA:
        problems.append("schema_mismatch")
    if not record.get("source", {}).get("model_usdc", {}).get("sha256"):
        problems.append("missing:source.model_usdc.sha256")
    if not record.get("solver", {}).get("image_digest"):
        problems.append("missing:solver.image_digest")
    if record.get("validation_level") not in VALIDATION_LEVELS:
        problems.append("invalid:validation_level")
    return problems


def write_run_record(record: dict, path: Path) -> Path:
    Path(path).write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return Path(path)
