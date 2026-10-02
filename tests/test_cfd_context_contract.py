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
