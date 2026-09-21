"""Voxel wrap: triangle soup -> closed outer shell (pure numpy).

Pipeline: rasterise triangle surfaces into an occupancy grid, morphologically
close it (seals door openings and curtain-wall gaps), flood-fill the exterior
air from the grid boundary, keep the largest non-exterior component and
extract its boundary faces. The result is closed by construction; the
watertight check below verifies it (boundary edge count must be zero).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

_AXIS_NEIGHBOURS = ((0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1))


@dataclass(frozen=True)
class VoxelGrid:
    origin: np.ndarray  # (3,) world position of voxel (0,0,0) min corner
    pitch: float
    shape: tuple[int, int, int]

    @staticmethod
    def around(bbox_min: np.ndarray, bbox_max: np.ndarray, pitch: float, *, padding_voxels: int) -> "VoxelGrid":
        extent = np.asarray(bbox_max, dtype=np.float64) - np.asarray(bbox_min, dtype=np.float64)
        cells = np.ceil(extent / pitch).astype(np.int64) + 2 * padding_voxels + 1
        origin = np.asarray(bbox_min, dtype=np.float64) - padding_voxels * pitch
        return VoxelGrid(origin=origin, pitch=float(pitch), shape=(int(cells[0]), int(cells[1]), int(cells[2])))

    def world_to_index(self, points: np.ndarray) -> np.ndarray:
        idx = np.floor((points - self.origin) / self.pitch).astype(np.int64)
        return np.clip(idx, 0, np.asarray(self.shape) - 1)

    def corner_to_world(self, corners: np.ndarray) -> np.ndarray:
        return self.origin + corners.astype(np.float64) * self.pitch

    @property
    def voxel_count(self) -> int:
        return int(np.prod(self.shape))


def _shift(mask: np.ndarray, axis: int, step: int) -> np.ndarray:
    """Shift a boolean grid by ``step`` along ``axis`` filling with False."""
    out = np.zeros_like(mask)
    if step > 0:
        src = [slice(None)] * 3
        dst = [slice(None)] * 3
        src[axis] = slice(0, -step)
        dst[axis] = slice(step, None)
    else:
        src = [slice(None)] * 3
        dst = [slice(None)] * 3
        src[axis] = slice(-step, None)
        dst[axis] = slice(0, step)
    out[tuple(dst)] = mask[tuple(src)]
    return out


def dilate_box(mask: np.ndarray, radius: int) -> np.ndarray:
    """Separable box dilation with a (2r+1)^3 structuring element."""
    out = mask.copy()
    for axis in range(3):
        acc = out.copy()
        for step in range(1, radius + 1):
            acc |= _shift(out, axis, step)
            acc |= _shift(out, axis, -step)
        out = acc
    return out


def erode_box(mask: np.ndarray, radius: int) -> np.ndarray:
    return ~dilate_box(~mask, radius)


def close_box(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask.copy()
    return erode_box(dilate_box(mask, radius), radius)


def voxelize_triangles(triangles: np.ndarray, grid: VoxelGrid, *, max_points_per_batch: int = 4_000_000) -> np.ndarray:
    """Mark every voxel touched by a triangle surface.

    Triangles are point-sampled on a barycentric lattice whose spacing is half
    the voxel pitch, which guarantees every voxel the surface passes through
    receives at least one sample.
    """
    occupancy = np.zeros(grid.shape, dtype=bool)
    if triangles.shape[0] == 0:
        return occupancy
    tris = np.asarray(triangles, dtype=np.float64)
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    edge = np.maximum.reduce(
        [np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1), np.linalg.norm(a - c, axis=1)]
    )
    subdivisions = np.maximum(1, np.ceil(edge / (grid.pitch * 0.5)).astype(np.int64))
    # Vertices always count.
    _mark(occupancy, grid, tris.reshape(-1, 3))

    for n in np.unique(subdivisions):
        n = int(n)
        sel = np.nonzero(subdivisions == n)[0]
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        keep = (i + j) <= n
        u = (i[keep] / n).astype(np.float64)
        v = (j[keep] / n).astype(np.float64)
        samples_per_tri = u.shape[0]
        batch = max(1, max_points_per_batch // samples_per_tri)
        for start in range(0, sel.shape[0], batch):
            idx = sel[start : start + batch]
            pa, pb, pc = a[idx], b[idx], c[idx]
            pts = (
                pa[:, None, :]
                + (pb - pa)[:, None, :] * u[None, :, None]
                + (pc - pa)[:, None, :] * v[None, :, None]
            )
            _mark(occupancy, grid, pts.reshape(-1, 3))
    return occupancy


def _mark(occupancy: np.ndarray, grid: VoxelGrid, points: np.ndarray) -> None:
    idx = grid.world_to_index(points)
    occupancy[idx[:, 0], idx[:, 1], idx[:, 2]] = True


def flood_fill(seed: np.ndarray, allowed: np.ndarray, *, max_iterations: int | None = None) -> np.ndarray:
    """Grow ``seed`` through 6-connected ``allowed`` voxels until stable."""
    region = seed & allowed
    limit = max_iterations or int(sum(allowed.shape)) + 8
    for _ in range(limit):
        grown = region.copy()
        for axis, step in _AXIS_NEIGHBOURS:
            grown |= _shift(region, axis, step)
        grown &= allowed
        if np.array_equal(grown, region):
            return region
        region = grown
    return region


def exterior_air(solid: np.ndarray) -> np.ndarray:
    """Voxels reachable from the grid boundary without crossing ``solid``."""
    seed = np.zeros_like(solid)
    seed[0, :, :] = seed[-1, :, :] = True
    seed[:, 0, :] = seed[:, -1, :] = True
    seed[:, :, 0] = seed[:, :, -1] = True
    return flood_fill(seed, ~solid)


def connected_components(mask: np.ndarray) -> list[np.ndarray]:
    """6-connected components of ``mask``, largest first."""
    remaining = mask.copy()
    components: list[np.ndarray] = []
    while remaining.any():
        flat = int(np.argmax(remaining))
        seed = np.zeros_like(remaining)
        seed.flat[flat] = True
        component = flood_fill(seed, remaining)
        components.append(component)
        remaining &= ~component
    components.sort(key=lambda comp: -int(comp.sum()))
    return components


def extract_boundary_mesh(inside: np.ndarray, grid: VoxelGrid) -> tuple[np.ndarray, np.ndarray]:
    """Boundary faces of ``inside`` as an outward-oriented triangle mesh.

    Returns (vertices (m, 3) world metres, faces (n, 3) vertex indices).
    """
    corner_faces: list[np.ndarray] = []
    nx, ny, nz = inside.shape
    padded = np.zeros((nx + 2, ny + 2, nz + 2), dtype=bool)
    padded[1:-1, 1:-1, 1:-1] = inside
    for axis in range(3):
        for direction in (1, -1):
            neighbour = _shift(padded, axis, -direction)  # neighbour in +direction
            exposed = padded & ~neighbour
            cells = np.argwhere(exposed) - 1  # back to unpadded voxel indices
            if cells.shape[0] == 0:
                continue
            corner_faces.append(_face_corners(cells, axis, direction))
    if not corner_faces:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    quads = np.concatenate(corner_faces)  # (q, 4, 3) integer corner coordinates
    flat = quads.reshape(-1, 3)
    unique, inverse = np.unique(flat, axis=0, return_inverse=True)
    quad_idx = inverse.reshape(-1, 4)
    faces = np.concatenate([quad_idx[:, [0, 1, 2]], quad_idx[:, [0, 2, 3]]])
    return grid.corner_to_world(unique), faces.astype(np.int64)


def _face_corners(cells: np.ndarray, axis: int, direction: int) -> np.ndarray:
    """Corner coordinates (q, 4, 3) of the voxel face on side ``direction`` of ``axis``.

    Corners are ordered counter-clockwise when viewed from outside (normal
    pointing along ``direction * axis``).
    """
    u_axis, v_axis = [(1, 2), (2, 0), (0, 1)][axis]
    base = cells.copy()
    if direction > 0:
        base[:, axis] += 1
    corners = np.repeat(base[:, None, :], 4, axis=1)
    order = [(0, 0), (1, 0), (1, 1), (0, 1)] if direction > 0 else [(0, 0), (0, 1), (1, 1), (1, 0)]
    for k, (du, dv) in enumerate(order):
        corners[:, k, u_axis] += du
        corners[:, k, v_axis] += dv
    return corners


def edge_statistics(faces: np.ndarray) -> dict[str, int]:
    """Count boundary (used once) and non-manifold (used more than twice) edges."""
    if faces.shape[0] == 0:
        return {"edge_count": 0, "boundary_edge_count": 0, "non_manifold_edge_count": 0}
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    edges = np.sort(edges, axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return {
        "edge_count": int(counts.shape[0]),
        "boundary_edge_count": int((counts == 1).sum()),
        "non_manifold_edge_count": int((counts > 2).sum()),
    }


def wrap_shell(
    triangles: np.ndarray,
    *,
    pitch: float,
    closing_radius_voxels: int,
    keep_largest_only: bool = True,
) -> dict:
    """Run the full wrap and return vertices, faces and statistics."""
    if triangles.shape[0] == 0:
        raise ValueError("no triangles to wrap")
    flat = triangles.reshape(-1, 3)
    grid = VoxelGrid.around(flat.min(axis=0), flat.max(axis=0), pitch, padding_voxels=closing_radius_voxels + 2)
    occupancy = voxelize_triangles(triangles, grid)
    closed = close_box(occupancy, closing_radius_voxels)
    exterior = exterior_air(closed)
    inside = ~exterior
    components = connected_components(inside)
    kept = components[0] if keep_largest_only else inside
    dropped = [int(comp.sum()) for comp in components[1:]] if keep_largest_only else []
    vertices, faces = extract_boundary_mesh(kept, grid)
    stats = {
        "voxel_pitch_m": grid.pitch,
        "grid_shape": list(grid.shape),
        "grid_origin": [float(v) for v in grid.origin],
        "occupied_voxels": int(occupancy.sum()),
        "closed_voxels": int(closed.sum()),
        "inside_voxels_total": int(inside.sum()),
        "inside_voxels_kept": int(kept.sum()),
        "shell_component_count": len(components),
        "dropped_island_voxel_counts": dropped,
        "vertex_count": int(vertices.shape[0]),
        "triangle_count": int(faces.shape[0]),
        **edge_statistics(faces),
    }
    stats["watertight"] = stats["boundary_edge_count"] == 0
    return {"vertices": vertices, "faces": faces, "stats": stats}
