import numpy as np
import pytest

from bimcfd.ground_reference import calculation_ground_reference


@pytest.mark.parametrize('ground, sample', [(0, 1.5), (.63, 2.13), (-2.12, -.62)])
def test_reference_records_actual_sample_not_assumed_default(ground, sample):
    points = np.array([[0, 0, sample], [10, 0, sample], [0, 10, sample]])
    original = points.copy()
    result = calculation_ground_reference(ground, points, .05)
    assert result['ground_z_m'] == ground
    assert result['sampling_plane_z_m'] == pytest.approx(sample)
    assert result['height_above_calculation_ground_m'] == pytest.approx(1.5)
    assert result['actual_ground_verified'] is False
    assert result['vector_display_lift_m'] == .05
    np.testing.assert_array_equal(points, original)


@pytest.mark.parametrize('points', [None, np.empty((0, 3)), [[0, 0, 1.5], [1, 0, 2]], [[0, 0, np.nan]]])
def test_unknown_or_nonplanar_samples_do_not_fabricate_height(points):
    result = calculation_ground_reference(0, points, None)
    assert result['sampling_plane_z_m'] is None
    assert result['height_above_calculation_ground_m'] is None
    assert result['actual_ground_verified'] is False


def test_invalid_ground_is_not_published():
    with pytest.raises(ValueError):
        calculation_ground_reference(np.nan, [[0, 0, 1.5]], .05)
