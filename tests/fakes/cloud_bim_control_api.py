"""Test-only double of the company-cloud control-plane `bim-control`.

Replaces `_bim-control` for verification. The company cloud is the external
control-plane authority; this repo only callbacks it (metadata-only) and reads
a small amount of control-plane metadata. This double:

  * receives conversion_result_ready / conversion_failed callbacks and
    ENFORCES the metadata-only hard rule (rejects any .usdc / large bytes),
  * exposes the minimal control-plane reads the coordinator uses.

This is a TEST FIXTURE, not a runtime service and not a runtime profile
(see design.md D4). It does not run in product runtime.

Contract: tests/contracts/conversion_result_callback.json
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

_CONTRACT_PATH = (
    Path(__file__).resolve().parents[1] / "contracts" / "conversion_result_callback.json"
)

# Keys / shapes that would indicate a cloud-edge separation violation
# (large model bytes leaking into a metadata-only callback).
_FORBIDDEN_KEYS = {"usdc", "usdc_body", "usdc_bytes", "model_usdc", "file_bytes", "content_base64"}
_USDC_MAGIC_PREFIXES = ("PXR-USDC", "usdc", "PK\x03\x04")


class MetadataOnlyViolation(AssertionError):
    """Raised when a callback payload carries large/binary model content."""


class CloudBimControlApi:
    """In-memory double of the company-cloud bim-control control-plane."""

    def __init__(self) -> None:
        self._callbacks: list[dict[str, Any]] = []
        self._model_versions: dict[str, dict[str, Any]] = {}

    # ---- callback receipt (coordinator -> company cloud) ----
    def record_callback(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._assert_metadata_only(payload)
        event = payload.get("event")
        if event not in ("conversion_result_ready", "conversion_failed"):
            raise AssertionError(f"unexpected callback event: {event!r}")
        stored = copy.deepcopy(payload)
        self._callbacks.append(stored)
        return {"received": True, "event": event, "correlation_id": payload.get("correlation_id")}

    def _assert_metadata_only(self, payload: dict[str, Any]) -> None:
        def walk(node: Any, path: str = "") -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if key.lower() in _FORBIDDEN_KEYS:
                        raise MetadataOnlyViolation(
                            f"metadata-only callback violated: forbidden key '{path}{key}'"
                        )
                    walk(value, f"{path}{key}.")
            elif isinstance(node, (list, tuple)):
                for idx, item in enumerate(node):
                    walk(item, f"{path}{idx}.")
            elif isinstance(node, (bytes, bytearray)):
                raise MetadataOnlyViolation(
                    f"metadata-only callback violated: raw bytes at '{path[:-1]}'"
                )
            elif isinstance(node, str) and len(node) > 4096:
                head = node[:16]
                if any(head.startswith(p) for p in _USDC_MAGIC_PREFIXES):
                    raise MetadataOnlyViolation(
                        f"metadata-only callback violated: embedded model body at '{path[:-1]}'"
                    )

        walk(payload)

    def get_callbacks(self, event: str | None = None) -> list[dict[str, Any]]:
        if event is None:
            return list(self._callbacks)
        return [c for c in self._callbacks if c.get("event") == event]

    def last_callback(self) -> dict[str, Any] | None:
        return self._callbacks[-1] if self._callbacks else None

    # ---- minimal control-plane reads the coordinator depends on ----
    def seed_model_version(self, external_model_version_id: str, *, artifacts=None, issues=None) -> None:
        self._model_versions[external_model_version_id] = {
            "artifacts": list(artifacts or []),
            "review_issues": list(issues or []),
        }

    def get_model_version_artifacts(self, external_model_version_id: str) -> list[dict[str, Any]]:
        return list(self._model_versions.get(external_model_version_id, {}).get("artifacts", []))

    def get_review_issues(self, external_model_version_id: str) -> list[dict[str, Any]]:
        return list(self._model_versions.get(external_model_version_id, {}).get("review_issues", []))

    def reset(self) -> None:
        self._callbacks.clear()
        self._model_versions.clear()


def load_contract() -> dict[str, Any]:
    return json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))


def example_callback(event: str = "conversion_result_ready", **overrides: Any) -> dict[str, Any]:
    """Return the frozen contract example for the given callback event."""
    contract = load_contract()
    payload = copy.deepcopy(contract["events"][event]["example"])
    payload.update(overrides)
    return payload
