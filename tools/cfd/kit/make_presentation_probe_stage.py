"""Synthetic CFD presentation probe stage (CP1, docs/plans/cfd-presentation-parity-contract.md).

Pure ``usd-core`` (repo .venv), deterministic, no project data. Writes three files
into ``--out-dir`` that mimic the production layout of ``cfd_pipeline/usd_results.py``:

* ``model.usdc``   a 40 x 25 x 30 m box "building" at ``/World/Elements/IfcWall/ProbeBuilding``
* ``overlay.usdc`` one run prim ``/World/Overlays/Cfd/<run>`` holding the probe geometry
* ``view.usda``    wrapper that sublayers both (``usd_results.write_wrapper_stage``)

Conventions match the writer: Z up, metres, model +Y = project north, wind bearing is the
meteorological "from" direction clockwise from +Y, one shared U colour scale (0-5 m/s),
240-frame loop at 24 fps with ``customLayerData["cfd:animation"]`` when anything is animated.

The flow is an analytic stand-in (2D potential flow around a cylinder that contains the
footprint, fading out above the roof, power-law profile in Z). It only needs to look like a
wind field; the probes measure rendering technique, layer size and open time, not physics.

    python tools/cfd/kit/make_presentation_probe_stage.py --out-dir <dir> --streamlines 60 --growth segments
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

_CFD_TOOLS = Path(__file__).resolve().parents[1]
if str(_CFD_TOOLS) not in sys.path:
    sys.path.insert(0, str(_CFD_TOOLS))

from bimcfd.usd_results import ANIMATION_NOTE, OVERLAY_ROOT, U_SCALE_M_S, colormap, particle_width_m, write_wrapper_stage  # noqa: E402

PLANE_Z_M = 1.5
VECTOR_Z_M = PLANE_Z_M + 0.05  # N5.1: 0.05 m above the pedestrian plane
UREF_M_S = 5.0
ZREF_M = 10.0
MIN_SPEED_M_S = 0.05
PLANE_CLIP_HEIGHTS = 3.0
GROWTH_MODES = ("none", "segments", "widths")
ARROW_MODES = ("instancer", "instancer_binned", "merged")
SECTION_IDS = ("Z1", "Z2", "Z3", "X1", "Y1")
COLOUR_BINS = 8
CLOCK_ATTR = "probe:frame"
WIND_ARROW_COLOUR = (0.95, 0.95, 0.95)
BUILDING_COLOUR = (0.62, 0.62, 0.6)
INSIDE_BUILDING_COLOUR = (0.35, 0.35, 0.35)


@dataclass(frozen=True)
class ProbeSpec:
    run_id: str = "cfd_probe"
    building_size_m: tuple[float, float, float] = (40.0, 25.0, 30.0)
    wind_from_deg: float = 270.0  # from the west: the flow runs along +X
    fps: int = 24
    frames: int = 240
    plane: bool = True
    plane_spacing_m: float = 4.0
    surface_pressure: bool = True
    streamlines: int = 0
    streamline_points: int = 60
    static_streamlines: bool = True
    streamline_width_m: float = 0.5
    growth: str = "none"
    growth_segments: int = 24
    growth_seconds: float = 6.0
    particles: int = 0
    arrows: int = 0
    arrow_mode: str = "instancer"
    wind_arrow: bool = False
    sections: int = 0
    section_spacing_m: float = 2.0

    def validate(self) -> None:
        if self.growth not in GROWTH_MODES:
            raise ValueError(f"growth must be one of {GROWTH_MODES}")
        if self.arrow_mode not in ARROW_MODES:
            raise ValueError(f"arrow_mode must be one of {ARROW_MODES}")
        if not 0 <= self.sections <= len(SECTION_IDS):
            raise ValueError(f"sections must be 0..{len(SECTION_IDS)}")
        if (self.growth != "none" or self.particles) and self.streamlines < 1:
            raise ValueError("growth and particles need streamlines >= 1")
        if self.streamlines and self.streamline_points < 2:
            raise ValueError("streamline_points must be >= 2")
        if self.growth != "none" and self.growth_segments < 1:
            raise ValueError("growth_segments must be >= 1")


# ── geometry of the synthetic scene ─────────────────────────────────────────────


def _half(spec: ProbeSpec) -> tuple[float, float, float]:
    lx, ly, h = spec.building_size_m
    return lx / 2.0, ly / 2.0, h


def _obstacle_radius(spec: ProbeSpec) -> float:
    hx, hy, _ = _half(spec)
    return 1.05 * math.hypot(hx, hy)


def _flow_axes(spec: ProbeSpec) -> tuple[np.ndarray, np.ndarray]:
    rad = math.radians(spec.wind_from_deg)
    downwind = np.array([-math.sin(rad), -math.cos(rad)])
    normal = np.array([-downwind[1], downwind[0]])
    return downwind, normal


def velocity_field(points: np.ndarray, spec: ProbeSpec) -> np.ndarray:
    """Analytic stand-in flow in model coordinates, (n, 3) -> (n, 3) m/s."""
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    _, _, height = _half(spec)
    radius = _obstacle_radius(spec)
    downwind, normal = _flow_axes(spec)
    xf = points[:, :2] @ downwind
    yf = points[:, :2] @ normal
    z = np.maximum(points[:, 2], 0.1)
    speed = UREF_M_S * (z / ZREF_M) ** 0.25
    blend = np.where(z <= height, 1.0, np.exp(-(z - height) / (0.3 * height)))
    r2 = np.maximum(xf * xf + yf * yf, radius * radius)
    uf = speed * (1.0 - blend * radius * radius * (xf * xf - yf * yf) / (r2 * r2))
    vf = -speed * blend * 2.0 * radius * radius * xf * yf / (r2 * r2)
    out = np.zeros_like(points)
    out[:, :2] = uf[:, None] * downwind[None, :] + vf[:, None] * normal[None, :]
    return out


def _inside_building(points: np.ndarray, spec: ProbeSpec, margin: float = 0.0) -> np.ndarray:
    hx, hy, h = _half(spec)
    return (np.abs(points[:, 0]) < hx + margin) & (np.abs(points[:, 1]) < hy + margin) & (points[:, 2] < h + margin)


def _plane_box(spec: ProbeSpec) -> tuple[float, float, float, float]:
    hx, hy, h = _half(spec)
    margin = PLANE_CLIP_HEIGHTS * h
    return -hx - margin, hx + margin, -hy - margin, hy + margin


def _speed_colours(points: np.ndarray, spec: ProbeSpec) -> tuple[np.ndarray, np.ndarray]:
    speed = np.linalg.norm(velocity_field(points, spec), axis=1)
    return speed, colormap(speed, *U_SCALE_M_S)


def streamline_tracks(spec: ProbeSpec) -> list[tuple[np.ndarray, np.ndarray]]:
    """Seed curtain upstream (N3.1 shape), fixed-step RK2 along the field, exactly ``streamline_points`` each."""
    count, n_points = spec.streamlines, spec.streamline_points
    _, _, height = _half(spec)
    radius = _obstacle_radius(spec)
    downwind, normal = _flow_axes(spec)
    corners = np.array([[sx * spec.building_size_m[0] / 2, sy * spec.building_size_m[1] / 2] for sx in (-1, 1) for sy in (-1, 1)])
    half_width = float(np.abs(corners @ normal).max())
    n_z = min(8, max(1, count // 30)) if count >= 30 else 1
    n_y = int(math.ceil(count / n_z))
    y_span = 1.5 * half_width
    ys = -y_span + (np.arange(n_y) + 0.5) * (2 * y_span / n_y) + 0.37  # offset: no seed on the stagnation line
    zs = np.linspace(PLANE_Z_M, 1.2 * height, n_z) if n_z > 1 else np.array([PLANE_Z_M + 0.5])
    x_start = -(radius + 0.5 * height)
    x_end = radius + PLANE_CLIP_HEIGHTS * height
    step = 1.15 * (x_end - x_start) / (n_points - 1)
    tracks = []
    for index in range(count):
        z = zs[index // n_y]
        y = ys[index % n_y]
        p = np.array([*(x_start * downwind + y * normal), z])
        pts = [p]
        for _ in range(n_points - 1):
            p = _rk2_step(p, step, spec, radius, height)
            pts.append(p)
        pts_arr = np.array(pts)
        speeds = np.linalg.norm(velocity_field(pts_arr, spec), axis=1)
        tracks.append((pts_arr, speeds))
    return tracks


def _direction(p: np.ndarray, spec: ProbeSpec) -> np.ndarray:
    v = velocity_field(p[None, :], spec)[0]
    norm = float(np.linalg.norm(v))
    return v / norm if norm > 1e-9 else np.array([*_flow_axes(spec)[0], 0.0])


def _rk2_step(p: np.ndarray, step: float, spec: ProbeSpec, radius: float, height: float) -> np.ndarray:
    mid = p + 0.5 * step * _direction(p, spec)
    nxt = p + step * _direction(mid, spec)
    if nxt[2] < height:
        r = math.hypot(nxt[0], nxt[1])
        if r < radius:  # stay outside the cylinder that contains the footprint
            scale = radius * 1.001 / max(r, 1e-6)
            nxt = np.array([nxt[0] * scale, nxt[1] * scale, nxt[2]])
    return nxt


def _travel_times(points: np.ndarray, speeds: np.ndarray) -> np.ndarray:
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    seg_speed = np.maximum(0.5 * (speeds[:-1] + speeds[1:]), MIN_SPEED_M_S)
    return np.concatenate([[0.0], np.cumsum(seg / seg_speed)])


def _window(points: np.ndarray, times: np.ndarray, lo: float, hi: float) -> np.ndarray | None:
    """Sub-polyline between travel times lo..hi with interpolated end points (so pieces join)."""
    if lo >= times[-1]:
        return None
    hi = min(hi, float(times[-1]))
    inner = (times > lo) & (times < hi)
    start = np.array([np.interp(lo, times, points[:, a]) for a in range(3)])
    end = np.array([np.interp(hi, times, points[:, a]) for a in range(3)])
    piece = np.vstack([start, points[inner], end])
    return piece if piece.shape[0] >= 2 else None


# ── USD authoring helpers ───────────────────────────────────────────────────────


def _vec3f(values: np.ndarray):
    from pxr import Vt

    return Vt.Vec3fArray.FromNumpy(np.ascontiguousarray(values, dtype=np.float32))


def _set_mesh(mesh, points: np.ndarray, counts: list[int] | np.ndarray, indices: np.ndarray) -> None:
    from pxr import Vt

    mesh.CreatePointsAttr(_vec3f(points))
    mesh.CreateFaceVertexCountsAttr(Vt.IntArray.FromNumpy(np.asarray(counts, dtype=np.int32)))
    mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(np.asarray(indices, dtype=np.int32)))
    mesh.CreateSubdivisionSchemeAttr("none")
    mesh.CreateExtentAttr(_vec3f(np.array([points.min(axis=0), points.max(axis=0)])))


def _grid(u: np.ndarray, v: np.ndarray, to_xyz, keep_face=None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    uu, vv = np.meshgrid(u, v, indexing="ij")
    points = to_xyz(uu.ravel(), vv.ravel())
    nu, nv = len(u), len(v)
    ii, jj = np.meshgrid(np.arange(nu - 1), np.arange(nv - 1), indexing="ij")
    a = (ii * nv + jj).ravel()
    quads = np.stack([a, a + nv, a + nv + 1, a + 1], axis=1)
    if keep_face is not None:
        centres = points[quads].mean(axis=1)
        quads = quads[keep_face(centres)]
    return points, np.full(len(quads), 4), quads.ravel()


def _linspace(lo: float, hi: float, spacing: float) -> np.ndarray:
    return np.linspace(lo, hi, int(round((hi - lo) / spacing)) + 1)


def arrow_geometry(length: float = 1.0) -> tuple[np.ndarray, list[int], list[int]]:
    """Unit arrow along +X centred on the origin: shaft box + head prism (14 points, 11 faces)."""
    shaft_hw, head_hw, head_start, thick = 0.06, 0.2, 0.15, 0.04
    x0, x1, x2 = -0.5, head_start, 0.5
    shaft = [(x, y, z) for z in (0.0, thick) for (x, y) in ((x0, -shaft_hw), (x1, -shaft_hw), (x1, shaft_hw), (x0, shaft_hw))]
    head = [(x, y, z) for z in (0.0, thick) for (x, y) in ((x1, -head_hw), (x2, 0.0), (x1, head_hw))]
    points = np.array(shaft + head, dtype=np.float64) * np.array([length, length, length])
    faces = [
        [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],  # shaft box
        [8, 10, 9], [11, 12, 13], [8, 9, 12, 11], [9, 10, 13, 12], [10, 8, 11, 13],  # head prism
    ]
    return points, [len(f) for f in faces], [i for f in faces for i in f]


ARROW_POINTS = 14


def _define_arrow_mesh(stage, path: str, points: np.ndarray, counts, indices, colour=None):
    from pxr import UsdGeom

    mesh = UsdGeom.Mesh.Define(stage, path)
    _set_mesh(mesh, points, counts, np.asarray(indices))
    mesh.GetDoubleSidedAttr().Set(True)
    if colour is not None:
        mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.constant).Set(_vec3f(np.array([colour])))
    return mesh


# ── prim writers ────────────────────────────────────────────────────────────────


def _write_model(path: Path, spec: ProbeSpec) -> None:
    from pxr import Usd, UsdGeom

    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    UsdGeom.Xform.Define(stage, "/World/Elements")
    UsdGeom.Xform.Define(stage, "/World/Elements/IfcWall")
    points, counts, indices = _box(spec, 0.0)
    mesh = UsdGeom.Mesh.Define(stage, "/World/Elements/IfcWall/ProbeBuilding")
    _set_mesh(mesh, points, counts, indices)
    mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.constant).Set(_vec3f(np.array([BUILDING_COLOUR])))
    stage.GetRootLayer().Save()


def _box(spec: ProbeSpec, outset: float) -> tuple[np.ndarray, list[int], list[int]]:
    hx, hy, h = _half(spec)
    hx, hy, top = hx + outset, hy + outset, h + outset
    points = np.array([[x, y, z] for z in (0.0, top) for (x, y) in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))])
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return points, [4] * 6, [i for f in faces for i in f]


def _write_plane(stage, run_path: str, spec: ProbeSpec) -> dict:
    from pxr import UsdGeom, Vt

    x0, x1, y0, y1 = _plane_box(spec)
    points, counts, indices = _grid(
        _linspace(x0, x1, spec.plane_spacing_m), _linspace(y0, y1, spec.plane_spacing_m),
        lambda u, v: np.stack([u, v, np.full_like(u, PLANE_Z_M)], axis=1),
        keep_face=lambda c: ~_inside_building(c, spec))
    mesh = UsdGeom.Mesh.Define(stage, f"{run_path}/PedestrianWind_1p5m")
    _set_mesh(mesh, points, counts, indices)
    _, colours = _speed_colours(points, spec)
    mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex).Set(_vec3f(colours))
    mesh.CreateDisplayOpacityPrimvar(UsdGeom.Tokens.constant).Set(Vt.FloatArray([0.6]))
    mesh.GetDoubleSidedAttr().Set(True)
    return {"points": int(len(points)), "faces": int(len(counts))}


def _write_surface_pressure(stage, run_path: str, spec: ProbeSpec) -> dict:
    from pxr import UsdGeom

    points, counts, indices = _box(spec, 0.02)
    mesh = UsdGeom.Mesh.Define(stage, f"{run_path}/BuildingSurfacePressure")
    _set_mesh(mesh, points, counts, indices)
    rad = math.radians(spec.wind_from_deg)
    from_vec = np.array([math.sin(rad), math.cos(rad), 0.0])
    normals = np.array([[0, 0, -1], [0, 0, 1], [0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)
    cp = np.clip(normals @ from_vec, -1.0, 1.0)  # windward faces high, leeward low
    mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.uniform).Set(_vec3f(colormap(cp, -1.0, 1.0)))
    mesh.GetDoubleSidedAttr().Set(True)
    return {"faces": 6}


def _write_streamlines(stage, run_path: str, spec: ProbeSpec, tracks) -> dict:
    from pxr import UsdGeom, Vt

    curves = UsdGeom.BasisCurves.Define(stage, f"{run_path}/Streamlines")
    pts = np.vstack([t[0] for t in tracks])
    speeds = np.concatenate([t[1] for t in tracks])
    curves.CreateTypeAttr(UsdGeom.Tokens.linear)
    curves.CreateWrapAttr(UsdGeom.Tokens.nonperiodic)
    curves.CreateCurveVertexCountsAttr(Vt.IntArray([len(t[0]) for t in tracks]))
    curves.CreatePointsAttr(_vec3f(pts))
    curves.CreateWidthsAttr(Vt.FloatArray([float(spec.streamline_width_m)]))
    curves.SetWidthsInterpolation(UsdGeom.Tokens.constant)
    curves.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex).Set(_vec3f(colormap(speeds, *U_SCALE_M_S)))
    return {"curves": len(tracks), "points": int(len(pts))}


def _reveal_frames(spec: ProbeSpec) -> list[float]:
    growth_frames = spec.growth_seconds * spec.fps
    return [float(round((k + 1) / spec.growth_segments * growth_frames)) for k in range(spec.growth_segments)]


def _write_growth_segments(stage, run_path: str, spec: ProbeSpec, tracks) -> dict:
    from pxr import UsdGeom, Vt

    UsdGeom.Xform.Define(stage, f"{run_path}/StreamlineGrowth")
    timed = [(pts, speeds, _travel_times(pts, speeds)) for pts, speeds in tracks]
    t_ref = float(np.percentile([t[2][-1] for t in timed], 95))
    n = spec.growth_segments
    reveal = _reveal_frames(spec)
    curves_total = points_total = 0
    for k in range(n):
        lo = k / n * t_ref
        hi = (k + 1) / n * t_ref if k < n - 1 else math.inf
        pieces = [w for w in (_window(pts, times, lo, hi) for pts, _, times in timed) if w is not None]
        seg = UsdGeom.BasisCurves.Define(stage, f"{run_path}/StreamlineGrowth/Seg_{k:03d}")
        seg.CreateTypeAttr(UsdGeom.Tokens.linear)
        seg.CreateWrapAttr(UsdGeom.Tokens.nonperiodic)
        all_pts = np.vstack(pieces) if pieces else np.zeros((0, 3))
        seg.CreateCurveVertexCountsAttr(Vt.IntArray([len(p) for p in pieces]))
        seg.CreatePointsAttr(_vec3f(all_pts))
        seg.CreateWidthsAttr(Vt.FloatArray([float(spec.streamline_width_m)]))
        seg.SetWidthsInterpolation(UsdGeom.Tokens.constant)
        if len(all_pts):
            speeds = np.linalg.norm(velocity_field(all_pts, spec), axis=1)
            seg.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex).Set(_vec3f(colormap(speeds, *U_SCALE_M_S)))
        visibility = seg.CreateVisibilityAttr()
        visibility.Set(UsdGeom.Tokens.invisible, 0.0)
        visibility.Set(UsdGeom.Tokens.inherited, reveal[k])
        curves_total += len(pieces)
        points_total += len(all_pts)
    return {"mode": "segments", "segments": n, "curves": curves_total, "points": points_total, "reveal_frames": reveal, "t_ref_s": t_ref}


def _write_growth_widths(stage, run_path: str, spec: ProbeSpec, tracks) -> dict:
    from pxr import UsdGeom, Vt

    curves = UsdGeom.BasisCurves.Define(stage, f"{run_path}/StreamlineGrowth")
    pts = np.vstack([t[0] for t in tracks])
    speeds = np.concatenate([t[1] for t in tracks])
    times = np.concatenate([_travel_times(p, s) for p, s in tracks])
    t_ref = float(np.percentile([_travel_times(p, s)[-1] for p, s in tracks], 95))
    frac = times / t_ref
    curves.CreateTypeAttr(UsdGeom.Tokens.linear)
    curves.CreateWrapAttr(UsdGeom.Tokens.nonperiodic)
    curves.CreateCurveVertexCountsAttr(Vt.IntArray([len(t[0]) for t in tracks]))
    curves.CreatePointsAttr(_vec3f(pts))
    curves.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex).Set(_vec3f(colormap(speeds, *U_SCALE_M_S)))
    widths = curves.CreateWidthsAttr()
    curves.SetWidthsInterpolation(UsdGeom.Tokens.vertex)
    width = float(spec.streamline_width_m)
    widths.Set(Vt.FloatArray.FromNumpy(np.zeros(len(pts), dtype=np.float32)), 0.0)
    n = spec.growth_segments
    for k, frame in enumerate(_reveal_frames(spec)):
        shown = np.ones(len(pts), dtype=bool) if k == n - 1 else frac <= (k + 1) / n
        widths.Set(Vt.FloatArray.FromNumpy(np.where(shown, width, 0.0).astype(np.float32)), frame)
    return {"mode": "widths", "segments": n, "curves": len(tracks), "points": int(len(pts)), "width_samples": n + 1, "t_ref_s": t_ref}


def _write_particles(stage, run_path: str, spec: ProbeSpec, tracks) -> dict:
    from pxr import UsdGeom, Vt

    timed = [(pts, speeds, _travel_times(pts, speeds)) for pts, speeds in tracks]
    per_track = int(math.ceil(spec.particles / len(timed)))
    owners = np.arange(spec.particles) % len(timed)
    phases = (np.arange(spec.particles) // len(timed)) / per_track
    hx, hy, height = _half(spec)
    width = particle_width_m(((-hx, -hy, 0.0), (hx, hy, height)))  # production sizing rule
    points = UsdGeom.Points.Define(stage, f"{run_path}/FlowParticles")
    points_attr = points.CreatePointsAttr()
    colour_pv = points.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex)
    extent_attr = points.CreateExtentAttr()
    points.CreateWidthsAttr(Vt.FloatArray([float(width)]))
    points.SetWidthsInterpolation(UsdGeom.Tokens.constant)
    for frame in range(spec.frames):
        seconds = frame / spec.fps
        pos = np.empty((spec.particles, 3))
        spd = np.empty(spec.particles)
        for t_index, (pts, speeds, times) in enumerate(timed):
            mask = owners == t_index
            total = float(times[-1]) or 1.0
            tau = np.mod(seconds + phases[mask] * total, total)
            for axis in range(3):
                pos[mask, axis] = np.interp(tau, times, pts[:, axis])
            spd[mask] = np.interp(tau, times, speeds)
        points_attr.Set(_vec3f(pos), float(frame))
        colour_pv.Set(_vec3f(colormap(spd, *U_SCALE_M_S)), float(frame))
        extent_attr.Set(_vec3f(np.array([pos.min(axis=0) - width, pos.max(axis=0) + width])), float(frame))
    return {"particles": spec.particles, "frames": spec.frames, "width_m": float(width)}


def _arrow_sites(spec: ProbeSpec) -> tuple[np.ndarray, float]:
    x0, x1, y0, y1 = _plane_box(spec)
    lx, ly, _ = spec.building_size_m
    spacing = math.sqrt(((x1 - x0) * (y1 - y0) - lx * ly) / spec.arrows)
    while True:
        xs = np.arange(x0 + spacing / 2, x1, spacing)
        ys = np.arange(y0 + spacing / 2, y1, spacing)
        xx, yy = np.meshgrid(xs, ys, indexing="ij")
        sites = np.stack([xx.ravel(), yy.ravel(), np.full(xx.size, VECTOR_Z_M)], axis=1)
        sites = sites[~_inside_building(sites, spec, margin=0.5)]
        if len(sites) >= spec.arrows:
            break
        spacing *= 0.97
    pick = np.round(np.linspace(0, len(sites) - 1, spec.arrows)).astype(int)
    return sites[pick], spacing


def _write_vectors(stage, run_path: str, spec: ProbeSpec) -> dict:
    from pxr import Gf, Sdf, UsdGeom, Vt

    sites, spacing = _arrow_sites(spec)
    velocity = velocity_field(sites, spec)
    speed = np.linalg.norm(velocity[:, :2], axis=1)
    heading = np.arctan2(velocity[:, 1], velocity[:, 0])
    # N5.1 length rule, floored so the probe draws every site (exact counts)
    length = 0.9 * spacing * np.clip(speed / U_SCALE_M_S[1], 0.15, 1.0)
    colours = colormap(speed, *U_SCALE_M_S)
    path = f"{run_path}/PedestrianWindVectors"
    proto_pts, proto_counts, proto_idx = arrow_geometry()
    summary = {"arrows": spec.arrows, "mode": spec.arrow_mode, "spacing_m": float(spacing)}
    if spec.arrow_mode == "merged":
        cos_h, sin_h = np.cos(heading), np.sin(heading)
        local = proto_pts[None, :, :] * np.stack([length, np.full_like(length, spacing), np.full_like(length, spacing)], axis=1)[:, None, :]
        world = np.empty_like(local)
        world[..., 0] = local[..., 0] * cos_h[:, None] - local[..., 1] * sin_h[:, None] + sites[:, None, 0]
        world[..., 1] = local[..., 0] * sin_h[:, None] + local[..., 1] * cos_h[:, None] + sites[:, None, 1]
        world[..., 2] = local[..., 2] + sites[:, None, 2]
        counts = np.tile(proto_counts, spec.arrows)
        indices = (np.asarray(proto_idx)[None, :] + (np.arange(spec.arrows) * ARROW_POINTS)[:, None]).ravel()
        mesh = UsdGeom.Mesh.Define(stage, path)
        _set_mesh(mesh, world.reshape(-1, 3), counts, indices)
        mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex).Set(_vec3f(np.repeat(colours, ARROW_POINTS, axis=0)))
        mesh.GetDoubleSidedAttr().Set(True)
        summary.update({"points": int(spec.arrows * ARROW_POINTS), "faces": int(len(counts))})
        return summary

    inst = UsdGeom.PointInstancer.Define(stage, path)
    UsdGeom.Scope.Define(stage, f"{path}/Prototypes")
    if spec.arrow_mode == "instancer":
        _define_arrow_mesh(stage, f"{path}/Prototypes/Arrow", proto_pts, proto_counts, proto_idx)
        inst.CreatePrototypesRel().SetTargets([f"{path}/Prototypes/Arrow"])
        proto_indices = np.zeros(spec.arrows, dtype=np.int32)
        # per-instance colour: vertex interpolation on a PointInstancer primvar = one value per instance
        primvar = UsdGeom.PrimvarsAPI(inst).CreatePrimvar("displayColor", Sdf.ValueTypeNames.Color3fArray, UsdGeom.Tokens.vertex)
        primvar.Set(_vec3f(colours))
    else:
        targets = []
        for b in range(COLOUR_BINS):
            centre = U_SCALE_M_S[0] + (b + 0.5) / COLOUR_BINS * (U_SCALE_M_S[1] - U_SCALE_M_S[0])
            colour = tuple(float(c) for c in colormap(np.array([centre]), *U_SCALE_M_S)[0])
            _define_arrow_mesh(stage, f"{path}/Prototypes/Arrow_{b}", proto_pts, proto_counts, proto_idx, colour)
            targets.append(f"{path}/Prototypes/Arrow_{b}")
        inst.CreatePrototypesRel().SetTargets(targets)
        t = np.clip((speed - U_SCALE_M_S[0]) / (U_SCALE_M_S[1] - U_SCALE_M_S[0]), 0.0, 1.0)
        proto_indices = np.minimum((t * COLOUR_BINS).astype(np.int32), COLOUR_BINS - 1)
    inst.CreateProtoIndicesAttr(Vt.IntArray.FromNumpy(proto_indices))
    inst.CreatePositionsAttr(_vec3f(sites))
    inst.CreateOrientationsAttr(Vt.QuathArray([Gf.Quath(float(math.cos(a / 2)), 0.0, 0.0, float(math.sin(a / 2))) for a in heading]))
    inst.CreateScalesAttr(_vec3f(np.stack([length, np.full_like(length, spacing), np.full_like(length, spacing)], axis=1)))
    summary["prototypes"] = 1 if spec.arrow_mode == "instancer" else COLOUR_BINS
    return summary


def _write_wind_arrow(stage, run_path: str, spec: ProbeSpec) -> dict:
    from pxr import UsdGeom

    _, _, height = _half(spec)
    downwind, _ = _flow_axes(spec)
    length = 0.6 * max(spec.building_size_m[:2])
    centre = -downwind * (_obstacle_radius(spec) + 0.5 * height + 0.5 * length)
    local, counts, indices = arrow_geometry(length)
    local[:, 2] = np.where(local[:, 2] > 0, 0.06 * length, 0.0) + 3.0  # 3 m base: clear of the 1.5 m plane
    heading = math.atan2(downwind[1], downwind[0])
    c, s = math.cos(heading), math.sin(heading)
    world = np.column_stack([local[:, 0] * c - local[:, 1] * s + centre[0], local[:, 0] * s + local[:, 1] * c + centre[1], local[:, 2]])
    mesh = _define_arrow_mesh(stage, f"{run_path}/WindDirectionArrow", world, counts, indices, WIND_ARROW_COLOUR)
    mesh.GetPrim().SetCustomDataByKey("cfd:wind_from_degrees", float(spec.wind_from_deg))
    mesh.GetPrim().SetCustomDataByKey("cfd:directions_relative_to", "project_north")
    return {"wind_from_deg": float(spec.wind_from_deg), "length_m": float(length), "centre_xy": [float(v) for v in centre]}


def _write_sections(stage, run_path: str, spec: ProbeSpec) -> dict:
    from pxr import UsdGeom

    x0, x1, y0, y1 = _plane_box(spec)
    _, _, height = _half(spec)
    s = spec.section_spacing_m
    top = 2.0 * height
    makers = {
        "Z1": lambda: _grid(_linspace(x0, x1, s), _linspace(y0, y1, s), lambda u, v: np.stack([u, v, np.full_like(u, 0.25 * height)], axis=1)),
        "Z2": lambda: _grid(_linspace(x0, x1, s), _linspace(y0, y1, s), lambda u, v: np.stack([u, v, np.full_like(u, 0.5 * height)], axis=1)),
        "Z3": lambda: _grid(_linspace(x0, x1, s), _linspace(y0, y1, s), lambda u, v: np.stack([u, v, np.full_like(u, 0.75 * height)], axis=1)),
        "X1": lambda: _grid(_linspace(y0, y1, s), _linspace(0.0, top, s), lambda u, v: np.stack([np.zeros_like(u), u, v], axis=1)),
        "Y1": lambda: _grid(_linspace(x0, x1, s), _linspace(0.0, top, s), lambda u, v: np.stack([u, np.zeros_like(u), v], axis=1)),
    }
    written = {}
    for section_id in SECTION_IDS[: spec.sections]:
        points, counts, indices = makers[section_id]()
        mesh = UsdGeom.Mesh.Define(stage, f"{run_path}/Section_{section_id}")
        _set_mesh(mesh, points, counts, indices)
        _, colours = _speed_colours(points, spec)
        colours[_inside_building(points, spec)] = INSIDE_BUILDING_COLOUR
        mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex).Set(_vec3f(colours))
        mesh.GetDoubleSidedAttr().Set(True)
        mesh.CreateVisibilityAttr(UsdGeom.Tokens.invisible)
        written[f"Section_{section_id}"] = {"points": int(len(points)), "faces": int(len(counts))}
    return {"count": len(written), "spacing_m": s, "prims": written}


def _write_overlay(path: Path, spec: ProbeSpec) -> dict:
    from pxr import Sdf, Usd, UsdGeom

    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    UsdGeom.Xform.Define(stage, "/World/Overlays")
    UsdGeom.Xform.Define(stage, OVERLAY_ROOT)
    run_path = f"{OVERLAY_ROOT}/{spec.run_id}"
    run = UsdGeom.Xform.Define(stage, run_path).GetPrim()
    run.SetCustomDataByKey("cfd:run_id", spec.run_id)
    run.SetCustomDataByKey("cfd:purpose", "presentation_probe_synthetic")
    run.SetCustomDataByKey("cfd:legend", {"U": {"min": float(U_SCALE_M_S[0]), "max": float(U_SCALE_M_S[1]), "unit": "m/s"}})
    prims: dict = {}
    if spec.plane:
        prims["PedestrianWind_1p5m"] = _write_plane(stage, run_path, spec)
    if spec.surface_pressure:
        prims["BuildingSurfacePressure"] = _write_surface_pressure(stage, run_path, spec)
    tracks = streamline_tracks(spec) if spec.streamlines else []
    if tracks and spec.static_streamlines:
        prims["Streamlines"] = _write_streamlines(stage, run_path, spec, tracks)
    if spec.growth == "segments":
        prims["StreamlineGrowth"] = _write_growth_segments(stage, run_path, spec, tracks)
    elif spec.growth == "widths":
        prims["StreamlineGrowth"] = _write_growth_widths(stage, run_path, spec, tracks)
    if spec.particles:
        prims["FlowParticles"] = _write_particles(stage, run_path, spec, tracks)
    if spec.arrows:
        prims["PedestrianWindVectors"] = _write_vectors(stage, run_path, spec)
    if spec.wind_arrow:
        prims["WindDirectionArrow"] = _write_wind_arrow(stage, run_path, spec)
    if spec.sections:
        prims["sections"] = _write_sections(stage, run_path, spec)
    if spec.growth != "none" or spec.particles:
        stage.SetStartTimeCode(0)
        stage.SetEndTimeCode(spec.frames - 1)
        stage.SetTimeCodesPerSecond(spec.fps)
        stage.SetFramesPerSecond(spec.fps)
        anim = {"fps": spec.fps, "frames": spec.frames, "loop": True, "note": ANIMATION_NOTE}
        if spec.growth != "none":
            anim["growth_seconds"] = float(spec.growth_seconds)
        stage.GetRootLayer().customLayerData = {"cfd:animation": anim}
        run.SetCustomDataByKey("cfd:animation", anim)
        # Probe clock (not in production layers): value == layer frame, so a reader at any stage time code
        # sees which overlay frame is displayed after time scaling or layer offsets (P7 timeline rate).
        clock = run.CreateAttribute(CLOCK_ATTR, Sdf.ValueTypeNames.Float, custom=True)
        for frame in range(spec.frames):
            clock.Set(float(frame), float(frame))
    stage.GetRootLayer().Save()
    return {"run_prim": run_path, "prims": prims}


def build_probe_stage(out_dir: Path, spec: ProbeSpec) -> dict:
    spec.validate()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model, overlay, view = out_dir / "model.usdc", out_dir / "overlay.usdc", out_dir / "view.usda"
    for stale in (model, overlay, view):
        if stale.exists():
            stale.unlink()
    _write_model(model, spec)
    written = _write_overlay(overlay, spec)
    write_wrapper_stage(out_path=view, model_usdc=model, result_layer=overlay)
    manifest = {
        "schema": "cfd-presentation-probe-stage/v1",
        "spec": asdict(spec),
        "model": str(model), "overlay": str(overlay), "view": str(view),
        "model_bytes": model.stat().st_size, "overlay_bytes": overlay.stat().st_size,
        **written,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _parse(argv: list[str] | None = None) -> tuple[Path, ProbeSpec]:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--run-id", default="cfd_probe")
    parser.add_argument("--wind-from", type=float, default=270.0)
    parser.add_argument("--no-plane", action="store_true")
    parser.add_argument("--plane-spacing", type=float, default=4.0)
    parser.add_argument("--no-surface-pressure", action="store_true")
    parser.add_argument("--streamlines", type=int, default=0)
    parser.add_argument("--streamline-points", type=int, default=60)
    parser.add_argument("--no-static-streamlines", action="store_true")
    parser.add_argument("--streamline-width", type=float, default=0.5)
    parser.add_argument("--growth", choices=GROWTH_MODES, default="none")
    parser.add_argument("--growth-segments", type=int, default=24)
    parser.add_argument("--growth-seconds", type=float, default=6.0)
    parser.add_argument("--particles", type=int, default=0)
    parser.add_argument("--arrows", type=int, default=0)
    parser.add_argument("--arrow-mode", choices=ARROW_MODES, default="instancer")
    parser.add_argument("--wind-arrow", action="store_true")
    parser.add_argument("--sections", type=int, default=0)
    parser.add_argument("--section-spacing", type=float, default=2.0)
    a = parser.parse_args(argv)
    spec = ProbeSpec(
        run_id=a.run_id, wind_from_deg=a.wind_from, plane=not a.no_plane, plane_spacing_m=a.plane_spacing,
        surface_pressure=not a.no_surface_pressure, streamlines=a.streamlines, streamline_points=a.streamline_points,
        static_streamlines=not a.no_static_streamlines, streamline_width_m=a.streamline_width, growth=a.growth,
        growth_segments=a.growth_segments, growth_seconds=a.growth_seconds, particles=a.particles, arrows=a.arrows,
        arrow_mode=a.arrow_mode, wind_arrow=a.wind_arrow, sections=a.sections, section_spacing_m=a.section_spacing)
    return a.out_dir, spec


def main(argv: list[str] | None = None) -> int:
    out_dir, spec = _parse(argv)
    manifest = build_probe_stage(out_dir, spec)
    print(json.dumps({k: manifest[k] for k in ("view", "overlay_bytes", "prims")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
