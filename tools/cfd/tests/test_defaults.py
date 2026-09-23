"""cfd-case-run-adr.md §3 single sources: ``CaseParams`` and the preprocess profile own the defaults the CLI applies."""

from __future__ import annotations

import pytest

from bimcfd.cli import build_parser
from bimcfd.openfoam_case import CaseParams
from bimcfd.profiles import EXTERIOR_WIND_V1, get_profile


def test_case_params_defaults_are_the_contract_defaults():
    params = CaseParams(wind_from_degrees=0.0, true_north_degrees=0.0)
    assert (params.end_time, params.n_procs, params.uref_m_s, params.zref_m, params.z0_m) == (600, 8, 5.0, 10.0, 0.5)
    assert (params.surface_refinement_level, params.region_refinement_level, params.ground_z_m, params.background_cell_m) == (2, 1, 0.0, None)


def test_sealing_limit_default_is_the_profile_value():
    assert get_profile("exterior-wind/v1") is EXTERIOR_WIND_V1 and EXTERIOR_WIND_V1.sealing_leak_fraction_limit == 0.15


@pytest.mark.parametrize(
    "argv",
    [
        ["make-case", "--shell", "s", "--out", "o", "--wind-from", "0"],
        ["batch", "--shell", "s", "--model-usdc", "m", "--conversion-dir", "c", "--preprocess-dir", "p", "--out", "o"],
        ["converge", "--shell", "s", "--conversion-dir", "c", "--preprocess-dir", "p", "--out", "o", "--run-id", "r"],
        ["aij-case-c", "--data-dir", "d", "--out", "o", "--run-id", "r"],
    ],
)
def test_cli_defaults_come_from_case_params(argv):
    args = build_parser().parse_args(argv)
    assert args.end_time == CaseParams.end_time == 600 and args.np == CaseParams.n_procs
    assert args.surface_level == CaseParams.surface_refinement_level and args.region_level == CaseParams.region_refinement_level
    if argv[0] != "aij-case-c":
        assert (args.uref, args.zref, args.z0, args.ground_z) == (CaseParams.uref_m_s, CaseParams.zref_m, CaseParams.z0_m, CaseParams.ground_z_m)
    if argv[0] in ("make-case", "batch"):
        assert args.cell is CaseParams.background_cell_m is None


def test_preprocess_leak_limit_flag_defaults_to_the_profile():
    args = build_parser().parse_args(["preprocess", "--model-usdc", "m", "--out", "o"])
    assert args.leak_limit is None
    assert build_parser().parse_args(["preprocess", "--model-usdc", "m", "--out", "o", "--leak-limit", "0.3"]).leak_limit == 0.3


def test_cli_defaults_are_read_from_case_params_at_parse_time(monkeypatch):
    """Equal values alone would not prove the source; a patched field must show up in the parser."""
    monkeypatch.setattr(CaseParams, "end_time", 601)
    monkeypatch.setattr(CaseParams, "n_procs", 3)
    args = build_parser().parse_args(["batch", "--shell", "s", "--model-usdc", "m", "--conversion-dir", "c", "--preprocess-dir", "p", "--out", "o"])
    assert (args.end_time, args.np) == (601, 3)
