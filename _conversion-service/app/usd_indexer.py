from pathlib import Path
import re
import subprocess
from typing import Any

from .ifc_class_canonicalizer import canonical_ifc_class, is_ifc_class_token
from .settings import Settings


class USDIndexerError(RuntimeError):
    code = "USD_INDEXER_FAILED"
    stage = "indexing_usd"


REVIT_ELEMENT_ID_RE = re.compile(r"(?<!\d)(\d{5,10})(?!\d)")


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


def enrich_usd_index(payload: dict[str, Any]) -> dict[str, Any]:
    for prim in payload.get("prims") or []:
        if not isinstance(prim, dict):
            continue

        path = str(prim.get("path") or "")
        name = str(prim.get("name") or "")
        class_segment_index, ifc_class = _parse_ifc_class(path, name)
        if ifc_class and not prim.get("ifc_class"):
            prim["ifc_class"] = ifc_class

        candidates = prim.get("identifier_candidates")
        if not isinstance(candidates, list):
            candidates = []
            prim["identifier_candidates"] = candidates

        for element_id in _parse_revit_element_ids(path, name, class_segment_index):
            entry = {"source": "path", "key": "revit_element_id", "value": element_id}
            if entry not in candidates:
                candidates.append(entry)
    return payload


def _parse_ifc_class(path: str, name: str) -> tuple[int | None, str | None]:
    segments = _path_segments(path)
    for index in range(len(segments) - 1, -1, -1):
        segment = segments[index].upper()
        if is_ifc_class_token(segment):
            return index, canonical_ifc_class(segment)
    name_upper = name.upper()
    if is_ifc_class_token(name_upper):
        return None, canonical_ifc_class(name_upper)
    return None, None


def _parse_revit_element_ids(path: str, name: str, class_segment_index: int | None) -> list[str]:
    segments = _path_segments(path)
    search_segments = segments[class_segment_index + 1 :] if class_segment_index is not None else segments
    if name and name not in search_segments:
        search_segments.append(name)

    values: list[str] = []
    seen: set[str] = set()
    for segment in search_segments:
        for match in REVIT_ELEMENT_ID_RE.finditer(segment):
            value = match.group(1)
            if value in seen:
                continue
            seen.add(value)
            values.append(value)
    return values


def _path_segments(path: str) -> list[str]:
    return [segment for segment in path.replace("\\", "/").split("/") if segment]
