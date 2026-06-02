"""Test-only double of the external customer-edge IFC Worker.

Replaces `_worker`'s role as the flow driver for verification: it produces a
spec-correct `POST /api/external/ifc-ready` request to `bim-review-coordinator`.

This is a TEST FIXTURE, not a runtime service and not a runtime profile
(see design.md D4). It does not run in product runtime.

Contract: tests/contracts/ifc_ready_payload.json
"""

from __future__ import annotations

import copy
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse
from pathlib import Path
from typing import Any

_CONTRACT_PATH = Path(__file__).resolve().parents[1] / "contracts" / "ifc_ready_payload.json"

# Local/dev hosts only: this fixture must never reach an arbitrary external host.
_ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "host.docker.internal"})


def load_contract() -> dict[str, Any]:
    return json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))


def build_ifc_ready_payload(**overrides: Any) -> dict[str, Any]:
    """Return a spec-correct ifc-ready payload (the frozen contract example).

    Use in unit/contract tests without any network.
    """
    payload = copy.deepcopy(load_contract()["example"])
    payload.update(overrides)
    return payload


def build_worker_compatibility_payload(**overrides: Any) -> dict[str, Any]:
    """Return a worker-compatibility ifc-ready payload (簡化形狀).

    backfill-coordinator-webhook-and-auto-session §1：模擬客戶落地端 IFC
    Worker 送的較簡化 payload（status / ifc_path / project_id / version /
    task_id）。coordinator 在 intake boundary 會正規化為 canonical
    ExternalIfcReadyEvent，dispatch 給 streaming 仍走 internal contract。
    """
    payload = copy.deepcopy(load_contract()["worker_compatibility_example"]["payload"])
    payload.update(overrides)
    return payload


def auth_headers(**overrides: Any) -> dict[str, str]:
    """intranet-dev AuthProvider headers from the frozen contract."""
    headers = dict(load_contract()["transport"]["auth"]["headers"])
    headers["X-Webhook-Secret"] = "dev-webhook-secret"
    headers.update(overrides)
    return headers


def post_ifc_ready(
    base_url: str,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> tuple[int, dict[str, Any] | str]:
    """POST ifc-ready to a running coordinator (used once T3 exists).

    Returns (status_code, parsed_json_or_text). Stdlib only (no new dependency).
    """
    if payload is None:
        payload = build_ifc_ready_payload()
    if headers is None:
        headers = auth_headers()
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported coordinator base_url scheme: {parsed.scheme or '<missing>'}")
    if parsed.hostname not in _ALLOWED_HOSTS:
        raise ValueError(f"host not allowed: {parsed.hostname}")
    url = base_url.rstrip("/") + load_contract()["transport"]["path"]
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310  # test fixture; host validated above
            body = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        status = exc.code
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, body
