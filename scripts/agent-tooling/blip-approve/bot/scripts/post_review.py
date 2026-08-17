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
VERDICT_LINE = re.compile(r"(?m)^VERDICT: (SHIP|NO-SHIP|HELD)$")
VERDICT_LIKE_LINE = re.compile(r"(?mi)^[ \t]*VERDICT[ \t]*:")
UNSAFE_LINE_CONTROL = re.compile(r"[\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069]")
ATTESTATION_FOOTER = re.compile(
    r"<!-- blip-ship-attestation:v1\n"
    r"repo=monkey1sai/AI-BIM-governance\n"
    r"pr=(?P<pr>[1-9][0-9]{0,5})\n"
    r"base=(?P<base>[0-9a-f]{40})\n"
    r"head=(?P<head>[0-9a-f]{40})\n"
    r"review_mode=(?:focused_semantic|risk_scoped_specialists|human_critical)\n"
    r"changed_files_sha256=[0-9a-f]{64}\n"
    r"diff_sha256=[0-9a-f]{64}\n"
    r"verdict=SHIP\n-->"
)
ACTIVE_MARKDOWN = (
    ("mention", re.compile(r"(?<!\\)@[A-Za-z0-9_]")),
    ("link_or_image", re.compile(r"!?\[[^\]\n]*\]\([^\)\n]+\)")),
    ("html", re.compile(r"(?i)<(?:/?[a-z!][^>]*)>")),
    ("command", re.compile(r"^[ \t]*/[A-Za-z]")),
    ("task_list", re.compile(r"^[ \t]*[-*+][ \t]+\[[ xX]\]")),
)
DLP_PATTERNS = (
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----", re.I)),
    ("github_token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b")),
    ("openai_key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("dlp_sentinel", re.compile(r"\bBLIP_DLP_SENTINEL_[A-Z0-9_-]{8,}\b")),
    (
        "credential_assignment",
        re.compile(
            r"(?i)(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key)"
            r"[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9+/_=.-]{24,}"
        ),
    ),
)


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


def outbound_safety_violation(body: str) -> str | None:
    for label, pattern in DLP_PATTERNS:
        if pattern.search(body):
            return label
    return None


def active_markdown_violation(report: str) -> str | None:
    in_inert_block = False
    for line in report.split("\n"):
        if line == "```text":
            if in_inert_block:
                return "nested_inert_block"
            in_inert_block = True
            continue
        if line == "```":
            if not in_inert_block:
                return "unexpected_fence"
            in_inert_block = False
            continue
        if in_inert_block:
            continue
        for label, pattern in ACTIVE_MARKDOWN:
            if pattern.search(line):
                return label
    return "unclosed_inert_block" if in_inert_block else None


def validate_body(event: str, body: str, *, pr_number: int, commit_id: str) -> str:
    if "\r" in body or UNSAFE_LINE_CONTROL.search(body):
        raise SystemExit("Protected Codex review body contains non-canonical line or direction controls")
    if body.endswith("\n"):
        body = body[:-1]
    if not body or body.endswith((" ", "\t", "\n")):
        raise SystemExit("Protected Codex review body has a non-canonical terminal boundary")
    violation = outbound_safety_violation(body)
    if violation:
        raise SystemExit(f"Protected Codex review body failed outbound content safety policy: {violation}")
    marker_count = body.count(ATTESTATION_MARKER)
    verdicts = list(VERDICT_LINE.finditer(body))
    verdict_like = list(VERDICT_LIKE_LINE.finditer(body))
    if len(verdicts) != 1 or len(verdict_like) != 1:
        raise SystemExit("Protected Codex review body requires exactly one canonical verdict line")
    verdict_match = verdicts[0]
    verdict = verdict_match.group(1)
    active_violation = active_markdown_violation(body[:verdict_match.end()])
    if active_violation:
        raise SystemExit(f"Protected Codex review body contains active Markdown: {active_violation}")
    if event == "comment":
        if verdict == "SHIP":
            if marker_count != 1:
                raise SystemExit("Protected Codex canonical SHIP comment requires one attestation footer")
            suffix = body[verdict_match.end():]
            if not suffix.startswith("\n\n"):
                raise SystemExit("Canonical Codex attestation footer is not at the final body boundary")
            footer = suffix[2:]
            footer_match = ATTESTATION_FOOTER.fullmatch(footer)
            if footer_match is None:
                raise SystemExit("Canonical Codex attestation footer grammar is invalid")
            if int(footer_match.group("pr")) != pr_number or footer_match.group("head") != commit_id.lower():
                raise SystemExit("Canonical Codex attestation footer differs from the exact PR/head tuple")
        elif verdict == "HELD":
            if marker_count != 0:
                raise SystemExit("Protected Codex HELD comment cannot carry a SHIP attestation footer")
            if verdict_match.end() != len(body):
                raise SystemExit("Protected Codex HELD verdict is not at the canonical terminal boundary")
        else:
            raise SystemExit("Protected Codex comment must be canonical SHIP+attestation or HELD")
    elif verdict != "NO-SHIP" or marker_count != 0:
        raise SystemExit("Protected Codex REQUEST_CHANGES requires NO-SHIP without a SHIP attestation")
    elif verdict_match.end() != len(body):
        raise SystemExit("Protected Codex NO-SHIP verdict is not at the canonical terminal boundary")
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
    full_body = validate_body(args.event, body, pr_number=args.pr, commit_id=args.commit_id)
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
