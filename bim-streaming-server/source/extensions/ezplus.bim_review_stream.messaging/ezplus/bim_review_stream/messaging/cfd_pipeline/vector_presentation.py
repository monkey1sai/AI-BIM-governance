"""Bounded surface-interpolated arrow geometry for pedestrian and section planes."""
from __future__ import annotations

import numpy as np

from .foam_vtk import VtkSurface

MAX_ARROWS = 5000
MIN_SPEED = 0.05


def _triangulate_polygon(poly, uv):
    """Ear clipping for simple polygons; never interpolate across a concave notch."""
    remaining = list(map(int, poly))
    if len(remaining) > 1 and remaining[0] == remaining[-1]:
        remaining.pop()
    if len(remaining) < 3:
        return []
    if len(remaining) == 3:
        return [tuple(remaining)]
    xy = uv[remaining] - uv[remaining[0]]
    area = np.sum(xy[:, 0] * np.roll(xy[:, 1], -1) - xy[:, 1] * np.roll(xy[:, 0], -1))
    epsilon = 1e-12 * max(1., float(np.ptp(xy, axis=0).max()) ** 2)
    if abs(area) <= epsilon:
        return []
    orientation = 1. if area > 0 else -1.

    def cross(a, b, c):
        ab, ac = b - a, c - a
        return ab[0] * ac[1] - ab[1] * ac[0]

    triangles = []
    while len(remaining) > 3:
        for i, current in enumerate(remaining):
            previous, following = remaining[i - 1], remaining[(i + 1) % len(remaining)]
            a, b, c = uv[[previous, current, following]]
            if orientation * cross(a, b, c) <= epsilon:
                continue
            others = [idx for idx in remaining if idx not in (previous, current, following)]
            if any(all(orientation * cross(x, y, uv[idx]) >= -epsilon
                       for x, y in ((a, b), (b, c), (c, a))) for idx in others):
                continue
            triangles.append((previous, current, following))
            remaining.pop(i)
            break
        else:
            # Invalid/degenerate topology: discard the entire polygon, not a partial fan.
            return []
    triangles.append(tuple(remaining))
    return triangles


def sample_surface_vectors(surface: VtkSurface, axes=(0, 1)):
    """Regular grid interpolated inside original polygon triangles, retaining holes."""
    empty = np.empty((0, 3))
    velocity = surface.point_data.get("U")
    if velocity is None or not surface.polygons or not len(surface.points):
        return empty, empty.copy(), 2.0
    points, velocity = np.asarray(surface.points), np.asarray(velocity)
    if velocity.shape != points.shape:
        raise ValueError("surface U must have one three-component value per point")
    uv = points[:, list(axes)]
    if not np.isfinite(points).all():
        raise ValueError("surface coordinates must be finite")
    lo, hi = uv.min(axis=0), uv.max(axis=0)
    spacing = max(2.0, float(np.max(hi - lo)) / 60.0)
    origin = lo + spacing / 2
    shape = np.maximum(0, np.floor((hi - origin) / spacing).astype(int) + 1)
    if not shape.all():
        return empty, empty.copy(), spacing
    triangles = np.array([triangle for poly in surface.polygons
                          for triangle in _triangulate_polygon(poly, uv)], dtype=int)
    if not len(triangles):
        return empty, empty.copy(), spacing
    tri_uv = uv[triangles]
    lower = np.maximum(0, np.ceil((tri_uv.min(axis=1) - origin) / spacing - 1e-9).astype(int))
    upper = np.minimum(shape - 1, np.floor((tri_uv.max(axis=1) - origin) / spacing + 1e-9).astype(int))
    samples = {}
    for index in np.flatnonzero(np.all(lower <= upper, axis=1)):
        ids = triangles[index]
        if not np.isfinite(velocity[ids]).all():
            continue
        a, b, c = tri_uv[index]
        edge1, edge2 = b - a, c - a
        determinant = edge1[0] * edge2[1] - edge1[1] * edge2[0]
        if abs(determinant) < 1e-12:
            continue
        for ix in range(lower[index, 0], upper[index, 0] + 1):
            for iy in range(lower[index, 1], upper[index, 1] + 1):
                key = (ix, iy)
                if key in samples:
                    continue
                relative = origin + np.array(key) * spacing - a
                s = (relative[0] * edge2[1] - relative[1] * edge2[0]) / determinant
                t = (edge1[0] * relative[1] - edge1[1] * relative[0]) / determinant
                if s >= -1e-9 and t >= -1e-9 and s + t <= 1 + 1e-9:
                    weights = np.array([1 - s - t, s, t])
                    samples[key] = (weights @ points[ids], weights @ velocity[ids])
    ordered = [samples[key] for key in sorted(samples)]
    ordered = [pair for pair in ordered if np.linalg.norm(pair[1]) >= MIN_SPEED]
    if len(ordered) > MAX_ARROWS:
        ordered = [ordered[i] for i in np.linspace(0, len(ordered) - 1, MAX_ARROWS, dtype=int)]
    if not ordered:
        return empty, empty.copy(), spacing
    return np.array([p for p, _ in ordered]), np.array([v for _, v in ordered]), spacing


def arrow_geometry():
    """Closed unit +X arrow, centered at the origin (CP1 verified topology)."""
    shaft = [(x, y, z) for z in (0., .04)
             for x, y in ((-.5, -.06), (.15, -.06), (.15, .06), (-.5, .06))]
    head = [(x, y, z) for z in (0., .04) for x, y in ((.15, -.2), (.5, 0.), (.15, .2))]
    faces = [[0,3,2,1], [4,5,6,7], [0,1,5,4], [1,2,6,5], [2,3,7,6], [3,0,4,7],
             [8,10,9], [11,12,13], [8,9,12,11], [9,10,13,12], [10,8,11,13]]
    return np.array(shaft + head), [len(f) for f in faces], [i for f in faces for i in f]


def _mesh(stage, path):
    from pxr import UsdGeom, Vt
    mesh = UsdGeom.Mesh.Define(stage, path)
    points, counts, indices = arrow_geometry()
    mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(points.astype(np.float32)))
    mesh.CreateFaceVertexCountsAttr(counts)
    mesh.CreateFaceVertexIndicesAttr(indices)
    mesh.CreateSubdivisionSchemeAttr("none")
    return mesh


def write_surface_vectors(stage, path, surface, colour_map, u_range, *, axes=(0, 1), normal_axis=2, allow_empty=False):
    from pxr import Gf, Sdf, UsdGeom, Vt
    sites, velocities, spacing = sample_surface_vectors(surface, axes)
    if not len(sites) and not allow_empty:
        return None
    sites[:, normal_axis] += .05
    speed = np.linalg.norm(velocities, axis=1)
    upper = float(u_range[1])
    if not np.isfinite(upper) or upper <= 0:
        raise ValueError("vector legend upper bound must be positive")
    lengths = .9 * spacing * np.minimum(speed / upper, 1.)
    inst = UsdGeom.PointInstancer.Define(stage, path)
    UsdGeom.Scope.Define(stage, path + "/Prototypes")
    prototype = _mesh(stage, path + "/Prototypes/Arrow")
    inst.CreatePrototypesRel().SetTargets([prototype.GetPath()])
    inst.CreateProtoIndicesAttr(Vt.IntArray([0] * len(sites)))
    inst.CreatePositionsAttr(Vt.Vec3fArray.FromNumpy(sites.astype(np.float32)))
    rotations = [Gf.Rotation(Gf.Vec3d(1, 0, 0), Gf.Vec3d(*map(float, v / s))).GetQuat()
                 for v, s in zip(velocities, speed)]
    inst.CreateOrientationsAttr(Vt.QuathArray([Gf.Quath(q) for q in rotations]))
    scales = np.column_stack([lengths, np.full(len(sites), spacing), np.full(len(sites), spacing)])
    inst.CreateScalesAttr(Vt.Vec3fArray.FromNumpy(scales.astype(np.float32)))
    UsdGeom.PrimvarsAPI(inst).CreatePrimvar("displayColor", Sdf.ValueTypeNames.Color3fArray, "vertex").Set(
        Vt.Vec3fArray.FromNumpy(colour_map(speed, *u_range).astype(np.float32)))
    return {"path": path, "arrows": len(sites), "spacing_m": spacing, "offset_m": .05}


def write_wind_arrow(stage, path, bbox, ground_z, to_model, *, building_surface=None):
    """Place a bounded downwind arrow over the roof, independent of low site appendages."""
    from pxr import Gf, UsdGeom, Vt
    lo, hi = map(np.asarray, bbox)
    height = max(float(hi[2] - ground_z), 1.)
    roof_lo, roof_hi = lo, hi
    if building_surface is not None:
        points = np.asarray(building_surface.points)
        roof = points[np.isfinite(points).all(axis=1) & (points[:, 2] >= hi[2] - .25 * height)]
        if len(roof):
            roof_lo, roof_hi = roof.min(axis=0), roof.max(axis=0)
    length = min(.8 * height, .6 * max(float(roof_hi[0] - roof_lo[0]), float(roof_hi[1] - roof_lo[1]), 1.))
    centre = np.array([(roof_lo[0] + roof_hi[0]) / 2, (roof_lo[1] + roof_hi[1]) / 2, hi[2] + .2 * height])
    mesh = _mesh(stage, path)
    points, _, _ = arrow_geometry()
    mesh.GetPointsAttr().Set(Vt.Vec3fArray.FromNumpy(to_model(points * length + centre).astype(np.float32)))
    mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.constant).Set([Gf.Vec3f(.04, .07, .12)])
    mesh.CreateDisplayOpacityPrimvar(UsdGeom.Tokens.constant).Set([1.])
    direction = to_model(np.array([[1., 0., 0.]]))[0]
    mesh.GetPrim().SetCustomDataByKey("cfd:flow_direction_model", Gf.Vec3d(*map(float, direction)))
    return {"path": path, "length_m": length, "direction_model": direction.tolist(),
            "placement": "above_roof", "centre_model": to_model(centre[None, :])[0].tolist()}
