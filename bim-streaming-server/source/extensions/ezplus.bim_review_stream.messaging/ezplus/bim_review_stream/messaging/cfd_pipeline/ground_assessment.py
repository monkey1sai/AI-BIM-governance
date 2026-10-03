"""Bounded captured-metadata diagnosis; never approve terrain or solved fields."""
from __future__ import annotations

import hashlib
import json
import math
import re

from .ground_surfaces import GroundFaceSelection, _face_identity


def _sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _number(value):
    if type(value) not in (int, float):
        raise ValueError("invalid_numeric_metadata")
    try:
        result = float(value)
    except OverflowError as error:
        raise ValueError("invalid_numeric_metadata") from error
    if not math.isfinite(result):
        raise ValueError("invalid_numeric_metadata")
    return result


def _optional_number(body, key, reasons):
    value = body.get(key)
    if value is None:
        reasons.add(f"{key}_unknown")
        return None
    return _number(value)


def assess_ground_metadata(selection: dict, case: dict, result: dict, exclusions: dict,
                           *, exclusions_sha256: str) -> dict:
    """Compare native captures, with a permanently HELD engineering status.

    Input checksums show local capture integrity, not a fresh USDC, a server
    ledger, mesh association or boundary-file verification. No U/p or USD IO.
    """
    if not all(isinstance(value, dict) for value in (selection, case, result, exclusions)):
        raise ValueError("invalid_metadata_object")
    if selection.get("schema") not in ("ground-selection-preview/v1", "ground-selection-version/v1"):
        raise ValueError("invalid_selection_schema")
    sha = selection.get("model_usdc_sha256")
    selection_sha = selection.get("selection_sha256")
    if (not _sha(sha) or not _sha(selection_sha)
            or selection.get("selection_id") != "ground_" + selection_sha
            or not _sha(exclusions_sha256)):
        raise ValueError("invalid_capture_identity")
    conversion = selection.get("conversion_job_id")
    if not isinstance(conversion, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,200}", conversion) or conversion in (".", ".."):
        raise ValueError("invalid_conversion_identity")
    region = selection.get("region_name")
    if (not isinstance(region, str) or not 1 <= len(region) <= 80 or not region.strip()
            or any(ord(char) < 32 or 127 <= ord(char) <= 159 or 0xd800 <= ord(char) <= 0xdfff for char in region)):
        raise ValueError("invalid_region_name")
    if _number(selection.get("stage_meters_per_unit")) <= 0:
        raise ValueError("invalid_units")
    faces = selection.get("faces")
    if not isinstance(faces, list) or not 1 <= len(faces) <= 100:
        raise ValueError("face_budget_exceeded")
    reasons = {"fresh_model_not_checked", "selection_ledger_not_checked",
               "scenario_ground_geometry_link_unverified", "case_mesh_time_link_unverified",
               "inlet_boundary_files_not_checked", "actual_ground_not_verified",
               "fluid_region_not_verified"}
    seen, vertices, identities, guids = set(), [], [], set()
    for face in faces:
        if not isinstance(face, dict):
            raise ValueError("invalid_face_metadata")
        guid, path, index = face.get("ifc_guid"), face.get("mesh_prim_path"), face.get("polygon_face_index")
        if (not isinstance(guid, str) or not re.fullmatch(r"[0-3][0-9A-Za-z_$]{21}", guid)
                or not isinstance(path, str) or not path.startswith("/World/Elements/") or len(path) > 1024
                or type(index) is not int or not 0 <= index <= 2**31 - 1
                or face.get("model_usdc_sha256") != sha
                or face.get("geometry_representation") != "authored_triangle"):
            raise ValueError("invalid_face_identity")
        points, normal = face.get("vertices_m"), face.get("normal")
        if (not isinstance(points, list) or len(points) != 3
                or any(not isinstance(point, list) or len(point) != 3 for point in points)
                or not isinstance(normal, list) or len(normal) != 3):
            raise ValueError("invalid_face_geometry")
        xyz = [[_number(value) for value in point] for point in points]
        normal = [_number(value) for value in normal]
        if normal[2] <= 0 or abs(math.hypot(*normal) - 1) > 1e-6:
            raise ValueError("invalid_face_normal")
        geometry_sha, face_id = _face_identity(sha, GroundFaceSelection(guid, path, index), xyz, normal)
        if (face.get("geometry_sha256") != geometry_sha or face.get("face_id") != face_id
                or face_id in seen):
            raise ValueError("face_capture_integrity_mismatch")
        seen.add(face_id); guids.add(guid); vertices.extend(xyz)
        identities.append({"face_id": face_id, "geometry_sha256": geometry_sha})
    expected_selection_sha = hashlib.sha256(b"ground-selection/v1\0" + json.dumps(
        [conversion, sha, region, sorted(seen)], sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()
    if expected_selection_sha != selection_sha:
        raise ValueError("selection_capture_integrity_mismatch")
    low, high = min(point[2] for point in vertices), max(point[2] for point in vertices)
    if any(not math.isfinite(z + 1.5) or abs((z + 1.5) - z - 1.5) > 1e-9 for z in (low, high)):
        raise ValueError("relative_height_precision_unsupported")
    if high - low > 1e-6:
        reasons.add("selected_surface_elevation_varies")

    source = result.get("source") or {}
    if not isinstance(source, dict):
        raise ValueError("invalid_result_source")
    source_match = source.get("model_usdc_sha256") == sha and source.get("conversion_job_id") == conversion
    if not source_match:
        reasons.add("result_source_mismatch_or_unknown")
    run_id = result.get("run_id")
    if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,200}", run_id):
        run_id = None
        reasons.add("result_run_id_unknown")
    if result.get("schema") != "cfd-run-result/v1" or result.get("status") != "ready":
        reasons.add("result_schema_or_state_unverified")
    if case.get("schema") != "cfd-case/v1":
        reasons.add("case_schema_unknown")
    params, domain, wind = case.get("params") or {}, case.get("domain") or {}, case.get("wind") or {}
    if not all(isinstance(value, dict) for value in (params, domain, wind)):
        raise ValueError("invalid_case_metadata")
    ground = _optional_number(params, "ground_z_m", reasons)
    height = _optional_number(case, "pedestrian_plane_height_m", reasons)
    plane = _optional_number(case, "pedestrian_plane_z_m", reasons)
    bottom = _optional_number(domain, "zmin", reasons)
    inflow = {key: _optional_number(params, key, reasons) for key in ("uref_m_s", "zref_m", "z0_m")}
    if any(value is not None and value <= 0 for value in inflow.values()):
        reasons.add("inlet_parameters_nonpositive")
    if height is not None and abs(height - 1.5) > 1e-6:
        reasons.add("pedestrian_height_not_1p5m")
    if ground is not None and bottom is not None and abs(ground - bottom) > 1e-6:
        reasons.add("domain_ground_mismatch")
    if ground is not None and height is not None and plane is not None and abs(plane - ground - height) > 1e-6:
        reasons.add("pedestrian_plane_metadata_mismatch")
    if ground is not None and max(abs(low - ground), abs(high - ground)) > 1e-6:
        reasons.add("flat_ground_differs_from_selected_surface")
    alpha = _optional_number(wind, "solver_rotation_alpha_rad", reasons)
    vector = wind.get("wind_vector_model_xy")
    if vector is None:
        reasons.add("wind_vector_model_xy_unknown")
    elif not isinstance(vector, list) or len(vector) != 2:
        raise ValueError("invalid_wind_vector")
    else:
        vector = [_number(value) for value in vector]
        if alpha is not None:
            x = math.cos(alpha) * vector[0] - math.sin(alpha) * vector[1]
            y = math.sin(alpha) * vector[0] + math.cos(alpha) * vector[1]
            if abs(x - 1) > 1e-8 or abs(y) > 1e-8:
                reasons.add("model_solver_rotation_inconsistent")
    items = exclusions.get("items")
    if not isinstance(items, list) or len(items) > 20000:
        raise ValueError("exclusion_budget_or_shape")
    if exclusions.get("schema") != "cfd-exclusion-list/v1":
        reasons.add("exclusion_schema_unknown")
    if exclusions.get("source_model_usdc_sha256") != sha:
        reasons.add("exclusion_source_mismatch_or_unknown")
    declared_exclusions = result.get("exclusions") or {}
    if not isinstance(declared_exclusions, dict):
        raise ValueError("invalid_exclusion_reference")
    if declared_exclusions.get("sha256") != exclusions_sha256:
        reasons.add("exclusion_capture_hash_mismatch_or_unknown")
    if any(not isinstance(item, dict) for item in items):
        raise ValueError("invalid_exclusion_item")
    excluded_selected = sorted(guids.intersection(item.get("ifc_guid") for item in items
                                                if isinstance(item.get("ifc_guid"), str)))
    if excluded_selected:
        reasons.add("selected_component_excluded_from_preprocess")
    difference = None if plane is None else [_number(plane - (high + 1.5)), _number(plane - (low + 1.5))]
    return {"schema": "cfd-ground-metadata-assessment/v1", "status": "HELD",
            "authority": "local_metadata_capture_only", "reasons": sorted(reasons),
            "selection_id": selection["selection_id"], "model_usdc_sha256": sha,
            "conversion_job_id": conversion, "run_id": run_id, "result_source_matches": source_match,
            "selected_source_faces": sorted(identities, key=lambda item: item["face_id"]),
            "selected_surface_z_range_m": [low, high],
            "relative_target_z_range_m": [_number(low + 1.5), _number(high + 1.5)],
            "case_declared": {"ground_z_m": ground, "sampling_plane_z_m": plane,
                              "pedestrian_height_m": height, "domain_zmin_m": bottom, **inflow,
                              "model_to_solver": {"kind": "rotation_about_z", "alpha_rad": alpha,
                                                  "wind_vector_model_xy": vector}},
            "old_plane_minus_relative_target_range_m": difference,
            "excluded_selected_guids": excluded_selected,
            "fresh_model_checked": False, "inlet_boundary_files_checked": False,
            "actual_ground_verified": False, "fluid_region_verified": False,
            "velocity_sampled": False, "solver_started": False}
