"""A2 model-version diff engine package（CPU-only，GlobalId 多級對齊）。"""
from __future__ import annotations

from .engine import open_model, run_diff, run_diff_on_paths
from .models import CHANGE_TYPES, DiffItem, DiffResult

__all__ = ["open_model", "run_diff", "run_diff_on_paths", "CHANGE_TYPES", "DiffItem", "DiffResult"]
