from __future__ import annotations

import numpy as np

from bimcfd.flow_animation import AnimationParams, advect_along_tracks
from bimcfd.foam_vtk import VtkSurface


def _tracks(n_points: int = 6, n_tracks: int = 3) -> VtkSurface:
    points = []
    lines = []
    velocity = []
    for t in range(n_tracks):
        start = len(points)
        for i in range(n_points):
            points.append([float(i) * 2.0, float(t) * 5.0, 1.5])
            velocity.append([1.0 + i * 0.5, 0.0, 0.0])
        lines.append(np.arange(start, start + n_points))
    return VtkSurface(points=np.array(points), lines=lines, point_data={"U": np.array(velocity)})


def test_particles_follow_tracks_at_local_speed_and_wrap():
    animation = advect_along_tracks(_tracks(), AnimationParams(fps=10, seconds=2.0, target_particles=6))
    assert animation is not None
    assert animation.frames == 20
    assert animation.tracks_used == 3
    assert animation.particles == 6  # two per track
    assert animation.positions.shape == (20, 6, 3)
    assert animation.speeds.shape == (20, 6)
    # Every sample lies on its track's segment (y is constant per track, x within [0, 10]).
    for t in range(3):
        cols = slice(t * 2, (t + 1) * 2)
        assert np.allclose(animation.positions[:, cols, 1], t * 5.0)
        assert animation.positions[:, cols, 0].min() >= 0.0 and animation.positions[:, cols, 0].max() <= 10.0
    # Particles move forward between frames unless they just wrapped to the start.
    dx = np.diff(animation.positions[:, 0, 0])
    assert np.all((dx > 0) | (dx < -5.0))
    # Speed readback is interpolated from the point speeds (1.0 .. 3.5 m/s).
    assert animation.speeds.min() >= 1.0 - 1e-6 and animation.speeds.max() <= 3.5 + 1e-6


def test_short_or_degenerate_tracks_are_skipped():
    degenerate = VtkSurface(
        points=np.array([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]], dtype=float),
        lines=[np.array([0, 1, 2, 3]), np.array([4, 5])],
        point_data={"U": np.ones((6, 3))},
    )
    assert advect_along_tracks(degenerate) is None


def test_missing_velocity_falls_back_to_unit_speed():
    tracks = _tracks()
    tracks.point_data = {}
    animation = advect_along_tracks(tracks, AnimationParams(fps=5, seconds=1.0, target_particles=3))
    assert animation is not None
    assert np.allclose(animation.speeds, 1.0)
