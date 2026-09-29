"""Cell-count and wall-clock estimate for a CFD run before it is submitted (contract S8, settings phase A).

The engine (``cfd_pipeline``) is not modified: the estimate reuses its public geometry helpers
(``wind_vector_model``, ``rotation_to_plus_x``, ``rotate_z``, ``domain_from_building``), its case layout helpers
(``background_grid``, ``refinement_box_for``, ``refinement_regions``) and its pre-processing filters
(``classify_elements``, ``detect_outliers``) read-only.

* Background cells are computed exactly as ``openfoam_case.build_case`` does (COST 732 domain with the
  requested multipliers, ``background_grid`` with any outer coarsening, the automatic cell rule) from the
  best geometry available:
  1. the ``shell.stl`` of an earlier run of the same model with the same pre-processing (exact);
  2. otherwise the conversion's ``bbox_index.json`` filtered with the profile's class and outlier
     rules (rough: element bounding-box corners, so rotated directions come out larger).
* Default mesh layout: refined cells = background cells x a refinement factor, and seconds = cells x
  seconds-per-cell; both come from finished runs on this host when there are any, otherwise from the
  documented defaults in ``cfd_options.json``.
* Other layouts (settings phase B, docs/plans/building-energy-cfd-b-engine-params.md §5): the engine's own
  refinement regions (box, ground band, coarsening shells) give a nested-box volume model; the default
  layout's cells minus its model count (the surface refinement the boxes do not describe) is added back.
* Every number is labelled as an estimate with its source.
"""

from __future__ import annotations

import json
import math
import statistics
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import numpy as np

from cfd_options import MESH_LAYOUT_FIELDS, CfdOptions

ESTIMATE_SCHEMA = "cfd-estimate/v1"
DEFAULT_BOX_MODE = "isotropic"  # CaseParams.refinement_box_mode default since S5c; the service never overrides it
_HISTORY_RUN_LIMIT = 200


def auto_background_cell_m(building_height_m: float) -> float:
    """``openfoam_case.build_case``: ``min(6.0, max(1.5, round(height / 6.0, 2)))`` (pinned by a test)."""
    return min(6.0, max(1.5, round(building_height_m / 6.0, 2)))


# --------------------------------------------------------------------------- geometry sources


@dataclass(frozen=True)
class Geometry:
    points: np.ndarray  # (n, 3) model-frame metres
    source: str  # "previous_run_shell" | "bbox_index_profile_filter"
    basis_run_id: str | None


_shell_cache: dict[str, np.ndarray] = {}
_bbox_cache: dict[tuple[str, int, str], np.ndarray] = {}
# Per ready run: its per-direction calibration rows and its pre-processing time. A ready run never changes, so each
# is read from disk once.
_run_rows_cache: dict[str, list[dict[str, Any]]] = {}
_preprocess_cache: dict[str, float | None] = {}
_cache_lock = threading.Lock()


def region_cells(grid: Any, regions: list[Mapping[str, Any]]) -> float:
    """Cells of a background grid refined by nested axis-aligned regions: each part of the domain takes the highest
    level of the regions that hold it (``openfoam_case.refinement_regions`` levels, blockMesh cells at level 0).

    The region faces cut the domain into boxes; each box counts volume / (level-0 cell volume / 8^level). Surface
    refinement and the 2:1 buffer layers are not modelled, which is why the estimate adds the default layout's
    residual back.
    """
    domain = grid.domain
    bounds = ((domain.xmin, domain.xmax), (domain.ymin, domain.ymax), (domain.zmin, domain.zmax))
    fine = grid.fine_spacing_m
    level0 = fine[0] * fine[1] * fine[2] * 8 ** grid.coarsening_levels
    cuts = []
    for axis, (lo, hi) in enumerate(bounds):
        values = {lo, hi}
        for region in regions:
            values.update(min(max(float(region[key][axis]), lo), hi) for key in ("min", "max"))
        ordered = sorted(values)
        cuts.append(list(zip(ordered[:-1], ordered[1:])))
    total = 0.0
    for x0, x1 in cuts[0]:
        for y0, y1 in cuts[1]:
            for z0, z1 in cuts[2]:
                centre = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0)
                level = max((int(r["level"]) for r in regions if all(r["min"][a] <= centre[a] <= r["max"][a] for a in range(3))), default=0)
                total += (x1 - x0) * (y1 - y0) * (z1 - z0) * 8 ** level / level0
    return total


def _shell_points(stl_path: Path) -> np.ndarray | None:
    from cfd_pipeline.stl import read_binary_stl

    key = str(stl_path.resolve())
    with _cache_lock:
        cached = _shell_cache.get(key)
    if cached is not None:
        return cached
    try:
        triangles = read_binary_stl(stl_path)
    except Exception:  # noqa: BLE001 - a truncated or foreign file is simply not a usable source
        return None
    if triangles.size == 0:
        return None
    points = np.unique(triangles.reshape(-1, 3), axis=0)
    with _cache_lock:
        if len(_shell_cache) > 16:
            _shell_cache.clear()
        _shell_cache[key] = points
    return points


def geometry_from_previous_run(store: Any, conversion_job_id: str, preprocess: Mapping[str, Any]) -> Geometry | None:
    """The wrapped shell of an earlier run of this model with the same voxel pitch and closing radius."""
    for doc in store.list(conversion_job_id=conversion_job_id, limit=_HISTORY_RUN_LIMIT):
        previous = ((doc.get("request") or {}).get("preprocess")) or {}
        if previous.get("profile") != preprocess.get("profile"):
            continue
        if not math.isclose(float(previous.get("voxel_pitch_m") or 0.0), float(preprocess["voxel_pitch_m"]), abs_tol=1e-9):
            continue
        if int(previous.get("closing_radius_voxels") or -1) != int(preprocess["closing_radius_voxels"]):
            continue
        stl = store.run_dir(doc["run_id"]) / "shell.stl"
        if not stl.is_file() or stl.stat().st_size <= 84:
            continue
        points = _shell_points(stl)
        if points is not None and len(points):
            return Geometry(points=points, source="previous_run_shell", basis_run_id=str(doc["run_id"]))
    return None


def _class_from_prim_path(path: Any) -> str | None:
    # /World/Elements/<IfcClass>/G_<GlobalId>[/...]
    if not isinstance(path, str):
        return None
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 3 and parts[0] == "World" and parts[1] == "Elements" and parts[2].startswith("Ifc"):
        return parts[2]
    return None


def geometry_from_bbox_index(conversion_dir: Path, profile_id: str) -> Geometry | None:
    """Element bounding boxes filtered with the profile's class and outlier rules; corners as points."""
    from cfd_pipeline.preprocess import classify_elements, detect_outliers
    from cfd_pipeline.profiles import get_profile
    from cfd_pipeline.usd_geometry import ElementGeometry

    path = Path(conversion_dir) / "bbox_index.json"
    if not path.is_file():
        return None
    stat = path.stat()
    key = (str(path.resolve()), int(stat.st_mtime_ns), profile_id)
    with _cache_lock:
        cached = _bbox_cache.get(key)
    if cached is not None:
        return Geometry(points=cached, source="bbox_index_profile_filter", basis_run_id=None)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    elements = []
    for item in doc.get("items") or []:
        if not isinstance(item, dict):
            continue
        box = item.get("bbox_world") or item.get("bbox_local")
        ifc_type = _class_from_prim_path(item.get("usd_prim_path"))
        if not ifc_type or not isinstance(box, list) or len(box) != 6:
            continue
        try:
            lo = np.array([float(v) for v in box[:3]])
            hi = np.array([float(v) for v in box[3:]])
        except (TypeError, ValueError):
            continue
        if not (np.all(np.isfinite(lo)) and np.all(np.isfinite(hi))):
            continue
        # One degenerate triangle spanning the box: ElementGeometry.bbox then equals the element box exactly.
        elements.append(ElementGeometry(ifc_guid=str(item.get("ifc_guid") or ""), ifc_type=ifc_type, prim_path=str(item["usd_prim_path"]), triangles=np.array([[lo, hi, lo]], dtype=np.float64)))
    if not elements:
        return None
    profile = get_profile(profile_id)
    kept, _excluded = classify_elements(elements, profile)
    kept, _outliers, _rule = detect_outliers(kept, core_percentile=profile.outlier_core_percentile, margin_heights=profile.outlier_margin_heights)
    if not kept:
        return None
    corners = []
    for element in kept:
        lo, hi = element.bbox  # type: ignore[misc]
        for x in (lo[0], hi[0]):
            for y in (lo[1], hi[1]):
                for z in (lo[2], hi[2]):
                    corners.append((x, y, z))
    points = np.unique(np.array(corners, dtype=np.float64), axis=0)
    with _cache_lock:
        if len(_bbox_cache) > 16:
            _bbox_cache.clear()
        _bbox_cache[key] = points
    return Geometry(points=points, source="bbox_index_profile_filter", basis_run_id=None)


# --------------------------------------------------------------------------- calibration from finished runs


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _direction_tag(degrees: float) -> str:
    from cfd_pipeline.case_run import direction_tag  # the runner's rule, one source

    return direction_tag(degrees)


def _run_rows(store: Any, run_id: str) -> list[dict[str, Any]]:
    """Calibration rows of one ready run (cached: a ready run's files never change)."""
    with _cache_lock:
        cached = _run_rows_cache.get(run_id)
    if cached is not None:
        return cached
    run_dir = store.run_dir(run_id)
    result = _load_json(run_dir / "result.json") or {}
    rows: list[dict[str, Any]] = []
    for direction in result.get("directions") or []:
        cells = direction.get("mesh_cells")
        if direction.get("status") != "ready" or not isinstance(cells, (int, float)) or cells <= 0:
            continue
        case_dir = run_dir / f"case_{_direction_tag(float(direction.get('wind_from_degrees', 0.0)))}"
        meta = _load_json(case_dir / "case_meta.json") or {}
        params = meta.get("params") or {}
        summary = _load_json(case_dir / "run_summary.json") or {}
        background = (meta.get("background_mesh") or {}).get("cell_count")
        elapsed = summary.get("elapsed_seconds")
        iterations = direction.get("iterations")
        rows.append({
            "cells": float(cells),
            "background": float(background) if isinstance(background, (int, float)) and background > 0 else None,
            "surface_level": params.get("surface_refinement_level"),
            "region_level": params.get("region_refinement_level"),
            # Runs before S5b-2 recorded no box mode and used the bbox box: they must not calibrate isotropic runs.
            "box_mode": params.get("refinement_box_mode"),
            # Settings phase B: a coarsened or re-laid-out mesh has a very different cells / background ratio.
            "default_layout": _default_layout(params),
            "n_procs": params.get("n_procs"),
            "elapsed": float(elapsed) if isinstance(elapsed, (int, float)) and elapsed > 0 else None,
            "iterations": float(iterations) if isinstance(iterations, (int, float)) and iterations > 0 else None,
        })
    with _cache_lock:
        if len(_run_rows_cache) > 512:
            _run_rows_cache.clear()
        _run_rows_cache[run_id] = rows
    return rows


def _default_layout(params: Mapping[str, Any]) -> bool:
    """Whether a case used the default domain and mesh layout. Cases written before settings phase B carry none of
    the layout keys; a missing key is the CaseParams default (unlike box_mode, whose absence meant the bbox box)."""
    from cfd_pipeline.openfoam_case import CaseParams

    for name in MESH_LAYOUT_FIELDS:
        default = getattr(CaseParams, name)
        value = params.get(name, default)
        if value is None or default is None:
            if value is not default:
                return False
        elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isclose(float(value), float(default), rel_tol=0.0, abs_tol=1e-9):
            return False
    return True


def _preprocess_seconds(store: Any, run_id: str) -> float | None:
    """The pre-processing time a finished run measured (``pre/preprocess_stats.json``), cached per run."""
    with _cache_lock:
        if run_id in _preprocess_cache:
            return _preprocess_cache[run_id]
    stats = _load_json(store.run_dir(run_id) / "pre" / "preprocess_stats.json") or {}
    elapsed = stats.get("elapsed_seconds")
    value = float(elapsed) if isinstance(elapsed, (int, float)) and not isinstance(elapsed, bool) and elapsed > 0 else None
    with _cache_lock:
        if len(_preprocess_cache) > 512:
            _preprocess_cache.clear()
        _preprocess_cache[run_id] = value
    return value


def history_samples(store: Any, *, surface_level: int, region_level: int, n_procs: int, conversion_job_id: str) -> dict[str, list[float]]:
    """Per-direction ratios from finished runs (mesh cells / background cells, seconds / mesh cell) and the
    pre-processing time of this model's finished runs."""
    samples: dict[str, list[float]] = {"ratio_same_model": [], "ratio_any_model": [], "seconds_per_cell": [], "iterations": [],
                                       "preprocess_seconds_same_model": []}
    for doc in store.list(status="ready", limit=_HISTORY_RUN_LIMIT):
        same_model = (doc.get("source") or {}).get("conversion_job_id") == conversion_job_id
        if same_model:
            measured = _preprocess_seconds(store, str(doc["run_id"]))
            if measured is not None:
                samples["preprocess_seconds_same_model"].append(measured)
        for row in _run_rows(store, str(doc["run_id"])):
            same_setup = (row["surface_level"] == surface_level and row["region_level"] == region_level
                          and row["box_mode"] == DEFAULT_BOX_MODE and row["default_layout"])
            if same_setup and row["background"]:
                ratio = row["cells"] / row["background"]
                samples["ratio_any_model"].append(ratio)
                if same_model:
                    samples["ratio_same_model"].append(ratio)
            if row["n_procs"] == n_procs and row["elapsed"]:
                samples["seconds_per_cell"].append(row["elapsed"] / row["cells"])
                if row["iterations"]:
                    samples["iterations"].append(row["iterations"])
    return samples


# --------------------------------------------------------------------------- estimate


def _true_north(request: Mapping[str, Any], conversion_dir: Path) -> float:
    from cfd_pipeline.wind import true_north_from_geo

    if request["wind"]["true_north_source"] == "manual":
        return float(request["wind"]["true_north_degrees_manual"])
    geo = Path(conversion_dir) / "geo_reference.json"
    value, _flags = true_north_from_geo(geo if geo.exists() else None)
    return float(value) if value is not None else 0.0


def estimate_run(
    *,
    request: Mapping[str, Any],
    conversion_dir: Path,
    store: Any,
    options: CfdOptions,
    max_cells_per_direction: int,
) -> dict[str, Any]:
    """``cfd-estimate/v1`` for a validated ``cfd-run-request/v1`` (defaults already applied)."""
    from cfd_pipeline.openfoam_case import CaseParams, background_grid, domain_kwargs, refinement_box_for, refinement_regions
    from cfd_pipeline.wind import domain_from_building, rotate_z, rotation_to_plus_x, wind_vector_model

    cfg = options.estimate
    mesh = request["mesh"]
    # The engine's own parameters: the standard layout (what the history factor calibrates) and the requested one.
    levels = {"surface_refinement_level": int(mesh["surface_refinement_level"]), "region_refinement_level": int(mesh["region_refinement_level"])}
    standard = CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, **levels)
    requested = CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, **levels,
                           **{name: mesh.get(name, getattr(CaseParams, name)) for name in MESH_LAYOUT_FIELDS})
    default_layout = _default_layout(mesh)
    n_procs = int(request["solver"]["n_procs"])
    conversion_job_id = request["source"]["conversion_job_id"]
    limits = {
        "max_cells_per_direction": int(max_cells_per_direction),
        "confirm_cells_per_direction": cfg["confirm_cells_per_direction"],
        "confirm_total_hours": cfg["confirm_total_hours"],
        "exceeds_hard_cap": False,
        "confirm_required": False,
        "confirm_reasons": [],
    }
    geometry = geometry_from_previous_run(store, conversion_job_id, request["preprocess"]) or geometry_from_bbox_index(conversion_dir, request["preprocess"]["profile"])
    if geometry is None:
        return {"schema": ESTIMATE_SCHEMA, "available": False, "is_estimate": True, "reason": "no_geometry_source", "geometry_source": None, "geometry_basis_run_id": None, "directions": [], "totals": None, "basis": None, "limits": limits}

    true_north = _true_north(request, conversion_dir)
    samples = history_samples(store, surface_level=int(mesh["surface_refinement_level"]), region_level=int(mesh["region_refinement_level"]), n_procs=n_procs, conversion_job_id=conversion_job_id)
    if samples["ratio_same_model"]:
        factor, factor_source, factor_n = statistics.median(samples["ratio_same_model"]), "history_same_model", len(samples["ratio_same_model"])
    elif samples["ratio_any_model"]:
        factor, factor_source, factor_n = statistics.median(samples["ratio_any_model"]), "history_any_model", len(samples["ratio_any_model"])
    else:
        factor, factor_source, factor_n = float(cfg["refine_factor_default"]), "config_default", 0
    if samples["seconds_per_cell"]:
        seconds_per_cell, spc_source, spc_n = statistics.median(samples["seconds_per_cell"]), "history_same_n_procs", len(samples["seconds_per_cell"])
    else:
        # Scale the documented default linearly with the core count (rough; stated as such).
        seconds_per_cell = float(cfg["seconds_per_cell_default"]) * float(cfg["seconds_per_cell_default_n_procs"]) / float(n_procs)
        spc_source, spc_n = "config_default_scaled_by_n_procs", 0
    typical_iterations = statistics.median(samples["iterations"]) if samples["iterations"] else float(cfg["typical_iterations_default"])
    iteration_share = min(1.0, float(request["solver"]["end_time"]) / typical_iterations)
    if samples["preprocess_seconds_same_model"]:
        preprocess_seconds = statistics.median(samples["preprocess_seconds_same_model"])
        preprocess_basis = f"median of {len(samples['preprocess_seconds_same_model'])} finished run(s) of this model"
    else:
        preprocess_seconds, preprocess_basis = float(cfg["preprocess_seconds_default"]), "documented default"

    def unavailable(reason: str) -> dict[str, Any]:
        return {"schema": ESTIMATE_SCHEMA, "available": False, "is_estimate": True, "reason": reason, "geometry_source": geometry.source,
                "geometry_basis_run_id": geometry.basis_run_id, "directions": [], "totals": None, "basis": None, "limits": limits}

    directions = []
    heights = []
    cells_used = []
    for degrees in request["wind"]["wind_from_degrees"]:
        alpha = rotation_to_plus_x(wind_vector_model(float(degrees), true_north))
        rotated = rotate_z(geometry.points, alpha)
        lo, hi = rotated.min(axis=0), rotated.max(axis=0)
        if hi[2] <= 0.0:
            return unavailable("geometry_below_ground")
        standard_domain = domain_from_building(lo, hi, ground_z=0.0, **domain_kwargs(standard))
        height = standard_domain.building_height_m
        cell = float(mesh["background_cell_m"]) if mesh.get("background_cell_m") is not None else auto_background_cell_m(height)
        standard_grid = background_grid(standard_domain, cell, 0)
        standard_cells = math.prod(standard_grid.cells) * factor
        if default_layout:
            grid, estimated = standard_grid, standard_cells
        else:
            grid = background_grid(domain_from_building(lo, hi, ground_z=0.0, **domain_kwargs(requested)), cell, requested.outer_coarsening_levels)
            footprint = np.unique(rotated[:, :2], axis=0)
            modelled = {}
            try:
                for key, params, layout_grid in (("standard", standard, standard_grid), ("requested", requested, grid)):
                    box = refinement_box_for(lo, hi, height=height, ground_z=0.0, mode=params.refinement_box_mode, scale=params.refinement_box_scale,
                                             footprint_xy=footprint)
                    modelled[key] = region_cells(layout_grid, refinement_regions(box=box, bbox_min=lo, bbox_max=hi, grid=layout_grid, params=params))
            except ValueError:
                return unavailable("layout_not_feasible")  # e.g. a ground band with no upstream fetch; build_case would fail
            # The default layout's cells beyond its box model are surface refinement, which no layout changes.
            estimated = modelled["requested"] + max(0.0, standard_cells - modelled["standard"])
        estimated = int(round(estimated))
        seconds = estimated * seconds_per_cell * iteration_share
        heights.append(height)
        cells_used.append(cell)
        directions.append({
            "wind_from_degrees": float(degrees),
            "domain_m": [round(v, 1) for v in grid.domain.size],
            "background_cells": int(math.prod(grid.cells)),
            "estimated_cells": estimated,
            "estimated_seconds": round(seconds, 1),
        })

    total_cells = sum(d["estimated_cells"] for d in directions)
    total_seconds = preprocess_seconds + sum(d["estimated_seconds"] for d in directions)
    worst = max(d["estimated_cells"] for d in directions)
    if worst > max_cells_per_direction:
        limits["exceeds_hard_cap"] = True
    if worst > cfg["confirm_cells_per_direction"]:
        limits["confirm_reasons"].append("cells_per_direction")
    if total_seconds / 3600.0 > cfg["confirm_total_hours"]:
        limits["confirm_reasons"].append("total_hours")
    limits["confirm_required"] = bool(limits["confirm_reasons"])

    background = cells_used[0]
    surface_level = int(mesh["surface_refinement_level"])
    region_level = int(mesh["region_refinement_level"])
    return {
        "schema": ESTIMATE_SCHEMA,
        "available": True,
        "is_estimate": True,
        "reason": None,
        "geometry_source": geometry.source,
        "geometry_basis_run_id": geometry.basis_run_id,
        "building_height_m": round(max(heights), 2),
        "background_cell_m": background,
        "background_cell_rule": "request" if mesh.get("background_cell_m") is not None else "auto",
        "near_building_cell_m": round(background / (2 ** surface_level), 3),
        "refinement_box_cell_m": round(background / (2 ** region_level), 3),
        "directions": directions,
        "totals": {
            "estimated_cells": int(total_cells),
            "estimated_seconds": round(total_seconds, 1),
            "preprocess_seconds": round(float(preprocess_seconds), 1),
        },
        "basis": {
            "refine_factor": round(float(factor), 4),
            "refine_factor_source": factor_source,
            "refine_factor_samples": factor_n,
            "seconds_per_cell": float(seconds_per_cell),
            "seconds_per_cell_source": spc_source,
            "seconds_per_cell_samples": spc_n,
            "n_procs": n_procs,
            "typical_iterations": round(float(typical_iterations), 1),
            "end_time": int(request["solver"]["end_time"]),
            "notes": [
                "Background cells follow the engine's domain and cell rules exactly for the geometry used; refined cells and time are scaled from history or documented defaults.",
                "A direction that does not reach residual control is extended once to twice endTime, which can roughly double its time.",
                f"Pre-processing time: {preprocess_basis}.",
            ] + ([] if default_layout else [
                "Non-default mesh layout: refined cells = a nested-box volume model of the engine's own refinement regions plus the default "
                "layout's surface-refinement residual; on the settings-phase-B benchmark and smoke meshes this was within about 1% of the "
                "meshed cell count.",
            ]),
        },
        "limits": limits,
    }
