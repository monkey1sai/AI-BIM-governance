from __future__ import annotations

import numpy as np

from bimcfd.foam_log import parse_check_mesh_log, parse_simple_foam_log, parse_solver_info
from bimcfd.foam_vtk import parse_legacy_vtk

LEGACY_POLY = """# vtk DataFile Version 2.0
sampleSurface
ASCII
DATASET POLYDATA
POINTS 4 float
0 0 1.5
1 0 1.5
1 1 1.5
0 1 1.5
POLYGONS 2 8
3 0 1 2
3 0 2 3
POINT_DATA 4
FIELD attributes 2
U 3 4 float
1 0 0
2 0 0
3 0 0
4 0 0
p 1 4 float
0.1 0.2 0.3 0.4
"""

LEGACY_CELL_SCALARS = """# vtk DataFile Version 5.1
building
ASCII
DATASET POLYDATA
POINTS 4 float
0 0 0 1 0 0 1 1 0 0 1 0
POLYGONS 2 4
OFFSETS vtktypeint64
0 4
CONNECTIVITY vtktypeint64
0 1 2 3
CELL_DATA 1
SCALARS p float 1
LOOKUP_TABLE default
-2.5
"""

LEGACY_LINES = """# vtk DataFile Version 2.0
particleTracks
ASCII
DATASET POLYDATA
POINTS 5 float
0 0 0
1 0 0
2 0 0
0 1 0
1 1 0
LINES 2 7
3 0 1 2
2 3 4
POINT_DATA 5
VECTORS U float
1 0 0
1 0 0
1 0 0
2 0 0
2 0 0
"""


def test_parse_polygons_with_point_field_data(tmp_path):
    path = tmp_path / "plane.vtk"
    path.write_text(LEGACY_POLY, encoding="utf-8")
    surface = parse_legacy_vtk(path)
    assert surface.points.shape == (4, 3)
    assert surface.polygon_count == 2
    assert list(surface.polygons[1]) == [0, 2, 3]
    assert surface.point_data["U"].shape == (4, 3)
    assert np.allclose(surface.point_data["p"], [0.1, 0.2, 0.3, 0.4])


def test_parse_vtk5_offsets_and_cell_scalars(tmp_path):
    path = tmp_path / "building.vtk"
    path.write_text(LEGACY_CELL_SCALARS, encoding="utf-8")
    surface = parse_legacy_vtk(path)
    assert surface.polygon_count == 1
    assert list(surface.polygons[0]) == [0, 1, 2, 3]
    assert np.allclose(surface.cell_data["p"], [-2.5])


def test_parse_lines_with_vectors(tmp_path):
    path = tmp_path / "tracks.vtk"
    path.write_text(LEGACY_LINES, encoding="utf-8")
    surface = parse_legacy_vtk(path)
    assert [list(line) for line in surface.lines] == [[0, 1, 2], [3, 4]]
    assert surface.point_data["U"].shape == (5, 3)


def test_parse_solver_info(tmp_path):
    path = tmp_path / "solverInfo.dat"
    path.write_text(
        "# Solver information\n"
        "# Time  Ux_solver Ux_initial Ux_final Ux_iters Ux_converged Uy_solver Uy_initial Uy_final Uy_iters Uy_converged p_solver p_initial p_final p_iters p_converged\n"
        "1 smoothSolver 1 0.1 2 false smoothSolver 1 0.1 2 false GAMG 1 0.01 5 false\n"
        "2 smoothSolver 0.5 0.05 2 false smoothSolver 0.4 0.04 2 false GAMG 0.2 0.002 4 false\n"
        "3 smoothSolver 0.0001 0.00001 1 true smoothSolver 0.0001 0.00001 1 true GAMG 0.0009 0.00001 3 true\n",
        encoding="utf-8",
    )
    info = parse_solver_info(path)
    assert info["iterations"] == 3
    assert info["fields"]["p"] == [1.0, 0.2, 0.0009]
    assert info["final_initial_residuals"]["Ux"] == 0.0001
    assert info["solver_converged_flags"]["p"] == "true"


def test_parse_simple_foam_and_check_mesh_logs(tmp_path):
    log = tmp_path / "log.simpleFoam"
    log.write_text("Time = 1\n\nTime = 2\n\nSIMPLE solution converged in 2 iterations\n\nEnd\n", encoding="utf-8")
    parsed = parse_simple_foam_log(log)
    assert parsed["converged_by_residual_control"] is True
    assert parsed["converged_iterations"] == 2
    assert parsed["last_time"] == 2
    assert parsed["reached_end"] is True
    assert parsed["fatal_error"] is False

    check = tmp_path / "log.checkMesh"
    check.write_text(
        "Mesh stats\n    points:           1234\n    faces:            5000\n    cells:            2000\n"
        "    Max non-orthogonality = 61.2 average: 8.1\n    Max skewness = 3.1 OK.\n\nMesh OK.\n",
        encoding="utf-8",
    )
    mesh = parse_check_mesh_log(check)
    assert mesh["cells"] == 2000
    assert mesh["max_non_orthogonality"] == 61.2
    assert mesh["max_skewness"] == 3.1
    assert mesh["mesh_ok"] is True
    assert mesh["failed_checks"] == 0
