"""Read only fixed native metadata snapshots; no mesh, boundary or solved fields."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re

from .case_run import direction_tag
from .ground_assessment import assess_ground_metadata


class GroundMetadataError(ValueError):
    def __init__(self, code, status=409):
        super().__init__(code)
        self.status = status


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate_key")
            result[key] = value
        return result
    def constant(_):
        raise ValueError("nonfinite_json")
    try:
        value = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
        # Reject exponent overflow too (JSON's 1e999 is not a parse_constant).
        json.dumps(value, allow_nan=False)
        if not isinstance(value, dict):
            raise ValueError("object_required")
        stack = [(value, 0)]
        while stack:
            item, depth = stack.pop()
            if depth > 64:
                raise ValueError("metadata_depth")
            if isinstance(item, dict):
                stack.extend((child, depth + 1) for child in item.values())
            elif isinstance(item, list):
                stack.extend((child, depth + 1) for child in item)
        return value
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        raise GroundMetadataError("ground_metadata_invalid_json") from None


def validate_assessment_request(body):
    if (not isinstance(body, dict) or set(body) != {"source_run_id", "wind_from_degrees"}
            or not isinstance(body["source_run_id"], str)
            or not re.fullmatch(r"cfd_[A-Za-z0-9_]{6,120}", body["source_run_id"])
            or type(body["wind_from_degrees"]) not in (int, float)):
        raise GroundMetadataError("invalid_request", 400)
    try:
        degrees = float(body["wind_from_degrees"])
    except (ValueError, OverflowError):
        raise GroundMetadataError("invalid_request", 400) from None
    if not math.isfinite(degrees) or not 0 <= degrees < 360:
        raise GroundMetadataError("invalid_request", 400)
    return body["source_run_id"], degrees


def metadata_bytes(folder, relative):
    path = (folder / relative).resolve()
    if not path.is_relative_to(folder):
        raise GroundMetadataError("ground_metadata_path_violation")
    try:
        with path.open("rb") as handle:
            raw = handle.read(2 * 1024 * 1024 + 1)
    except FileNotFoundError:
        raise GroundMetadataError("ground_metadata_missing", 404) from None
    except OSError:
        raise GroundMetadataError("ground_metadata_unavailable", 502) from None
    if len(raw) > 2 * 1024 * 1024:
        raise GroundMetadataError("ground_metadata_too_large", 413)
    return raw


def revalidate_ground_run_metadata(root, run_id, native):
    folder = (Path(root).resolve() / run_id).resolve()
    if folder != Path(root).resolve() / run_id:
        raise GroundMetadataError("ground_metadata_path_violation")
    files = {"run_status": "run.json", "result": "result.json", "run_record": "run_record.json",
             "exclusions": "exclusions.json", "case_metadata": f"case_{native['direction_tag']}/case_meta.json"}
    for key, expected in native["hashes"].items():
        if hashlib.sha256(metadata_bytes(folder, files[key])).hexdigest() != expected:
            raise GroundMetadataError("ground_run_changed")


def read_ground_run_metadata(root, run_id, degrees, source):
    """Native result -> aggregate -> unique ready case hash chain, bounded IO.

    Missing legacy hash links remain unknown; a declared but wrong hash is an
    integrity error. Never read a case that has no proven metadata link.
    """
    run_id, degrees = validate_assessment_request({"source_run_id": run_id, "wind_from_degrees": degrees})
    root = Path(root).resolve()
    folder = (root / run_id).resolve()
    if folder != root / run_id:
        raise GroundMetadataError("ground_metadata_path_violation")
    hashes = {}

    def read(name, relative):
        raw = metadata_bytes(folder, relative)
        doc = strict_json(raw)
        hashes[name] = hashlib.sha256(raw).hexdigest()
        return doc

    def same_source(doc):
        if not isinstance(doc, dict) or any(doc.get(key) != source[key] for key in source):
            raise GroundMetadataError("ground_run_source_mismatch")

    run = read("run_status", "run.json")
    if run.get("run_id") != run_id:
        raise GroundMetadataError("ground_run_identity_mismatch")
    if run.get("status") != "ready":
        raise GroundMetadataError("ground_run_not_ready")
    request = run.get("request")
    if not isinstance(request, dict):
        raise GroundMetadataError("ground_run_source_mismatch")
    same_source(request.get("source"))
    result = read("result", "result.json")
    if result.get("schema") != "cfd-run-result/v1" or result.get("run_id") != run_id or result.get("status") != "ready":
        raise GroundMetadataError("ground_run_identity_mismatch")
    same_source(result.get("source"))

    def direction(doc):
        values = doc.get("directions")
        if not isinstance(values, list) or len(values) > 16:
            raise GroundMetadataError("ground_direction_invalid")
        found = [item for item in values if isinstance(item, dict)
                 and type(item.get("wind_from_degrees")) in (int, float)
                 and item["wind_from_degrees"] == degrees]
        if len(found) != 1 or found[0].get("status") != "ready":
            raise GroundMetadataError("ground_direction_not_unique_ready")
        return found[0]

    requested = request.get("wind", {}).get("wind_from_degrees") if isinstance(request.get("wind"), dict) else None
    if not isinstance(requested, list) or sum(type(value) in (int, float) and value == degrees for value in requested) != 1:
        raise GroundMetadataError("ground_direction_invalid")
    target = direction(result)
    tag = direction_tag(degrees)
    artifact = target.get("overlay_layer")
    if not isinstance(artifact, dict) or artifact.get("artifact_id") != f"cfd:{run_id}:{tag}":
        raise GroundMetadataError("ground_direction_invalid")
    for item in result["directions"]:
        if not isinstance(item, dict) or type(item.get("wind_from_degrees")) not in (int, float):
            raise GroundMetadataError("ground_direction_invalid")
        angle = item["wind_from_degrees"]
        if not math.isfinite(angle) or not 0 <= angle < 360:
            raise GroundMetadataError("ground_direction_invalid")
        if angle != degrees and direction_tag(angle) == tag:
            raise GroundMetadataError("ground_direction_tag_collision")

    links = {"run_record": "unknown", "case_metadata": "unknown", "exclusions": "unknown"}

    def checked_reference(key, filename):
        reference = result.get(key)
        if reference is None:
            return None
        if not isinstance(reference, dict) or reference.get("filename") != filename:
            raise GroundMetadataError("ground_metadata_reference_invalid")
        expected = reference.get("sha256")
        if expected is None:
            return None
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise GroundMetadataError("ground_metadata_reference_invalid")
        doc = read(key, filename)
        if hashes[key] != expected:
            raise GroundMetadataError("ground_metadata_hash_mismatch")
        links[key] = "verified"
        return doc

    record = checked_reference("run_record", "run_record.json")
    exclusions = checked_reference("exclusions", "exclusions.json")
    if exclusions is not None and (exclusions.get("schema") != "cfd-exclusion-list/v1"
                                  or exclusions.get("source_model_usdc_sha256") != source["model_usdc_sha256"]):
        raise GroundMetadataError("ground_run_source_mismatch")
    case = None
    if record is not None:
        if record.get("schema") != "cfd-run-record/v1" or record.get("run_id") != run_id:
            raise GroundMetadataError("ground_run_identity_mismatch")
        same_source(record.get("source"))
        matched = direction(record)
        outputs = matched.get("outputs")
        if outputs is not None and not isinstance(outputs, dict):
            raise GroundMetadataError("ground_metadata_reference_invalid")
        reference = (outputs or {}).get("case_case_meta.json")
        if reference is not None:
            if not isinstance(reference, dict):
                raise GroundMetadataError("ground_metadata_reference_invalid")
            expected = reference.get("sha256")
            if expected is not None:
                if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
                    raise GroundMetadataError("ground_metadata_reference_invalid")
                case = read("case_metadata", f"case_{tag}/case_meta.json")
                if hashes["case_metadata"] != expected:
                    raise GroundMetadataError("ground_metadata_hash_mismatch")
                if case.get("schema") != "cfd-case/v1":
                    raise GroundMetadataError("ground_case_schema_invalid")
                params = case.get("params")
                if not isinstance(params, dict) or type(params.get("wind_from_degrees")) not in (int, float) or params["wind_from_degrees"] != degrees:
                    raise GroundMetadataError("ground_direction_invalid")
                links["case_metadata"] = "verified"
    native = {"result": result, "case": case, "exclusions": exclusions, "links": links,
              "hashes": hashes, "direction_tag": tag}
    revalidate_ground_run_metadata(root, run_id, native)
    return native


def build_service_assessment(selection, native, degrees):
    sha = selection["model_usdc_sha256"]
    exclusions = native["exclusions"] or {"schema": "cfd-exclusion-list/v1", "source_model_usdc_sha256": sha, "items": []}
    diagnosis = assess_ground_metadata(selection, native["case"] or {}, native["result"], exclusions,
                                       exclusions_sha256=native["hashes"].get("exclusions", "0" * 64))
    reasons = set(diagnosis["reasons"]) - {"fresh_model_not_checked"}
    for link, status in native["links"].items():
        if status == "unknown":
            reasons.add(f"{link}_link_unknown")
    fields = ("selected_source_faces", "selected_surface_z_range_m", "relative_target_z_range_m", "case_declared",
              "old_plane_minus_relative_target_range_m", "excluded_selected_guids")
    return {"schema": "cfd-ground-service-assessment/v1", "status": "HELD", "authority": "source_bound_metadata_only",
            "selection_id": selection["selection_id"], "selection_sha256": selection["selection_sha256"],
            "conversion_job_id": selection["conversion_job_id"], "model_usdc_sha256": sha,
            "source_run_id": native["result"]["run_id"], "wind_from_degrees": degrees, "direction_tag": native["direction_tag"],
            "checks": {"fresh_source_verified": True, "fresh_faces_verified": True, "selection_ledger_verified": False,
                       **{f"{key}_link": value for key, value in native["links"].items()}},
            "metadata_sha256": {key: native["hashes"].get(key) for key in ("run_status", "result", "run_record", "case_metadata", "exclusions")},
            "reasons": sorted(reasons), **{key: diagnosis[key] for key in fields},
            "inlet_boundary_files_checked": False, "actual_ground_verified": False, "fluid_region_verified": False,
            "velocity_sampled": False, "solver_started": False}
