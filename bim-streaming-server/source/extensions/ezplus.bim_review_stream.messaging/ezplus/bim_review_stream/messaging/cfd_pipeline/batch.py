"""Multi-direction batch: one case per wind direction, one summary document.

Each direction is an independent CFD Case Run (its own case directory, result layer and
``cfd-run-record/v1``; see ``case_run.py``). Failures are recorded with their outcome kind
and the batch continues.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .case_run import CaseOutcome, CaseProgress, CaseRunPorts, CaseRunSpec, direction_tag, run_wind_directions
from .openfoam_case import DEFAULT_IMAGE, CaseParams, run_case

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
    run_case_fn: Callable[..., dict] | None = None,
) -> dict:
    """Run every direction sequentially through CFD Case Run; returns and writes ``batch_summary.json``.

    The batch never stops early (an empty ``stop_on``): a failed direction is recorded with its
    outcome kind and the next one runs. ``run_case_fn`` is the container port (Docker by default).
    The batch run id carries a random suffix, as the job service's does, so two batches started in
    the same second cannot share record ids, overlay layers or container names. Every direction's
    ``CaseParams`` is built before the first solve, so an invalid ``case_overrides`` raises at once
    instead of failing each direction in turn. The batch passes no ``should_stop``: it cannot be
    cancelled and always runs every direction.
    """
    out_root = Path(out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = uuid.uuid4().hex[:6]
    batch_id = f"cfdbatch_{stamp}_{suffix}"
    run_id = f"cfd_{stamp}_{suffix}"
    summary_path = out_root / "batch_summary.json"
    specs = []
    for direction in directions:
        tag = direction_tag(direction)
        specs.append(CaseRunSpec(
            run_id=run_id, tag=tag, case_dir=out_root / f"case_{tag}", shell_stl=Path(shell_stl),
            params=CaseParams(wind_from_degrees=direction, true_north_degrees=true_north_degrees, **case_overrides),
            image=image, results_dir=out_root / f"results_{tag}", model_usdc=Path(model_usdc),
            conversion_dir=Path(conversion_dir), preprocess_dir=Path(preprocess_dir), operator=operator,
            conversion_reference=conversion_reference, source_ifc_sha256=source_ifc_sha256,
        ))
    entries: list[dict] = []
    started: dict[str, float] = {}

    def on_progress(event: CaseProgress) -> None:
        if event.stage == "meshing":
            started[event.tag] = time.time()
        elif event.stage == "direction_done":
            now = time.time()
            entry = _entry(event.outcome)
            entry["elapsed_seconds"] = round(now - started.get(event.tag, now), 1)
            entries.append(entry)
            _write_summary(summary_path, batch_id, run_id, directions, entries, image)

    ports = CaseRunPorts(run_case_fn=run_case_fn or run_case, on_progress=on_progress)
    run_wind_directions(specs, ports, stop_on=frozenset())
    return _write_summary(summary_path, batch_id, run_id, directions, entries, image)


def _entry(outcome: CaseOutcome) -> dict:
    """One ``batch_summary.json`` entry from a direction's outcome."""
    spec = outcome.spec
    entry: dict = {"wind_from_degrees": spec.params.wind_from_degrees, "run_id": spec.case_run_id, "case_dir": str(spec.case_dir),
                   "status": "ok" if outcome.kind == "ready" else "failed"}
    if outcome.case_meta is not None:
        entry["mesh_cells_background"] = outcome.case_meta["background_mesh"]["cell_count"]
    if outcome.run_summary is not None:
        entry["solver_exit_code"] = outcome.run_summary.get("exit_code")
    if outcome.kind != "ready":
        entry["failure_kind"] = outcome.kind
        entry["error"] = outcome.message or outcome.kind
        return entry
    post, record = outcome.postprocess or {}, outcome.record or {}
    prims = post.get("prims") or {}
    entry["pedestrian"] = prims.get("PedestrianWind_1p5m")
    entry["building_pressure"] = prims.get("BuildingSurfacePressure")
    entry["solver"] = {key: (record.get("solver") or {}).get(key) for key in ("iterations", "converged_by_residual_control", "final_initial_residuals")}
    entry["mesh"] = record.get("mesh")
    entry["record_problems"] = list(outcome.record_problems)
    entry["result_layer"] = post.get("layer")
    return entry


def _write_summary(path: Path, batch_id: str, run_id: str, directions: list[float], entries: list[dict], image: str) -> dict:
    doc = {
        "schema": BATCH_SCHEMA,
        "batch_id": batch_id,
        "run_id": run_id,
        "image": image,
        "directions": directions,
        "updated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **summarize_batch(entries),
        "entries": entries,
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc
