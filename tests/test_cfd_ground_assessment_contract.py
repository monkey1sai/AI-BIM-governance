"""Public JSON schema must bound every numerical pair as tightly as Zod."""
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

SPEC = json.loads((Path(__file__).parent / "contracts/coordinator-browser-api-v1.openapi.json").read_text(encoding="utf-8"))
SCHEMA = SPEC["components"]["schemas"]["GroundAssessmentReport"]


@pytest.mark.parametrize("field", ["selected_surface_z_range_m", "relative_target_z_range_m", "old_plane_minus_relative_target_range_m", "wind_vector_model_xy"])
@pytest.mark.parametrize("value", [[], [0], [0, 1, 2]])
def test_public_numerical_pairs_reject_wrong_dimensions(field, value):
    shape = SCHEMA["properties"]
    schema = shape[field] if field != "wind_vector_model_xy" else shape["case_declared"]["properties"]["model_to_solver"]["properties"][field]
    assert list(Draft202012Validator(schema).iter_errors(value))


def test_only_two_bounded_input_fields_and_fixed_engineering_false():
    input_schema = SPEC["components"]["schemas"]["GroundAssessmentRequest"]
    validator = Draft202012Validator(input_schema)
    body = {"source_run_id": "cfd_test000001", "wind_from_degrees": 0}
    assert validator.is_valid(body)
    assert not validator.is_valid({**body, "path": "../other"})
    assert not validator.is_valid({**body, "wind_from_degrees": 360})
    for field in ("actual_ground_verified", "fluid_region_verified", "velocity_sampled", "solver_started", "inlet_boundary_files_checked"):
        assert SCHEMA["properties"][field]["const"] is False
