"""Streaming-owned conversion checks. No purpose grant, ratios, or GPU mutation."""
from collections import Counter
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import tempfile

from conversion_source_fingerprint import (
    attach_source_fingerprint, capture_source, verify_source,
)

VERSION = "conversion-facts-validator/v1"
CONVERTER_VERSION = "host-native-ifc-adapter/v1"
_GUID = re.compile(r"^[A-Za-z0-9_$-]{1,128}$")


def _check(name, state, *reasons):
    return {"id": name, "state": state, "reasonCodes": list(reasons)}


def _source_inventory(ifc_path):
    """Enumerate source products before examining any conversion output."""
    try:
        import ifcopenshell
        from ifcopenshell.util.unit import calculate_unit_scale
    except ImportError:
        return None, [], None, _check("source_inventory", "not_run", "ifc_parser_unavailable")
    try:
        model = ifcopenshell.open(str(ifc_path))
        expected, excluded, seen = {}, [], set()
        for product in model.by_type("IfcProduct"):
            guid = str(product.GlobalId or "")
            if not _GUID.fullmatch(guid) or guid in seen:
                return None, [], None, _check("source_inventory", "fail", "source_identity_invalid")
            seen.add(guid)
            if product.Representation is None:
                excluded.append({"guid": guid, "reason": "non_renderable"})
            else:
                expected[guid] = str(product.is_a())
        assignments = model.by_type("IfcUnitAssignment")
        length_units = [unit for assignment in assignments for unit in assignment.Units
                        if getattr(unit, "UnitType", None) == "LENGTHUNIT"]
        scale = calculate_unit_scale(model) if len(length_units) == 1 else None
        if scale is not None and (not math.isfinite(scale) or scale <= 0):
            scale = None
        return expected, sorted(excluded, key=lambda item: item["guid"]), scale, _check("source_inventory", "pass")
    except Exception:
        return None, [], None, _check("source_inventory", "execution_failed", "ifc_inventory_unavailable")


def _usd_observation(model_path):
    try:
        from pxr import Sdf, Usd, UsdGeom
    except ImportError:
        return None, {}, _check("usd_artifact", "not_run", "usd_parser_unavailable"), _check("mesh_geometry", "not_run")
    try:
        # Do not resolve unvalidated external assets while collecting local facts.
        layer = Sdf.Layer.FindOrOpen(str(model_path))
        if layer is None or layer.GetExternalReferences():
            return None, {}, _check("usd_artifact", "fail", "usd_layer_or_dependencies_invalid"), _check("mesh_geometry", "not_run")
        stage = Usd.Stage.Open(layer, load=Usd.Stage.LoadNone)
        if stage is None:
            raise ValueError("stage")
        mesh_paths, invalid = set(), False
        for prim in stage.Traverse():
            if not prim.IsA(UsdGeom.Mesh):
                continue
            mesh_paths.add(str(prim.GetPath()))
            mesh = UsdGeom.Mesh(prim)
            points = mesh.GetPointsAttr().Get()
            counts = mesh.GetFaceVertexCountsAttr().Get()
            indices = mesh.GetFaceVertexIndicesAttr().Get()
            matrix = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
            if (points is None or len(points) == 0 or counts is None or len(counts) == 0
                    or indices is None or any(n < 3 for n in counts)
                    or sum(counts) != len(indices)
                    or any(i < 0 or i >= len(points) for i in indices)
                    or any(not math.isfinite(float(v)) for point in points for v in point)
                    or any(not math.isfinite(float(matrix[i][j])) for i in range(4) for j in range(4))):
                invalid = True
        unit = float(UsdGeom.GetStageMetersPerUnit(stage)) if stage.HasAuthoredMetadata("metersPerUnit") else None
        axis = str(UsdGeom.GetStageUpAxis(stage)) if stage.HasAuthoredMetadata("upAxis") else None
        if axis not in ("Y", "Z"):
            axis = None
        if unit is not None and (not math.isfinite(unit) or unit <= 0):
            unit = None
        return stage, {"meshPaths": mesh_paths, "metersPerUnit": unit, "upAxis": axis}, \
            _check("usd_artifact", "pass"), \
            _check("mesh_geometry", "fail", "mesh_geometry_invalid") if invalid or not mesh_paths else _check("mesh_geometry", "pass")
    except Exception:
        return None, {}, _check("usd_artifact", "fail", "usd_open_failed"), _check("mesh_geometry", "not_run")


def _mapping_observation(mapping_path, expected, stage, mesh_paths):
    if expected is None or stage is None:
        return None, _check("mapping", "not_run", "mapping_prerequisites_unavailable")
    try:
        mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
        if (not isinstance(mapping, dict) or mapping.get("mock") is not False
                or mapping.get("allow_fake_mapping") is not False
                or mapping.get("mapping_provenance") != "converter_verified"
                or not isinstance(mapping.get("items"), list)):
            raise ValueError("mapping")
        found, used = {}, set()
        for item in mapping["items"]:
            guid, prim_path = item.get("ifc_guid"), item.get("usd_prim_path")
            if (guid not in expected or not isinstance(prim_path, str)
                    or not prim_path.startswith("/") or len(prim_path) > 2048 or prim_path in used):
                raise ValueError("mapping identity")
            prim = stage.GetPrimAtPath(prim_path)
            if not prim.IsValid() or not any(p == prim_path or p.startswith(prim_path + "/") for p in mesh_paths):
                raise ValueError("mapping geometry")
            # A declared GUID is not enough: the USD prim must carry that identity.
            authored = [prim.GetCustomDataByKey(key) for key in ("bim:ifc_guid", "ifc:guid", "ifc_guid", "ifcGlobalId")]
            if guid not in authored:
                raise ValueError("mapping semantic identity")
            used.add(prim_path)
            found.setdefault(guid, []).append(prim_path)
        return [{"guid": guid, "primPaths": sorted(paths)} for guid, paths in sorted(found.items())], _check("mapping", "pass")
    except Exception:
        return None, _check("mapping", "fail", "mapping_correspondence_invalid")


def collect_conversion_facts(ifc_path, model_path, mapping_path, source, model_version_id):
    verify_source(ifc_path, source)
    expected, excluded, scale, source_check = _source_inventory(ifc_path)
    model_before, mapping_before = capture_source(model_path), capture_source(mapping_path)
    stage, usd, artifact_check, geometry_check = _usd_observation(model_path)
    correspondence, mapping_check = _mapping_observation(mapping_path, expected, stage, usd.get("meshPaths", set()))
    converted = {item["guid"] for item in correspondence} if correspondence is not None else None
    missing = [{"guid": guid, "reasonCodes": ["renderable_not_corresponded"]}
               for guid in sorted(set(expected) - converted)] if expected is not None and converted is not None else []
    inventory = {
        "observation": "observed" if expected is not None else "not_run",
        "expectedRenderable": len(expected) if expected is not None else None,
        "convertedRenderable": len(converted) if converted is not None else None,
        "missing": missing, "excluded": excluded,
    }
    by_class = []
    for category, count in sorted(Counter((expected or {}).values()).items()):
        by_class.append({"ifcType": category, "expected": count,
                         "converted": sum(expected[g] == category for g in converted) if converted is not None else None})
    if expected is None or converted is None:
        completeness = _check("inventory_completeness", "unknown", "inventory_or_mapping_unavailable")
    elif not expected:
        completeness = _check("inventory_completeness", "fail", "no_renderable_source")
    elif missing:
        completeness = {**_check("inventory_completeness", "pass_with_limits", "source_components_missing"),
                        "limitations": ["Some source components have no verified rendered correspondence."]}
    else:
        completeness = _check("inventory_completeness", "pass")
    units_known = scale is not None and usd.get("metersPerUnit") is not None and usd.get("upAxis") in ("Y", "Z")
    checks = [source_check, artifact_check, geometry_check, mapping_check, completeness,
              _check("units", "pass" if units_known else "unknown", *([] if units_known else ["units_unavailable"])),
              _check("coordinates", "unknown", "source_output_alignment_not_validated"),
              _check("reference_measurement", "not_run", "reference_and_tolerance_unavailable"),
              _check("ifc_rules", "not_run", "ifc_rule_authority_not_run")]
    verify_source(ifc_path, source)
    verify_source(model_path, model_before)
    verify_source(mapping_path, mapping_before)
    return {
        "schemaVersion": "conversion-validation-facts/v1", "validatorVersion": VERSION,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSha256": source.sha256, "modelVersionId": model_version_id,
        "sourceName": Path(ifc_path).name[:256],
        "artifacts": {"usdcSha256": model_before.sha256, "mappingSha256": mapping_before.sha256},
        "inventory": inventory, "byClass": by_class,
        "expectedElements": [{"guid": guid, "ifcType": kind} for guid, kind in sorted(expected.items())] if expected is not None else None,
        "correspondence": correspondence,
        "units": {"ifcLengthScaleM": scale, "usdMetersPerUnit": usd.get("metersPerUnit"), "upAxis": usd.get("upAxis")},
        "checks": checks,
    }


def attach_conversion_validation(metadata_path, ifc_path, model_path, mapping_path, source, model_version_id):
    facts = collect_conversion_facts(ifc_path, model_path, mapping_path, source, model_version_id)
    attach_source_fingerprint(metadata_path, source, model_version_id)
    metadata_path = Path(metadata_path)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata.setdefault("converter_version", CONVERTER_VERSION)
    metadata["conversion_validation"] = facts
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=metadata_path.parent,
                                         prefix=".validation-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(metadata, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        verify_source(ifc_path, source)
        os.replace(temporary, metadata_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
