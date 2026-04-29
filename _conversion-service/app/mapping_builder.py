from datetime import UTC, datetime
from typing import Any


def build_element_mapping(
    ifc_index: dict[str, Any],
    usd_index: dict[str, Any],
    *,
    project_id: str,
    model_version_id: str,
    source_artifact_id: str,
    allow_fake_mapping: bool = False,
) -> dict[str, Any]:
    usdc_artifact_id = _derive_usdc_artifact_id(source_artifact_id)
    ifc_elements = list(ifc_index.get("elements") or [])
    usd_prims = list(usd_index.get("prims") or [])
    items: list[dict[str, Any]] = []
    used_ifc_guids: set[str] = set()
    used_usd_paths: set[str] = set()

    guid_to_ifc = {item.get("ifc_guid"): item for item in ifc_elements if item.get("ifc_guid")}
    for prim in usd_prims:
        prim_path = prim.get("path")
        if not prim_path:
            continue
        for candidate in _guid_candidates(prim):
            if candidate in guid_to_ifc and candidate not in used_ifc_guids:
                items.append(_mapping_item(guid_to_ifc[candidate], prim, "metadata_guid", 0.95))
                used_ifc_guids.add(candidate)
                used_usd_paths.add(prim_path)
                break

    revit_to_ifc = {
        str(item.get("revit_element_id")): item
        for item in ifc_elements
        if item.get("ifc_guid") not in used_ifc_guids and item.get("revit_element_id")
    }
    for prim in usd_prims:
        prim_path = prim.get("path")
        if not prim_path or prim_path in used_usd_paths:
            continue
        for candidate in _revit_candidates(prim):
            if candidate in revit_to_ifc:
                ifc_item = revit_to_ifc[candidate]
                items.append(_mapping_item(ifc_item, prim, "metadata_revit_element_id", 0.85))
                used_ifc_guids.add(ifc_item["ifc_guid"])
                used_usd_paths.add(prim_path)
                break

    name_class_pairs = _unique_ifc_name_class_pairs(ifc_elements, used_ifc_guids)
    usd_name_pairs = _unique_usd_name_class_pairs(usd_prims, used_usd_paths)
    for key, ifc_item in name_class_pairs.items():
        prim = usd_name_pairs.get(key)
        if not prim:
            continue
        items.append(_mapping_item(ifc_item, prim, "unique_name_class_match", 0.50))
        used_ifc_guids.add(ifc_item["ifc_guid"])
        used_usd_paths.add(prim["path"])

    if allow_fake_mapping:
        unmapped_ifc = [item for item in ifc_elements if item.get("ifc_guid") not in used_ifc_guids]
        unmapped_usd = [prim for prim in usd_prims if prim.get("path") not in used_usd_paths]
        for ifc_item, prim in zip(unmapped_ifc, unmapped_usd):
            items.append(_mapping_item(ifc_item, prim, "fake_for_smoke_test", 0.01))
            used_ifc_guids.add(ifc_item["ifc_guid"])
            used_usd_paths.add(prim["path"])

    unmapped_ifc_guids = [item["ifc_guid"] for item in ifc_elements if item.get("ifc_guid") not in used_ifc_guids]
    unmapped_usd_prims = [prim["path"] for prim in usd_prims if prim.get("path") and prim.get("path") not in used_usd_paths]

    fake_count = sum(1 for item in items if item["mapping_method"] == "fake_for_smoke_test")
    return {
        "project_id": project_id,
        "model_version_id": model_version_id,
        "source_artifact_id": source_artifact_id,
        "usdc_artifact_id": usdc_artifact_id,
        "mapping_version": "v0.1",
        "generated_at": datetime.now(UTC).isoformat(),
        "allow_fake_mapping": allow_fake_mapping,
        "items": items,
        "unmapped_ifc_guids": unmapped_ifc_guids,
        "unmapped_usd_prims": unmapped_usd_prims,
        "summary": {
            "mapped_count": len(items),
            "unmapped_ifc_count": len(unmapped_ifc_guids),
            "unmapped_usd_count": len(unmapped_usd_prims),
            "fake_mapping_count": fake_count,
        },
    }


def _mapping_item(ifc_item: dict[str, Any], prim: dict[str, Any], method: str, confidence: float) -> dict[str, Any]:
    return {
        "ifc_guid": ifc_item.get("ifc_guid"),
        "ifc_class": ifc_item.get("ifc_class"),
        "name": ifc_item.get("name"),
        "revit_element_id": ifc_item.get("revit_element_id"),
        "usd_prim_path": prim.get("path"),
        "usd_prim_type": prim.get("type"),
        "mapping_confidence": confidence,
        "mapping_method": method,
    }


def _guid_candidates(prim: dict[str, Any]) -> list[str]:
    return [str(value) for value in prim.get("guid_candidates") or [] if value]


def _revit_candidates(prim: dict[str, Any]) -> list[str]:
    values = []
    for key in ("revit_element_id", "revitElementId", "externalId"):
        value = prim.get(key)
        if value:
            values.append(str(value))
    for entry in prim.get("identifier_candidates") or []:
        if entry.get("key") in {"revitElementId", "externalId", "revit_element_id"} and entry.get("value"):
            values.append(str(entry["value"]))
    return values


def _unique_ifc_name_class_pairs(items: list[dict[str, Any]], used_guids: set[str]) -> dict[tuple[str, str], dict[str, Any]]:
    counts: dict[tuple[str, str], int] = {}
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for item in items:
        if item.get("ifc_guid") in used_guids:
            continue
        key = (_norm(item.get("name")), _norm(item.get("ifc_class")))
        if not all(key):
            continue
        counts[key] = counts.get(key, 0) + 1
        by_key[key] = item
    return {key: by_key[key] for key, count in counts.items() if count == 1}


def _unique_usd_name_class_pairs(prims: list[dict[str, Any]], used_paths: set[str]) -> dict[tuple[str, str], dict[str, Any]]:
    counts: dict[tuple[str, str], int] = {}
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for prim in prims:
        if prim.get("path") in used_paths:
            continue
        names = [prim.get("name"), _last_path_token(prim.get("path"))]
        classes = [prim.get("ifc_class"), prim.get("type")]
        for name in names:
            for class_name in classes:
                key = (_norm(name), _norm(class_name))
                if not all(key):
                    continue
                counts[key] = counts.get(key, 0) + 1
                by_key[key] = prim
    return {key: by_key[key] for key, count in counts.items() if count == 1}


def _last_path_token(path: str | None) -> str | None:
    if not path:
        return None
    return path.rstrip("/").split("/")[-1]


def _norm(value: object) -> str:
    return str(value or "").strip().lower()


def _derive_usdc_artifact_id(source_artifact_id: str) -> str:
    if "ifc" in source_artifact_id:
        return source_artifact_id.replace("ifc", "usdc")
    return f"{source_artifact_id}_usdc"
