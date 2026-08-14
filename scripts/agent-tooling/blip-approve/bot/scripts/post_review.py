#!/usr/bin/env python3
"""Post one fixed Codex App COMMENT or REQUEST_CHANGES review."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_auth import API, http_json, load_bot_config, protected_installation_token  # noqa: E402


FIXED_REPO = "monkey1sai/AI-BIM-governance"
CODEX_APP_ID = "4445344"
CODEX_INSTALLATION_ID = "150304409"
CODEX_APP_SLUG = "codex-tri-adversarial-bot"
CODEX_BOT_LOGIN = "codex-tri-adversarial-bot[bot]"
CODEX_BOT_ID = 311390181
CODEX_BOT_NAME = "Codex Tri-Adversarial Bot"
CODEX_BOT_SUBTITLE = "Automated **tri-adversarial ship-gate** with protected canonical attestation binding."
ATTESTATION_MARKER = "<!-- blip-ship-attestation:v1"
EVENT_MAP = {"comment": "COMMENT", "request_changes": "REQUEST_CHANGES"}


def runtime_root() -> Path:
    source_parent = Path(__file__).resolve().parent
    return source_parent if (source_parent / "bots.json").is_file() else source_parent.parent


def validate_fixed_config() -> None:
    entry = load_bot_config(runtime_root(), "codex", override=True)
    expected = {
        "app_id": CODEX_APP_ID,
        "installation_id": CODEX_INSTALLATION_ID,
        "app_slug": CODEX_APP_SLUG,
        "repo": FIXED_REPO,
    }
    for key, value in expected.items():
        if str(entry.get(key) or "") != value:
            raise SystemExit(f"Codex bot config {key} differs from the protected fixed identity")


def fixed_installation_token() -> str:
    validate_fixed_config()
    return protected_installation_token(CODEX_APP_ID, CODEX_INSTALLATION_ID)


def review_header(event: str) -> str:
    return (
        f"## {CODEX_BOT_NAME}\n\n"
        f"{CODEX_BOT_SUBTITLE}\n"
        f"Mapped event: **`{EVENT_MAP[event]}`**\n\n"
        "---\n\n"
    )


def validate_body(event: str, body: str) -> str:
    body = body.strip()
    marker_count = body.count(ATTESTATION_MARKER)
    is_ship = bool(re.search(r"(?m)^VERDICT: SHIP\s*$", body))
    is_held = bool(re.search(r"(?m)^VERDICT: HELD\s*$", body))
    is_no_ship = bool(re.search(r"(?m)^VERDICT: NO-SHIP\s*$", body))
    if event == "comment":
        if is_ship:
            if marker_count != 1:
                raise SystemExit("Protected Codex canonical SHIP comment requires one attestation footer")
            footer = body[body.index(ATTESTATION_MARKER):]
            if not body.endswith(footer) or footer.count(ATTESTATION_MARKER) != 1:
                raise SystemExit("Canonical Codex attestation footer is not unique at the final body boundary")
        elif is_held:
            if marker_count != 0:
                raise SystemExit("Protected Codex HELD comment cannot carry a SHIP attestation footer")
        else:
            raise SystemExit("Protected Codex comment must be canonical SHIP+attestation or HELD")
    elif not is_no_ship or marker_count != 0:
        raise SystemExit("Protected Codex REQUEST_CHANGES requires NO-SHIP without a SHIP attestation")
    full_body = review_header(event) + body
    if len(full_body) > 60_000:
        raise SystemExit("Protected Codex review body is too large; refusing to truncate authorization evidence")
    return full_body


def exact_existing_reviews(existing: object, commit_id: str) -> list[dict]:
    if not isinstance(existing, list):
        raise SystemExit("GitHub review enumeration is malformed")
    if len(existing) >= 100:
        raise SystemExit("GitHub review enumeration may be incomplete at the 100-review boundary")
    return [
        review
        for review in existing
        if isinstance(review, dict)
        and (review.get("user") or {}).get("type") == "Bot"
        and (review.get("user") or {}).get("login") == CODEX_BOT_LOGIN
        and (review.get("user") or {}).get("id") == CODEX_BOT_ID
        and review.get("state") != "DISMISSED"
        and str(review.get("commit_id") or "").lower() == commit_id.lower()
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Post one protected Codex App review")
    parser.add_argument("--bot", choices=["codex"], required=True)
    parser.add_argument("--bot-name", default=CODEX_BOT_NAME)
    parser.add_argument("--bot-subtitle", default=CODEX_BOT_SUBTITLE)
    parser.add_argument("--repo", choices=[FIXED_REPO], required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--event", choices=sorted(EVENT_MAP), required=True)
    body_group = parser.add_mutually_exclusive_group(required=True)
    body_group.add_argument("--body-file", type=Path)
    body_group.add_argument("--body")
    parser.add_argument("--commit-id", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--live", action="store_true")
    args = parser.parse_args()

    if args.bot_name != CODEX_BOT_NAME or args.bot_subtitle != CODEX_BOT_SUBTITLE:
        raise SystemExit("Protected Codex review identity header differs from the fixed source")
    validate_fixed_config()
    if args.pr < 1 or args.pr > 999999:
        raise SystemExit("Protected Codex review PR number is out of range")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", args.commit_id):
        raise SystemExit("Protected Codex App posting requires an exact full commit SHA")
    if args.body_file is not None:
        if not args.body_file.is_file():
            raise SystemExit("Protected Codex review body file is unavailable")
        body = args.body_file.read_text(encoding="utf-8")
    else:
        body = str(args.body or "")
    full_body = validate_body(args.event, body)
    payload = {"body": full_body, "event": EVENT_MAP[args.event], "commit_id": args.commit_id.lower()}
    dry = not args.live

    print(f"repo={FIXED_REPO} pr=#{args.pr} event={payload['event']} dry_run={dry}")
    print(f"body_chars={len(full_body)}")
    if dry:
        root = runtime_root()
        out = root / "artifacts" / f"review-pr-{args.pr}-codex-dry-run.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Dry-run payload written: {out}")
        print(f"POST_REVIEW_RESULT event={payload['event']} dry_run=True")
        return

    token = fixed_installation_token()
    owner, repo_name = FIXED_REPO.split("/", 1)
    existing = http_json(
        "GET",
        f"{API}/repos/{owner}/{repo_name}/pulls/{args.pr}/reviews?per_page=100&page=1",
        token=token,
    )
    mine = exact_existing_reviews(existing, args.commit_id)
    if mine:
        ids = ", ".join(f"{review.get('id')}({review.get('state')})" for review in mine)
        raise SystemExit(f"Refusing duplicate fixed App review on this head: {ids}")

    result = http_json(
        "POST",
        f"{API}/repos/{owner}/{repo_name}/pulls/{args.pr}/reviews",
        token=token,
        body=payload,
    )
    expected_state = {"COMMENT": "COMMENTED", "REQUEST_CHANGES": "CHANGES_REQUESTED"}[payload["event"]]
    if not isinstance(result, dict):
        raise SystemExit("GitHub review response is malformed")
    review_id = result.get("id")
    html_url = result.get("html_url")
    user = result.get("user")
    expected_prefix = f"https://github.com/{FIXED_REPO}/pull/{args.pr}#pullrequestreview-"
    if (
        not isinstance(review_id, int)
        or review_id <= 0
        or result.get("state") != expected_state
        or not isinstance(html_url, str)
        or not html_url.startswith(expected_prefix)
        or str(result.get("commit_id") or "").lower() != args.commit_id.lower()
        or str(result.get("body") or "") != full_body
        or not isinstance(user, dict)
        or {"login": user.get("login"), "id": user.get("id"), "type": user.get("type")}
        != {"login": CODEX_BOT_LOGIN, "id": CODEX_BOT_ID, "type": "Bot"}
    ):
        raise SystemExit("GitHub review response did not confirm the fixed App review tuple")

    readback = http_json(
        "GET",
        f"{API}/repos/{owner}/{repo_name}/pulls/{args.pr}/reviews/{review_id}",
        token=token,
    )
    if not isinstance(readback, dict):
        raise SystemExit("GitHub Codex review readback is malformed")
    readback_user = readback.get("user")
    if (
        readback.get("id") != review_id
        or readback.get("state") != expected_state
        or readback.get("html_url") != html_url
        or str(readback.get("commit_id") or "").lower() != args.commit_id.lower()
        or str(readback.get("body") or "") != full_body
        or not isinstance(readback_user, dict)
        or readback_user.get("login") != CODEX_BOT_LOGIN
        or readback_user.get("id") != CODEX_BOT_ID
        or readback_user.get("type") != "Bot"
    ):
        raise SystemExit("GitHub Codex review readback differs from the submitted review")
    print(
        f"POST_REVIEW_RESULT event={payload['event']} dry_run=False "
        f"review_id={review_id} html={html_url}"
    )


if __name__ == "__main__":
    main()
