from __future__ import annotations

import json
import math

import numpy as np
import pytest

from bimcfd.openfoam_case import CaseParams, build_case
from bimcfd.stl import write_binary_stl

from test_voxel_shell import box_triangles


@pytest.fixture
def shell(tmp_path):
    tris = box_triangles((0, 0, 0), (20, 30, 10))
    vertices = tris.reshape(-1, 3)
    faces = np.arange(vertices.shape[0]).reshape(-1, 3)
    path = tmp_path / "shell.stl"
    write_binary_stl(path, vertices, faces)
    return path


def test_build_case_writes_complete_case_for_west_wind(shell, tmp_path):
    out = tmp_path / "case"
    meta = build_case(
        shell_stl=shell,
        out_dir=out,
        params=CaseParams(wind_from_degrees=270.0, true_north_degrees=0.0, n_procs=2, end_time=5),
    )

    for rel in (
        "system/controlDict",
        "system/fvSchemes",
        "system/fvSolution",
        "system/blockMeshDict",
        "system/snappyHexMeshDict",
        "system/meshQualityDict",
        "system/decomposeParDict",
        "constant/turbulenceProperties",
        "constant/transportProperties",
        "constant/triSurface/building.stl",
        "0.orig/include/ABLConditions",
        "0.orig/U",
        "0.orig/p",
        "0.orig/k",
        "0.orig/omega",
        "0.orig/nut",
        "Allrun",
        "case.foam",
        "case_meta.json",
    ):
        assert (out / rel).exists(), rel

    # West wind already blows along +X: no rotation.
    assert meta["wind"]["solver_rotation_alpha_deg"] == pytest.approx(0.0)
    bbox = meta["building_bbox_solver_frame"]
    assert bbox["min"] == pytest.approx([0, 0, 0])
    assert bbox["max"] == pytest.approx([20, 30, 10])

    dom = meta["domain"]
    assert dom["building_height_m"] == 10.0
    assert dom["xmin"] == pytest.approx(-50.0)
    assert dom["xmax"] == pytest.approx(170.0)
    assert dom["zmax"] == pytest.approx(60.0)
    assert dom["blockage_ratio"] <= 0.03 + 1e-9

    loc = meta["location_in_mesh"]
    assert dom["xmin"] < loc[0] < 0.0  # upstream of the building, inside the domain
    assert dom["ymin"] < loc[1] < dom["ymax"]
    assert dom["zmin"] < loc[2] < dom["zmax"]

    snappy = (out / "system/snappyHexMeshDict").read_text(encoding="utf-8")
    assert "level (2 2);" in snappy
    assert "levels ((1E15 1));" in snappy
    assert "locationInMesh" in snappy
    block = (out / "system/blockMeshDict").read_text(encoding="utf-8")
    cells = meta["background_mesh"]["cells"]
    assert f"({cells[0]} {cells[1]} {cells[2]})" in block
    assert "(-50 -" in block
    abl = (out / "0.orig/include/ABLConditions").read_text(encoding="utf-8")
    assert "Uref            5;" in abl
    assert "z0              uniform 0.5;" in abl
    control = (out / "system/controlDict").read_text(encoding="utf-8")
    assert "endTime         5;" in control
    assert "cuttingPlane" in control and "point   (0 0 1.5);" in control
    assert "numberOfSubdomains 2;" in (out / "system/decomposeParDict").read_text(encoding="utf-8")
    allrun = (out / "Allrun").read_bytes()
    assert b"\r" not in allrun
    assert b"runParallel snappyHexMesh -overwrite" in allrun
    assert json.loads((out / "case_meta.json").read_text(encoding="utf-8"))["schema"] == "cfd-case/v1"
    assert meta["assumptions"] == []


def test_north_wind_rotates_building_so_wind_is_along_plus_x(shell, tmp_path):
    meta = build_case(
        shell_stl=shell,
        out_dir=tmp_path / "case",
        params=CaseParams(wind_from_degrees=0.0, true_north_degrees=None, n_procs=2, end_time=5),
    )
    # A north wind blows toward -Y; rotating by +90 deg maps -Y onto +X.
    assert meta["wind"]["solver_rotation_alpha_deg"] == pytest.approx(90.0)
    bbox = meta["building_bbox_solver_frame"]
    assert bbox["max"][0] - bbox["min"][0] == pytest.approx(30.0)
    assert bbox["max"][1] - bbox["min"][1] == pytest.approx(20.0)
    assert "true_north_unknown_assumed_project_north" in meta["assumptions"]
    assert meta["wind"]["true_north_degrees_used"] == 0.0


def test_sampling_heights_follow_ground_level_and_assumptions_propagate(shell, tmp_path):
    meta = build_case(
        shell_stl=shell,
        out_dir=tmp_path / "case",
        params=CaseParams(wind_from_degrees=270.0, true_north_degrees=0.0, ground_z_m=-3.0, n_procs=2, end_time=5, assumptions=["true_north_default_direction"]),
    )
    assert meta["pedestrian_plane_z_m"] == pytest.approx(-1.5)
    control = (tmp_path / "case/system/controlDict").read_text(encoding="utf-8")
    assert "point   (0 0 -1.5);" in control
    assert control.count("-1.5)") >= 3  # cutting plane point + both streamline seed ends
    assert meta["domain"]["zmin"] == -3.0
    assert meta["assumptions"] == ["true_north_default_direction"]


def test_case_rejects_shell_below_ground(tmp_path):
    tris = box_triangles((0, 0, -10), (5, 5, -1))
    vertices = tris.reshape(-1, 3)
    path = tmp_path / "under.stl"
    write_binary_stl(path, vertices, np.arange(vertices.shape[0]).reshape(-1, 3))
    with pytest.raises(ValueError):
        build_case(shell_stl=path, out_dir=tmp_path / "case", params=CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0))



def test_streamline_seeds_form_an_inlet_lattice_of_at_least_200_points(shell, tmp_path):
    from bimcfd.openfoam_case import streamline_seed_points
    from bimcfd.wind import Domain

    out = tmp_path / "case_seeds"
    params = CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0, n_procs=2, end_time=5)
    meta = build_case(shell_stl=shell, out_dir=out, params=params)
    domain = Domain(**meta["domain"])
    seeds = streamline_seed_points(params, domain, meta["pedestrian_plane_z_m"])
    assert len(seeds) >= 200
    xs = {round(s[0], 6) for s in seeds}
    assert xs == {round(domain.xmin + 1.0, 6)}  # one metre downstream of the inlet
    assert min(s[1] for s in seeds) > domain.ymin and max(s[1] for s in seeds) < domain.ymax
    assert min(s[2] for s in seeds) == pytest.approx(meta["pedestrian_plane_z_m"])
    assert max(s[2] for s in seeds) <= domain.zmax
    assert len({s[2] for s in seeds}) == params.streamline_seed_rows
    control = (out / "system/controlDict").read_text(encoding="utf-8")
    assert "type        cloud;" in control
    assert control.count("(") >= len(seeds)  # every seed is written as a (x y z) tuple
    assert "nPoints" not in control

def test_run_case_polls_should_stop_and_kills_the_container(tmp_path, monkeypatch):
    import subprocess

    from bimcfd import openfoam_case

    class FakeProc:
        def __init__(self):
            self.returncode = None
            self.terminated = False

        def wait(self, timeout=None):
            if self.terminated:
                self.returncode = -15
                return self.returncode
            raise subprocess.TimeoutExpired(cmd="docker", timeout=timeout)

        def terminate(self):
            self.terminated = True

        def kill(self):
            self.terminated = True

    fake = FakeProc()
    killed: list[str] = []
    monkeypatch.setattr(openfoam_case.subprocess, "Popen", lambda *a, **k: fake)
    monkeypatch.setattr(openfoam_case, "kill_container", lambda name: killed.append(name) or True)
    monkeypatch.setattr(openfoam_case, "image_digest", lambda image: "img@sha256:00")
    remaining = {"n": 2}

    def should_stop():
        remaining["n"] -= 1
        return remaining["n"] <= 0

    case_dir = tmp_path / "case"
    case_dir.mkdir()
    summary = openfoam_case.run_case(case_dir=case_dir, container_name="cfd_x_w000", should_stop=should_stop, poll_interval_s=0.01)
    assert summary["cancelled"] is True
    assert summary["timed_out"] is False
    assert killed == ["cfd_x_w000"]
    assert summary["exit_code"] == -15
    assert (case_dir / "docker_run.log").exists()


def test_run_case_timeout_kills_the_container(tmp_path, monkeypatch):
    import subprocess

    from bimcfd import openfoam_case

    class FakeProc:
        returncode = None

        def wait(self, timeout=None):
            if self.returncode is not None:
                return self.returncode
            raise subprocess.TimeoutExpired(cmd="docker", timeout=timeout)

        def terminate(self):
            self.returncode = -15

        def kill(self):
            self.returncode = -9

    killed: list[str] = []
    monkeypatch.setattr(openfoam_case.subprocess, "Popen", lambda *a, **k: FakeProc())
    monkeypatch.setattr(openfoam_case, "kill_container", lambda name: killed.append(name) or True)
    monkeypatch.setattr(openfoam_case, "image_digest", lambda image: None)
    case_dir = tmp_path / "case"
    case_dir.mkdir()
    summary = openfoam_case.run_case(case_dir=case_dir, container_name="cfd_x_w001", timeout_s=0, poll_interval_s=0.01)
    assert summary["timed_out"] is True
    assert summary["cancelled"] is False
    assert killed == ["cfd_x_w001"]
