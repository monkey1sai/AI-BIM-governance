"""Test-only doubles of the external platform (NOT runtime services).

These replace the deleted `_worker` / `_bim-control` services for verification
only. Per design.md D4 they are test fixtures, never a runtime profile, and
never started by product runtime / compose / start-all / health / smoke as
services.
"""

from .cloud_bim_control_api import (
    CloudBimControlApi,
    MetadataOnlyViolation,
    example_callback,
)
from .external_ifc_worker_client import (
    auth_headers,
    build_ifc_ready_payload,
    post_ifc_ready,
)

__all__ = [
    "CloudBimControlApi",
    "MetadataOnlyViolation",
    "example_callback",
    "auth_headers",
    "build_ifc_ready_payload",
    "post_ifc_ready",
]
