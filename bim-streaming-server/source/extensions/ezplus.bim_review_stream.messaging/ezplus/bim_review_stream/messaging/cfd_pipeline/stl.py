"""Minimal binary STL writer/reader."""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np


def write_binary_stl(path: Path, vertices: np.ndarray, faces: np.ndarray, *, solid_name: str = "shell") -> None:
    tri = np.asarray(vertices, dtype=np.float64)[np.asarray(faces, dtype=np.int64)]  # (n, 3, 3)
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    lengths[lengths == 0] = 1.0
    normals = normals / lengths[:, None]
    record = np.zeros(tri.shape[0], dtype=[("normal", "<f4", (3,)), ("v", "<f4", (3, 3)), ("attr", "<u2")])
    record["normal"] = normals.astype(np.float32)
    record["v"] = tri.astype(np.float32)
    header = solid_name.encode("ascii", "replace")[:80].ljust(80, b"\0")
    with Path(path).open("wb") as handle:
        handle.write(header)
        handle.write(struct.pack("<I", tri.shape[0]))
        handle.write(record.tobytes())


def read_binary_stl(path: Path) -> np.ndarray:
    """Return triangles as an (n, 3, 3) float64 array."""
    data = Path(path).read_bytes()
    count = struct.unpack("<I", data[80:84])[0]
    record = np.frombuffer(data[84:], dtype=[("normal", "<f4", (3,)), ("v", "<f4", (3, 3)), ("attr", "<u2")], count=count)
    return record["v"].astype(np.float64)
