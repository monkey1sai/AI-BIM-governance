import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.converter_runner import run_converter
from app.settings import Settings


def test_converter_runner_prefers_pwsh_over_windows_powershell(monkeypatch, tmp_path: Path):
    streaming_root = tmp_path / "bim-streaming-server"
    script_path = streaming_root / "scripts" / "convert-ifc-to-usdc.ps1"
    script_path.parent.mkdir(parents=True)
    script_path.write_text("", encoding="utf-8")

    ifc_path = tmp_path / "source.ifc"
    ifc_path.write_text("ISO-10303-21;", encoding="utf-8")
    output_dir = tmp_path / "output"
    output_path = output_dir / "model.usdc"

    found = {
        "pwsh": "C:/Program Files/PowerShell/7/pwsh.exe",
        "powershell.exe": "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        "powershell": "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    }

    monkeypatch.setattr("shutil.which", lambda name: found.get(name))

    captured_args = None

    def fake_run(args, **kwargs):
        nonlocal captured_args
        captured_args = args
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("", encoding="utf-8")
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    settings = Settings(
        service_root=tmp_path,
        bim_streaming_server_root=streaming_root,
        work_dir=tmp_path / "work",
        jobs_dir=tmp_path / "jobs",
        logs_dir=tmp_path / "logs",
    )

    run_converter(
        settings=settings,
        ifc_path=ifc_path,
        output_dir=output_dir,
        output_name="model.usdc",
        log_path=tmp_path / "converter.log",
        force=True,
    )

    assert captured_args is not None
    assert captured_args[0] == found["pwsh"]
