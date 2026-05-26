"""Kit-side bootstrap for the cross-service structured log baseline.

This module is the bridge between the pure-Python ``struct_log`` adapter and
the Kit runtime where the streaming-server messaging extension actually runs.
Responsibilities:

    * Parse ``--trace-id`` from the Kit process's argv (forwarded by
      ``bim-streaming-server/scripts/convert-ifc-to-usdc.ps1``).
    * Construct a singleton ``StructLogger`` for the lifetime of the Kit
      subprocess so all modules can share the same sink and seq counters.
    * Provide ``log_kit_startup_lifecycle()`` / ``log_kit_shutdown_lifecycle()``
      helpers for the extension entry point to emit explicit lifecycle events.
    * Co-exist with ``carb.log_*``. Adding structured log calls is additive;
      no existing Kit log channel is removed.

This module deliberately imports ``struct_log`` lazily from a sibling module to
keep test-time imports independent of Kit's package machinery. Kit modules
that want a logger should call :func:`get_logger` rather than re-constructing
their own.
"""
from __future__ import annotations

import os
import sys
import threading
from typing import Optional

from . import struct_log

_logger_lock = threading.Lock()
_logger: Optional[struct_log.StructLogger] = None


def _parse_trace_id_from_argv() -> Optional[str]:
    """Find ``--trace-id <value>`` or ``--trace-id=<value>`` in ``sys.argv``."""
    argv = list(sys.argv or [])
    for i, token in enumerate(argv):
        if token == "--trace-id" and i + 1 < len(argv):
            value = argv[i + 1].strip()
            if value:
                return value
        if token.startswith("--trace-id="):
            value = token.split("=", 1)[1].strip()
            if value:
                return value
    return None


def _resolve_initial_trace_id() -> Optional[str]:
    """Trace_id precedence: CLI ``--trace-id`` > ``BIM_TRACE_ID`` env > None."""
    cli = _parse_trace_id_from_argv()
    if cli:
        return cli
    env = os.environ.get("BIM_TRACE_ID")
    if env:
        return env
    return None


def get_logger() -> struct_log.StructLogger:
    """Return the process-wide structured logger, constructing on first use.

    Safe to call from any Kit module. Subsequent callers receive the same
    instance so file rotation and counters stay consistent.
    """
    global _logger
    if _logger is not None:
        return _logger
    with _logger_lock:
        if _logger is None:
            initial_trace = _resolve_initial_trace_id()
            _logger = struct_log.create_logger(
                "streaming-server",
                component="kit_ext_bootstrap",
                initial_trace_id=initial_trace,
            )
    return _logger


def reset_logger_for_test() -> None:
    """Test helper — drop the cached singleton so the next call rebuilds it."""
    global _logger
    with _logger_lock:
        _logger = None


def log_kit_startup_lifecycle(extension_id: str = "ezplus.bim_review_stream.messaging") -> None:
    """Emit a ``lifecycle.start`` record for the Kit subprocess."""
    logger = get_logger()
    try:
        logger.lifecycle(
            "kit_ext_bootstrap",
            f"kit extension {extension_id} on_startup",
            {
                "phase": "start",
                "subject_kind": "kit_subprocess",
                "subject_id": str(os.getpid()),
                "extension_id": extension_id,
            },
        )
    except Exception:
        # Never let log failures escape the Kit startup path.
        pass


def log_kit_shutdown_lifecycle(extension_id: str = "ezplus.bim_review_stream.messaging") -> None:
    """Emit a ``lifecycle.closed`` record for the Kit subprocess."""
    logger = get_logger()
    try:
        logger.lifecycle(
            "kit_ext_bootstrap",
            f"kit extension {extension_id} on_shutdown",
            {
                "phase": "closed",
                "subject_kind": "kit_subprocess",
                "subject_id": str(os.getpid()),
                "extension_id": extension_id,
            },
        )
    except Exception:
        pass
