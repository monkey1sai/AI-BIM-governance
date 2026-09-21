"""Offline CFD proof-of-concept tooling (docs/plans/building-energy-cfd.md, P1).

Input: the ``model.usdc`` and JSON sidecars of one successful identity
conversion. Output: a watertight building shell (STL), an OpenFOAM case, the
sampled results as a USD overlay layer, and a ``cfd-run-record/v1`` document.

This package is the pipeline behind the host-native CFD job service (cfd_job_service.py)
and the offline ``tools/cfd`` CLI (``bimcfd`` shim). Results are
for design comparison only, never a regulatory or certification basis.
"""

__all__ = ["__version__"]

__version__ = "0.2.0"
