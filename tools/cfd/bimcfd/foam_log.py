"""Extract convergence and mesh facts from OpenFOAM logs and solverInfo."""

from __future__ import annotations

import re
from pathlib import Path


def parse_solver_info(path: Path) -> dict:
    """Read ``postProcessing/solverInfo/<time>/solverInfo.dat``.

    Returns initial residual history per field plus the last row.
    """
    header: list[str] = []
    rows: list[list[str]] = []
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("#"):
            tokens = line.lstrip("#").split()
            if tokens and tokens[0] == "Time":
                header = tokens
            continue
        if line.strip():
            rows.append(line.split())
    if not header or not rows:
        return {"iterations": 0, "fields": {}, "final_initial_residuals": {}}
    initial_columns = {name[: -len("_initial")]: idx for idx, name in enumerate(header) if name.endswith("_initial")}
    history = {field: [] for field in initial_columns}
    for row in rows:
        for field, idx in initial_columns.items():
            try:
                history[field].append(float(row[idx]))
            except (IndexError, ValueError):
                history[field].append(float("nan"))
    last = rows[-1]
    final = {field: history[field][-1] for field in history}
    converged_columns = {name[: -len("_converged")]: idx for idx, name in enumerate(header) if name.endswith("_converged")}
    converged_flags = {field: last[idx] for field, idx in converged_columns.items() if idx < len(last)}
    return {
        "iterations": int(float(last[0])),
        "fields": history,
        "final_initial_residuals": final,
        "solver_converged_flags": converged_flags,
    }


def parse_simple_foam_log(path: Path) -> dict:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    converged = re.search(r"SIMPLE solution converged in (\d+) iterations", text)
    last_time = None
    for match in re.finditer(r"^Time = (\d+)", text, flags=re.MULTILINE):
        last_time = int(match.group(1))
    end_reached = "End" in text.splitlines()[-5:] if text else False
    return {
        "converged_by_residual_control": bool(converged),
        "converged_iterations": int(converged.group(1)) if converged else None,
        "last_time": last_time,
        "reached_end": bool(end_reached),
        "fatal_error": "FOAM FATAL" in text,
    }


def parse_check_mesh_log(path: Path) -> dict:
    text = Path(path).read_text(encoding="utf-8", errors="replace")

    def grab(pattern: str, cast=float):
        match = re.search(pattern, text, flags=re.MULTILINE)
        return cast(match.group(1)) if match else None

    failed = re.search(r"Failed (\d+) mesh checks", text)
    return {
        "cells": grab(r"^\s*cells:\s+(\d+)", int),
        "faces": grab(r"^\s*faces:\s+(\d+)", int),
        "points": grab(r"^\s*points:\s+(\d+)", int),
        "max_non_orthogonality": grab(r"Max non-orthogonality = ([0-9.eE+-]+)"),
        "max_skewness": grab(r"Max skewness = ([0-9.eE+-]+)"),
        "mesh_ok": "Mesh OK." in text,
        "failed_checks": int(failed.group(1)) if failed else 0,
    }
