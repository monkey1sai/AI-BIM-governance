"""Versioned identities of execution definitions, not original file hashes."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def _json_value(value: Any) -> bool:
    if value is None or type(value) in (str, bool, int, float):
        return True
    if type(value) is list:
        return all(_json_value(item) for item in value)
    if type(value) is dict:
        return all(type(key) is str and _json_value(item) for key, item in value.items())
    return False


def _digest(profile: str, payload: str) -> str:
    digest = hashlib.sha256((profile + "\0" + payload).encode("utf-8")).hexdigest()
    return f"{profile}:sha256:{digest}"


def dsl_snapshot(rule_set: dict) -> tuple[dict, str | None]:
    try:
        if not _json_value(rule_set):
            return rule_set, None
        payload = json.dumps(rule_set, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        return json.loads(payload), _digest("dsl-json-v1", payload)
    except (TypeError, ValueError, UnicodeError, RecursionError):
        # Preserve existing execution compatibility; unknown identity never authorizes confirmation.
        return rule_set, None


def ids_snapshot(specs: Any) -> tuple[Any, str | None]:
    from ifctester import ids
    if type(specs) is not ids.Ids:
        return specs, None
    try:
        snapshot = ids.from_string(specs.to_string())
        payload = snapshot.to_string()
        return snapshot, _digest("ids-xml-v1", payload)
    except Exception:
        # Unsupported definitions may still run, but must not acquire a made-up identity.
        return specs, None
