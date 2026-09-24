"""Golden case files for settings phase B (docs/plans/building-energy-cfd-b-engine-params.md §6).

With default phase-B parameters the case writer must keep producing byte-identical dictionaries. The reference
hashes were generated on main 29dd74a, before any phase-B engine change, with
``python tests/test_golden_case.py --write`` run in tools/cfd. Only hashes are committed, never STL or OpenFOAM
files (repository rule). The shell STL is compared through its vertices rounded to 0.1 mm, so a last-bit float
difference between platforms does not fail the test; every other file is compared byte for byte.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

from bimcfd.aij_case_c import write_blocks_stl
from bimcfd.openfoam_case import CaseParams, build_case
from bimcfd.stl import read_binary_stl, write_binary_stl

from test_voxel_shell import box_triangles

GOLDEN = Path(__file__).with_name("golden") / "default_case_sha256.json"
SKIPPED = {"case_meta.json"}  # carries asdict(CaseParams), which gains the phase-B fields by design


def _write_boxes(path: Path, boxes) -> None:
    tris = np.concatenate([box_triangles(lo, hi) for lo, hi in boxes])
    vertices = tris.reshape(-1, 3)
    write_binary_stl(path, vertices, np.arange(vertices.shape[0]).reshape(-1, 3))


def _shell(kind: str, folder: Path) -> Path:
    path = folder / f"{kind}.stl"
    if kind == "box":
        _write_boxes(path, [((0, 0, 0), (30, 20, 15))])
    elif kind == "l_shape":
        # Footprint centroid differs from the bbox centre, which the isotropic box depends on.
        _write_boxes(path, [((0, 0, 0), (40, 12, 18)), ((0, 12, 0), (12, 36, 18))])
    elif kind == "aij_1d":
        write_blocks_stl(path, "1D", scale=75.0)
    else:
        raise ValueError(kind)
    return path


CASES: dict[str, dict] = {
    "box_n000_isotropic": {"shell": "box", "wind_from_degrees": 0.0, "true_north_degrees": 0.0},
    "box_n0225_isotropic": {"shell": "box", "wind_from_degrees": 22.5, "true_north_degrees": 0.0},
    "l_shape_n045_tn10_isotropic": {"shell": "l_shape", "wind_from_degrees": 45.0, "true_north_degrees": 10.0},
    "l_shape_n000_unknown_north_bbox": {"shell": "l_shape", "wind_from_degrees": 0.0, "true_north_degrees": None, "refinement_box_mode": "bbox"},
    "box_w090_cell3_levels32": {"shell": "box", "wind_from_degrees": 90.0, "true_north_degrees": 0.0, "background_cell_m": 3.0,
                                "surface_refinement_level": 3, "region_refinement_level": 2},
    "aij_1d_w270_bbox_cell1p5": {"shell": "aij_1d", "wind_from_degrees": 270.0, "true_north_degrees": 0.0, "background_cell_m": 1.5,
                                 "refinement_box_mode": "bbox"},
}


def _stl_digest(path: Path) -> str:
    rounded = np.round(read_binary_stl(path).reshape(-1, 3).astype(np.float64), 4)
    return "vertices_0.1mm:" + hashlib.sha256(np.ascontiguousarray(rounded).tobytes()).hexdigest()


def case_hashes(work: Path) -> dict[str, dict[str, str]]:
    """Write every golden case under ``work`` and return {case: {relative path: digest}}."""
    shells: dict[str, Path] = {}
    result: dict[str, dict[str, str]] = {}
    for name, spec in CASES.items():
        spec = dict(spec)
        kind = spec.pop("shell")
        if kind not in shells:
            shells[kind] = _shell(kind, work)
        out = work / name
        build_case(shell_stl=shells[kind], out_dir=out, params=CaseParams(**spec))
        digests: dict[str, str] = {}
        for path in sorted(p for p in out.rglob("*") if p.is_file()):
            rel = path.relative_to(out).as_posix()
            if rel in SKIPPED:
                continue
            digests[rel] = _stl_digest(path) if path.suffix == ".stl" else hashlib.sha256(path.read_bytes()).hexdigest()
        result[name] = digests
    return result


def test_default_parameters_reproduce_the_pre_phase_b_case_files(tmp_path):
    assert GOLDEN.exists(), f"missing {GOLDEN.name}: generate it on the pre-change main with --write"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))["cases"]
    actual = case_hashes(tmp_path)
    assert sorted(actual) == sorted(expected)
    for name, files in expected.items():
        assert sorted(actual[name]) == sorted(files), f"{name}: file set changed"
        changed = [rel for rel, digest in files.items() if actual[name][rel] != digest]
        assert not changed, f"{name}: default parameters changed {changed}"


if __name__ == "__main__":  # pragma: no cover - maintenance entry point
    if sys.argv[1:] != ["--write"]:
        raise SystemExit("usage: python tests/test_golden_case.py --write  (only on the pre-change main)")
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        hashes = case_hashes(Path(tmp))
    GOLDEN.parent.mkdir(exist_ok=True)
    GOLDEN.write_text(json.dumps({"schema": "cfd-golden-case/v1", "generated_from": "main 29dd74a, before any phase-B engine change",
                                  "cases": hashes}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {GOLDEN} ({sum(len(v) for v in hashes.values())} digests)")
