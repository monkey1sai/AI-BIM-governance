from __future__ import annotations

import math

import numpy as np
import pytest

from bimcfd.wind import domain_from_building, rotate_z, rotation_to_plus_x, wind_vector_model


def test_north_wind_blows_toward_minus_y_when_project_north_is_true_north():
    vec = wind_vector_model(0.0, 0.0)
    assert np.allclose(vec, [0.0, -1.0])


def test_west_wind_blows_toward_plus_x():
    vec = wind_vector_model(270.0, 0.0)
    assert np.allclose(vec, [1.0, 0.0])


def test_true_north_rotation_is_applied():
    # True north 90 deg anticlockwise from +Y means true north is -X.
    # A north wind then blows toward +X.
    vec = wind_vector_model(0.0, 90.0)
    assert np.allclose(vec, [1.0, 0.0])


def test_rotation_aligns_wind_with_plus_x():
    vec = wind_vector_model(30.0, 0.0)
    alpha = rotation_to_plus_x(vec)
    rotated = rotate_z(np.array([[vec[0], vec[1], 0.0]]), alpha)[0]
    assert np.allclose(rotated, [1.0, 0.0, 0.0])
    # Rotating back restores the original vector.
    back = rotate_z(rotated[None, :], -alpha)[0]
    assert np.allclose(back, [vec[0], vec[1], 0.0])


def test_domain_follows_cost_732_margins():
    dom = domain_from_building(np.array([0.0, 0.0, -2.0]), np.array([70.0, 60.0, 23.0]), ground_z=0.0)
    assert dom.building_height_m == 23.0
    assert dom.xmin == pytest.approx(-5 * 23)
    assert dom.xmax == pytest.approx(70 + 15 * 23)
    assert dom.zmin == 0.0
    assert dom.zmax == pytest.approx(23 + 5 * 23)
    # 5H lateral margins would give 3.4% blockage; the domain widens to hit 3%.
    assert dom.ymin < -5 * 23
    assert dom.ymax > 60 + 5 * 23
    assert dom.ymin == pytest.approx(-(dom.ymax - 60))
    assert dom.blockage_ratio == pytest.approx(0.03)


def test_domain_keeps_5h_lateral_margin_for_slender_building():
    dom = domain_from_building(np.array([0.0, 0.0, 0.0]), np.array([20.0, 20.0, 60.0]), ground_z=0.0)
    assert dom.ymin == pytest.approx(-5 * 60)
    assert dom.ymax == pytest.approx(20 + 5 * 60)
    assert dom.blockage_ratio < 0.03


def test_domain_rejects_building_below_ground():
    with pytest.raises(ValueError):
        domain_from_building(np.array([0.0, 0.0, -5.0]), np.array([1.0, 1.0, -1.0]), ground_z=0.0)
