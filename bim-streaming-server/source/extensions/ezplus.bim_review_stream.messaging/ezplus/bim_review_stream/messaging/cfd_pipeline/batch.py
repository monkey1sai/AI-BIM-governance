"""Multi-direction batch: one case per wind direction, one summary document.

Each direction is an independent run (its own case directory, result layer
and ``cfd-run-record/v1``). Failures are recorded and the batch continues.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from .openfoam_case import DEFAULT_IMAGE, CaseParams, build_case, run_case, run_case_with_extension

BATCH_SCHEMA = "cfd-batch-summary/v1"


def wind_directions(count: int, *, start_degrees: float = 0.0) -> list[float]:
    """Evenly spaced meteorological directions, e.g. 16 -> 0, 22.5, ..., 337.5."""
    if count <= 0:
        raise ValueError("count must be positive")
    step = 360.0 / count
    return [round((start_degrees + i * step) % 360.0, 3) for i in range(count)]


def summarize_batch(entries: list[dict]) -> dict:
    """Aggregate per-direction results into the batch summary body."""
    done = [e for e in entries if e.get("status") == "ok"]
    failed = [e for e in entries if e.get("status") != "ok"]
    peak = None
    for entry in done:
        value = (entry.get("pedestrian") or {}).get("U_magnitude_max")
        if value is not None and (peak is None or value > peak["U_magnitude_max"]):
            peak = {"wind_from_degrees": entry["wind_from_degrees"], "U_magnitude_max": value}
    return {
        "direction_count": len(entries),
        "ok_count": len(done),
        "failed_count": len(failed),
        "failed_directions": [e["wind_from_degrees"] for e in failed],
        "converged_count": sum(1 for e in done if (e.get("solver") or {}).get("converged_by_residual_control")),
        "pedestrian_peak": peak,
        "total_elapsed_seconds": round(sum(float(e.get("elapsed_seconds") or 0.0) for e in entries), 1),
    }


def run_batch(
    *,
    shell_stl: Path,
    model_usdc: Path,
    conversion_dir: Path,
    preprocess_dir: Path,
    out_root: Path,
    directions: list[float],
    true_north_degrees: float | None,
    case_overrides: dict,
    image: str = DEFAULT_IMAGE,
    operator: str = "unknown",
    source_ifc_sha256: str | None = None,
    conversion_reference: str | None = None,
    postprocess_fn=None,
    record_fn=None,
) -> dict:
    """Run every direction sequentially; returns and writes ``batch_summary.json``.

    ``postprocess_fn(case_dir, model_usdc, run_id, out_dir) -> dict`` and
    ``record_fn(run_id, case_dir, conversion_dir, preprocess_dir, out_dir, ...) -> dict``
    default to the CLI implementations; they are injectable for tests.
    """
    from . import cli

    postprocess_fn = postprocess_fn or cli.postprocess_case
    record_fn = record_fn or cli.record_case
    out_root = Path(out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    batch_id = f"cfdbatch_{stamp}"
    entries: list[dict] = []
    summary_path = out_root / "batch_summary.json"

    for direction in directions:
        tag = f"w{int(round(direction)) % 360:03d}"
        run_id = f"cfd_{stamp}_{tag}"
        case_dir = out_root / f"case_{tag}"
        result_dir = out_root / f"results_{tag}"
        started = time.time()
        entry: dict = {"wind_from_degrees": direction, "run_id": run_id, "case_dir": str(case_dir), "status": "pending"}
        try:
            params = CaseParams(wind_from_degrees=direction, true_north_degrees=true_north_degrees, **case_overrides)
            meta = build_case(shell_stl=Path(shell_stl), out_dir=case_dir, params=params)
            # R-A4: same one-time endTime extension as the job service; `run_case` is looked up at call time (tests inject it).
            run = run_case_with_extension(case_dir=case_dir, end_time=int(params.end_time), run_case_fn=run_case, image=image)
            (case_dir / "run_summary.json").write_text(json.dumps(run, indent=2), encoding="utf-8")
            entry["mesh_cells_background"] = meta["background_mesh"]["cell_count"]
            entry["solver_exit_code"] = run["exit_code"]
            if run["exit_code"] != 0:
                raise RuntimeError(f"Allrun exit {run['exit_code']}")
            post = postprocess_fn(case_dir, Path(model_usdc), run_id, result_dir)
            record = record_fn(
                run_id=run_id,
                case_dir=case_dir,
                conversion_dir=Path(conversion_dir),
                preprocess_dir=Path(preprocess_dir),
                out_dir=result_dir,
                operator=operator,
                source_ifc_sha256=source_ifc_sha256,
                conversion_reference=conversion_reference,
                image=image,
            )
            entry["pedestrian"] = (post.get("prims") or {}).get("PedestrianWind_1p5m")
            entry["building_pressure"] = (post.get("prims") or {}).get("BuildingSurfacePressure")
            entry["solver"] = {
                "iterations": record["solver"].get("iterations"),
                "converged_by_residual_control": record["solver"].get("converged_by_residual_control"),
                "final_initial_residuals": record["solver"].get("final_initial_residuals"),
            }
            entry["mesh"] = record.get("mesh")
            entry["record_problems"] = record.get("validation_problems", [])
            entry["result_layer"] = post.get("layer")
            entry["status"] = "ok"
        except Exception as exc:  # noqa: BLE001 - keep the batch going, record the failure
            entry["status"] = "failed"
            entry["error"] = f"{type(exc).__name__}: {exc}"
        entry["elapsed_seconds"] = round(time.time() - started, 1)
        entries.append(entry)
        _write_summary(summary_path, batch_id, directions, entries, image)

    return _write_summary(summary_path, batch_id, directions, entries, image)


def _write_summary(path: Path, batch_id: str, directions: list[float], entries: list[dict], image: str) -> dict:
    doc = {
        "schema": BATCH_SCHEMA,
        "batch_id": batch_id,
        "image": image,
        "directions": directions,
        "updated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **summarize_batch(entries),
        "entries": entries,
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc
