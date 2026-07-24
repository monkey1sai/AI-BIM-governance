import json
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import probe_ifc_clash_capability as probe  # noqa: E402


def test_clash_canaries_cover_overlap_clearance_and_separation() -> None:
    result = probe.run_probe()

    assert result.capable is True
    assert result.overlap.intersection >= 1
    assert result.overlap.collision >= 1
    assert result.near_clearance.intersection == 0
    assert result.near_clearance.collision == 0
    assert result.near_clearance.clearance >= 1
    assert result.separated == probe.ClashCounts(
        intersection=0,
        collision=0,
        clearance=0,
    )


def test_pythonocc_bindings_are_not_the_clash_capability_gate(monkeypatch) -> None:
    monkeypatch.setattr(probe.geom, "has_occ", False)

    result = probe.run_probe()

    assert result.capable is True
    assert result.pythonocc_bindings_available is False
    assert result.overlap.intersection >= 1
    assert result.overlap.collision >= 1
    assert result.near_clearance.clearance >= 1


def test_missing_opencascade_iterator_fails_loud(monkeypatch) -> None:
    class UnavailableIterator:
        def initialize(self) -> bool:
            return False

    monkeypatch.setattr(
        probe.geom,
        "iterator",
        lambda *_args, **_kwargs: UnavailableIterator(),
    )

    with pytest.raises(
        probe.ClashCapabilityError,
        match="OpenCASCADE iterator did not initialize",
    ):
        probe.run_probe()


def test_cli_failure_is_machine_readable_and_nonzero(monkeypatch, capsys) -> None:
    def fail_probe():
        raise probe.ClashCapabilityError("fixture backend failure")

    monkeypatch.setattr(probe, "run_probe", fail_probe)

    assert probe.main() == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload == {
        "capable": False,
        "error": {
            "code": "ifc_clash_engine_unavailable",
            "detail": "fixture backend failure",
        },
    }
