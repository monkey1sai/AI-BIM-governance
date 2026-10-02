import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator


def test_frozen_ground_reference_refuses_unsupported_verification_claims():
    schema = json.loads((Path(__file__).parent / 'contracts/cfd-run-result-v1.schema.json').read_text(encoding='utf-8'))
    validator = Draft202012Validator(schema['$defs']['presentation']['properties']['ground_reference'])
    value = {'schema': 'cfd-ground-reference/v1', 'reference': 'assumed_flat_plane', 'units': 'm', 'up_axis': 'Z',
             'ground_z_m': .63, 'sampling_plane_z_m': 2.13, 'height_above_calculation_ground_m': 1.5,
             'actual_ground_verified': False, 'vector_display_lift_m': .05}
    validator.validate(value)
    validator.validate({**value, 'sampling_plane_z_m': None, 'height_above_calculation_ground_m': None})
    for field, invalid in [('actual_ground_verified', True), ('units', 'mm'), ('up_axis', 'Y'),
                           ('reference', 'selected_surface'), ('vector_display_lift_m', -1), ('unknown', 1)]:
        assert not validator.is_valid({**copy.deepcopy(value), field: invalid}), field
