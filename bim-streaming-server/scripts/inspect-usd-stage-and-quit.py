import argparse
from datetime import UTC, datetime
import json
import sys
import traceback
from pathlib import Path


GUID_KEYS = {
    "GlobalId",
    "IfcGUID",
    "ifc_guid",
    "ifcGlobalId",
    "sourceGlobalId",
    "externalId",
    "revitElementId",
}


def main() -> int:
    parser = argparse.ArgumentParser("Inspect USD stage and quit")
    parser.add_argument("--usd-path", required=True)
    parser.add_argument("--output-path", required=True)
    args = parser.parse_args()

    try:
        from pxr import Usd

        stage = Usd.Stage.Open(args.usd_path)
        if stage is None:
            raise RuntimeError(f"USD stage could not be opened: {args.usd_path}")

        prims = []
        for prim in stage.Traverse():
            metadata = _json_safe(prim.GetAllMetadata())
            custom_data = _json_safe(prim.GetCustomData())
            attributes, attribute_candidates = _inspect_attributes(prim)
            guid_candidates = _unique(
                _candidate_values(metadata)
                + _candidate_values(custom_data)
                + attribute_candidates
            )

            prims.append(
                {
                    "path": str(prim.GetPath()),
                    "name": prim.GetName(),
                    "type": prim.GetTypeName(),
                    "active": prim.IsActive(),
                    "metadata": metadata,
                    "customData": custom_data,
                    "attributes": attributes,
                    "guid_candidates": guid_candidates,
                    "identifier_candidates": _identifier_candidates(metadata, custom_data, attributes),
                }
            )

        payload = {
            "usd_path": str(Path(args.usd_path)),
            "generated_at": datetime.now(UTC).isoformat(),
            "root_layer": stage.GetRootLayer().identifier,
            "prim_count": len(prims),
            "prims": prims,
        }
        output_path = Path(args.output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0
    except Exception:
        sys.stderr.write(traceback.format_exc())
        return 1


def _inspect_attributes(prim):
    attributes = []
    candidate_values = []
    for attr in prim.GetAttributes():
        entry = {"name": attr.GetName(), "type": str(attr.GetTypeName())}
        should_read_value = _is_candidate_key(attr.GetName()) or _is_small_scalar_type(str(attr.GetTypeName()))
        if should_read_value:
            try:
                value = _json_safe(attr.Get())
                if value is not None:
                    entry["value"] = value
                    if _is_candidate_key(attr.GetName()):
                        candidate_values.extend(_flatten_candidate_values(value))
            except Exception as exc:
                entry["read_error"] = str(exc)
        attributes.append(entry)
    return attributes, _unique(candidate_values)


def _identifier_candidates(metadata, custom_data, attributes):
    candidates = []
    for source_name, source in (("metadata", metadata), ("customData", custom_data)):
        if isinstance(source, dict):
            for key, value in source.items():
                if _is_candidate_key(key):
                    for candidate in _flatten_candidate_values(value):
                        candidates.append({"source": source_name, "key": key, "value": candidate})
    for attr in attributes:
        key = attr.get("name")
        if _is_candidate_key(key) and "value" in attr:
            for candidate in _flatten_candidate_values(attr["value"]):
                candidates.append({"source": "attribute", "key": key, "value": candidate})
    return candidates


def _candidate_values(value):
    candidates = []
    if isinstance(value, dict):
        for key, item in value.items():
            if _is_candidate_key(key):
                candidates.extend(_flatten_candidate_values(item))
            else:
                candidates.extend(_candidate_values(item))
    elif isinstance(value, list):
        for item in value:
            candidates.extend(_candidate_values(item))
    return candidates


def _flatten_candidate_values(value):
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (int, float)):
        return [str(value)]
    if isinstance(value, list):
        values = []
        for item in value:
            values.extend(_flatten_candidate_values(item))
        return values
    return []


def _is_candidate_key(key):
    if not key:
        return False
    return key in GUID_KEYS or key.lower() in {item.lower() for item in GUID_KEYS} or "guid" in key.lower()


def _is_small_scalar_type(type_name):
    return type_name in {
        "bool",
        "int",
        "uint",
        "int64",
        "uint64",
        "float",
        "double",
        "string",
        "token",
        "asset",
    }


def _json_safe(value, depth=0):
    if depth > 5:
        return str(value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item, depth + 1) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        if len(value) > 64:
            return {"truncated": True, "length": len(value)}
        return [_json_safe(item, depth + 1) for item in value]
    return str(value)


def _unique(values):
    seen = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


if __name__ == "__main__":
    exit_code = main()
    try:
        import omni.kit.app

        omni.kit.app.get_app().post_quit(exit_code)
    except Exception:
        sys.exit(exit_code)
