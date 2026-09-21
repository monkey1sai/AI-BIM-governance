"""Offline CFD proof-of-concept tooling (docs/plans/building-energy-cfd.md, P1).

Input: the ``model.usdc`` and JSON sidecars of one successful identity
conversion. Output: a watertight building shell (STL), an OpenFOAM case, the
sampled results as a USD overlay layer, and a ``cfd-run-record/v1`` document.

This package is not a service and is not wired to any product UI. Results are
for design comparison only, never a regulatory or certification basis.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
