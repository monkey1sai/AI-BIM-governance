from datetime import UTC, datetime
from pathlib import Path
import re
from typing import Any

from .ifc_class_canonicalizer import canonical_ifc_class


ENTITY_RE = re.compile(r"^\s*#(?P<id>\d+)\s*=\s*(?P<class>IFC[A-Z0-9_]+)\s*\((?P<args>.*)\)\s*;?\s*$", re.I | re.S)
IFC_GLOBAL_ID_RE = re.compile(r"^[0-9A-Za-z_$]{22}$")
TAG_ARG_INDEX = 7


def build_ifc_index(
    ifc_path: Path | str,
    *,
    project_id: str,
    model_version_id: str,
    source_artifact_id: str,
    prefer_ifcopenshell: bool = True,
) -> dict[str, Any]:
    path = Path(ifc_path)
    if prefer_ifcopenshell:
        try:
            return _build_with_ifcopenshell(path, project_id, model_version_id, source_artifact_id)
        except Exception:
            pass
    return _build_with_regex(path, project_id, model_version_id, source_artifact_id)


def _base_index(
    path: Path,
    project_id: str,
    model_version_id: str,
    source_artifact_id: str,
    method: str,
) -> dict[str, Any]:
    return {
        "project_id": project_id,
        "model_version_id": model_version_id,
        "source_artifact_id": source_artifact_id,
        "source_path": str(path),
        "generated_at": datetime.now(UTC).isoformat(),
        "indexer": {"method": method},
        "elements": [],
        "summary": {"element_count": 0, "guid_count": 0},
    }


def _build_with_ifcopenshell(
    path: Path,
    project_id: str,
    model_version_id: str,
    source_artifact_id: str,
) -> dict[str, Any]:
    import ifcopenshell  # type: ignore

    model = ifcopenshell.open(str(path))
    index = _base_index(path, project_id, model_version_id, source_artifact_id, "ifcopenshell")
    elements = []
    for entity in model.by_type("IfcRoot"):
        guid = getattr(entity, "GlobalId", None)
        if not _is_ifc_global_id(str(guid) if guid else None):
            continue
        elements.append(
            {
                "ifc_entity_id": f"#{entity.id()}",
                "ifc_guid": str(guid),
                "ifc_class": canonical_ifc_class(entity.is_a()),
                "name": _none_if_empty(getattr(entity, "Name", None)),
                "revit_element_id": _numeric_or_none(getattr(entity, "Tag", None)),
            }
        )
    index["elements"] = elements
    index["summary"] = {"element_count": len(elements), "guid_count": len({item["ifc_guid"] for item in elements})}
    return index


def _build_with_regex(
    path: Path,
    project_id: str,
    model_version_id: str,
    source_artifact_id: str,
) -> dict[str, Any]:
    index = _base_index(path, project_id, model_version_id, source_artifact_id, "regex_fallback")
    elements = []
    for record in _iter_step_records(path):
        match = ENTITY_RE.match(record)
        if not match:
            continue
        args = _split_step_args(match.group("args"))
        guid = _unquote_step_string(args[0]) if args else None
        if not _is_ifc_global_id(guid):
            continue
        ifc_class = canonical_ifc_class(match.group("class"))
        elements.append(
            {
                "ifc_entity_id": f"#{match.group('id')}",
                "ifc_guid": guid,
                "ifc_class": ifc_class,
                "name": _unquote_step_string(args[2]) if len(args) > 2 else None,
                "revit_element_id": _extract_revit_element_id(args),
                "raw_line": _compact_record(record),
            }
        )
    index["elements"] = elements
    index["summary"] = {"element_count": len(elements), "guid_count": len({item["ifc_guid"] for item in elements})}
    return index


def _iter_step_records(path: Path):
    buffer: list[str] = []
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("#") and not buffer:
                buffer.append(stripped)
            elif buffer:
                buffer.append(stripped)
            if buffer and stripped.endswith(";"):
                yield " ".join(buffer)
                buffer = []


def _split_step_args(text: str) -> list[str]:
    args: list[str] = []
    current: list[str] = []
    in_string = False
    depth = 0
    index = 0
    while index < len(text):
        char = text[index]
        current.append(char)
        if char == "'":
            if in_string and index + 1 < len(text) and text[index + 1] == "'":
                current.append(text[index + 1])
                index += 1
            else:
                in_string = not in_string
        elif not in_string:
            if char == "(":
                depth += 1
            elif char == ")":
                depth = max(0, depth - 1)
            elif char == "," and depth == 0:
                current.pop()
                args.append("".join(current).strip())
                current = []
        index += 1
    if current:
        args.append("".join(current).strip())
    return args


def _unquote_step_string(value: str | None) -> str | None:
    if not value or value == "$":
        return None
    value = value.strip()
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return None


def _is_ifc_global_id(value: str | None) -> bool:
    return bool(value and IFC_GLOBAL_ID_RE.fullmatch(value))


def _extract_revit_element_id(args: list[str]) -> str | None:
    if len(args) <= TAG_ARG_INDEX:
        return None
    tag = _unquote_step_string(args[TAG_ARG_INDEX])
    if not tag:
        return None
    tag = tag.strip()
    return tag if re.fullmatch(r"\d+", tag) else None


def _none_if_empty(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _numeric_or_none(value: object) -> str | None:
    text = _none_if_empty(value)
    return text if text and re.fullmatch(r"\d+", text) else None


def _compact_record(value: str) -> str:
    return " ".join(value.split())
