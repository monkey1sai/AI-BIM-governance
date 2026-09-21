"""Particle advection along steady-state streamlines (S3.1 visual quality).

The solver is steady (simpleFoam), so every streamline is also a pathline: a
particle released on a track moves along it at the local speed |U|. We reuse
the streamLine tracks the solver already wrote (points + U at points) instead of
sampling the volume again, and author the result as time-sampled point clouds.

Honest labelling: this is an *illustrative* animation derived from the steady
solution, not a transient simulation. Callers write that note into the layer.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .foam_vtk import VtkSurface

MIN_SPEED_M_S = 0.05


@dataclass(frozen=True)
class AnimationParams:
    fps: int = 24
    seconds: float = 10.0
    target_particles: int = 1500
    min_track_points: int = 4

    @property
    def frames(self) -> int:
        return int(round(self.fps * self.seconds))


@dataclass
class ParticleAnimation:
    positions: np.ndarray  # (frames, particles, 3)
    speeds: np.ndarray  # (frames, particles)
    fps: int
    tracks_used: int

    @property
    def frames(self) -> int:
        return int(self.positions.shape[0])

    @property
    def particles(self) -> int:
        return int(self.positions.shape[1])


def _track_timeline(points: np.ndarray, speeds: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Cumulative travel time along a polyline given point speeds; returns (times, arc_lengths)."""
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    seg_speed = np.maximum(0.5 * (speeds[:-1] + speeds[1:]), MIN_SPEED_M_S)
    dt = seg / seg_speed
    times = np.concatenate([[0.0], np.cumsum(dt)])
    arcs = np.concatenate([[0.0], np.cumsum(seg)])
    return times, arcs


def advect_along_tracks(tracks: VtkSurface, params: AnimationParams = AnimationParams()) -> ParticleAnimation | None:
    """Spawn particles on every usable track and move them with the local speed.

    Particles are phase-staggered along each track and wrap at the track end, so
    the loop is seamless for any playback length. Returns None when no track has
    enough points.
    """
    velocity = tracks.point_data.get("U")
    usable: list[tuple[np.ndarray, np.ndarray]] = []
    for line in tracks.lines:
        idx = np.asarray(line, dtype=int)
        if idx.size < params.min_track_points:
            continue
        pts = tracks.points[idx].astype(np.float64)
        if velocity is not None:
            spd = np.linalg.norm(velocity[idx], axis=1)
        else:
            spd = np.full(idx.size, 1.0)
        if not np.all(np.isfinite(pts)) or float(np.linalg.norm(pts[-1] - pts[0])) <= 0.0:
            continue
        usable.append((pts, spd))
    if not usable:
        return None

    per_track = max(1, int(round(params.target_particles / len(usable))))
    frames = params.frames
    frame_times = np.arange(frames, dtype=np.float64) / params.fps
    positions = np.empty((frames, per_track * len(usable), 3), dtype=np.float32)
    speeds = np.empty((frames, per_track * len(usable)), dtype=np.float32)

    for t_index, (pts, spd) in enumerate(usable):
        times, _ = _track_timeline(pts, spd)
        total = float(times[-1]) if times[-1] > 0 else 1.0
        phases = (np.arange(per_track, dtype=np.float64) / per_track) * total
        # (frames, per_track) travel time modulo the track duration
        tau = np.mod(frame_times[:, None] + phases[None, :], total)
        flat = tau.ravel()
        col = slice(t_index * per_track, (t_index + 1) * per_track)
        for axis in range(3):
            positions[:, col, axis] = np.interp(flat, times, pts[:, axis]).reshape(frames, per_track)
        speeds[:, col] = np.interp(flat, times, spd).reshape(frames, per_track)

    return ParticleAnimation(positions=positions, speeds=speeds, fps=params.fps, tracks_used=len(usable))
