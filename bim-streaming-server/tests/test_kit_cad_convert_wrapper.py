"""Contract tests for the Kit CAD converter wrapper.

`convert-ifc-to-usdc.ps1` invokes `kit-cad-convert-and-quit.py` inside Kit and
forwards the inbound trace id as `--trace-id`. The wrapper parses its own
arguments strictly, so an argument the caller sends but the wrapper does not
declare aborts the whole Kit process at parse time - which is exactly how every
host-native IFC->USDC conversion failed before this was fixed. These tests pin
both halves of that contract: the forwarded flag is accepted, and it is not
leaked into the argv handed to the HOOPS process script.
"""

import importlib.util
import sys
import types
from pathlib import Path

import pytest

WRAPPER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "kit-cad-convert-and-quit.py"


def _load_wrapper(monkeypatch):
    """Import the wrapper with Kit's runtime modules stubbed out."""
    quits: list[int] = []

    carb = types.ModuleType("carb")
    carb.log_error = lambda *_args, **_kwargs: None

    omni = types.ModuleType("omni")
    omni_kit = types.ModuleType("omni.kit")
    omni_kit_app = types.ModuleType("omni.kit.app")
    omni_kit_app.get_app = lambda: types.SimpleNamespace(post_quit=quits.append)
    omni_kit.app = omni_kit_app
    omni.kit = omni_kit

    for name, module in (
        ("carb", carb),
        ("omni", omni),
        ("omni.kit", omni_kit),
        ("omni.kit.app", omni_kit_app),
    ):
        monkeypatch.setitem(sys.modules, name, module)

    spec = importlib.util.spec_from_file_location("kit_cad_convert_and_quit", WRAPPER_PATH)
    assert spec is not None and spec.loader is not None, f"cannot load wrapper at {WRAPPER_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, quits


def _base_argv(process_script: Path) -> list[str]:
    return [
        "kit-cad-convert-and-quit.py",
        "--process-script",
        str(process_script),
        "--input-path",
        "C:/storage/ifc-cache/job/source.ifc",
        "--output-path",
        "C:/artifacts/job",
        "--config-path",
        "C:/config/cad.json",
    ]


def test_wrapper_accepts_forwarded_trace_id_and_keeps_it_out_of_the_process_argv(
    monkeypatch, tmp_path: Path
):
    module, quits = _load_wrapper(monkeypatch)
    process_script = tmp_path / "hoops_main.py"
    process_script.write_text("", encoding="utf-8")

    observed: dict[str, object] = {}

    def fake_run_path(path, run_name=None):
        observed["path"] = path
        observed["run_name"] = run_name
        observed["argv"] = list(sys.argv)

    monkeypatch.setattr(module.runpy, "run_path", fake_run_path)
    monkeypatch.setattr(
        sys, "argv", _base_argv(process_script) + ["--trace-id", "stream_conv_20260819_abc123"]
    )

    module.main()

    assert quits == [0]
    assert observed["path"] == str(process_script)
    assert observed["run_name"] == "__main__"
    # the HOOPS process script has no --trace-id of its own; forwarding it would
    # move the failure one layer inward instead of fixing it
    assert observed["argv"] == [
        str(process_script),
        "--input-path",
        "C:/storage/ifc-cache/job/source.ifc",
        "--output-path",
        "C:/artifacts/job",
        "--config-path",
        "C:/config/cad.json",
    ]


def test_wrapper_still_runs_without_a_trace_id(monkeypatch, tmp_path: Path):
    module, quits = _load_wrapper(monkeypatch)
    process_script = tmp_path / "hoops_main.py"
    process_script.write_text("", encoding="utf-8")

    monkeypatch.setattr(module.runpy, "run_path", lambda *_a, **_k: None)
    monkeypatch.setattr(sys, "argv", _base_argv(process_script))

    module.main()

    assert quits == [0]


def test_wrapper_still_rejects_an_unknown_argument(monkeypatch, tmp_path: Path):
    # accepting --trace-id must not turn the parser permissive; a typo should
    # still fail loudly rather than run a conversion with a silently ignored flag
    module, _ = _load_wrapper(monkeypatch)
    process_script = tmp_path / "hoops_main.py"
    process_script.write_text("", encoding="utf-8")

    monkeypatch.setattr(module.runpy, "run_path", lambda *_a, **_k: None)
    monkeypatch.setattr(sys, "argv", _base_argv(process_script) + ["--trace-di", "typo"])

    with pytest.raises(SystemExit):
        module.main()
