#!/usr/bin/env python3
"""Mint the owner-signed branch-protection attestation consumed by blip_review.py.

Why this exists: the fixed reviewer `monkey1sai-blip` is pinned to
least-privilege write permission, while GitHub's legacy protection read
endpoint (`GET /repos/{owner}/{repo}/branches/{branch}/protection`) requires
repository admin, so the reviewer token receives HTTP 404 and can never
observe the full policy (verified 2026-09-01 across ten failed vote
attempts). The owner therefore runs this tool with a separate read-only
admin-scope credential, and the observed protection snapshot is signed into a
packet the approval broker can verify offline.

Trust model: this tool is an evidence courier, not a trusted validator. The
broker re-runs the complete policy validation on the embedded snapshot and
additionally cross-checks the write-visible GraphQL `refUpdateRule` live at
approval time, so a stale or dishonest packet still fails closed on every
write-visible field.

Secrets: the admin credential is read only from the environment variable named
by --admin-token-env and is used solely for two read-only GETs. The signing
key is a dedicated protection-attestation secret, never the counted-reviewer
PAT. Neither value is ever printed; the emitted attestation contains only
branch-protection settings and expires within ten minutes.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote

SOURCE_PARENT = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE_PARENT))
import blip_review as blip  # noqa: E402

DEFAULT_ADMIN_TOKEN_ENV = "BLIP_PROTECTION_ADMIN_TOKEN"
DEFAULT_SIGNING_KEY_ENV = blip.PROTECTION_ATTESTATION_KEY_ENV
DEFAULT_VALID_SECONDS = 600
MIN_VALID_SECONDS = 60
MAX_VALID_SECONDS = blip.PROTECTION_ATTESTATION_MAX_VALIDITY_SECONDS


def read_required_env(name: str, purpose: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Environment variable {name} is required ({purpose}) and must not be empty")
    return value


def fetch_protection_snapshot(admin_token: str, base_branch: str) -> dict:
    owner, _, name = blip.DEFAULT_REPO.partition("/")
    encoded_branch = quote(base_branch, safe="")
    active_rules = blip.http_json(
        "GET",
        f"{blip.API}/repos/{owner}/{name}/rules/branches/{encoded_branch}?per_page=100",
        token=admin_token,
    )
    if not isinstance(active_rules, list):
        raise SystemExit("Active branch rules payload is malformed")
    if len(active_rules) >= 100:
        raise SystemExit("Active branch rules may be paginated; refusing incomplete protection state")
    if active_rules:
        raise SystemExit("Active rulesets are present but the approval broker only supports verified legacy protection")
    protection = blip.http_json(
        "GET",
        f"{blip.API}/repos/{owner}/{name}/branches/{encoded_branch}/protection",
        token=admin_token,
    )
    if not isinstance(protection, dict):
        raise SystemExit("Branch protection payload is missing or malformed")
    return protection


def build_attestation(
    *,
    signing_key: str,
    protection: dict,
    base_branch: str,
    valid_seconds: int,
    now: int | None = None,
) -> str:
    issued_at = int(time.time()) if now is None else int(now)
    expires_at = issued_at + valid_seconds
    payload_text = json.dumps(
        {
            "version": blip.PROTECTION_ATTESTATION_VERSION,
            "repository": blip.DEFAULT_REPO,
            "base_branch": base_branch,
            "issued_at": issued_at,
            "expires_at": expires_at,
            "active_rules": [],
            "protection": protection,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    signature = hmac.new(
        signing_key.encode("utf-8"), payload_text.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    encoded = base64.urlsafe_b64encode(payload_text.encode("utf-8")).decode("ascii").rstrip("=")
    return f"{encoded}.{signature}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Mint the owner-signed branch-protection attestation for the blip approval broker"
    )
    parser.add_argument("--repo", default=blip.DEFAULT_REPO, choices=[blip.DEFAULT_REPO])
    parser.add_argument("--base-branch", default=blip.DEFAULT_BASE_BRANCH, choices=[blip.DEFAULT_BASE_BRANCH])
    parser.add_argument(
        "--valid-seconds",
        type=int,
        default=DEFAULT_VALID_SECONDS,
        help=(
            "Short attestation validity in seconds "
            f"({MIN_VALID_SECONDS}..{MAX_VALID_SECONDS}); re-mint immediately before every approval"
        ),
    )
    parser.add_argument(
        "--admin-token-env",
        default=DEFAULT_ADMIN_TOKEN_ENV,
        help="Environment variable holding the owner's read-only admin-scope credential",
    )
    parser.add_argument(
        "--signing-key-env",
        default=DEFAULT_SIGNING_KEY_ENV,
        help="Environment variable holding the dedicated protection-attestation HMAC key",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Write the attestation line to this file (default: stdout)",
    )
    cli = parser.parse_args()

    if not MIN_VALID_SECONDS <= cli.valid_seconds <= MAX_VALID_SECONDS:
        raise SystemExit(
            f"--valid-seconds must be between {MIN_VALID_SECONDS} and {MAX_VALID_SECONDS}"
        )
    admin_token = read_required_env(cli.admin_token_env, "read-only admin protection reads")
    signing_key = read_required_env(cli.signing_key_env, "dedicated attestation HMAC key")
    if not 32 <= len(signing_key) <= 4096:
        raise SystemExit("The dedicated attestation HMAC key must contain 32..4096 characters")

    protection = fetch_protection_snapshot(admin_token, cli.base_branch)
    normalized = blip.validate_protection_payload(protection, cli.base_branch)
    attestation = build_attestation(
        signing_key=signing_key,
        protection=protection,
        base_branch=cli.base_branch,
        valid_seconds=cli.valid_seconds,
    )
    verified = blip.verify_protection_attestation(
        signing_key=signing_key, raw=attestation, base_branch=cli.base_branch
    )
    if blip.validate_protection_payload(verified["protection"], cli.base_branch) != normalized:
        raise SystemExit("Round-trip verification of the minted attestation failed")

    if cli.out is not None:
        cli.out.write_text(attestation + "\n", encoding="ascii", newline="\n")
        destination = str(cli.out)
    else:
        print(attestation)
        destination = "stdout"
    digest = hashlib.sha256(attestation.encode("ascii")).hexdigest()
    print(
        "[mint] protection attestation minted: "
        f"branch={cli.base_branch} issued_at={verified['issued_at']} expires_at={verified['expires_at']} "
        f"required_checks={len(normalized['required'])} sha256={digest} out={destination}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
