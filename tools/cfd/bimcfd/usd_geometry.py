"""Load identity-authored USDC elements as world-space triangle soups."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np


@dataclass
class ElementGeometry:
    ifc_guid: str
    ifc_type: str
    prim_path: str
    triangles: np.ndarray  # (n, 3, 3) float64, world metres

    @property
    def triangle_count(self) -> int:
        return int(self.triangles.shape[0])

    @property
    def bbox(self) -> tuple[np.ndarray, np.ndarray] | None:
        if self.triangle_count == 0:
            return None
        flat = self.triangles.reshape(-1, 3)
        return flat.min(axis=0), flat.max(axis=0)


def triangulate_faces(face_counts: np.ndarray, face_indices: np.ndarray) -> np.ndarray:
    """Fan-triangulate polygon faces into an (n, 3) index array."""
    triangles: list[np.ndarray] = []
    offset = 0
    for count in face_counts:
        count = int(count)
        if count >= 3:
            poly = face_indices[offset : offset + count]
            fan = np.stack([np.full(count - 2, poly[0]), poly[1:-1], poly[2:]], axis=1)
            triangles.append(fan)
        offset += count
    if not triangles:
        return np.zeros((0, 3), dtype=np.int64)
    return np.concatenate(triangles).astype(np.int64)


def matrix_to_numpy(matrix) -> np.ndarray:
    """Gf.Matrix4d (row-vector convention) to a (4, 4) float64 array."""
    return np.array([[float(matrix[i][j]) for j in range(4)] for i in range(4)], dtype=np.float64)


def transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Apply a USD row-vector matrix: world = [p, 1] @ M."""
    homogeneous = np.concatenate([points, np.ones((points.shape[0], 1))], axis=1)
    return (homogeneous @ matrix)[:, :3]


def iter_elements(usdc_path: Path, *, elements_root: str = "/World/Elements") -> Iterator[ElementGeometry]:
    from pxr import Usd, UsdGeom

    stage = Usd.Stage.Open(str(usdc_path))
    if stage is None:
        raise FileNotFoundError(f"cannot open USD stage {usdc_path}")
    metres_per_unit = float(UsdGeom.GetStageMetersPerUnit(stage) or 1.0)
    root = stage.GetPrimAtPath(elements_root)
    if not root.IsValid():
        raise ValueError(f"{usdc_path} has no {elements_root} prim")
    xcache = UsdGeom.XformCache(Usd.TimeCode.Default())

    for class_prim in root.GetChildren():
        for element in class_prim.GetChildren():
            custom = element.GetCustomDataByKey("bim") or {}
            ifc_guid = str(custom.get("ifc_guid") or element.GetName())
            ifc_type = str(custom.get("ifc_type") or class_prim.GetName())
            parts: list[np.ndarray] = []
            for prim in Usd.PrimRange(element):
                if not prim.IsA(UsdGeom.Mesh):
                    continue
                mesh = UsdGeom.Mesh(prim)
                points = np.array(mesh.GetPointsAttr().Get() or [], dtype=np.float64).reshape(-1, 3)
                counts = np.array(mesh.GetFaceVertexCountsAttr().Get() or [], dtype=np.int64)
                indices = np.array(mesh.GetFaceVertexIndicesAttr().Get() or [], dtype=np.int64)
                if points.shape[0] == 0 or counts.shape[0] == 0:
                    continue
                tri_idx = triangulate_faces(counts, indices)
                if tri_idx.shape[0] == 0:
                    continue
                world = transform_points(points, matrix_to_numpy(xcache.GetLocalToWorldTransform(prim)))
                if metres_per_unit != 1.0:
                    world = world * metres_per_unit
                valid = (tri_idx >= 0).all(axis=1) & (tri_idx < world.shape[0]).all(axis=1)
                parts.append(world[tri_idx[valid]])
            triangles = np.concatenate(parts) if parts else np.zeros((0, 3, 3), dtype=np.float64)
            yield ElementGeometry(
                ifc_guid=ifc_guid,
                ifc_type=ifc_type,
                prim_path=str(element.GetPath()),
                triangles=triangles,
            )


def load_elements(usdc_path: Path, *, elements_root: str = "/World/Elements") -> list[ElementGeometry]:
    return list(iter_elements(usdc_path, elements_root=elements_root))
