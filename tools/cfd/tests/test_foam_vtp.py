from __future__ import annotations

import base64

import numpy as np

from bimcfd.foam_vtk import parse_vtk_any, parse_vtp


def _b64(array: np.ndarray, header_dtype=np.uint64) -> str:
    raw = array.tobytes()
    header = np.array([len(raw)], dtype=header_dtype).tobytes()
    return base64.b64encode(header + raw).decode("ascii")


def _vtp(tmp_path, fmt: str):
    points = np.array([[0, 0, 1], [1, 0, 1], [2, 0, 1], [0, 5, 1], [1, 5, 1]], dtype=np.float32)
    connectivity = np.array([0, 1, 2, 3, 4], dtype=np.int32)
    offsets = np.array([3, 5], dtype=np.int32)
    p = np.array([0.5, 0.4, 0.3, -0.1, -0.2], dtype=np.float32)
    u = np.array([[1, 0, 0]] * 5, dtype=np.float32)

    def arr(a):
        return _b64(a) if fmt == "binary" else " ".join(str(v) for v in a.ravel())

    text = f"""<?xml version='1.0'?>
<VTKFile type='PolyData' version='0.1' byte_order='LittleEndian' header_type='UInt64'>
  <PolyData>
    <Piece NumberOfPoints='5' NumberOfLines='2'>
      <Points>
        <DataArray type='Float32' Name='Points' NumberOfComponents='3' format='{fmt}'>
{arr(points)}
        </DataArray>
      </Points>
      <Lines>
        <DataArray type='Int32' Name='connectivity' format='{fmt}'>
{arr(connectivity)}
        </DataArray>
        <DataArray type='Int32' Name='offsets' format='{fmt}'>
{arr(offsets)}
        </DataArray>
      </Lines>
      <PointData>
        <DataArray type='Float32' Name='p' format='{fmt}'>
{arr(p)}
        </DataArray>
        <DataArray type='Float32' Name='U' NumberOfComponents='3' format='{fmt}'>
{arr(u)}
        </DataArray>
      </PointData>
    </Piece>
  </PolyData>
</VTKFile>
"""
    path = tmp_path / f"track_{fmt}.vtp"
    path.write_text(text, encoding="utf-8")
    return path


def test_parse_vtp_binary_base64(tmp_path):
    surface = parse_vtp(_vtp(tmp_path, "binary"))
    assert surface.points.shape == (5, 3)
    assert [list(line) for line in surface.lines] == [[0, 1, 2], [3, 4]]
    assert np.allclose(surface.point_data["p"], [0.5, 0.4, 0.3, -0.1, -0.2], atol=1e-6)
    assert surface.point_data["U"].shape == (5, 3)
    assert surface.polygons == []


def test_parse_vtp_ascii_and_dispatch(tmp_path):
    surface = parse_vtk_any(_vtp(tmp_path, "ascii"))
    assert surface.points.shape == (5, 3)
    assert [list(line) for line in surface.lines] == [[0, 1, 2], [3, 4]]
    assert np.allclose(surface.point_data["U"][:, 0], 1.0)
