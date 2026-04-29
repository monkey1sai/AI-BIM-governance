from pathlib import Path
import subprocess

from .settings import Settings


class USDIndexerError(RuntimeError):
    code = "USD_INDEXER_FAILED"
    stage = "indexing_usd"


def run_usd_indexer(*, settings: Settings, usd_path: Path, output_path: Path, log_path: Path) -> Path:
    build_root = settings.bim_streaming_server_root / "_build" / "windows-x86_64" / "release"
    kit_exe = build_root / "kit" / "kit.exe"
    helper_script = settings.bim_streaming_server_root / "scripts" / "inspect-usd-stage-and-quit.py"
    if not kit_exe.is_file():
        raise USDIndexerError(f"Kit executable not found: {kit_exe}. Run .\\repo.bat build first.")
    if not helper_script.is_file():
        raise USDIndexerError(f"USD inspection helper not found: {helper_script}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    exec_script = f'"{helper_script}" --usd-path "{usd_path}" --output-path "{output_path}"'
    args = [
        str(kit_exe),
        "--ext-folder",
        str(build_root / "exts"),
        "--ext-folder",
        str(build_root / "extscache"),
        "--ext-folder",
        str(build_root / "apps"),
        "--no-window",
        "--enable",
        "omni.usd.libs",
        "--enable",
        "omni.usd",
        "--exec",
        exec_script,
        "--/app/fastShutdown=1",
        "--info",
    ]

    with log_path.open("a", encoding="utf-8", errors="replace") as log_file:
        log_file.write("[usd-indexer] " + " ".join(args) + "\n")
        try:
            process = subprocess.run(
                args,
                cwd=settings.bim_streaming_server_root,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                timeout=settings.conversion_timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise USDIndexerError(f"USD indexer timed out after {settings.conversion_timeout_seconds} seconds.") from exc

    if process.returncode != 0:
        raise USDIndexerError(f"USD indexer failed with exit code {process.returncode}.")
    if not output_path.is_file():
        raise USDIndexerError(f"USD indexer finished but output is missing: {output_path}")
    return output_path
