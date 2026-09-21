"""Thin shim: ``bimcfd`` resolves to the streaming extension's ``cfd_pipeline`` package.

The CFD pipeline code lives in
``bim-streaming-server/.../messaging/cfd_pipeline`` so the host-native CFD job
service (S1) and this offline CLI share one implementation. Importing
``bimcfd.<module>`` loads the same files under the ``bimcfd`` name.
"""

from __future__ import annotations

from pathlib import Path

_PIPELINE_DIR = (
    Path(__file__).resolve().parents[3]
    / "bim-streaming-server"
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
    / "cfd_pipeline"
)
if not _PIPELINE_DIR.is_dir():  # pragma: no cover - broken checkout
    raise ImportError(f"cfd_pipeline package not found at {_PIPELINE_DIR}")

__path__ = [str(_PIPELINE_DIR)]  # type: ignore[name-defined]
__version__ = "0.2.0"
