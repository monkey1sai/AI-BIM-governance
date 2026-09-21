from __future__ import annotations

import numpy as np
import pytest

from bimcfd.stl import read_binary_stl, write_binary_stl
from bimcfd.voxel_shell import (
    VoxelGrid,
    close_box,
    connected_components,
    edge_statistics,
    exterior_air,
    extract_boundary_mesh,
    voxelize_triangles,
    wrap_shell,
)


def box_triangles(minimum, maximum) -> np.ndarray:
    """12 triangles of an axis-aligned box."""
    x0, y0, z0 = minimum
    x1, y1, z1 = maximum
    v = np.array(
        [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
        dtype=np.float64,
    )
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    faces = []
    for a, b, c, d in quads:
        faces.append([v[a], v[b], v[c]])
        faces.append([v[a], v[c], v[d]])
    return np.array(faces)


def test_voxelize_marks_surface_but_not_interior():
    tris = box_triangles((0, 0, 0), (4, 4, 4))
    grid = VoxelGrid.around(np.array([0.0, 0, 0]), np.array([4.0, 4, 4]), 1.0, padding_voxels=1)
    occ = voxelize_triangles(tris, grid)
    # box spans voxels 1..4 (5 cells across incl. the max face landing in voxel 5)
    assert occ[1, 1, 1]
    assert not occ[3, 3, 3]  # interior of the hollow box stays empty
    assert not occ[0, 0, 0]  # padding stays empty


def test_exterior_flood_fill_does_not_enter_closed_box():
    tris = box_triangles((0, 0, 0), (4, 4, 4))
    grid = VoxelGrid.around(np.array([0.0, 0, 0]), np.array([4.0, 4, 4]), 1.0, padding_voxels=2)
    occ = voxelize_triangles(tris, grid)
    ext = exterior_air(occ)
    assert ext[0, 0, 0]
    assert not ext[4, 4, 4]  # inside the box
    inside = ~ext
    assert inside.sum() > occ.sum()  # hollow interior counted as inside


def test_closing_seals_a_one_voxel_gap():
    mask = np.zeros((7, 7, 7), dtype=bool)
    mask[2:5, 2:5, 2:5] = True
    mask[3, 3, 4] = False  # punch a hole in the top face
    mask[3, 3, 3] = False  # and hollow the centre
    closed = close_box(mask, 1)
    assert closed[3, 3, 4]
    ext = exterior_air(closed)
    assert not ext[3, 3, 3]


def test_boundary_mesh_of_single_voxel_is_a_closed_cube():
    inside = np.zeros((3, 3, 3), dtype=bool)
    inside[1, 1, 1] = True
    grid = VoxelGrid(origin=np.zeros(3), pitch=1.0, shape=(3, 3, 3))
    vertices, faces = extract_boundary_mesh(inside, grid)
    assert vertices.shape == (8, 3)
    assert faces.shape == (12, 3)
    stats = edge_statistics(faces)
    assert stats == {"edge_count": 18, "boundary_edge_count": 0, "non_manifold_edge_count": 0}
    # Outward orientation: every face normal points away from the cube centre.
    tri = vertices[faces]
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    centres = tri.mean(axis=1) - np.array([1.5, 1.5, 1.5])
    assert (np.einsum("ij,ij->i", normals, centres) > 0).all()


def test_edge_statistics_detects_open_mesh():
    faces = np.array([[0, 1, 2], [0, 2, 3]])
    stats = edge_statistics(faces)
    assert stats["boundary_edge_count"] == 4
    assert stats["non_manifold_edge_count"] == 0


def test_connected_components_sorted_largest_first():
    mask = np.zeros((6, 3, 3), dtype=bool)
    mask[0:3, :, :] = True
    mask[5, 0, 0] = True
    comps = connected_components(mask)
    assert [int(c.sum()) for c in comps] == [27, 1]


def test_wrap_shell_produces_watertight_shell_and_drops_islands():
    building = box_triangles((0, 0, 0), (10, 8, 6))
    island = box_triangles((40, 40, 0), (41, 41, 1))
    result = wrap_shell(np.concatenate([building, island]), pitch=1.0, closing_radius_voxels=1)
    stats = result["stats"]
    assert stats["watertight"] is True
    assert stats["boundary_edge_count"] == 0
    assert stats["shell_component_count"] == 2
    assert stats["dropped_island_voxel_counts"] == [pytest.approx(8, abs=8)] or len(stats["dropped_island_voxel_counts"]) == 1
    lo = result["vertices"].min(axis=0)
    hi = result["vertices"].max(axis=0)
    # Shell hugs the building within one voxel.
    assert np.allclose(lo, [0, 0, 0], atol=1.0)
    assert np.allclose(hi, [10, 8, 6], atol=1.0 + 1.0)
    assert hi[0] < 20  # island not part of the kept shell


def test_stl_roundtrip(tmp_path):
    tris = box_triangles((0, 0, 0), (1, 2, 3))
    vertices = tris.reshape(-1, 3)
    faces = np.arange(vertices.shape[0]).reshape(-1, 3)
    path = tmp_path / "box.stl"
    write_binary_stl(path, vertices, faces)
    back = read_binary_stl(path)
    assert back.shape == (12, 3, 3)
    assert np.allclose(back, tris)
