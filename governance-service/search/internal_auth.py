"""Shared fail-closed authentication for coordinator-only A4 routes."""
from __future__ import annotations

import os
import secrets
from typing import Optional


def internal_context_token() -> Optional[str]:
    token = os.getenv("A4_INTERNAL_CONTEXT_TOKEN", "").strip()
    if not token or len(token) < 16 or len(token) > 4_096:
        return None
    try:
        encoded = token.encode("ascii")
    except UnicodeEncodeError:
        return None
    if any(value < 0x21 or value > 0x7E for value in encoded):
        return None
    return token


def internal_token_matches(candidate: str, configured: str) -> bool:
    try:
        candidate_bytes = candidate.encode("ascii")
        configured_bytes = configured.encode("ascii")
    except UnicodeEncodeError:
        return False
    return secrets.compare_digest(candidate_bytes, configured_bytes)
