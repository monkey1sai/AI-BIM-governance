"""Parse legacy ASCII VTK files written by OpenFOAM sampling."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass
class VtkSurface:
    points: np.ndarray  # (n, 3)
    polygons: list[np.ndarray] = field(default_factory=list)  # each (k,) point indices
    lines: list[np.ndarray] = field(default_factory=list)
    point_data: dict[str, np.ndarray] = field(default_factory=dict)
    cell_data: dict[str, np.ndarray] = field(default_factory=dict)

    @property
    def polygon_count(self) -> int:
        return len(self.polygons)


def parse_vtk_any(path: Path) -> VtkSurface:
    """Dispatch on suffix: ``.vtp`` (XML PolyData) or legacy ``.vtk``."""
    path = Path(path)
    if path.suffix.lower() == ".vtp":
        return parse_vtp(path)
    return parse_legacy_vtk(path)


_VTP_DTYPES = {
    "Float32": np.float32,
    "Float64": np.float64,
    "Int32": np.int32,
    "Int64": np.int64,
    "UInt32": np.uint32,
    "UInt64": np.uint64,
    "Int8": np.int8,
    "UInt8": np.uint8,
}


def parse_vtp(path: Path) -> VtkSurface:
    """Parse an XML VTK PolyData file with inline ascii or base64 binary arrays.

    OpenFOAM's set writers (streamLine, sampledSets) emit this format; the
    arrays are uncompressed with a ``header_type`` byte-count prefix.
    """
    import base64
    import xml.etree.ElementTree as ET

    root = ET.parse(Path(path)).getroot()
    header_dtype = _VTP_DTYPES[root.get("header_type", "UInt32")]
    byte_order = "<" if root.get("byte_order", "LittleEndian") == "LittleEndian" else ">"
    if root.find(".//*[@compressor]") is not None or root.get("compressor"):
        raise ValueError(f"compressed VTP not supported: {path}")

    def read_array(node) -> np.ndarray:
        dtype = np.dtype(_VTP_DTYPES[node.get("type")]).newbyteorder(byte_order)
        components = int(node.get("NumberOfComponents", "1"))
        fmt = node.get("format", "ascii")
        text = (node.text or "").strip()
        if fmt == "ascii":
            values = np.array(text.split(), dtype=np.float64).astype(dtype)
        elif fmt == "binary":
            raw = base64.b64decode(text)
            header_size = np.dtype(header_dtype).itemsize
            nbytes = int(np.frombuffer(raw[:header_size], dtype=np.dtype(header_dtype).newbyteorder(byte_order))[0])
            values = np.frombuffer(raw[header_size : header_size + nbytes], dtype=dtype)
        else:
            raise ValueError(f"unsupported DataArray format {fmt!r} in {path}")
        values = values.astype(np.float64) if values.dtype.kind == "f" else values.astype(np.int64)
        return values.reshape(-1, components) if components > 1 else values

    def read_cells(section) -> list[np.ndarray]:
        if section is None:
            return []
        arrays = {node.get("Name"): read_array(node) for node in section.findall("DataArray")}
        connectivity = arrays.get("connectivity")
        offsets = arrays.get("offsets")
        if connectivity is None or offsets is None:
            return []
        cells = []
        start = 0
        for end in offsets.astype(np.int64):
            cells.append(connectivity[start:end].astype(np.int64))
            start = int(end)
        return cells

    piece = root.find(".//Piece")
    if piece is None:
        raise ValueError(f"no Piece in {path}")
    points_node = piece.find("Points/DataArray")
    points = read_array(points_node).reshape(-1, 3) if points_node is not None else np.zeros((0, 3))
    surface = VtkSurface(points=points)
    surface.polygons = read_cells(piece.find("Polys"))
    surface.lines = read_cells(piece.find("Lines"))
    for section_name, target in (("PointData", surface.point_data), ("CellData", surface.cell_data)):
        section = piece.find(section_name)
        if section is None:
            continue
        for node in section.findall("DataArray"):
            target[node.get("Name")] = read_array(node)
    return surface


def parse_legacy_vtk(path: Path) -> VtkSurface:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    lines = [line.strip() for line in text.splitlines()]
    surface = VtkSurface(points=np.zeros((0, 3)))
    i = 0
    section = None  # "POINT_DATA" | "CELL_DATA"
    while i < len(lines):
        line = lines[i]
        if not line or line.startswith("#"):
            i += 1
            continue
        tokens = line.split()
        key = tokens[0].upper()
        if key == "POINTS":
            count = int(tokens[1])
            values, i = _read_numbers(lines, i + 1, count * 3)
            surface.points = values.reshape(count, 3)
            continue
        if key in ("POLYGONS", "LINES"):
            cells, i = _read_cells(lines, i, tokens)
            if key == "POLYGONS":
                surface.polygons = cells
            else:
                surface.lines = cells
            continue
        if key in ("POINT_DATA", "CELL_DATA"):
            section = key
            i += 1
            continue
        if key == "FIELD":
            array_count = int(tokens[2])
            i += 1
            for _ in range(array_count):
                while i < len(lines) and not lines[i]:
                    i += 1
                name, components, tuples = lines[i].split()[:3]
                values, i = _read_numbers(lines, i + 1, int(components) * int(tuples))
                _store(surface, section, name, values.reshape(int(tuples), int(components)))
            continue
        if key == "SCALARS":
            name = tokens[1]
            components = int(tokens[3]) if len(tokens) > 3 else 1
            i += 1
            if i < len(lines) and lines[i].upper().startswith("LOOKUP_TABLE"):
                i += 1
            count = _section_count(surface, section)
            values, i = _read_numbers(lines, i, count * components)
            _store(surface, section, name, values.reshape(count, components))
            continue
        if key in ("VECTORS", "NORMALS"):
            name = tokens[1]
            count = _section_count(surface, section)
            values, i = _read_numbers(lines, i + 1, count * 3)
            _store(surface, section, name, values.reshape(count, 3))
            continue
        if key in ("METADATA", "INFORMATION"):
            i += 1
            while i < len(lines) and lines[i] and not lines[i].split()[0].isupper():
                i += 1
            continue
        i += 1
    return surface


def _section_count(surface: VtkSurface, section: str | None) -> int:
    if section == "CELL_DATA":
        return len(surface.polygons) or len(surface.lines)
    return surface.points.shape[0]


def _store(surface: VtkSurface, section: str | None, name: str, values: np.ndarray) -> None:
    if values.shape[1] == 1:
        values = values[:, 0]
    if section == "CELL_DATA":
        surface.cell_data[name] = values
    else:
        surface.point_data[name] = values


def _read_numbers(lines: list[str], start: int, count: int) -> tuple[np.ndarray, int]:
    values: list[float] = []
    i = start
    while len(values) < count and i < len(lines):
        if lines[i]:
            values.extend(float(tok) for tok in lines[i].split())
        i += 1
    return np.array(values[:count], dtype=np.float64), i


def _read_cells(lines: list[str], start: int, tokens: list[str]) -> tuple[list[np.ndarray], int]:
    count = int(tokens[1])
    size = int(tokens[2])
    i = start + 1
    # VTK 5.x style: OFFSETS then CONNECTIVITY blocks.
    if i < len(lines) and lines[i].upper().startswith("OFFSETS"):
        offsets, i = _read_numbers(lines, i + 1, count)
        while i < len(lines) and not lines[i].upper().startswith("CONNECTIVITY"):
            i += 1
        connectivity, i = _read_numbers(lines, i + 1, size)
        offsets = offsets.astype(np.int64)
        connectivity = connectivity.astype(np.int64)
        cells = [connectivity[offsets[k] : offsets[k + 1]] for k in range(count - 1)]
        return cells, i
    numbers, i = _read_numbers(lines, i, size)
    numbers = numbers.astype(np.int64)
    cells: list[np.ndarray] = []
    pos = 0
    for _ in range(count):
        k = int(numbers[pos])
        cells.append(numbers[pos + 1 : pos + 1 + k])
        pos += 1 + k
    return cells, i
