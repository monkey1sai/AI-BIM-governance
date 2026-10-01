"""Bounded presentation geometry derived from solver tracks (no solver changes)."""
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


def clip_tracks(tracks: VtkSurface, bbox, ground_z: float, *, horizontal_heights: float = 3, top_heights: float = 1) -> VtkSurface:
    """Clip each edge to bbox ±3H / top +H, interpolate U, split at exits.

    Downsampling is confined to each retained fragment, so an excursion outside
    the box never becomes a chord joining two disconnected fragments.
    """
    lo, hi = map(lambda p: np.asarray(p, dtype=float), bbox)
    height = float(hi[2] - ground_z)
    low = np.array([lo[0] - horizontal_heights * height, lo[1] - horizontal_heights * height, ground_z])
    high = np.array([hi[0] + horizontal_heights * height, hi[1] + horizontal_heights * height, hi[2] + top_heights * height])
    velocity = tracks.point_data.get("U")
    fragments = []
    for line in tracks.lines:
        if len(line) < 2:
            continue
        p,q = tracks.points[line[:-1]],tracks.points[line[1:]]
        delta = q-p
        start,end = np.zeros(len(p)),np.ones(len(p))
        valid = np.isfinite(p).all(axis=1) & np.isfinite(q).all(axis=1) & (np.linalg.norm(delta,axis=1) >= 1e-12)
        # Intersect all edges in one batch, retaining the same slab clipping and
        # exit/reentry boundaries. This bounds the cost of a full URANS series.
        for axis in range(3):
            parallel = np.abs(delta[:,axis]) < 1e-12
            valid &= ~(parallel & ((p[:,axis] < low[axis]) | (p[:,axis] > high[axis])))
            t0 = np.full(len(p),-np.inf)
            t1 = np.full(len(p),np.inf)
            np.divide(low[axis]-p[:,axis],delta[:,axis],out=t0,where=~parallel)
            np.divide(high[axis]-p[:,axis],delta[:,axis],out=t1,where=~parallel)
            start = np.maximum(start,np.minimum(t0,t1))
            end = np.minimum(end,np.maximum(t0,t1))
        indices = np.flatnonzero(valid & (start < end))
        if not len(indices):
            continue
        start,end = start[indices,None],end[indices,None]
        starts,ends = p[indices]+start*delta[indices],p[indices]+end*delta[indices]
        if velocity is None:
            start_u,end_u = np.zeros_like(starts),np.zeros_like(ends)
        else:
            a,b = velocity[line[:-1][indices]],velocity[line[1:][indices]]
            start_u,end_u = a*(1-start)+b*start,a*(1-end)+b*end
        breaks = (np.diff(indices) != 1) | (end[:-1,0] < 1) | ~np.isclose(ends[:-1],starts[1:],atol=1e-9,rtol=0).all(axis=1)
        boundaries = np.r_[0,np.flatnonzero(breaks)+1,len(indices)]
        for first,last in zip(boundaries[:-1],boundaries[1:]):
            pts = np.vstack((starts[first],ends[first:last]))
            values = np.vstack((start_u[first],end_u[first:last]))
            keep = np.linspace(0,len(pts)-1,min(MAX_POINTS,len(pts)),dtype=int)
            fragments.append(list(zip(pts[keep],values[keep])))
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
