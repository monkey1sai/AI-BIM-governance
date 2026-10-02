"""CP9a frozen payload shape, embedding and canonical reference bytes."""
import hashlib
import json
import copy
from pathlib import Path

from jsonschema import Draft202012Validator

CONTRACTS = Path(__file__).parent / "contracts"


def read(name):
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def test_context_embedded_schema_matches_standalone():
    schema = read("cfd-context-v1.schema.json")
    Draft202012Validator.check_schema(schema)
    shape = {key: value for key, value in schema.items() if key not in ("$schema", "$id", "title", "description")}
    assert read("cfd-run-request-v1.schema.json")["$defs"]["context"] == shape
    estimate_shape = {key: value for key, value in read("cfd-estimate-request-v1.schema.json")["properties"]["context"].items() if key != "description"}
    assert estimate_shape == shape


def test_context_reference_vector_and_run_compatibility():
    vector = read("fixtures/cfd-context-canonical-v1.json")
    assert hashlib.sha256(vector["canonical_ascii"].encode("ascii")).hexdigest() == vector["canonical_sha256"]
    context = {**read("fixtures/cfd-context-v1.json"), "canonical_sha256": vector["canonical_sha256"]}
    Draft202012Validator(read("cfd-context-v1.schema.json")).validate(context)
    run_schema = read("cfd-run-request-v1.schema.json")
    validator = Draft202012Validator(run_schema)
    legacy = run_schema["examples"][0]
    validator.validate(legacy)
    validator.validate({**legacy, "context": context})
    assert not validator.is_valid({**legacy, "context": {**context, "unknown": True}})
    assert not validator.is_valid({**legacy, "context": {**context, "masses": context["masses"] * 51}})
    estimate_schema = read("cfd-estimate-request-v1.schema.json")
    Draft202012Validator(estimate_schema).validate({**estimate_schema["examples"][0], "context": context})


def test_context_geometry_openapi_and_frozen_response_have_exact_mesh_bounds():
    from referencing import Registry, Resource
    components = read("coordinator-browser-api-v1.openapi.json")["components"]["schemas"]
    registry = Registry().with_resource("urn:schemas", Resource.from_contents({"$schema": "https://json-schema.org/draft/2020-12/schema", "components": {"schemas": components}}))
    openapi_validator = Draft202012Validator({"$ref": "urn:schemas#/components/schemas/CfdContextGeometry"}, registry=registry)
    frozen_validator = Draft202012Validator(read("cfd-estimate-v1.schema.json")["properties"]["context_geometry"])
    value = {"schema": "cfd-context-geometry/v1", "canonical_sha256": "a"*64, "model_usdc_sha256": "b"*64,
             "geometry_sha256": "c"*64, "source_frame": {"up_axis": "Z", "meters_per_unit": 1}, "units": "m", "precision": "binary32",
             "mass_count": 1, "masses": [{"id": "mass", "vertices_m": [[0, 0, 0]]*8, "faces": [[0, 1, 2]]*12, "max_rounding_error_m": 0}],
             "max_rounding_error_m": 0, "bbox_m": {"min": [0, 0, 0], "max": [1, 1, 1]}, "solver_submission_enabled": False, "limitations": []}
    for validator in [openapi_validator, frozen_validator]:
        validator.validate(value)
        for key, replacement in [("vertices_m", [[0, 0]]*8), ("vertices_m", [[0, 0, 0]]*7), ("faces", [[0, 1, 8]]*12)]:
            invalid = copy.deepcopy(value)
            invalid["masses"][0][key] = replacement
            assert not validator.is_valid(invalid), key
        assert not validator.is_valid({**value, "solver_submission_enabled": True})


def test_openapi_and_runtime_publish_exact_triples_and_scalar_note_limit():
    components = read("coordinator-browser-api-v1.openapi.json")["components"]["schemas"]
    for name in ("CfdContext", "CfdContextDraft"):
        shape = components[name]
        validator = Draft202012Validator(shape)
        valid = {**read("fixtures/cfd-context-v1.json"), "canonical_sha256": "a" * 64}
        validator.validate(valid)
        for field, values in (("position_m", [[], [1, 2], [1, 2, 3, 4]]), ("dimensions_m", [[], [1, 2], [1, 2, 3, 4]])):
            for value in values:
                invalid = copy.deepcopy(valid)
                invalid["masses"][0][field] = value
                assert not validator.is_valid(invalid), (name, field, value)
        invalid = copy.deepcopy(valid)
        invalid["masses"][0]["provenance"]["note"] = "a" * 501
        assert not validator.is_valid(invalid), name
        valid["masses"][0]["provenance"]["note"] = "😀" * 500
        validator.validate(valid)
