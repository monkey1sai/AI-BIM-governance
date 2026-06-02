"""A3 cross-discipline federation package（OpenUSD sublayer 疊合，member usdc immutable）。"""
from __future__ import annotations

from .builder import build_federated_usda, open_federated_prim_paths
from .coords import validate_coords

__all__ = ["build_federated_usda", "open_federated_prim_paths", "validate_coords"]
