"""CFD P2 S0 contract freeze: the three cfd-run-* schemas stay valid, self-consistent and exemplified.

Authority: docs/plans/building-energy-cfd-p2-contract.md §3. These schemas are the payload
truth for streaming /api/cfd-runs (S1) and coordinator /api/cfd/* (S2); implementations must
validate against them, never the other way round.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

CONTRACTS = Path(__file__).resolve().parents[1] / "tests" / "contracts"
SCHEMAS = {
    "request": CONTRACTS / "cfd-run-request-v1.schema.json",
    "result": CONTRACTS / "cfd-run-result-v1.schema.json",
    "ledger": CONTRACTS / "cfd-run-ledger-record-v1.schema.json",
    # S8 settings phase A: options served to the browser form, and the pre-submission estimate.
    "options": CONTRACTS / "cfd-options-v1.schema.json",
    "estimate_request": CONTRACTS / "cfd-estimate-request-v1.schema.json",
    "estimate": CONTRACTS / "cfd-estimate-v1.schema.json",
}
STATUS_VOCAB = ["queued", "preprocessing", "meshing", "solving", "postprocessing", "ready", "failed", "cancelled"]


def _load(name: str) -> dict:
    return json.loads(SCHEMAS[name].read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", sorted(SCHEMAS))
def test_schema_is_valid_draft_2020_12(name: str) -> None:
    schema = _load(name)
    Draft202012Validator.check_schema(schema)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["$id"].endswith(f"/{SCHEMAS[name].name}")


@pytest.mark.parametrize("name", sorted(SCHEMAS))
def test_embedded_examples_validate(name: str) -> None:
    schema = _load(name)
    validator = Draft202012Validator(schema)
    examples = schema.get("examples") or []
    assert examples, f"{name} must ship at least one example"
    for example in examples:
        errors = sorted(validator.iter_errors(example), key=lambda e: list(e.path))
        assert not errors, "\n".join(f"{list(e.path)}: {e.message}" for e in errors)


def test_status_vocabulary_is_shared_and_frozen() -> None:
    result = _load("result")["$defs"]["status"]["enum"]
    ledger = _load("ledger")["$defs"]["status"]["enum"]
    assert result == ledger == STATUS_VOCAB


def test_request_schema_pins_owner_decisions() -> None:
    props = _load("request")["properties"]
    assert props["schema"]["const"] == "cfd-run-request/v1"
    assert props["preprocess"]["properties"]["profile"]["enum"] == ["exterior-wind/v1"]
    assert props["preprocess"]["properties"]["closing_radius_voxels"]["default"] == 4
    assert props["preprocess"]["properties"]["leak_fraction_limit"]["default"] == 0.15
    assert props["wind"]["properties"]["wind_from_degrees"]["maxItems"] == 16
    # The browser never supplies the hash, but the body must carry it once the coordinator filled it in.
    assert "model_usdc_sha256" in props["source"]["required"]


def test_result_schema_pins_purpose_and_appendage_policy() -> None:
    schema = _load("result")
    assert schema["properties"]["purpose"]["const"] == "design_comparison_only"
    assert schema["properties"]["preprocess"]["properties"]["appendage_policy"]["const"] == "included"
    assert schema["properties"]["run_record"]["allOf"][1]["properties"]["schema"]["const"] == "cfd-run-record/v1"
    example = schema["examples"][0]
    assert example["preprocess"]["leak_fraction"] == pytest.approx(0.1198)
    assert example["preprocess"]["sealing_suspect"] is False  # 0.1198 <= 0.15 limit


def test_request_rejects_wrong_shapes() -> None:
    validator = Draft202012Validator(_load("request"))
    good = _load("request")["examples"][0]

    bad_direction = json.loads(json.dumps(good))
    bad_direction["wind"]["wind_from_degrees"] = [0, 360]
    assert any(validator.iter_errors(bad_direction))

    manual_without_value = json.loads(json.dumps(good))
    manual_without_value["wind"]["true_north_source"] = "manual"
    manual_without_value["wind"]["true_north_degrees_manual"] = None
    assert any(validator.iter_errors(manual_without_value))

    extra_field = json.loads(json.dumps(good))
    extra_field["solver"]["gpu"] = True
    assert any(validator.iter_errors(extra_field))


def test_result_overlay_artifact_id_matches_run_and_direction() -> None:
    example = _load("result")["examples"][0]
    for direction in example["directions"]:
        artifact_id = direction["overlay_layer"]["artifact_id"]
        assert artifact_id == f"cfd:{example['run_id']}:w{int(round(direction['wind_from_degrees'])):03d}"


def test_estimate_request_reuses_the_run_request_definitions_verbatim() -> None:
    """An estimate must apply exactly the bounds a submission would (S8): same sub-schemas, no drift."""
    request = _load("request")["properties"]
    estimate = _load("estimate_request")["properties"]
    for section in ("preprocess", "wind", "mesh", "solver"):
        assert estimate[section] == request[section], section
    assert estimate["source"]["properties"]["conversion_job_id"] == request["source"]["properties"]["conversion_job_id"]
    assert "idempotency_key" not in estimate and "requested_by" not in estimate


def test_options_example_bounds_and_standard_preset_match_the_request_schema() -> None:
    """The options document never widens a contract bound, and the standard preset equals the schema defaults."""
    request = _load("request")["properties"]
    example = _load("options")["examples"][0]

    def schema_of(key: str) -> dict:
        section, field = key.split(".", 1)
        return request[section]["properties"][field]

    for field in example["fields"]:
        spec = schema_of(field["key"])
        if "minimum" in spec:
            assert field.get("minimum") == spec["minimum"], field["key"]
        if "exclusiveMinimum" in spec:
            assert field.get("exclusive_minimum") == spec["exclusiveMinimum"], field["key"]
        if "maximum" in spec:
            assert field.get("maximum") == spec["maximum"], field["key"]
        if "enum" in spec:
            assert field.get("enum") == spec["enum"], field["key"]
    standard = next(p for p in example["presets"] if p["preset_id"] == "standard")
    assert standard["verified"] is True
    for key, value in standard["values"].items():
        spec = schema_of(key)
        if "default" in spec:
            assert value == spec["default"], key


def test_estimate_schema_requires_numbers_only_when_available() -> None:
    validator = Draft202012Validator(_load("estimate"))
    available, unavailable = _load("estimate")["examples"][:2]
    broken = dict(available)
    broken.pop("background_cell_m")
    assert list(validator.iter_errors(broken)), "an available estimate must carry background_cell_m"
    mixed = dict(unavailable)
    mixed["totals"] = {"estimated_cells": 1, "estimated_seconds": 1.0, "preprocess_seconds": 0.0}
    assert list(validator.iter_errors(mixed)), "an unavailable estimate must not carry totals"
    assert available["is_estimate"] is True and unavailable["is_estimate"] is True


def test_ledger_origin_s8_fields_are_optional() -> None:
    validator = Draft202012Validator(_load("ledger"))
    record = json.loads(json.dumps(_load("ledger")["examples"][0]))
    # S7 origin with only its required fields, then the S8 additions on top.
    record["origin"] = {"session_id": None, "wind_from_degrees": [0], "uref_m_s": 5.0, "end_time": None, "n_procs": None, "background_cell_m": None}
    assert not list(validator.iter_errors(record))
    record["origin"].update({"zref_m": 10, "z0_m": 0.5, "true_north_source": "manual", "true_north_degrees_manual": 12.5, "preset_match": None})
    assert not list(validator.iter_errors(record))
    record["origin"]["z0_m"] = 0
    assert list(validator.iter_errors(record)), "z0_m keeps the request bound (exclusive minimum 0)"


# --------------------------------------------------------------------------- settings phase B (B1b)

MESSAGING = (Path(__file__).resolve().parents[1] / "bim-streaming-server" / "source" / "extensions"
             / "ezplus.bim_review_stream.messaging" / "ezplus" / "bim_review_stream" / "messaging")
OPENAPI = CONTRACTS / "coordinator-browser-api-v1.openapi.json"
PRE_B_MESH_FIELDS = ("background_cell_m", "surface_refinement_level", "region_refinement_level")


def _cfd_options():
    """cfd_options.py loaded by path: its bounds and preset keys are the streaming side of these contracts."""
    import importlib.util
    import sys

    name = "cfd_options_under_contract"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, MESSAGING / "cfd_options.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module  # dataclasses resolve annotations through sys.modules
        spec.loader.exec_module(module)
    return sys.modules[name]


def test_mesh_fields_agree_across_the_schema_the_bounds_and_the_presets() -> None:
    """A mesh field added in one place only would be rejected (strict objects) or silently dropped elsewhere."""
    options = _cfd_options()
    schema_mesh = _load("request")["properties"]["mesh"]["properties"]
    bounds_mesh = {key.split(".", 1)[1]: spec for key, spec in options.REQUEST_FIELD_BOUNDS.items() if key.startswith("mesh.")}
    assert set(schema_mesh) == set(bounds_mesh)
    for name, spec in schema_mesh.items():
        bounds = bounds_mesh[name]
        assert (spec["minimum"], spec["maximum"]) == (bounds["minimum"], bounds["maximum"]), name
        types = spec["type"] if isinstance(spec["type"], list) else [spec["type"]]
        assert ("null" in types) == bool(bounds.get("nullable")), name
    assert set(options.PRESET_KEYS) <= set(options.REQUEST_FIELD_BOUNDS)


def test_field_key_enumerations_are_one_list() -> None:
    """cfd-options-v1 fieldKey, cfd-estimate-v1 custom_fields and the coordinator zod enum (through the emitted openapi)."""
    options = _cfd_options()
    field_key = _load("options")["$defs"]["fieldKey"]["enum"]
    custom = _load("estimate")["$defs"]["settingsProfile"]["properties"]["custom_fields"]["items"]["enum"]
    zod = json.loads(OPENAPI.read_text(encoding="utf-8"))["components"]["schemas"]["CfdSettingsProfile"]["properties"]["custom_fields"]["items"]["enum"]
    assert field_key == custom == zod == sorted(options.REQUEST_FIELD_BOUNDS)


def test_estimate_unavailable_reasons_are_one_list() -> None:
    """cfd-estimate-v1 reason and the coordinator zod enum (B1b-2 added layout_not_feasible); the viewer's reason texts
    are keyed by the generated type, so its typecheck covers the third copy."""
    schema = [reason for reason in _load("estimate")["properties"]["reason"]["enum"] if reason is not None]
    zod = json.loads(OPENAPI.read_text(encoding="utf-8"))["components"]["schemas"]["CfdEstimate"]["properties"]["reason"]
    zod_reasons = next(option["enum"] for option in zod["anyOf"] if option.get("type") == "string")
    assert "layout_not_feasible" in schema
    assert schema == zod_reasons
    assert None in _load("estimate")["properties"]["reason"]["enum"] and {"type": "null"} in zod["anyOf"]


def _spec_bounds(spec: dict) -> tuple:
    """(types, minimum, maximum) of a JSON-schema or OpenAPI 3.1 property, whichever way it writes nullability."""
    types: set = set()
    minimum = maximum = None
    for option in spec.get("anyOf") or [spec]:
        kind = option.get("type")
        types.update(kind if isinstance(kind, list) else [kind])
        minimum = option.get("minimum", minimum)
        maximum = option.get("maximum", maximum)
    return tuple(sorted(types)), minimum, maximum


def test_coordinator_bounds_match_the_json_schemas() -> None:
    """The coordinator's zod copies of the mesh and ledger-origin bounds, read through the emitted openapi."""
    components = json.loads(OPENAPI.read_text(encoding="utf-8"))["components"]["schemas"]
    request_mesh = _load("request")["properties"]["mesh"]["properties"]
    for component in ("CfdRunCreateRequest", "CfdEstimateRequest"):
        zod_mesh = components[component]["properties"]["mesh"]["properties"]
        assert set(zod_mesh) == set(request_mesh), component
        for name, spec in request_mesh.items():
            assert _spec_bounds(zod_mesh[name]) == _spec_bounds(spec), (component, name)
    ledger_origin = _load("ledger")["properties"]["origin"]["oneOf"][0]["properties"]
    zod_origin = components["CfdRunOrigin"]["properties"]
    for name in request_mesh:
        if name not in PRE_B_MESH_FIELDS:
            assert _spec_bounds(zod_origin[name]) == _spec_bounds(ledger_origin[name]), name


def test_ledger_origin_records_the_layout_fields_within_the_request_bounds() -> None:
    validator = Draft202012Validator(_load("ledger"))
    origin = _load("ledger")["properties"]["origin"]["oneOf"][0]["properties"]
    mesh = _load("request")["properties"]["mesh"]["properties"]
    layout = [name for name in mesh if name not in PRE_B_MESH_FIELDS]
    assert len(layout) == 9
    for name in layout:
        assert (origin[name]["minimum"], origin[name]["maximum"]) == (mesh[name]["minimum"], mesh[name]["maximum"]), name
        assert "null" in origin[name]["type"], name
    record = json.loads(json.dumps(_load("ledger")["examples"][0]))
    record["origin"] = {"session_id": None, "wind_from_degrees": [0], "uref_m_s": 5.0, "end_time": None, "n_procs": None, "background_cell_m": None,
                        **{name: None for name in layout}}
    assert not list(validator.iter_errors(record))
    record["origin"].update({"outer_coarsening_levels": 1, "ground_band_height_h": 0.2, "domain_upstream_h": 3})
    assert not list(validator.iter_errors(record))
    record["origin"]["outer_coarsening_levels"] = 3
    assert list(validator.iter_errors(record)), "outer_coarsening_levels keeps the request bound"
