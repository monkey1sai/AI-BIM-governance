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
