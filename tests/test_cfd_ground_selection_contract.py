"""Public generated schema must retain exact authored triangle dimensions."""
import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


CONTRACTS = Path(__file__).parent / "contracts"
OPENAPI = json.loads((CONTRACTS / "coordinator-browser-api-v1.openapi.json").read_text(encoding="utf-8"))
PREVIEW = json.loads((CONTRACTS / "fixtures" / "ground-selection-preview-v1.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator({"$ref": "#/components/schemas/GroundSelectionPreview", "components": OPENAPI["components"]})


def test_ground_preview_wire_fixture_is_valid():
    assert list(VALIDATOR.iter_errors(PREVIEW)) == []


@pytest.mark.parametrize("field,value", [
    ("vertices_m", []),
    ("vertices_m", [[0, 0], [0, 0, 0], [0, 0, 0]]),
    ("vertices_m", [[0, 0, 0, 0], [0, 0, 0], [0, 0, 0]]),
    ("vertices_m", [[0, 0, 0]] * 4),
    ("point_indices", [0, 1]), ("point_indices", [0, 1, 2, 3]),
    ("normal", [0, 1]), ("normal", [0, 0, 1, 0]),
])
def test_public_schema_rejects_non_triangle_dimensions(field, value):
    invalid = copy.deepcopy(PREVIEW)
    invalid["faces"][0][field] = value
    assert list(VALIDATOR.iter_errors(invalid)), field
