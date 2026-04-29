from pathlib import Path
import shutil
import subprocess

from .settings import Settings


class ConverterProcessError(RuntimeError):
    code = "CONVERTER_PROCESS_FAILED"
    stage = "converting_ifc_to_usdc"


def run_converter(
    *,
    settings: Settings,
    ifc_path: Path,
    output_dir: Path,
    output_name: str,
    log_path: Path,
    force: bool,
) -> Path:
    script_path = settings.bim_streaming_server_root / "scripts" / "convert-ifc-to-usdc.ps1"
    if not script_path.is_file():
        raise ConverterProcessError(f"Converter script not found: {script_path}")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / output_name
    powershell = (
        shutil.which("pwsh.exe")
        or shutil.which("pwsh")
        or shutil.which("powershell.exe")
        or shutil.which("powershell")
    )
    if not powershell:
        raise ConverterProcessError("PowerShell executable was not found.")

    args = [
        powershell,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
        "-IfcPath",
        str(ifc_path),
        "-OutputName",
        output_name,
        "-OutputDir",
        str(output_dir),
        "-TimeoutSeconds",
        str(settings.conversion_timeout_seconds),
    ]
    if force:
        args.append("-Force")

    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", errors="replace") as log_file:
        log_file.write("[converter] " + " ".join(args) + "\n")
        try:
            process = subprocess.run(
                args,
                cwd=settings.bim_streaming_server_root,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                timeout=settings.conversion_timeout_seconds + 30,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ConverterProcessError(
                f"Converter timed out after {settings.conversion_timeout_seconds} seconds."
            ) from exc

    if process.returncode != 0:
        raise ConverterProcessError(f"Converter failed with exit code {process.returncode}.")
    if not output_path.is_file():
        raise ConverterProcessError(f"Converter finished but output is missing: {output_path}")
    return output_path
