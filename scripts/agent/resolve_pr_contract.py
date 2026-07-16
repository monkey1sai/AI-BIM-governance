#!/usr/bin/env python3
"""Turn the PR handoff table into a non-executable local validation contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


FIELDS = (
    "Cloud task ID / URL",
    "Issue",
    "Cloud base SHA",
    "Expected touch set",
    "Local validation profile",
    "Local-only checks outstanding",
    "Deployment requirement",
)
PROFILES = {"contracts", "integration", "browser-e2e", "kit-runtime", "full"}
DEPLOYMENT_REQUIREMENTS = {
    "none": "none",
    "required after merge from protected main": "test-deploy-after-merge",
}
SHA_RE = re.compile(r"^[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$")
ISSUE_URL_RE = re.compile(r"https://github\.com/([^/]+)/([^/]+)/issues/(\d+)")


class ContractError(ValueError):
    pass


def _clean_cell(value: str) -> str:
    return value.strip().strip("`").strip()


def parse_fields(body: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in body.splitlines():
        for key in FIELDS:
            prefix = f"{key}:"
            if line.startswith(prefix):
                if key in values:
                    raise ContractError(f"duplicate PR handoff field: {key}")
                values[key] = _clean_cell(line[len(prefix) :])
                break
    missing = [field for field in FIELDS if not values.get(field)]
    if missing:
        raise ContractError(f"missing PR handoff fields: {', '.join(missing)}")
    return values


def parse_touch_set(raw: str) -> list[str]:
    parts = re.split(r"\s*(?:,|<br\s*/?>)\s*", raw, flags=re.IGNORECASE)
    patterns: list[str] = []
    for part in parts:
        pattern = _clean_cell(part).replace("\\", "/")
        if not pattern:
            continue
        if pattern.startswith(("/", "-")) or ".." in pattern.split("/"):
            raise ContractError(f"unsafe touch-set pattern: {pattern}")
        if not re.fullmatch(r"[A-Za-z0-9._/*?\[\]-]+", pattern):
            raise ContractError(f"unsupported touch-set pattern: {pattern}")
        patterns.append(pattern)
    if not patterns:
        raise ContractError("Expected touch set must contain at least one repo-relative glob")
    return patterns


def resolve_contract(
    body: str, *, repository: str, pr_number: int, base_sha: str, candidate_sha: str
) -> dict[str, object]:
    fields = parse_fields(body)
    cloud_base_sha = fields["Cloud base SHA"].lower()
    event_base_sha = base_sha.lower()
    candidate_sha = candidate_sha.lower()
    for label, value in (
        ("Cloud base SHA", cloud_base_sha),
        ("event base SHA", event_base_sha),
        ("candidate SHA", candidate_sha),
    ):
        if not SHA_RE.fullmatch(value):
            raise ContractError(f"{label} must be a full commit SHA")
    if cloud_base_sha != event_base_sha:
        raise ContractError(
            "Cloud base SHA must equal the current protected PR base SHA; "
            "refresh the cloud task before local approval"
        )

    issue_match = re.fullmatch(r"#(\d+)", fields["Issue"])
    if not issue_match:
        issue_url_match = ISSUE_URL_RE.fullmatch(fields["Issue"])
        if issue_url_match and f"{issue_url_match.group(1)}/{issue_url_match.group(2)}".casefold() != repository.casefold():
            raise ContractError("Issue URL must belong to the current repository")
        issue_match = issue_url_match
    if not issue_match:
        raise ContractError("Issue must be #<number> or a same-repo GitHub issue URL")

    profile = fields["Local validation profile"]
    if profile not in PROFILES:
        raise ContractError(f"unknown local validation profile: {profile}")

    deployment_input = fields["Deployment requirement"]
    if deployment_input not in DEPLOYMENT_REQUIREMENTS:
        raise ContractError(f"unknown deployment requirement: {deployment_input}")
    deployment = DEPLOYMENT_REQUIREMENTS[deployment_input]

    cloud_task = fields["Cloud task ID / URL"]
    if cloud_task.lower() in {"none", "n/a", "todo", "tbd"}:
        raise ContractError("Cloud task ID / URL cannot be a placeholder")

    return {
        "schema_version": "ai-bim-task-contract/v1",
        "task_id": cloud_task,
        "issue": int(issue_match.group(issue_match.lastindex or 1)),
        "pr_number": pr_number,
        "repository": repository,
        "pr_body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "cloud_base_sha": cloud_base_sha,
        "base_sha": event_base_sha,
        "candidate_sha": candidate_sha,
        "expected_touch_set": parse_touch_set(fields["Expected touch set"]),
        "local_validation_profile": profile,
        "local_only_checks_outstanding": fields["Local-only checks outstanding"],
        "deployment_requirement": deployment,
    }


def atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--body-file", required=True, type=Path)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--pr-number", required=True, type=int)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        body = args.body_file.read_text(encoding="utf-8")
        payload = resolve_contract(
            body,
            repository=args.repository,
            pr_number=args.pr_number,
            base_sha=args.base_sha,
            candidate_sha=args.candidate_sha,
        )
        atomic_write_json(args.output, payload)
    except (OSError, ContractError, ValueError) as exc:
        print(f"PR contract rejected: {exc}", file=sys.stderr)
        return 20
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
