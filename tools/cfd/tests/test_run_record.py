from __future__ import annotations

import json

from bimcfd.run_record import REQUIRED_TOP_LEVEL, SCHEMA, build_run_record, sha256_of, validate_run_record, write_run_record


def test_run_record_binds_inputs_and_outputs_by_hash(tmp_path):
    model = tmp_path / "model.usdc"
    model.write_bytes(b"usdc")
    mapping = tmp_path / "element_mapping.json"
    mapping.write_text("{}", encoding="utf-8")
    exclusions = tmp_path / "exclusions.json"
    exclusions.write_text("{}", encoding="utf-8")
    layer = tmp_path / "cfd_run.usdc"
    layer.write_bytes(b"layer")

    inputs = dict(
        run_id="run1",
        operator="tester",
        model_usdc=model,
        sidecar_paths={"element_mapping": mapping, "missing": tmp_path / "nope.json"},
        source_ifc_sha256="abc",
        conversion_reference="conversion/2026",
        geo_reference={"available": False, "true_north_degrees": 0.0, "true_north_source": "x", "warnings": ["geo_reference_missing"], "site": {"ref_latitude_degrees": 1}},
        preprocess_stats={"profile": {"profile_id": "exterior-wind/v1"}, "effective": {"voxel_pitch_m": 0.5}, "element_count_total": 3, "element_count_kept": 2, "excluded_by_reason": {"outlier": 1}, "shell": {"watertight": True}},
        exclusions_path=exclusions,
        case_meta={"wind": {"wind_from_degrees": 0}, "assumptions": [], "domain": {}, "background_mesh": {}, "params": {"surface_refinement_level": 2, "region_refinement_level": 1, "turbulence_model": "kOmegaSST", "end_time": 300, "n_procs": 8}, "initial_conditions": {}},
        check_mesh={"cells": 10, "mesh_ok": True},
        solver_run={"image": "img", "image_digest": "img@sha256:deadbeef", "exit_code": 0, "elapsed_seconds": 1.0},
        solver_info={"iterations": 300, "final_initial_residuals": {"p": 1e-4}},
        simple_log={"converged_by_residual_control": False, "fatal_error": False},
        weather={"epw_sha256": None, "uref_m_s": 5.0},
        output_files={"result_layer": layer},
    )
    record = build_run_record(**inputs)

    assert validate_run_record(record) == []
    assert record["schema"] == SCHEMA
    assert set(REQUIRED_TOP_LEVEL) <= set(record)
    assert record["source"]["model_usdc"]["sha256"] == sha256_of(model)
    assert "element_mapping" in record["source"]["sidecars"]
    assert "missing" not in record["source"]["sidecars"]
    assert record["preprocess"]["exclusion_list"]["sha256"] == sha256_of(exclusions)
    assert record["outputs"]["result_layer"]["sha256"] == sha256_of(layer)
    assert record["geo_reference"]["site_geolocation_present"] is True
    assert record["solver"]["image_digest"] == "img@sha256:deadbeef"
    assert record["purpose"] == "design_comparison_only"

    path = write_run_record(record, tmp_path / "run_record.json")
    assert json.loads(path.read_text(encoding="utf-8"))["run_id"] == "run1"

    # A case written before settings phase B has none of the layout keys; the record reads them as absent.
    assert record["case"]["refinement"]["outer_coarsening_levels"] is None and record["case"]["cost732_deviations"] is None
    regions = [{"name": "refinementBox", "min": [0, 0, 0], "max": [1, 1, 1], "level": 2},
               {"name": "coarseningShell1", "min": [-1, -1, 0], "max": [2, 2, 2], "level": 1}]
    params = {**inputs["case_meta"]["params"], "refinement_box_mode": "isotropic", "refinement_box_scale": 1.5,
              "outer_coarsening_levels": 1, "coarsening_shell_h": 1.0, "ground_band_height_h": None}
    case_meta = {**inputs["case_meta"], "params": params, "refinement_regions": regions, "surface_refinement_level_effective": 3,
                 "cost732_deviations": ["upstream_below_5H"]}
    refined = build_run_record(**{**inputs, "case_meta": case_meta})
    assert refined["case"]["refinement"] == {
        "surface_level": 2, "region_level": 1, "box_mode": "isotropic", "box_scale": 1.5, "outer_coarsening_levels": 1,
        "coarsening_shell_h": 1.0, "ground_band_height_h": None, "surface_level_effective": 3, "regions": regions}
    assert refined["case"]["cost732_deviations"] == ["upstream_below_5H"]


def test_validation_flags_missing_digest():
    record = {"schema": SCHEMA, **{key: {} for key in REQUIRED_TOP_LEVEL if key != "schema"}}
    problems = validate_run_record(record)
    assert "missing:source.model_usdc.sha256" in problems
    assert "missing:solver.image_digest" in problems
