import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.settings import Settings
from app.usd_indexer import enrich_usd_index, run_usd_indexer


def test_usd_indexer_enables_usd_extensions_and_build_paths(monkeypatch, tmp_path: Path):
    streaming_root = tmp_path / "bim-streaming-server"
    kit_exe = streaming_root / "_build" / "windows-x86_64" / "release" / "kit" / "kit.exe"
    helper_script = streaming_root / "scripts" / "inspect-usd-stage-and-quit.py"
    kit_exe.parent.mkdir(parents=True)
    helper_script.parent.mkdir(parents=True)
    kit_exe.write_text("", encoding="utf-8")
    helper_script.write_text("", encoding="utf-8")

    usd_path = tmp_path / "model.usdc"
    usd_path.write_text("", encoding="utf-8")
    output_path = tmp_path / "usd_index.json"

    captured_args = None

    def fake_run(args, **kwargs):
        nonlocal captured_args
        captured_args = args
        output_path.write_text("{}", encoding="utf-8")
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    settings = Settings(
        service_root=tmp_path,
        bim_streaming_server_root=streaming_root,
        work_dir=tmp_path / "work",
        jobs_dir=tmp_path / "jobs",
        logs_dir=tmp_path / "logs",
    )

    run_usd_indexer(settings=settings, usd_path=usd_path, output_path=output_path, log_path=tmp_path / "indexer.log")

    assert captured_args is not None
    build_root = streaming_root / "_build" / "windows-x86_64" / "release"
    assert captured_args.count("--ext-folder") == 3
    assert str(build_root / "exts") in captured_args
    assert str(build_root / "extscache") in captured_args
    assert str(build_root / "apps") in captured_args
    assert _has_arg_pair(captured_args, "--enable", "omni.usd.libs")
    assert _has_arg_pair(captured_args, "--enable", "omni.usd")


def _has_arg_pair(args: list[str], key: str, value: str) -> bool:
    return any(args[index] == key and args[index + 1] == value for index in range(len(args) - 1))


def test_enrich_usd_index_reads_ifc_class_and_revit_id_from_path():
    payload = {
        "prims": [
            {
                "path": "/Root/Geometry/IFCWALL/tn__115cm551956_body",
                "name": "tn__115cm551956_body",
                "type": "Mesh",
                "identifier_candidates": [],
            }
        ]
    }

    enriched = enrich_usd_index(payload)

    prim = enriched["prims"][0]
    assert prim["ifc_class"] == "IfcWall"
    assert {"source": "path", "key": "revit_element_id", "value": "551956"} in prim["identifier_candidates"]
