"""Write sampled CFD results as a USD overlay layer under ``/World/Overlays/Cfd``.

The layer never touches ``model.usdc``. A wrapper stage sublayers the model
and the result layer so Kit can open both together.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from .foam_vtk import VtkSurface
from .wind import rotate_z

OVERLAY_ROOT = "/World/Overlays/Cfd"


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


def write_result_layer(
    *,
    out_path: Path,
    run_id: str,
    pedestrian_plane: VtkSurface | None,
    building_surface: VtkSurface | None,
    streamlines: VtkSurface | None,
    solver_rotation_alpha_rad: float,
    run_custom_data: dict | None = None,
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

    def to_model(points: np.ndarray) -> np.ndarray:
        return rotate_z(points, back)

    if pedestrian_plane is not None and pedestrian_plane.polygon_count:
        mesh = UsdGeom.Mesh.Define(stage, f"{run_path}/PedestrianWind_1p5m")
        pts = to_model(pedestrian_plane.points)
        _set_mesh_topology(mesh, pts, pedestrian_plane.polygons, Vt, Gf)
        velocity = pedestrian_plane.point_data.get("U")
        pressure = pedestrian_plane.point_data.get("p")
        summary = {}
        if velocity is not None:
            magnitude = np.linalg.norm(velocity, axis=1)
            _set_primvar(mesh, "U_magnitude", magnitude, "vertex", Sdf, Vt, Gf)
            _set_primvar(mesh, "U", to_model(velocity), "vertex", Sdf, Vt, Gf, vector=True)
            _set_display_color(mesh, colormap(magnitude), "vertex", Vt, Gf)
            summary = {"U_magnitude_min": float(magnitude.min()), "U_magnitude_max": float(magnitude.max())}
        if pressure is not None:
            _set_primvar(mesh, "p", pressure, "vertex", Sdf, Vt, Gf)
        mesh.GetDoubleSidedAttr().Set(True)
        written["PedestrianWind_1p5m"] = {"path": str(mesh.GetPath()), "polygons": pedestrian_plane.polygon_count, **summary}

    if building_surface is not None and building_surface.polygon_count:
        mesh = UsdGeom.Mesh.Define(stage, f"{run_path}/BuildingSurfacePressure")
        pts = to_model(building_surface.points)
        _set_mesh_topology(mesh, pts, building_surface.polygons, Vt, Gf)
        pressure = building_surface.cell_data.get("p")
        if pressure is None:
            pressure = building_surface.point_data.get("p")
            interp = "vertex"
        else:
            interp = "uniform"
        summary = {}
        if pressure is not None:
            _set_primvar(mesh, "p", pressure, interp, Sdf, Vt, Gf)
            _set_display_color(mesh, colormap(pressure), interp, Vt, Gf)
            summary = {"p_min": float(np.nanmin(pressure)), "p_max": float(np.nanmax(pressure))}
        mesh.GetDoubleSidedAttr().Set(True)
        written["BuildingSurfacePressure"] = {"path": str(mesh.GetPath()), "polygons": building_surface.polygon_count, **summary}

    if streamlines is not None and streamlines.lines:
        curves = UsdGeom.BasisCurves.Define(stage, f"{run_path}/Streamlines")
        counts = [int(len(line)) for line in streamlines.lines if len(line) >= 2]
        order = np.concatenate([line for line in streamlines.lines if len(line) >= 2])
        pts = to_model(streamlines.points[order])
        curves.CreateTypeAttr(UsdGeom.Tokens.linear)
        curves.CreateCurveVertexCountsAttr(Vt.IntArray(counts))
        curves.CreatePointsAttr(Vt.Vec3fArray([Gf.Vec3f(*map(float, p)) for p in pts]))
        curves.CreateWidthsAttr(Vt.FloatArray([0.2] * pts.shape[0]))
        velocity = streamlines.point_data.get("U")
        if velocity is not None:
            magnitude = np.linalg.norm(velocity[order], axis=1)
            _set_primvar(curves, "U_magnitude", magnitude, "vertex", Sdf, Vt, Gf)
            _set_display_color(curves, colormap(magnitude), "vertex", Vt, Gf)
        written["Streamlines"] = {"path": str(curves.GetPath()), "curves": len(counts), "points": int(pts.shape[0])}

    stage.GetRootLayer().Save()
    return {"layer": str(out_path), "run_prim": run_path, "prims": written}


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
