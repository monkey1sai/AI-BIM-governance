#!/usr/bin/env python3
"""Minimal GitHub JSON helpers for the protected review runtime.

This module has no PEM, JWT, dotenv, token-printing, or generic installation-token
surface. The owner-controlled wrapper injects one short-lived token through a
cleared child environment.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.github.com"
UA = "grok-tri-adversarial-bot/1.0"
PROTECTED_INSTALLATION_TOKEN_ENV = "BLIP_PROTECTED_CODEX_INSTALLATION_TOKEN"
PROTECTED_APP_ID_ENV = "BLIP_PROTECTED_CODEX_APP_ID"
PROTECTED_INSTALLATION_ID_ENV = "BLIP_PROTECTED_CODEX_INSTALLATION_ID"
MAX_GITHUB_JSON_BYTES = 16 * 1024 * 1024


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never forward an authorization header across an HTTP redirect."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise urllib.error.HTTPError(req.full_url, code, "GitHub redirect refused", headers, fp)


_NO_REDIRECT_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    _NoRedirectHandler(),
)


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON property: {key}")
        result[key] = value
    return result


BOT_ENV_KEYS = {
    "app_slug": "APP_SLUG",
    "app_id": "GITHUB_APP_ID",
    "installation_id": "GITHUB_APP_INSTALLATION_ID",
    "repo": "GITHUB_REPO",
}


def load_bot_config(root: Path, bot: str, *, override: bool = False) -> dict:
    """Load the one fixed, non-secret protected App identity."""
    if bot != "codex" or override is not True:
        raise SystemExit("Protected bot config accepts only the fixed Codex identity with override")
    path = root / "bots.json"
    if not path.is_file():
        raise SystemExit(f"bots.json not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_json_object)
    except (json.JSONDecodeError, ValueError) as exc:
        raise SystemExit(f"bots.json is not valid JSON: {exc}") from exc
    if set(data) != {"schema", "bots"} or data.get("schema") != "blip-protected-bot-config/v1":
        raise SystemExit("bots.json has unknown, missing, or invalid top-level fields")
    bots = data.get("bots")
    if not isinstance(bots, dict) or set(bots) != {"codex"}:
        raise SystemExit("bots.json must contain exactly the fixed Codex bot")
    entry = bots["codex"]
    if not isinstance(entry, dict) or set(entry) != set(BOT_ENV_KEYS):
        raise SystemExit("Codex bot config has unknown or missing identity fields")
    for key, env_key in BOT_ENV_KEYS.items():
        value = entry.get(key)
        if not isinstance(value, str) or not value:
            raise SystemExit(f"Codex bot config {key} is empty or malformed")
        os.environ[env_key] = value
    return entry


def protected_installation_token(expected_app_id: str, expected_installation_id: str) -> str:
    """Return the token injected by the protected owner wrapper.

    Identity companion fields are mandatory so a stale environment from a
    different App cannot be accepted accidentally.  The wrapper clears its
    child environment before adding these values; callers must never log the
    returned token.
    """

    app_id = os.environ.pop(PROTECTED_APP_ID_ENV, "").strip()
    installation_id = os.environ.pop(PROTECTED_INSTALLATION_ID_ENV, "").strip()
    token = os.environ.pop(PROTECTED_INSTALLATION_TOKEN_ENV, "").strip()
    if app_id != expected_app_id or installation_id != expected_installation_id:
        raise SystemExit("Protected GitHub App identity handoff is absent or mismatched")
    if not token or any(ch.isspace() for ch in token) or len(token) < 20:
        raise SystemExit("Protected GitHub installation token handoff is absent or malformed")
    return token


def http_json(
    method: str,
    url: str,
    token: str | None = None,
    body: dict | None = None,
) -> dict | list:
    if method not in {"GET", "POST"}:
        raise SystemExit("GitHub JSON helper accepts only GET or POST")
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "api.github.com"
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise SystemExit("GitHub JSON helper refused a non-canonical API origin")
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", UA)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with _NO_REDIRECT_OPENER.open(req, timeout=60) as resp:
            raw_bytes = resp.read(MAX_GITHUB_JSON_BYTES + 1)
            if len(raw_bytes) > MAX_GITHUB_JSON_BYTES:
                raise SystemExit("GitHub JSON response exceeded the protected byte limit")
            try:
                raw = raw_bytes.decode("utf-8", errors="strict")
                return json.loads(raw, object_pairs_hook=_unique_json_object) if raw else {}
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
                raise SystemExit("GitHub JSON response is malformed or contains duplicate fields") from None
    except urllib.error.HTTPError as e:
        # Error bodies can contain credential-adjacent response data.  Keep the
        # diagnostic stable and never relay the body into logs or artifacts.
        raise SystemExit(f"HTTP {e.code} {method} {url}") from e
