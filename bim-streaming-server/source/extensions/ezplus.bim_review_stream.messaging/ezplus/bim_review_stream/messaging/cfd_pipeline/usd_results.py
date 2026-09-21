"""Write sampled CFD results as a USD overlay layer under ``/World/Overlays/Cfd``.

The layer never touches ``model.usdc``. A wrapper stage sublayers the model
and the result layer so Kit can open both together.

S3.1 (visual quality): the pedestrian plane is clipped to the building bbox
expanded by 3H so the building is not buried under a domain-wide slab; every
prim shares one fixed colour scale (U 0–5 m/s, p from this run's surface
range) and the scale is written to the run prim's customData for the legend;
the plane is translucent; streamlines are tubes; a particle animation
(time-sampled UsdGeomPoints) derived from the steady solution shows the flow.
"""

from __future__ import annotations

import re
from dataclasses import asdict
from pathlib import Path

import numpy as np

from .flow_animation import AnimationParams, ParticleAnimation, advect_along_tracks
from .foam_vtk import VtkSurface
from .wind import rotate_z

OVERLAY_ROOT = "/World/Overlays/Cfd"
U_SCALE_M_S: tuple[float, float] = (0.0, 5.0)
PLANE_CLIP_HEIGHTS = 3.0
PLANE_OPACITY = 0.6
STREAMLINE_WIDTH_M = 0.5
PARTICLE_WIDTH_M = 0.6
ANIMATION_NOTE = "示意動畫，基於穩態解（simpleFoam steady-state）；非瞬態模擬"


def safe_prim_name(value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9_]", "_", value)
    if not name or not (name[0].isalpha() or name[0] == "_"):
        name = f"_{name}"
    return name


def colormap(values: np.ndarray, vmin: float | None = None, vmax: float | None = None) -> np.ndarray:
    """Blue -> cyan -> green -> yellow -> red ramp, returns (n, 3) in 0..1."""
    values = np.asarray(values, dtype=np.float64)
    finite = values[np.isfinite(values)]
    lo = float(finite.min()) if vmin is None and finite.size else (vmin or 0.0)
    hi = float(finite.max()) if vmax is None and finite.size else (vmax if vmax is not None else 1.0)
    if hi <= lo:
        hi = lo + 1.0
    t = np.clip((np.nan_to_num(values, nan=lo) - lo) / (hi - lo), 0.0, 1.0)
    stops = np.array([[0.0, 0.0, 1.0], [0.0, 1.0, 1.0], [0.0, 1.0, 0.0], [1.0, 1.0, 0.0], [1.0, 0.0, 0.0]])
    idx = np.minimum((t * 4).astype(int), 3)
    frac = t * 4 - idx
    return stops[idx] * (1 - frac)[:, None] + stops[idx + 1] * frac[:, None]


def clip_surface_to_xy_box(surface: VtkSurface, xmin: float, xmax: float, ymin: float, ymax: float) -> VtkSurface:
    """Keep polygons whose vertices all lie inside the XY box; compact point arrays and point data."""
    inside = (
        (surface.points[:, 0] >= xmin) & (surface.points[:, 0] <= xmax)
        & (surface.points[:, 1] >= ymin) & (surface.points[:, 1] <= ymax)
    )
    kept_index = [i for i, poly in enumerate(surface.polygons) if inside[np.asarray(poly, dtype=int)].all()]
    if not kept_index:
        return VtkSurface(points=np.zeros((0, 3)), polygons=[], point_data={k: v[:0] for k, v in surface.point_data.items()})
    kept_polys = [np.asarray(surface.polygons[i], dtype=int) for i in kept_index]
    used = np.unique(np.concatenate(kept_polys))
    remap = np.full(surface.points.shape[0], -1, dtype=int)
    remap[used] = np.arange(used.size)
    n_points, n_cells = surface.points.shape[0], len(surface.polygons)
    # Only per-point / per-cell arrays are remapped; scalar metadata arrays (e.g. TimeValue) pass through.
    return VtkSurface(
        points=surface.points[used],
        polygons=[remap[poly] for poly in kept_polys],
        point_data={k: (v[used] if getattr(v, "shape", (0,))[0] == n_points else v) for k, v in surface.point_data.items()},
        cell_data={k: (v[kept_index] if getattr(v, "shape", (0,))[0] == n_cells else v) for k, v in surface.cell_data.items()},
    )


def plane_clip_box(bbox_min, bbox_max, *, ground_z: float, heights: float = PLANE_CLIP_HEIGHTS) -> tuple[float, float, float, float]:
    """XY box = building bbox expanded by ``heights`` × building height (solver frame)."""
    bbox_min = np.asarray(bbox_min, dtype=np.float64)
    bbox_max = np.asarray(bbox_max, dtype=np.float64)
    height = max(float(bbox_max[2] - ground_z), 1.0)
    margin = heights * height
    return (float(bbox_min[0] - margin), float(bbox_max[0] + margin), float(bbox_min[1] - margin), float(bbox_max[1] + margin))


def write_result_layer(
    *,
    out_path: Path,
    run_id: str,
    pedestrian_plane: VtkSurface | None,
    building_surface: VtkSurface | None,
    streamlines: VtkSurface | None,
    solver_rotation_alpha_rad: float,
    run_custom_data: dict | None = None,
    building_bbox_solver_frame: tuple | None = None,
    ground_z: float = 0.0,
    u_scale_m_s: tuple[float, float] = U_SCALE_M_S,
    plane_opacity: float = PLANE_OPACITY,
    streamline_width_m: float = STREAMLINE_WIDTH_M,
    animation: AnimationParams | None = AnimationParams(),
) -> dict:
    """Author the overlay layer; geometry is rotated back into the model frame."""
    from pxr import Gf, Sdf, Usd, UsdGeom, Vt

    out_path = Path(out_path)
    stage = Usd.Stage.CreateNew(str(out_path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    UsdGeom.Xform.Define(stage, "/World/Overlays")
    UsdGeom.Xform.Define(stage, OVERLAY_ROOT)
    run_path = f"{OVERLAY_ROOT}/{safe_prim_name(run_id)}"
    run_prim = UsdGeom.Xform.Define(stage, run_path).GetPrim()
    run_prim.SetCustomDataByKey("cfd:run_id", run_id)
    run_prim.SetCustomDataByKey("cfd:purpose", "design_comparison_only")
    for key, value in (run_custom_data or {}).items():
        run_prim.SetCustomDataByKey(f"cfd:{key}", value)

    back = -solver_rotation_alpha_rad
    written: dict[str, dict] = {}
    u_lo, u_hi = float(u_scale_m_s[0]), float(u_scale_m_s[1])

    def to_model(points: np.ndarray) -> np.ndarray:
        return rotate_z(points, back)

    # ── one pressure scale for the whole run (this direction's surface range) ──
    p_lo = p_hi = None
    building_p = None
    building_interp = "uniform"
    if building_surface is not None and building_surface.polygon_count:
        building_p = building_surface.cell_data.get("p")
        if building_p is None:
            building_p = building_surface.point_data.get("p")
            building_interp = "vertex"
        if building_p is not None and np.isfinite(building_p).any():
            p_lo, p_hi = float(np.nanmin(building_p)), float(np.nanmax(building_p))

    # VtDictionary cannot hold None: the pressure entry only carries a range when a surface was sampled.
    legend = {
        "U": {"min": u_lo, "max": u_hi, "unit": "m/s", "prims": ["PedestrianWind_1p5m", "Streamlines", "FlowParticles"]},
        "p": {"unit": "Pa", "prims": ["BuildingSurfacePressure"], "available": p_lo is not None,
              **({"min": p_lo, "max": p_hi} if p_lo is not None else {})},
    }
    run_prim.SetCustomDataByKey("cfd:legend", legend)

    if pedestrian_plane is not None and pedestrian_plane.polygon_count:
        plane = pedestrian_plane
        clip = None
        if building_bbox_solver_frame is not None:
            clip = plane_clip_box(building_bbox_solver_frame[0], building_bbox_solver_frame[1], ground_z=ground_z)
            clipped = clip_surface_to_xy_box(plane, *clip)
            if clipped.polygon_count:
                plane = clipped
        mesh = UsdGeom.Mesh.Define(stage, f"{run_path}/PedestrianWind_1p5m")
        pts = to_model(plane.points)
        _set_mesh_topology(mesh, pts, plane.polygons, Vt, Gf)
        velocity = plane.point_data.get("U")
        pressure = plane.point_data.get("p")
        summary: dict = {"clipped_to_bbox_heights": PLANE_CLIP_HEIGHTS if clip else None}
        if velocity is not None:
            magnitude = np.linalg.norm(velocity, axis=1)
            _set_primvar(mesh, "U_magnitude", magnitude, "vertex", Sdf, Vt, Gf)
            _set_primvar(mesh, "U", to_model(velocity), "vertex", Sdf, Vt, Gf, vector=True)
            _set_display_color(mesh, colormap(magnitude, u_lo, u_hi), "vertex", Vt, Gf)
            summary.update({"U_magnitude_min": float(magnitude.min()), "U_magnitude_max": float(magnitude.max())})
        if pressure is not None:
            _set_primvar(mesh, "p", pressure, "vertex", Sdf, Vt, Gf)
        mesh.CreateDisplayOpacityPrimvar(UsdGeom.Tokens.constant).Set(Vt.FloatArray([float(plane_opacity)]))
        mesh.GetDoubleSidedAttr().Set(True)
        written["PedestrianWind_1p5m"] = {"path": str(mesh.GetPath()), "polygons": plane.polygon_count, "display_opacity": float(plane_opacity), **summary}

    if building_surface is not None and building_surface.polygon_count:
        mesh = UsdGeom.Mesh.Define(stage, f"{run_path}/BuildingSurfacePressure")
        pts = to_model(building_surface.points)
        _set_mesh_topology(mesh, pts, building_surface.polygons, Vt, Gf)
        summary = {}
        if building_p is not None:
            _set_primvar(mesh, "p", building_p, building_interp, Sdf, Vt, Gf)
            _set_display_color(mesh, colormap(building_p, p_lo, p_hi), building_interp, Vt, Gf)
            summary = {"p_min": p_lo, "p_max": p_hi}
        mesh.GetDoubleSidedAttr().Set(True)
        written["BuildingSurfacePressure"] = {"path": str(mesh.GetPath()), "polygons": building_surface.polygon_count, **summary}

    if streamlines is not None and streamlines.lines:
        curves = UsdGeom.BasisCurves.Define(stage, f"{run_path}/Streamlines")
        counts = [int(len(line)) for line in streamlines.lines if len(line) >= 2]
        order = np.concatenate([line for line in streamlines.lines if len(line) >= 2])
        pts = to_model(streamlines.points[order])
        curves.CreateTypeAttr(UsdGeom.Tokens.linear)
        curves.CreateWrapAttr(UsdGeom.Tokens.nonperiodic)
        curves.CreateCurveVertexCountsAttr(Vt.IntArray(counts))
        curves.CreatePointsAttr(Vt.Vec3fArray([Gf.Vec3f(*map(float, p)) for p in pts]))
        # Constant tube width: RTX renders BasisCurves as round tubes of this diameter.
        curves.CreateWidthsAttr(Vt.FloatArray([float(streamline_width_m)]))
        curves.SetWidthsInterpolation(UsdGeom.Tokens.constant)
        velocity = streamlines.point_data.get("U")
        if velocity is not None:
            magnitude = np.linalg.norm(velocity[order], axis=1)
            _set_primvar(curves, "U_magnitude", magnitude, "vertex", Sdf, Vt, Gf)
            _set_display_color(curves, colormap(magnitude, u_lo, u_hi), "vertex", Vt, Gf)
        written["Streamlines"] = {"path": str(curves.GetPath()), "curves": len(counts), "points": int(pts.shape[0]), "width_m": float(streamline_width_m)}

        if animation is not None:
            particles = advect_along_tracks(streamlines, animation)
            if particles is not None:
                written["FlowParticles"] = _write_particles(stage, run_path, particles, to_model, u_lo, u_hi, Vt, Gf, UsdGeom)
                stage.SetStartTimeCode(0)
                stage.SetEndTimeCode(particles.frames - 1)
                stage.SetTimeCodesPerSecond(particles.fps)
                stage.SetFramesPerSecond(particles.fps)
                run_prim.SetCustomDataByKey("cfd:animation", {
                    "kind": "particle_advection_along_steady_streamlines",
                    "note": ANIMATION_NOTE,
                    "fps": particles.fps,
                    "frames": particles.frames,
                    "particles": particles.particles,
                    "tracks_used": particles.tracks_used,
                    "prim": f"{run_path}/FlowParticles",
                })
                stage.GetRootLayer().customLayerData = {
                    "cfd:animation": {"fps": particles.fps, "frames": particles.frames, "loop": True, "note": ANIMATION_NOTE},
                }

    stage.GetRootLayer().Save()
    return {"layer": str(out_path), "run_prim": run_path, "prims": written, "legend": legend, **({"animation": asdict(animation)} if animation else {})}


def _write_particles(stage, run_path: str, particles: ParticleAnimation, to_model, u_lo: float, u_hi: float, Vt, Gf, UsdGeom) -> dict:
    """Time-sampled UsdGeomPoints: positions and speed colours per frame, constant widths."""
    points = UsdGeom.Points.Define(stage, f"{run_path}/FlowParticles")
    points_attr = points.CreatePointsAttr()
    color_primvar = points.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex)
    extent_attr = points.CreateExtentAttr()
    points.CreateWidthsAttr(Vt.FloatArray([PARTICLE_WIDTH_M]))
    points.SetWidthsInterpolation(UsdGeom.Tokens.constant)
    points.GetPrim().SetCustomDataByKey("cfd:animation_note", ANIMATION_NOTE)
    frames = particles.frames
    for frame in range(frames):
        pos = to_model(particles.positions[frame].astype(np.float64))
        points_attr.Set(Vt.Vec3fArray.FromNumpy(pos.astype(np.float32)), float(frame))
        color_primvar.Set(Vt.Vec3fArray.FromNumpy(colormap(particles.speeds[frame], u_lo, u_hi).astype(np.float32)), float(frame))
        lo, hi = pos.min(axis=0) - PARTICLE_WIDTH_M, pos.max(axis=0) + PARTICLE_WIDTH_M
        extent_attr.Set(Vt.Vec3fArray([Gf.Vec3f(*map(float, lo)), Gf.Vec3f(*map(float, hi))]), float(frame))
    return {
        "path": str(points.GetPath()), "particles": particles.particles, "frames": frames, "fps": particles.fps,
        "tracks_used": particles.tracks_used, "width_m": PARTICLE_WIDTH_M, "note": ANIMATION_NOTE,
    }


def write_wrapper_stage(*, out_path: Path, model_usdc: Path, result_layer: Path) -> Path:
    """Stage that sublayers the original model and the CFD result layer."""
    from pxr import Sdf, Usd, UsdGeom

    out_path = Path(out_path)
    stage = Usd.Stage.CreateNew(str(out_path))
    root = stage.GetRootLayer()
    root.subLayerPaths.append(_relative(model_usdc, out_path.parent))
    root.subLayerPaths.append(_relative(result_layer, out_path.parent))
    stage.SetDefaultPrim(stage.GetPrimAtPath("/World"))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    result = Sdf.Layer.FindOrOpen(str(result_layer))
    if result is not None and result.HasStartTimeCode():
        # The root layer owns the stage time range; copy it so the wrapper plays the animation.
        stage.SetStartTimeCode(result.startTimeCode)
        stage.SetEndTimeCode(result.endTimeCode)
        stage.SetTimeCodesPerSecond(result.timeCodesPerSecond)
        stage.SetFramesPerSecond(result.framesPerSecond)
    root.Save()
    return out_path


def _relative(target: Path, base: Path) -> str:
    try:
        rel = Path(target).resolve().relative_to(Path(base).resolve())
        return "./" + rel.as_posix()
    except ValueError:
        import os

        return Path(os.path.relpath(Path(target).resolve(), Path(base).resolve())).as_posix()


def _set_mesh_topology(mesh, points: np.ndarray, polygons: list[np.ndarray], Vt, Gf) -> None:
    counts = [int(len(poly)) for poly in polygons]
    indices = np.concatenate(polygons).astype(int) if polygons else np.zeros(0, dtype=int)
    mesh.CreatePointsAttr(Vt.Vec3fArray([Gf.Vec3f(*map(float, p)) for p in points]))
    mesh.CreateFaceVertexCountsAttr(Vt.IntArray(counts))
    mesh.CreateFaceVertexIndicesAttr(Vt.IntArray([int(i) for i in indices]))
    mesh.CreateSubdivisionSchemeAttr("none")


def _set_primvar(gprim, name: str, values: np.ndarray, interpolation: str, Sdf, Vt, Gf, *, vector: bool = False) -> None:
    from pxr import UsdGeom

    api = UsdGeom.PrimvarsAPI(gprim)
    if vector:
        primvar = api.CreatePrimvar(name, Sdf.ValueTypeNames.Float3Array, interpolation)
        primvar.Set(Vt.Vec3fArray([Gf.Vec3f(*map(float, v)) for v in values]))
    else:
        primvar = api.CreatePrimvar(name, Sdf.ValueTypeNames.FloatArray, interpolation)
        primvar.Set(Vt.FloatArray([float(v) for v in np.nan_to_num(values)]))


def _set_display_color(gprim, colors: np.ndarray, interpolation: str, Vt, Gf) -> None:
    primvar = gprim.CreateDisplayColorPrimvar(interpolation)
    primvar.Set(Vt.Vec3fArray([Gf.Vec3f(*map(float, c)) for c in colors]))
