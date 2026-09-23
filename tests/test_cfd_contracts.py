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
