"""Generate and run an OpenFOAM (ESI v2412) steady RANS wind case.

The case follows the ``motorBike``/``turbineSiting`` tutorial structure:
blockMesh background -> snappyHexMesh (castellate + snap, no layers) ->
simpleFoam with k-omega SST and atmospheric-boundary-layer inlet profiles.
Sampling (1.5 m pedestrian plane, building surface pressure, streamlines)
runs as function objects at the end of the run and writes legacy ASCII VTK.
"""

from __future__ import annotations

import json
import math
import subprocess
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from .stl import read_binary_stl, write_binary_stl
from .usd_results import PLANE_CLIP_HEIGHTS
from .wind import Domain, domain_from_building, rotate_z, rotation_to_plus_x, wind_vector_model

DEFAULT_IMAGE = "opencfd/openfoam-default:2412"
PEDESTRIAN_HEIGHT_M = 1.5
# COST 732 best practice the effective domain is checked against (settings phase B honest labelling).
COST732_MIN_MARGIN_H = {"upstream": 5.0, "downstream": 15.0, "lateral": 5.0, "top": 5.0}
COST732_MAX_BLOCKAGE = 0.03


@dataclass
class CaseParams:
    wind_from_degrees: float
    true_north_degrees: float | None
    uref_m_s: float = 5.0
    zref_m: float = 10.0
    z0_m: float = 0.5
    ground_z_m: float = 0.0
    background_cell_m: float | None = None
    surface_refinement_level: int = 2
    region_refinement_level: int = 1
    end_time: int = 600  # contract S1 / R-A4 default; the CLI and the service read it from here
    n_procs: int = 8
    turbulence_model: str = "kOmegaSST"
    # S3.1: seeds on a vertical lattice across the inlet (y × z), >= 200 tracks.
    streamline_seeds: int = 240
    streamline_seed_rows: int = 8
    nu_m2_s: float = 1.5e-5
    turbulence_intensity: float = 0.1
    # "isotropic" (default since S5c, owner 2026-09-22): box about the footprint centroid with the farthest-vertex
    # radius, identical for every wind direction so the 16-direction cell counts match; "bbox": the P1 behaviour
    # (box follows the rotated bbox, so cells varied 186k-560k across directions in the P1 batch).
    refinement_box_mode: str = "isotropic"
    # Settings phase B (docs/plans/building-energy-cfd-b-engine-params.md): the computational domain and the mesh
    # layout. The defaults reproduce the pre-phase-B case byte for byte (tools/cfd/tests/test_golden_case.py).
    domain_upstream_h: float = 5.0  # inlet distance in building heights H (COST 732: >= 5H)
    domain_downstream_h: float = 15.0  # outlet distance (COST 732: >= 15H)
    domain_lateral_h: float = 5.0  # side margins; the blockage rule may still widen them
    domain_top_h: float = 5.0  # top margin
    max_blockage_ratio: float = 0.03  # frontal area / domain cross-section (COST 732: <= 3%)
    refinement_box_scale: float = 1.0  # multiplies the refinement box margins (1H upstream/sides/top, 2H downstream)
    outer_coarsening_levels: int = 0  # n: background 2^n coarser, surface and box levels +n, n shells keep the old resolution
    coarsening_shell_h: float = 1.0  # innermost shell = refinement box grown by this many H, and at least bbox ± 3H
    ground_band_height_h: float | None = None  # upstream ground refinement band height in H; None = no band
    # S6 prerequisite (AIJ root-cause isolation) knobs; defaults reproduce the P1/S5 behaviour exactly.
    pedestrian_height_m: float = PEDESTRIAN_HEIGHT_M  # sampling plane above ground (0.1D at model scale needs this)
    wall_z0_m: float | None = None  # ground atmNutkWallFunction z0; None -> the inlet ABL z0 (coupled, as before)
    inlet_turbulence: str = "abl"  # "abl": atmBoundaryLayerInletK/Omega from u*; "fixed": uniform k/omega from turbulence_intensity
    # Caller-supplied assumptions (e.g. the IFC TrueNorth is the default
    # direction) that must travel into case_meta and the run record.
    assumptions: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _foam_header(class_name: str, object_name: str, location: str | None = None) -> str:
    loc = f'    location    "{location}";\n' if location else ""
    return (
        "FoamFile\n{\n    version     2.0;\n    format      ascii;\n"
        f"    class       {class_name};\n{loc}    object      {object_name};\n}}\n\n"
    )


def _vec(values) -> str:
    return "(" + " ".join(f"{float(v):.6g}" for v in values) + ")"


def _written(value: float) -> float:
    """``value`` as _vec writes it (6 significant digits), which is what blockMesh and snappyHexMesh read."""
    return float(f"{float(value):.6g}")


def domain_kwargs(params) -> dict:
    """``domain_from_building`` keywords from ``CaseParams`` (an instance, or the class for its defaults)."""
    return {"upstream_heights": params.domain_upstream_h, "downstream_heights": params.domain_downstream_h,
            "lateral_heights": params.domain_lateral_h, "top_heights": params.domain_top_h,
            "max_blockage_ratio": params.max_blockage_ratio}


def refinement_box_for(bbox_min, bbox_max, *, height: float, ground_z: float, mode: str, scale: float, footprint_xy=None) -> dict:
    """snappyHexMesh refinement region. ``bbox``: 1H upstream/sides, 2H downstream around the rotated bbox.
    ``isotropic``: a circle about the footprint vertex centroid with radius = farthest vertex, plus the same
    margins in every direction. Centroid and vertex distances are invariant under rotation about Z, so the box
    size (and the cell count) is the same for every wind direction; ``footprint_xy`` are the (n, 2) shell
    vertices in the solver frame (falls back to the bbox when not given, which is only rotation-invariant for
    90-degree steps). ``scale`` multiplies the margins only, not the bbox or circle they grow from (settings
    phase B ``refinement_box_scale``; 1 = the pre-phase-B box)."""
    bbox_min = np.asarray(bbox_min, dtype=float)
    bbox_max = np.asarray(bbox_max, dtype=float)
    if mode == "bbox":
        return {"min": (bbox_min[0] - height * scale, bbox_min[1] - height * scale, ground_z),
                "max": (bbox_max[0] + 2.0 * height * scale, bbox_max[1] + height * scale, bbox_max[2] + height * scale)}
    if mode == "isotropic":
        if footprint_xy is not None and len(footprint_xy):
            xy = np.asarray(footprint_xy, dtype=float)[:, :2]
            centre = xy.mean(axis=0)
            radius = float(np.linalg.norm(xy - centre, axis=1).max())
        else:
            centre = 0.5 * (bbox_min[:2] + bbox_max[:2])
            radius = 0.5 * float(np.linalg.norm(bbox_max[:2] - bbox_min[:2]))
        return {"min": (float(centre[0] - radius - height * scale), float(centre[1] - radius - height * scale), ground_z),
                "max": (float(centre[0] + radius + 2.0 * height * scale), float(centre[1] + radius + height * scale),
                        float(bbox_max[2] + height * scale))}
    raise ValueError(f"refinement_box_mode must be 'bbox' or 'isotropic': {mode!r}")


@dataclass(frozen=True)
class BackgroundGrid:
    """blockMesh layout: the domain it spans, its cell counts and the pre-coarsening spacing."""

    domain: Domain
    cells: tuple[int, int, int]
    cell_size_m: float  # nominal background cell: the requested or automatic cell times 2^n
    fine_spacing_m: tuple[float, float, float]  # size / N of the pre-coarsening grid (today's background spacing)
    coarsening_levels: int


def background_grid(domain: Domain, cell: float, coarsening_levels: int) -> BackgroundGrid:
    """Background mesh for ``domain`` (the case writer's rule; the estimator switches to it in settings phase B1b).

    Today's rule is ``N = max(4, ceil(size / cell))`` cells per axis at spacing ``size / N``. With n coarsening
    levels (settings phase B §3) N is padded up to a multiple of 2^n and only the max side of each axis is
    extended, to ``min + N' · spacing``: grid lines keep their place relative to the building, so every refined
    level keeps today's spacing, and the blockMesh cells are 2^n of those spacings. The blockage ratio is
    recomputed for the extended cross-section.
    """
    if coarsening_levels < 0:
        raise ValueError("outer_coarsening_levels must be >= 0")
    size = domain.size
    fine = tuple(max(4, int(math.ceil(s / cell))) for s in size)
    spacing = tuple(s / n for s, n in zip(size, fine))
    if coarsening_levels == 0:
        return BackgroundGrid(domain=domain, cells=fine, cell_size_m=cell, fine_spacing_m=spacing, coarsening_levels=0)
    factor = 2 ** coarsening_levels
    padded = tuple(int(math.ceil(n / factor)) * factor for n in fine)
    xmax = domain.xmin + padded[0] * spacing[0]
    ymax = domain.ymin + padded[1] * spacing[1]
    zmax = domain.zmin + padded[2] * spacing[2]
    frontal_area = domain.blockage_ratio * (domain.ymax - domain.ymin) * (domain.zmax - domain.zmin)
    extended = Domain(xmin=domain.xmin, xmax=xmax, ymin=domain.ymin, ymax=ymax, zmin=domain.zmin, zmax=zmax,
                      building_height_m=domain.building_height_m,
                      blockage_ratio=frontal_area / ((ymax - domain.ymin) * (zmax - domain.zmin)))
    return BackgroundGrid(domain=extended, cells=tuple(n // factor for n in padded), cell_size_m=cell * factor,
                          fine_spacing_m=spacing, coarsening_levels=coarsening_levels)


def refinement_regions(*, box: dict, bbox_min, bbox_max, grid: BackgroundGrid, params: CaseParams) -> list[dict]:
    """snappyHexMesh refinement regions: the refinement box, the optional upstream ground band and, with n
    coarsening levels, n shells that keep the pre-coarsening resolution around the building (phase B §3).

    Levels are relative to the (coarsened) background: the box and the band sit at ``region level + n``; shell k
    (1 = innermost) at ``n - k + 1``. Shell 1 is the box grown by ``coarsening_shell_h``·H and at least the
    pedestrian-plane crop (bbox ± 3H in x/y), so the sampled plane never lies in coarsened cells; each further
    shell grows by the same distance.
    """
    domain = grid.domain
    height = domain.building_height_m
    ground = params.ground_z_m
    n = grid.coarsening_levels
    level = params.region_refinement_level + n
    shells: list[dict] = []
    if n:
        grow = params.coarsening_shell_h * height
        crop = PLANE_CLIP_HEIGHTS * height
        lo = [min(box["min"][0] - grow, float(bbox_min[0]) - crop), min(box["min"][1] - grow, float(bbox_min[1]) - crop), ground]
        hi = [max(box["max"][0] + grow, float(bbox_max[0]) + crop), max(box["max"][1] + grow, float(bbox_max[1]) + crop), box["max"][2] + grow]
        for k in range(1, n + 1):
            shells.append({"name": f"coarseningShell{k}",
                           "min": (max(lo[0], domain.xmin), max(lo[1], domain.ymin), ground),
                           "max": (min(hi[0], domain.xmax), min(hi[1], domain.ymax), min(hi[2], domain.zmax)),
                           "level": n - k + 1})
            lo = [lo[0] - grow, lo[1] - grow, ground]
            hi = [hi[0] + grow, hi[1] + grow, hi[2] + grow]
    regions = [{"name": "refinementBox", "min": tuple(box["min"]), "max": tuple(box["max"]), "level": level}]
    if params.ground_band_height_h is not None:
        regions.append(_ground_band(box=box, grid=grid, ground=ground, height_h=params.ground_band_height_h, level=level, shells=shells))
    return regions + shells


def _ground_band(*, box: dict, grid: BackgroundGrid, ground: float, height_h: float, level: int, shells: list[dict]) -> dict:
    """The upstream ground band region, checked against how snappyHexMesh will refine it (phase B §3).

    snappyHexMesh refines a cell when its centre lies in a region, level by level from the blockMesh cells, and stops
    at the region's level. So the band must hold two cells at its level, contain the centres of the coarsest ground
    cells along it (the blockMesh cells, or the level of the innermost shell that already covers the whole band), and
    keep its top off the centre of every cell it still has to refine, where the outcome would hang on round-off. The
    checks use the heights as written (6 significant digits), which is what blockMesh and snappyHexMesh read.
    """
    domain = grid.domain
    if box["min"][0] <= domain.xmin:
        raise ValueError("ground band has no upstream fetch: the refinement box reaches the inlet")
    band = {"name": "groundBand", "min": (domain.xmin, box["min"][1], ground),
            "max": (box["min"][0], box["max"][1], ground + height_h * domain.building_height_m), "level": level}
    covering = [shell["level"] for shell in shells
                if all(s <= b for s, b in zip(shell["min"], band["min"])) and all(s >= b for s, b in zip(shell["max"], band["max"]))]
    base = max(covering, default=0)  # level of the coarsest cells the band itself has to refine
    zmin = _written(domain.zmin)
    coarse_z = (_written(domain.zmax) - zmin) / grid.cells[2]  # blockMesh (level 0) cell height
    thickness = _written(band["max"][2]) - zmin
    band_cell = coarse_z / 2 ** level
    if thickness < 2.0 * band_cell:
        raise ValueError(f"ground band {thickness:g} m is thinner than two cells at its level ({2.0 * band_cell:g} m)")
    if thickness <= 0.5 * coarse_z / 2 ** base:
        raise ValueError(f"ground band {thickness:g} m does not reach the centre of the coarsest ground cells along it "
                         f"({0.5 * coarse_z / 2 ** base:g} m, level {base})")
    for cell_level in range(base, level):
        cell_height = coarse_z / 2 ** cell_level
        offset = (thickness / cell_height - 0.5) % 1.0
        if min(offset, 1.0 - offset) < 1e-6:
            raise ValueError(f"ground band top {thickness:g} m sits on a cell centre at level {cell_level}; choose a height between centres")
    return band


def cost732_deviations(domain: Domain, bbox_min, bbox_max) -> list[str]:
    """Where the effective domain (after the blockage widening and any coarsening extension) falls short of the
    COST 732 recommendations; empty for the default domain. Feeds the honest-labelling limitations."""
    height = domain.building_height_m
    tolerance = 1e-9 * max(height, 1.0)
    margins = {
        "upstream": float(bbox_min[0]) - domain.xmin,
        "downstream": domain.xmax - float(bbox_max[0]),
        "lateral": min(float(bbox_min[1]) - domain.ymin, domain.ymax - float(bbox_max[1])),
        "top": domain.zmax - float(bbox_max[2]),
    }
    deviations = [f"{name}_below_{COST732_MIN_MARGIN_H[name]:g}H" for name, margin in margins.items()
                  if margin < COST732_MIN_MARGIN_H[name] * height - tolerance]
    if domain.blockage_ratio > COST732_MAX_BLOCKAGE * (1.0 + 1e-9):
        deviations.append(f"blockage_above_{COST732_MAX_BLOCKAGE:g}")
    return deviations


def build_case(*, shell_stl: Path, out_dir: Path, params: CaseParams) -> dict:
    """Write a complete case directory and return its metadata document."""
    for name in ("domain_upstream_h", "domain_downstream_h", "domain_lateral_h", "domain_top_h", "max_blockage_ratio",
                 "refinement_box_scale", "coarsening_shell_h"):
        if not getattr(params, name) > 0:
            raise ValueError(f"{name} must be positive")
    if params.ground_band_height_h is not None and not params.ground_band_height_h > 0:
        raise ValueError("ground_band_height_h must be positive")
    out_dir = Path(out_dir)
    for sub in ("system", "constant/triSurface", "0.orig/include"):
        (out_dir / sub).mkdir(parents=True, exist_ok=True)

    true_north = params.true_north_degrees
    assumptions: list[str] = list(params.assumptions)
    if true_north is None:
        true_north = 0.0
        assumptions.append("true_north_unknown_assumed_project_north")
    wind_vec = wind_vector_model(params.wind_from_degrees, true_north)
    alpha = rotation_to_plus_x(wind_vec)

    triangles = read_binary_stl(shell_stl)
    rotated = rotate_z(triangles.reshape(-1, 3), alpha).reshape(-1, 3, 3)
    vertices = rotated.reshape(-1, 3)
    faces = np.arange(vertices.shape[0]).reshape(-1, 3)
    write_binary_stl(out_dir / "constant/triSurface/building.stl", vertices, faces, solid_name="building")

    bbox_min = vertices.min(axis=0)
    bbox_max = vertices.max(axis=0)
    if bbox_max[2] <= params.ground_z_m:
        raise ValueError("building shell lies entirely below ground level")
    domain = domain_from_building(bbox_min, bbox_max, ground_z=params.ground_z_m, **domain_kwargs(params))
    height = domain.building_height_m
    requested_cell = params.background_cell_m or min(6.0, max(1.5, round(height / 6.0, 2)))
    grid = background_grid(domain, requested_cell, params.outer_coarsening_levels)
    domain = grid.domain
    cell = grid.cell_size_m
    cells = grid.cells

    # Nudged off cell faces by irrational fractions of the background cell: the domain mid-plane
    # (even cell count) and 2H offsets can land exactly on a face / processor boundary, and
    # snappyHexMesh then reports "Point ... is not inside the mesh" in parallel runs. The x offset is
    # 2H downstream of the inlet, or halfway to the building when the upstream fetch is shorter than 4H.
    location_in_mesh = (
        domain.xmin + min(2.0 * height, 0.5 * (float(bbox_min[0]) - domain.xmin)) + 0.37 * cell,
        0.5 * (domain.ymin + domain.ymax) + 0.29 * cell,
        params.ground_z_m + 0.5 * height + 0.31 * cell,
    )
    in_building = all(bbox_min[i] <= location_in_mesh[i] <= bbox_max[i] for i in range(3))
    in_domain = (domain.xmin < location_in_mesh[0] < domain.xmax and domain.ymin < location_in_mesh[1] < domain.ymax
                 and domain.zmin < location_in_mesh[2] < domain.zmax)
    shown = tuple(round(float(v), 3) for v in location_in_mesh)
    if in_building:
        raise ValueError(f"locationInMesh {shown} lies inside the building bbox; the case needs a point in the fluid")
    if not in_domain:
        raise ValueError(f"locationInMesh {shown} lies outside the domain; the background cell is too large for this domain")
    refinement_box = refinement_box_for(bbox_min, bbox_max, height=height, ground_z=params.ground_z_m, mode=params.refinement_box_mode,
                                        scale=params.refinement_box_scale, footprint_xy=np.unique(vertices[:, :2], axis=0))
    regions = refinement_regions(box=refinement_box, bbox_min=bbox_min, bbox_max=bbox_max, grid=grid, params=params)
    surface_level = params.surface_refinement_level + grid.coarsening_levels

    k0 = 1.5 * (params.turbulence_intensity * params.uref_m_s) ** 2
    omega0 = math.sqrt(k0) / (0.09**0.25 * max(0.07 * height, 0.1))
    if params.inlet_turbulence not in ("abl", "fixed"):
        raise ValueError(f"inlet_turbulence must be 'abl' or 'fixed': {params.inlet_turbulence!r}")
    if params.wall_z0_m is not None and params.wall_z0_m <= 0:
        raise ValueError("wall_z0_m must be positive")
    if params.pedestrian_height_m <= 0:
        raise ValueError("pedestrian_height_m must be positive")
    pedestrian_z = params.ground_z_m + params.pedestrian_height_m

    _write(out_dir / "system/controlDict", _control_dict(params, domain, pedestrian_z))
    _write(out_dir / "system/fvSchemes", _fv_schemes())
    _write(out_dir / "system/fvSolution", _fv_solution())
    _write(out_dir / "system/blockMeshDict", _block_mesh_dict(domain, cells))
    _write(out_dir / "system/snappyHexMeshDict", _snappy_dict(surface_level, regions, location_in_mesh))
    _write(out_dir / "system/meshQualityDict", _mesh_quality_dict())
    _write(out_dir / "system/decomposeParDict", _decompose_dict(params.n_procs))
    _write(out_dir / "constant/turbulenceProperties", _turbulence_properties(params.turbulence_model))
    _write(out_dir / "constant/transportProperties", _transport_properties(params.nu_m2_s))
    _write(out_dir / "0.orig/include/ABLConditions", _abl_conditions(params))
    _write(out_dir / "0.orig/U", _field_u(params))
    _write(out_dir / "0.orig/p", _field_p())
    _write(out_dir / "0.orig/k", _field_k(k0, inlet=params.inlet_turbulence))
    _write(out_dir / "0.orig/omega", _field_omega(omega0, inlet=params.inlet_turbulence))
    _write(out_dir / "0.orig/nut", _field_nut(wall_z0_m=params.wall_z0_m))
    _write(out_dir / "Allrun", _allrun(), executable=True)
    (out_dir / "case.foam").write_text("", encoding="utf-8")

    meta = {
        "schema": "cfd-case/v1",
        "params": asdict(params),
        "assumptions": assumptions,
        "wind": {
            "wind_from_degrees": params.wind_from_degrees,
            "true_north_degrees_used": true_north,
            "wind_vector_model_xy": [float(v) for v in wind_vec],
            "solver_rotation_alpha_rad": float(alpha),
            "solver_rotation_alpha_deg": math.degrees(alpha),
        },
        "building_bbox_solver_frame": {"min": [float(v) for v in bbox_min], "max": [float(v) for v in bbox_max]},
        "domain": asdict(domain),
        "cost732_deviations": cost732_deviations(domain, bbox_min, bbox_max),
        "background_mesh": {"cell_size_m": cell, "cells": list(cells), "cell_count": int(np.prod(cells)),
                            "outer_coarsening_levels": grid.coarsening_levels,
                            "fine_spacing_m": [float(v) for v in grid.fine_spacing_m]},
        "refinement_box": {k: [float(v) for v in vals] for k, vals in refinement_box.items()},
        "refinement_regions": [{"name": r["name"], "min": [float(v) for v in r["min"]], "max": [float(v) for v in r["max"]],
                                "level": int(r["level"])} for r in regions],
        "surface_refinement_level_effective": surface_level,
        "location_in_mesh": [float(v) for v in location_in_mesh],
        "initial_conditions": {"k": k0, "omega": omega0},
        "inlet_turbulence": params.inlet_turbulence,
        "wall_z0_m_effective": params.wall_z0_m if params.wall_z0_m is not None else params.z0_m,
        "pedestrian_plane_height_m": params.pedestrian_height_m,
        "pedestrian_plane_z_m": pedestrian_z,
    }
    (out_dir / "case_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def run_case(
    *,
    case_dir: Path,
    image: str = DEFAULT_IMAGE,
    log_path: Path | None = None,
    timeout_s: int = 6 * 3600,
    container_name: str | None = None,
    cpus: float | None = None,
    should_stop: Callable[[], bool] | None = None,
    poll_interval_s: float = 2.0,
    script: str = "Allrun",
) -> dict:
    """Run ``Allrun`` (or another case script, e.g. ``Allcontinue``) inside the OpenFOAM container. Returns a run summary.

    ``container_name`` lets a supervisor cancel the run with ``kill_container``;
    ``cpus`` caps the container (docker ``--cpus``) so the solver shares the
    host with Kit instead of taking every core. ``should_stop`` is polled every
    ``poll_interval_s`` while the container runs; when it returns True the
    container is killed and the summary carries ``cancelled: True``. A
    ``timeout_s`` expiry also kills the container instead of leaving it running.
    """
    case_dir = Path(case_dir).resolve()
    digest = image_digest(image)
    command = ["docker", "run", "--rm"]
    if container_name:
        command += ["--name", container_name]
    if cpus:
        command += ["--cpus", f"{float(cpus):g}"]
    command += [
        "-v",
        f"{case_dir.as_posix()}:/case",
        image,
        "bash",
        "-c",
        # The image entrypoint changes directory before exec, so be explicit.
        f"cd /case && bash ./{script}",
    ]
    started = time.time()
    log_path = log_path or (case_dir / "docker_run.log")
    cancelled = False
    timed_out = False
    with Path(log_path).open("w", encoding="utf-8") as log:
        proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        while True:
            try:
                proc.wait(timeout=poll_interval_s)
                break
            except subprocess.TimeoutExpired:
                pass
            if should_stop is not None and should_stop():
                cancelled = True
            elif time.time() - started > timeout_s:
                timed_out = True
            if cancelled or timed_out:
                if container_name:
                    kill_container(container_name)
                proc.terminate()
                try:
                    proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
                break
    return {
        "image": image,
        "image_digest": digest,
        "command": command,
        "script": script,
        "exit_code": proc.returncode if proc.returncode is not None else -1,
        "elapsed_seconds": round(time.time() - started, 1),
        "log": str(log_path),
        "cancelled": cancelled,
        "timed_out": timed_out,
    }


CONTINUE_SCRIPT = "Allcontinue"
CONTINUE_LOG_SUFFIX = "continue"  # RunFunctions -s: log.simpleFoam.continue / log.reconstructPar.continue


def write_continue_script(case_dir: Path, *, end_time: int) -> Path:
    """Write ``Allcontinue``: raise ``endTime`` and resume simpleFoam from the latest decomposed time.

    ``Allrun`` leaves the processor directories in place and controlDict already says
    ``startFrom latestTime``, so a second solver pass continues the same SIMPLE iteration
    sequence; ``-s continue`` keeps the first pass' logs. ``case_meta.json`` records the
    extension so the run record can report the effective endTime.
    """
    case_dir = Path(case_dir)
    end_time = int(end_time)
    if end_time <= 0:
        raise ValueError("end_time must be positive")
    _write(case_dir / CONTINUE_SCRIPT, _allcontinue(end_time), executable=True)
    meta_path = case_dir / "case_meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        initial = int(meta.get("params", {}).get("end_time") or 0)
        meta["extension"] = {"end_time_initial": initial, "end_time_effective": end_time, "script": CONTINUE_SCRIPT}
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return case_dir / CONTINUE_SCRIPT


def run_case_with_extension(
    *,
    case_dir: Path,
    end_time: int,
    extension_factor: float = 2.0,
    run_case_fn: Callable[..., dict] = None,
    on_extend: Callable[[int], None] | None = None,
    **run_kwargs,
) -> dict:
    """``run_case`` plus at most one automatic endTime extension (contract S5, R-A4).

    When the first pass exits 0 but ``log.simpleFoam`` shows no ``residualControl``
    convergence, endTime is raised to ``extension_factor`` × the initial value and the
    solver resumes once. The returned summary is the last pass' summary with
    ``elapsed_seconds`` summed, plus ``extended_to`` (int or None) and ``passes``.
    """
    try:
        from .foam_log import parse_simple_foam_log
    except ImportError:  # pragma: no cover - direct import in tests
        from foam_log import parse_simple_foam_log

    runner = run_case_fn or run_case
    case_dir = Path(case_dir)
    first = runner(case_dir=case_dir, **run_kwargs)
    first_summary = dict(first)
    result = {**first, "extended_to": None, "passes": [first_summary]}
    log = case_dir / "log.simpleFoam"
    if first.get("exit_code") != 0 or first.get("cancelled") or first.get("timed_out") or not log.exists():
        return result
    parsed = parse_simple_foam_log(log)
    if parsed.get("converged_by_residual_control") or parsed.get("fatal_error"):
        return result
    new_end = int(math.ceil(int(end_time) * float(extension_factor)))
    if new_end <= int(end_time):
        return result
    should_stop = run_kwargs.get("should_stop")
    if should_stop is not None and should_stop():
        return {**result, "cancelled": True}
    write_continue_script(case_dir, end_time=new_end)
    if on_extend is not None:
        on_extend(new_end)
    continue_kwargs = dict(run_kwargs)
    if continue_kwargs.get("container_name"):
        continue_kwargs["container_name"] = f"{continue_kwargs['container_name']}_x"
    continue_kwargs.setdefault("log_path", case_dir / "docker_run.continue.log")
    second = runner(case_dir=case_dir, script=CONTINUE_SCRIPT, **continue_kwargs)
    return {
        **second,
        "elapsed_seconds": round(float(first.get("elapsed_seconds") or 0.0) + float(second.get("elapsed_seconds") or 0.0), 1),
        "extended_to": new_end,
        "passes": [first_summary, dict(second)],
    }


def kill_container(container_name: str) -> bool:
    """Best-effort ``docker kill``; returns True when docker reported success."""
    try:
        out = subprocess.run(["docker", "kill", container_name], capture_output=True, text=True, check=False, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return out.returncode == 0


def image_available(image: str) -> bool:
    """True when ``docker image inspect`` succeeds for ``image`` on this host."""
    try:
        out = subprocess.run(["docker", "image", "inspect", image], capture_output=True, text=True, check=False, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return out.returncode == 0


def image_digest(image: str) -> str | None:
    try:
        out = subprocess.run(
            ["docker", "image", "inspect", image, "--format", "{{index .RepoDigests 0}}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = out.stdout.strip()
    return value or None


def _write(path: Path, content: str, *, executable: bool = False) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")
    if executable:
        path.chmod(0o755)


def streamline_seed_points(params: CaseParams, domain: Domain, pedestrian_z: float) -> list[tuple[float, float, float]]:
    """Vertical lattice one metre downstream of the inlet: rows from pedestrian height to ~2.5H."""
    rows = max(1, int(params.streamline_seed_rows))
    total = max(rows, int(params.streamline_seeds))
    cols = max(1, int(math.ceil(total / rows)))
    x = domain.xmin + 1.0
    y0, y1 = domain.ymin + 0.1 * (domain.ymax - domain.ymin), domain.ymax - 0.1 * (domain.ymax - domain.ymin)
    z_top = min(domain.zmax - 1.0, domain.zmin + 2.5 * domain.building_height_m)
    ys = np.linspace(y0, y1, cols) if cols > 1 else np.array([0.5 * (y0 + y1)])
    zs = np.linspace(pedestrian_z, max(z_top, pedestrian_z), rows) if rows > 1 else np.array([pedestrian_z])
    return [(float(x), float(y), float(z)) for z in zs for y in ys]


def _control_dict(params: CaseParams, domain: Domain, pedestrian_z: float) -> str:
    seeds = streamline_seed_points(params, domain, pedestrian_z)
    seed_points = "\n".join(f"            {_vec(p)}" for p in seeds)
    return (
        _foam_header("dictionary", "controlDict", "system")
        + f"""application     simpleFoam;

libs            (atmosphericModels);

startFrom       latestTime;
startTime       0;
stopAt          endTime;
endTime         {params.end_time};
deltaT          1;

writeControl    timeStep;
writeInterval   {params.end_time};
purgeWrite      0;
writeFormat     binary;
writePrecision  8;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable false;

functions
{{
    solverInfo
    {{
        type            solverInfo;
        libs            (utilityFunctionObjects);
        fields          (U p k omega);
        writeResidualFields no;
        executeControl  timeStep;
        executeInterval 1;
        writeControl    timeStep;
        writeInterval   1;
    }}

    samples
    {{
        type            surfaces;
        libs            (sampling);
        executeControl  onEnd;
        writeControl    onEnd;
        surfaceFormat   vtk;
        formatOptions
        {{
            vtk
            {{
                legacy  true;
                format  ascii;
            }}
        }}
        fields          (U p);
        interpolationScheme cellPoint;
        surfaces
        {{
            pedestrian_1p5m
            {{
                type            cuttingPlane;
                planeType       pointAndNormal;
                pointAndNormalDict
                {{
                    point   (0 0 {pedestrian_z:.6g});
                    normal  (0 0 1);
                }}
                interpolate     true;
            }}
            building
            {{
                type            patch;
                patches         (building);
                interpolate     false;
            }}
        }}
    }}

    streamlines
    {{
        type            streamLine;
        libs            (fieldFunctionObjects);
        executeControl  onEnd;
        writeControl    onEnd;
        setFormat       vtk;
        // Honoured by the in-solver onEnd write (legacy .vtk); the standalone
        // postProcess utility ignores it and writes .vtp, which we also parse.
        formatOptions
        {{
            vtk
            {{
                legacy  true;
                format  ascii;
            }}
        }}
        U               U;
        fields          (U);
        direction       forward;
        lifeTime        20000;
        nSubCycle       5;
        cloud           particleTracks;
        interpolationScheme cellPoint;
        seedSampleSet
        {{
            type        cloud;
            axis        xyz;
            points
            (
{seed_points}
            );
        }}
    }}
}}
"""
    )


def _fv_schemes() -> str:
    return (
        _foam_header("dictionary", "fvSchemes", "system")
        + """ddtSchemes
{
    default         steadyState;
}

gradSchemes
{
    default         Gauss linear;
    limited         cellLimited Gauss linear 1;
    grad(U)         $limited;
    grad(k)         $limited;
    grad(omega)     $limited;
}

divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss linearUpwindV limited;
    div(phi,k)      bounded Gauss limitedLinear 1;
    div(phi,omega)  bounded Gauss limitedLinear 1;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}

laplacianSchemes
{
    default         Gauss linear limited corrected 0.33;
}

interpolationSchemes
{
    default         linear;
}

snGradSchemes
{
    default         limited corrected 0.33;
}

wallDist
{
    method          meshWave;
}
"""
    )


def _fv_solution() -> str:
    return (
        _foam_header("dictionary", "fvSolution", "system")
        + """solvers
{
    p
    {
        solver          GAMG;
        smoother        GaussSeidel;
        tolerance       1e-7;
        relTol          0.01;
    }

    Phi
    {
        $p;
    }

    "(U|k|omega)"
    {
        solver          smoothSolver;
        smoother        GaussSeidel;
        tolerance       1e-8;
        relTol          0.1;
        nSweeps         2;
    }
}

SIMPLE
{
    nNonOrthogonalCorrectors 0;
    consistent      yes;

    residualControl
    {
        p               1e-3;
        U               1e-4;
        "(k|omega)"     1e-4;
    }
}

potentialFlow
{
    nNonOrthogonalCorrectors 10;
}

relaxationFactors
{
    equations
    {
        U               0.9;
        k               0.7;
        omega           0.7;
    }
}

cache
{
    grad(U);
}
"""
    )


def _block_mesh_dict(domain: Domain, cells: tuple[int, int, int]) -> str:
    x0, x1, y0, y1, z0, z1 = domain.xmin, domain.xmax, domain.ymin, domain.ymax, domain.zmin, domain.zmax
    verts = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    vertex_text = "\n".join(f"    {_vec(v)}" for v in verts)
    return (
        _foam_header("dictionary", "blockMeshDict", "system")
        + f"""scale   1;

vertices
(
{vertex_text}
);

blocks
(
    hex (0 1 2 3 4 5 6 7) ({cells[0]} {cells[1]} {cells[2]}) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    inlet
    {{
        type patch;
        faces ((0 4 7 3));
    }}
    outlet
    {{
        type patch;
        faces ((1 2 6 5));
    }}
    sides
    {{
        type patch;
        faces ((0 1 5 4) (3 7 6 2));
    }}
    top
    {{
        type patch;
        faces ((4 5 6 7));
    }}
    ground
    {{
        type wall;
        faces ((0 3 2 1));
    }}
);

mergePatchPairs
(
);
"""
    )


def _snappy_dict(level: int, regions: list[dict], location) -> str:
    """``level``: building surface level; ``regions``: searchableBox refinement regions (name, min, max, level).
    One region (the refinement box) writes exactly the pre-phase-B dictionary."""
    geometry = "".join(
        f"""
    {r["name"]}
    {{
        type searchableBox;
        min {_vec(r["min"])};
        max {_vec(r["max"])};
    }}
""" for r in regions)
    region_entries = "".join(
        f"""        {r["name"]}
        {{
            mode inside;
            levels ((1E15 {r["level"]}));
        }}
""" for r in regions)
    return (
        _foam_header("dictionary", "snappyHexMeshDict", "system")
        + f"""castellatedMesh true;
snap            true;
addLayers       false;

geometry
{{
    building.stl
    {{
        type triSurfaceMesh;
        name building;
    }}
{geometry}}}

castellatedMeshControls
{{
    maxLocalCells   4000000;
    maxGlobalCells  12000000;
    minRefinementCells 10;
    maxLoadUnbalance 0.10;
    nCellsBetweenLevels 3;

    features
    (
    );

    refinementSurfaces
    {{
        building
        {{
            level ({level} {level});
            patchInfo
            {{
                type wall;
                inGroups (wall);
            }}
        }}
    }}

    resolveFeatureAngle 30;

    refinementRegions
    {{
{region_entries}    }}

    locationInMesh {_vec(location)};
    allowFreeStandingZoneFaces true;
}}

snapControls
{{
    nSmoothPatch    3;
    tolerance       2.0;
    nSolveIter      30;
    nRelaxIter      5;
    nFeatureSnapIter 10;
    implicitFeatureSnap true;
    explicitFeatureSnap false;
    multiRegionFeatureSnap false;
}}

addLayersControls
{{
    relativeSizes   true;
    layers
    {{
    }}
    expansionRatio  1.0;
    finalLayerThickness 0.3;
    minThickness    0.1;
    nGrow           0;
    featureAngle    60;
    slipFeatureAngle 30;
    nRelaxIter      3;
    nSmoothSurfaceNormals 1;
    nSmoothNormals  3;
    nSmoothThickness 10;
    maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.3;
    minMedialAxisAngle 90;
    nBufferCellsNoExtrude 0;
    nLayerIter      50;
}}

meshQualityControls
{{
    #include "meshQualityDict"
}}

writeFlags
(
    scalarLevels
);

mergeTolerance  1e-6;
"""
    )


def _mesh_quality_dict() -> str:
    return (
        _foam_header("dictionary", "meshQualityDict", "system")
        + """maxNonOrtho         65;
maxBoundarySkewness 20;
maxInternalSkewness 4;
maxConcave          80;
minVol              1e-13;
minTetQuality       1e-15;
minArea             -1;
minTwist            0.02;
minDeterminant      0.001;
minFaceWeight       0.05;
minVolRatio         0.01;
minTriangleTwist    -1;
nSmoothScale        4;
errorReduction      0.75;

relaxed
{
    maxNonOrtho     75;
}
"""
    )


def _decompose_dict(n_procs: int) -> str:
    return (
        _foam_header("dictionary", "decomposeParDict", "system")
        + f"""numberOfSubdomains {n_procs};

method          scotch;
"""
    )


def _turbulence_properties(model: str) -> str:
    return (
        _foam_header("dictionary", "turbulenceProperties", "constant")
        + f"""simulationType  RAS;

RAS
{{
    RASModel        {model};
    turbulence      on;
    printCoeffs     on;
}}
"""
    )


def _transport_properties(nu: float) -> str:
    return (
        _foam_header("dictionary", "transportProperties", "constant")
        + f"""transportModel  Newtonian;

nu              {nu:.6g};
"""
    )


def _abl_conditions(params: CaseParams) -> str:
    return f"""Uref            {params.uref_m_s:.6g};
Zref            {params.zref_m:.6g};
zDir            (0 0 1);
flowDir         (1 0 0);
z0              uniform {params.z0_m:.6g};
zGround         uniform {params.ground_z_m:.6g};
d               uniform 0.0;
kappa           0.41;
Cmu             0.09;
"""


def _field_u(params: CaseParams) -> str:
    return (
        _foam_header("volVectorField", "U", "0")
        + f"""#include        "include/ABLConditions"

dimensions      [0 1 -1 0 0 0 0];

internalField   uniform ({params.uref_m_s:.6g} 0 0);

boundaryField
{{
    inlet
    {{
        type            atmBoundaryLayerInletVelocity;
        #include        "include/ABLConditions"
        value           $internalField;
    }}

    outlet
    {{
        type            inletOutlet;
        inletValue      uniform (0 0 0);
        value           $internalField;
    }}

    sides
    {{
        type            slip;
    }}

    top
    {{
        type            slip;
    }}

    ground
    {{
        type            noSlip;
    }}

    building
    {{
        type            noSlip;
    }}

    "procBoundary.*"
    {{
        type            processor;
    }}
}}
"""
    )


def _field_p() -> str:
    return (
        _foam_header("volScalarField", "p", "0")
        + """dimensions      [0 2 -2 0 0 0 0];

internalField   uniform 0;

boundaryField
{
    inlet
    {
        type            zeroGradient;
    }

    outlet
    {
        type            fixedValue;
        value           uniform 0;
    }

    sides
    {
        type            slip;
    }

    top
    {
        type            slip;
    }

    ground
    {
        type            zeroGradient;
    }

    building
    {
        type            zeroGradient;
    }

    "procBoundary.*"
    {
        type            processor;
    }
}
"""
    )


def _inlet_block(abl_type: str, inlet: str) -> str:
    if inlet == "fixed":
        return """    inlet
    {
        type            fixedValue;
        value           $internalField;
    }
"""
    return f"""    inlet
    {{
        type            {abl_type};
        #include        "include/ABLConditions"
        value           $internalField;
    }}
"""


def _field_k(k0: float, *, inlet: str = "abl") -> str:
    return (
        _foam_header("volScalarField", "k", "0")
        + f"""#include        "include/ABLConditions"

dimensions      [0 2 -2 0 0 0 0];

internalField   uniform {k0:.6g};

boundaryField
{{
"""
        + _inlet_block("atmBoundaryLayerInletK", inlet)
        + f"""
    outlet
    {{
        type            inletOutlet;
        inletValue      $internalField;
        value           $internalField;
    }}

    sides
    {{
        type            slip;
    }}

    top
    {{
        type            slip;
    }}

    ground
    {{
        type            kqRWallFunction;
        value           $internalField;
    }}

    building
    {{
        type            kqRWallFunction;
        value           $internalField;
    }}

    "procBoundary.*"
    {{
        type            processor;
    }}
}}
"""
    )


def _field_omega(omega0: float, *, inlet: str = "abl") -> str:
    return (
        _foam_header("volScalarField", "omega", "0")
        + f"""#include        "include/ABLConditions"

dimensions      [0 0 -1 0 0 0 0];

internalField   uniform {omega0:.6g};

boundaryField
{{
"""
        + _inlet_block("atmBoundaryLayerInletOmega", inlet)
        + f"""
    outlet
    {{
        type            inletOutlet;
        inletValue      $internalField;
        value           $internalField;
    }}

    sides
    {{
        type            slip;
    }}

    top
    {{
        type            slip;
    }}

    ground
    {{
        type            omegaWallFunction;
        value           $internalField;
    }}

    building
    {{
        type            omegaWallFunction;
        value           $internalField;
    }}

    "procBoundary.*"
    {{
        type            processor;
    }}
}}
"""
    )


def _field_nut(*, wall_z0_m: float | None = None) -> str:
    ground_z0 = "$z0" if wall_z0_m is None else f"uniform {float(wall_z0_m):.6g}"
    return (
        _foam_header("volScalarField", "nut", "0")
        + """#include        "include/ABLConditions"

dimensions      [0 2 -1 0 0 0 0];

internalField   uniform 0;

boundaryField
{
    inlet
    {
        type            calculated;
        value           uniform 0;
    }

    outlet
    {
        type            calculated;
        value           uniform 0;
    }

    sides
    {
        type            calculated;
        value           uniform 0;
    }

    top
    {
        type            calculated;
        value           uniform 0;
    }

    ground
    {
        type            atmNutkWallFunction;
        z0              __GROUND_Z0__;
        value           uniform 0;
    }

    building
    {
        type            nutkWallFunction;
        value           uniform 0;
    }

    "procBoundary.*"
    {
        type            processor;
    }
}
""".replace("__GROUND_Z0__", ground_z0)
    )


def _allcontinue(end_time: int) -> str:
    return f"""#!/bin/bash
cd "${{0%/*}}" || exit 1
export OMPI_ALLOW_RUN_AS_ROOT=1
export OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1
export OMPI_MCA_btl_vader_single_copy_mechanism=none
. "${{WM_PROJECT_DIR:?}}/bin/tools/RunFunctions"
set -e

# Contract S5 / R-A4: one automatic endTime extension when residualControl was not reached.
foamDictionary -entry endTime -set {end_time} system/controlDict
foamDictionary -entry writeInterval -set {end_time} system/controlDict
runParallel -s {CONTINUE_LOG_SUFFIX} $(getApplication)
runApplication -s {CONTINUE_LOG_SUFFIX} reconstructPar -latestTime
echo "ALLCONTINUE_COMPLETE"
"""


def _allrun() -> str:
    return """#!/bin/bash
cd "${0%/*}" || exit 1
export OMPI_ALLOW_RUN_AS_ROOT=1
export OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1
export OMPI_MCA_btl_vader_single_copy_mechanism=none
. "${WM_PROJECT_DIR:?}/bin/tools/RunFunctions"
set -e

runApplication blockMesh
runApplication decomposePar -force
runParallel snappyHexMesh -overwrite
runParallel checkMesh -constant
restore0Dir -processor
runParallel $(getApplication)
runApplication reconstructParMesh -constant
runApplication reconstructPar -latestTime
echo "ALLRUN_COMPLETE"
"""
