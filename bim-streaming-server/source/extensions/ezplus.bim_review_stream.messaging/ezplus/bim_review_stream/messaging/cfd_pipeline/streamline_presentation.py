"""Bounded presentation geometry derived from steady solver tracks (no solver changes)."""
from __future__ import annotations

import numpy as np

from .foam_vtk import VtkSurface

MAX_TRACKS = 240
MAX_POINTS = 200
GROWTH_SEGMENTS = 48


def footprint_hull(points) -> list[list[float]]:
    """Model-coordinate convex hull; deterministic bounded outline for the HUD."""
    xy = sorted(set(map(tuple, np.asarray(points, dtype=float)[:, :2])))
    if len(xy) < 3:
        return [list(p) for p in xy]

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    lower, upper = [], []
    for half, sequence in ((lower, xy), (upper, reversed(xy))):
        for point in sequence:
            while len(half) >= 2 and cross(half[-2], half[-1], point) <= 0:
                half.pop()
            half.append(point)
    hull = lower[:-1] + upper[:-1]
    if len(hull) > 64:
        hull = [hull[i] for i in np.linspace(0, len(hull) - 1, 64, dtype=int)]
    return [list(map(float, p)) for p in hull]


def clip_tracks(tracks: VtkSurface, bbox, ground_z: float) -> VtkSurface:
    """Clip each edge to bbox ±3H / top +H, interpolate U, split at exits.

    Downsampling is confined to each retained fragment, so an excursion outside
    the box never becomes a chord joining two disconnected fragments.
    """
    lo, hi = map(lambda p: np.asarray(p, dtype=float), bbox)
    height = float(hi[2] - ground_z)
    low = np.array([lo[0] - 3 * height, lo[1] - 3 * height, ground_z])
    high = np.array([hi[0] + 3 * height, hi[1] + 3 * height, hi[2] + height])
    velocity = tracks.point_data.get("U")
    fragments = []
    current = []

    def flush():
        nonlocal current
        if len(current) >= 2:
            indexes = np.linspace(0, len(current) - 1, min(MAX_POINTS, len(current)), dtype=int)
            fragments.append([current[i] for i in indexes])
        current = []

    for line in tracks.lines:
        for a, b in zip(line[:-1], line[1:]):
            p, q = tracks.points[a], tracks.points[b]
            delta = q - p
            if not np.isfinite([*p, *q]).all():
                flush()
                continue
            start, end = 0.0, 1.0
            for axis in range(3):
                if abs(delta[axis]) < 1e-12:
                    if p[axis] < low[axis] or p[axis] > high[axis]:
                        end = -1.0
                        break
                else:
                    t0, t1 = sorted(((low[axis] - p[axis]) / delta[axis], (high[axis] - p[axis]) / delta[axis]))
                    start, end = max(start, t0), min(end, t1)
            if start >= end or np.linalg.norm(delta) < 1e-12:
                flush()
                continue
            edge = []
            for t in (start, end):
                u = velocity[a] * (1 - t) + velocity[b] * t if velocity is not None else np.zeros(3)
                edge.append((p + t * delta, u))
            if current and not np.allclose(current[-1][0], edge[0][0], atol=1e-9, rtol=0):
                flush()
            if not current:
                current.append(edge[0])
            current.append(edge[1])
            if end < 1:
                flush()
        flush()
    # Evenly cover the retained source population if a solver produces more than the cap.
    if len(fragments) > MAX_TRACKS:
        fragments = [fragments[i] for i in np.linspace(0, len(fragments) - 1, MAX_TRACKS, dtype=int)]
    points, speeds, lines = [], [], []
    for fragment in fragments:
        offset = len(points)
        points.extend(p for p, _ in fragment)
        speeds.extend(u for _, u in fragment)
        lines.append(np.arange(offset, len(points)))
    return VtkSurface(points=np.asarray(points).reshape(-1, 3), lines=lines,
                      point_data={"U": np.asarray(speeds).reshape(-1, 3)} if velocity is not None else {})


def growth_buckets(tracks: VtkSurface):
    """Group edges by cumulative travel time, normalized to the longest retained track.

    All tracks start together; a slower track takes longer to finish. Each bucket
    is one BasisCurves prim, bounding drawables independently of track count.
    """
    velocity = tracks.point_data.get("U")
    timelines = []
    for line in tracks.lines:
        pts = tracks.points[line]
        speed = np.linalg.norm(velocity[line], axis=1) if velocity is not None else np.ones(len(line))
        dt = np.linalg.norm(np.diff(pts, axis=0), axis=1) / np.maximum((speed[:-1] + speed[1:]) / 2, 0.05)
        timelines.append(np.cumsum(dt))
    duration = max((float(t[-1]) for t in timelines if len(t)), default=0.0)
    buckets = [[] for _ in range(GROWTH_SEGMENTS)]
    if duration <= 0:
        return buckets
    for line, times in zip(tracks.lines, timelines):
        for a, b, end in zip(line[:-1], line[1:], times):
            index = min(GROWTH_SEGMENTS - 1, max(0, int(np.ceil(end / duration * GROWTH_SEGMENTS)) - 1))
            buckets[index].append((int(a), int(b)))
    return buckets
