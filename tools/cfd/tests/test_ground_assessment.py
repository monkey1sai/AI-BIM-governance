"""Metadata cannot confer ground, mesh, boundary, field or solver authority."""
import copy
import hashlib
import json
import math

import numpy as np
import pytest

from bimcfd.cli import main
from bimcfd.ground_assessment import assess_ground_metadata
from bimcfd.ground_surfaces import GroundFaceSelection, _face_identity


SHA, GUID = "a" * 64, "0000000000000000000000"


def bind_selection(selection):
    digest = hashlib.sha256(b"ground-selection/v1\0" + json.dumps([
        selection["conversion_job_id"], selection["model_usdc_sha256"], selection["region_name"],
        sorted(face["face_id"] for face in selection["faces"])],
        ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    selection.update(selection_sha256=digest, selection_id="ground_" + digest)


def captures(flat=False):
    xyz = [[0., 0., 0. if flat else -.87], [2., 0., 0. if flat else -.5], [0., 2., 0. if flat else -.8]]
    normal = np.cross(np.subtract(xyz[1], xyz[0]), np.subtract(xyz[2], xyz[0]))
    normal = (normal / np.linalg.norm(normal)).tolist()
    identity = GroundFaceSelection(GUID, "/World/Elements/IfcSite/G_" + GUID + "/Body_000", 14)
    geom, face_id = _face_identity(SHA, identity, xyz, normal)
    selection = {"schema": "ground-selection-version/v1", "region_name": "原面診斷區",
                 "conversion_job_id": "conversion_1", "model_usdc_sha256": SHA,
                 "stage_meters_per_unit": 1, "actual_ground_verified": False, "faces": [{
                     "ifc_guid": GUID, "mesh_prim_path": identity.mesh_prim_path, "polygon_face_index": 14,
                     "vertices_m": xyz, "normal": normal, "face_id": face_id, "geometry_sha256": geom,
                     "model_usdc_sha256": SHA, "geometry_representation": "authored_triangle"}]}
    bind_selection(selection)
    case = {"schema": "cfd-case/v1", "params": {"ground_z_m": 0, "uref_m_s": 5, "zref_m": 10, "z0_m": .1},
            "domain": {"zmin": 0}, "pedestrian_plane_height_m": 1.5, "pedestrian_plane_z_m": 1.5,
            "wind": {"wind_vector_model_xy": [0, -1], "solver_rotation_alpha_rad": math.pi / 2}}
    exclusions = {"schema": "cfd-exclusion-list/v1", "source_model_usdc_sha256": SHA,
                  "items": [] if flat else [{"ifc_guid": GUID, "ifc_type": "IfcSite", "reason": "class_excluded"}]}
    exclusion_sha = hashlib.sha256(json.dumps(exclusions).encode()).hexdigest()
    result = {"schema": "cfd-run-result/v1", "status": "ready", "run_id": "run_1",
              "source": {"model_usdc_sha256": SHA, "conversion_job_id": "conversion_1"},
              "exclusions": {"sha256": exclusion_sha}, "private_url": "must_not_be_copied"}
    return selection, case, result, exclusions, exclusion_sha


def assess(data):
    return assess_ground_metadata(*data[:4], exclusions_sha256=data[4])


def test_observed_negative_terrain_gap_and_exclusion_are_reported():
    report = assess(captures())
    assert report["status"] == "HELD"
    assert report["result_source_matches"] is True
    assert report["old_plane_minus_relative_target_range_m"] == pytest.approx([.5, .87])
    assert report["relative_target_z_range_m"] == pytest.approx([.63, 1.])
    assert report["excluded_selected_guids"] == [GUID]
    assert {"selected_surface_elevation_varies", "selected_component_excluded_from_preprocess",
            "flat_ground_differs_from_selected_surface"}.issubset(report["reasons"])
    assert "model_solver_rotation_inconsistent" not in report["reasons"]
    assert "private_url" not in json.dumps(report)


def test_matching_flat_metadata_even_with_claimed_approvals_stays_held():
    data = captures(flat=True)
    data[0]["actual_ground_verified"] = True
    data[1]["fluid_region_verified"] = True
    report = assess(data)
    assert report["status"] == "HELD"
    assert "flat_ground_differs_from_selected_surface" not in report["reasons"]
    assert report["old_plane_minus_relative_target_range_m"] == [0, 0]
    assert {"fresh_model_not_checked", "selection_ledger_not_checked", "case_mesh_time_link_unverified",
            "inlet_boundary_files_not_checked", "fluid_region_not_verified"}.issubset(report["reasons"])
    for key in ("fresh_model_checked", "inlet_boundary_files_checked", "actual_ground_verified",
                "fluid_region_verified", "velocity_sampled", "solver_started"):
        assert report[key] is False


@pytest.mark.parametrize("mutation", ["region", "conversion", "valid_new_geometry_old_version"])
def test_selection_checksum_binds_region_conversion_and_faces(mutation):
    data = captures()
    if mutation == "region": data[0]["region_name"] += "已變更"
    elif mutation == "conversion": data[0]["conversion_job_id"] += "_other"
    else:
        face = data[0]["faces"][0]
        for point in face["vertices_m"]: point[2] += .1
        face["geometry_sha256"], face["face_id"] = _face_identity(SHA, GroundFaceSelection(
            GUID, face["mesh_prim_path"], face["polygon_face_index"]), face["vertices_m"], face["normal"])
    with pytest.raises(ValueError, match="selection_capture_integrity_mismatch"):
        assess(data)


def test_native_sorted_face_selection_hash_and_output_ignore_capture_order():
    data = captures()
    second = copy.deepcopy(data[0]["faces"][0])
    second["polygon_face_index"] = 45
    second["geometry_sha256"], second["face_id"] = _face_identity(SHA, GroundFaceSelection(
        GUID, second["mesh_prim_path"], 45), second["vertices_m"], second["normal"])
    data[0]["faces"].append(second)
    bind_selection(data[0])
    expected = assess(data)
    data[0]["faces"].reverse()
    assert assess(data) == expected


@pytest.mark.parametrize("which,field,value,reason", [
    (2, "source", {}, "result_source_mismatch_or_unknown"),
    (2, "schema", "legacy", "result_schema_or_state_unverified"),
    (2, "status", "running", "result_schema_or_state_unverified"),
    (2, "run_id", "../../private", "result_run_id_unknown"),
    (2, "exclusions", {}, "exclusion_capture_hash_mismatch_or_unknown"),
    (3, "source_model_usdc_sha256", "c" * 64, "exclusion_source_mismatch_or_unknown"),
    (1, "params", {}, "ground_z_m_unknown"),
    (1, "domain", {"zmin": -1}, "domain_ground_mismatch"),
    (1, "pedestrian_plane_z_m", 2, "pedestrian_plane_metadata_mismatch"),
    (1, "pedestrian_plane_height_m", 2, "pedestrian_height_not_1p5m"),
    (1, "wind", {"wind_vector_model_xy": [0, -1], "solver_rotation_alpha_rad": 0}, "model_solver_rotation_inconsistent"),
    (1, "wind", {}, "solver_rotation_alpha_rad_unknown"),
])
def test_legacy_unknown_or_inconsistent_is_held(which, field, value, reason):
    data = captures()
    data[which][field] = value
    assert reason in assess(data)["reasons"]


@pytest.mark.parametrize("mutation", ["vertices", "face_hash", "duplicate", "oversize", "normal", "face_source",
                                    "bool_index", "bool_number", "nonfinite", "nested_shape", "selection_id"])
def test_invalid_capture_cannot_generate_a_diagnostic(mutation):
    data = captures()
    face = data[0]["faces"][0]
    if mutation == "vertices": face["vertices_m"][0][2] += .1
    elif mutation == "face_hash": face["face_id"] = "c" * 64
    elif mutation == "duplicate": data[0]["faces"].append(copy.deepcopy(face))
    elif mutation == "oversize": data[0]["faces"] *= 101
    elif mutation == "normal": face["normal"] = [0, 0, 0]
    elif mutation == "face_source": face["model_usdc_sha256"] = "c" * 64
    elif mutation == "bool_index": face["polygon_face_index"] = True
    elif mutation == "bool_number": data[1]["params"]["ground_z_m"] = True
    elif mutation == "nonfinite": data[1]["params"]["uref_m_s"] = float("nan")
    elif mutation == "nested_shape": face["vertices_m"] = [[0]]
    else: data[0]["selection_id"] = "ground_" + "c" * 64
    with pytest.raises(ValueError): assess(data)


def cli_files(tmp_path):
    data = captures()
    args = ["ground-assess"]
    for name, doc in zip(("selection", "case-meta", "result", "exclusions"), data[:4]):
        path = tmp_path / (name + ".json")
        path.write_text(json.dumps(doc), encoding="utf-8")
        args += ["--" + name, str(path)]
    return args + ["--out", str(tmp_path / "assessment.json")]


def test_cli_no_solver_fields_model_read_or_overwrite(tmp_path, monkeypatch, capsys):
    import subprocess
    from bimcfd import ground_surfaces
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: pytest.fail("process/solver started"))
    monkeypatch.setattr(ground_surfaces, "_source_stage", lambda *a, **k: pytest.fail("USD read"))
    args = cli_files(tmp_path)
    inputs = {p: p.read_bytes() for p in tmp_path.iterdir()}
    assert main(args) == 2
    report = json.loads((tmp_path / "assessment.json").read_bytes())
    assert report["status"] == "HELD"
    for key, option in (("selection", "selection"), ("case_meta", "case-meta"), ("result", "result"), ("exclusions", "exclusions")):
        path = next(p for p in inputs if p.name == option + ".json")
        assert report["input_sha256"][key] == hashlib.sha256(inputs[path]).hexdigest()
    original = (tmp_path / "assessment.json").read_bytes()
    assert main(args) == 4
    assert (tmp_path / "assessment.json").read_bytes() == original
    args[-1] = args[2]
    assert main(args) == 4
    for p, raw in inputs.items(): assert p.read_bytes() == raw
    assert "must_not_be_copied" not in capsys.readouterr().out


@pytest.mark.parametrize("raw", [b'{"faces":[],"faces":[]}', b'{"x":NaN}', b'{"x":Infinity}',
                                b'[' * 2000 + b']' * 2000, b' ' * (2 * 1024 * 1024 + 1), b'\xff'],
                         ids=["duplicate", "nan", "infinity", "depth", "oversize", "encoding"])
def test_cli_bad_json_fails_without_output(tmp_path, raw):
    args = cli_files(tmp_path)
    (tmp_path / "selection.json").write_bytes(raw)
    assert main(args) == 4
    assert not (tmp_path / "assessment.json").exists()


def test_real_module_entrypoint_is_deterministic_and_not_pass(tmp_path):
    import subprocess
    import sys
    from pathlib import Path
    args = cli_files(tmp_path)
    assert main(args) == 2
    expected = (tmp_path / "assessment.json").read_bytes()
    args[-1] = str(tmp_path / "second.json")
    completed = subprocess.run([sys.executable, "-m", "bimcfd", *args],
                               cwd=Path(__file__).resolve().parents[1], capture_output=True, timeout=20)
    assert completed.returncode == 2, completed.stderr.decode()
    assert (tmp_path / "second.json").read_bytes() == expected
