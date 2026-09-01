#!/usr/bin/env python3
"""Survey a PR, request one governed repair, or submit one guarded User approval.

Why this exists: a GitHub **App** approving review does not count toward
`required_approving_review_count` (verified 2026-07-31 — the review posted, yet
`reviewDecision` stayed `REVIEW_REQUIRED`). Only a *user* account with write access
produces a counted approval. `monkey1sai-blip` is that account, and it is the exact
reviewer AI-BIM-governance PR #458 pins (`REVIEWER_LOGIN`/`REVIEWER_ID`).

The approval path is deliberately narrower than the credential: fixed repository and
reviewer, exact base/head, active branch protection, required checks, complete review
state, machine-mode exact-head SHIP attestation or an explicit human-critical owner
override, no auto-merge, and a short-lived signed broker capability are all mandatory.
It never merges, resolves a thread, dismisses a
review, pushes, changes repository settings, or touches an owner-consent comment.

Branch protection is verified from two sources because the least-privilege write
reviewer cannot read GitHub's admin-only legacy protection endpoint (observed as
HTTP 404 on 2026-09-01 across ten failed vote attempts): an owner-minted signed
protection attestation (`mint_protection_attestation.py`) supplies the complete
legacy-protection snapshot, and the write-visible GraphQL `refUpdateRule` is
cross-checked live on every preflight and post-approval pass so drift in the
write-visible fields still fails closed between attestation refreshes.

Honest framing for anyone reading a report produced with this: an approval submitted
here is a *scripted* approval carrying the operator's authority. It satisfies the
mechanism; it does not by itself constitute independent human review.

The token is a real secret. This script accepts it only through `BLIP_GITHUB_TOKEN`,
which must be injected by an owner-approved secret broker or process environment. It
never opens a protected `.env*` file and never prints the token.
"""

from __future__ import annotations

import argparse
import base64
import hmac
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import quote
from contextlib import contextmanager
from pathlib import Path

import msvcrt

SOURCE_PARENT = Path(__file__).resolve().parent
APP_SCRIPTS_PARENT = (
    SOURCE_PARENT if (SOURCE_PARENT / "ship_gate_packet.py").is_file() else SOURCE_PARENT / "app-scripts"
)
sys.path.insert(0, str(SOURCE_PARENT))
sys.path.insert(0, str(APP_SCRIPTS_PARENT))
from app_auth import API, http_json  # noqa: E402
from ship_gate_packet import (  # noqa: E402
    collect_pr_snapshot,
    path_requires_elevated_scope,
    validate_snapshot,
)

GRAPHQL = "https://api.github.com/graphql"
DEFAULT_TOKEN_ENV = "BLIP_GITHUB_TOKEN"
DEFAULT_REVIEWER = "monkey1sai-blip"
DEFAULT_REVIEWER_ID = 311287868
DEFAULT_REPO = "monkey1sai/AI-BIM-governance"
DEFAULT_BASE_BRANCH = "main"
APPROVAL_CAPABILITY_ENV = "BLIP_APPROVAL_CAPABILITY"
APPROVAL_CAPABILITY_VERSION = "blip-approval-capability/v2"
PROTECTION_ATTESTATION_ENV = "BLIP_PROTECTION_ATTESTATION"
PROTECTION_ATTESTATION_VERSION = "blip-protection-attestation/v1"
PROTECTION_ATTESTATION_MAX_VALIDITY_SECONDS = 30 * 24 * 3600
PROTECTION_ATTESTATION_MAX_CHARS = 262144
MACHINE_REVIEW_MODES = frozenset({"mechanical_only", "focused_semantic", "risk_scoped_specialists"})
HUMAN_CRITICAL_REVIEW_MODE = "human_critical"
SUPPORTED_REVIEW_MODES = MACHINE_REVIEW_MODES | {HUMAN_CRITICAL_REVIEW_MODE}
SHIP_ATTESTERS = frozenset({"codex-tri-adversarial-bot", "codex-tri-adversarial-bot[bot]"})
SHIP_ATTESTER_ID = 311390181
BLOCKING_MARKER = re.compile(r"(?m)^VERDICT: (?:NO-SHIP|HELD)\s*$")
SHIP_ATTESTATION_PREFIX = "<!-- blip-ship-attestation:v1"
PLATFORM_SUCCESS_CONCLUSIONS = frozenset({"SUCCESS", "SKIPPED", "NEUTRAL"})
MANDATORY_REAL_SUCCESS_CHECKS = frozenset({"agent-governance"})
AGENT_GOVERNANCE_APP_ID = 15368
CODEX_FIX_MARKER_VERSION = "v2"
RUNTIME_STATE_ROOT = Path(__file__).resolve().parent / "state"
REPAIR_FINDING_PROVIDER_BY_AUTHOR = {
    "claude-tri-adversarial-bot": "anthropic_claude",
    "claude-tri-adversarial-bot[bot]": "anthropic_claude",
    "coderabbitai": "coderabbit",
    "coderabbitai[bot]": "coderabbit",
    "copilot-pull-request-reviewer": "github_copilot",
    "copilot-pull-request-reviewer[bot]": "github_copilot",
    "monkey1sai": "human_owner",
}
CODEX_FIXER_PROVIDER = "openai_codex"
TRUSTED_REPAIR_FINDING_AUTHORS = frozenset(REPAIR_FINDING_PROVIDER_BY_AUTHOR)


def log(msg: str) -> None:
    print(f"[blip] {msg}", flush=True)


def read_token(token_env: str) -> str:
    """Accept a broker-injected process value; protected `.env*` fallbacks are forbidden."""
    value = os.environ.get(token_env, "").strip()
    if value:
        return value
    raise SystemExit(
        f"No broker-injected {token_env} process value; protected .env fallbacks are disabled by governance"
    )


def redact(text: str, token: str) -> str:
    return text.replace(token, "<redacted-token>") if token else text


def graphql(token: str, query: str, variables: dict | None = None) -> dict:
    body = {"query": query, "variables": variables or {}}
    result = http_json("POST", GRAPHQL, token=token, body=body)
    if isinstance(result, dict) and result.get("errors"):
        raise SystemExit(f"GraphQL error: {json.dumps(result['errors'], ensure_ascii=False)[:600]}")
    return result if isinstance(result, dict) else {}


PR_QUERY = """
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      number title state isDraft headRefOid baseRefOid baseRefName
      author { login }
      reviewDecision mergeStateStatus
      autoMergeRequest { enabledAt mergeMethod }
      files(first:100) {
        pageInfo { hasNextPage }
        nodes { path additions deletions changeType }
      }
      commits(last:1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              contexts(first:100) {
                pageInfo { hasNextPage }
                nodes {
                  __typename
                  ... on CheckRun {
                    name status conclusion completedAt
                    checkSuite { app { databaseId slug } }
                  }
                  ... on StatusContext {
                    context state createdAt
                    creator { login }
                  }
                }
              }
            }
          }
        }
      }
      reviewThreads(first:100) {
        pageInfo { hasNextPage }
        nodes {
          id isResolved isOutdated path line
          comments(first:100) {
            pageInfo { hasNextPage }
            nodes {
              id author { login }
              body
              pullRequestReview { author { login } commit { oid } }
            }
          }
        }
      }
      reviews(first:100) {
        pageInfo { hasNextPage }
        nodes {
          id databaseId state body submittedAt url
          commit { oid }
          author { __typename login ... on Bot { databaseId } }
        }
      }
    }
  }
}
"""


def fetch_pr(token: str, owner: str, name: str, number: int) -> dict:
    data = graphql(token, PR_QUERY, {"owner": owner, "name": name, "number": number})
    pr = ((data.get("data") or {}).get("repository") or {}).get("pullRequest")
    if not pr:
        raise SystemExit(f"PR {owner}/{name}#{number} not found (or the token cannot see it)")
    return pr


def verify_identity(token: str, repo: str) -> dict:
    me = http_json("GET", f"{API}/user", token=token)
    login = me.get("login") if isinstance(me, dict) else None
    user_id = me.get("id") if isinstance(me, dict) else None
    user_type = me.get("type") if isinstance(me, dict) else None
    if login != DEFAULT_REVIEWER or user_id != DEFAULT_REVIEWER_ID or user_type != "User":
        raise SystemExit(
            f"Token identity is login={login!r} id={user_id!r} type={user_type!r}; refusing to act — "
            "the designated fixed reviewer account did not authenticate."
        )
    owner, _, name = repo.partition("/")
    perm = http_json("GET", f"{API}/repos/{owner}/{name}/collaborators/{login}/permission", token=token)
    level = perm.get("permission") if isinstance(perm, dict) else None
    if level != "write":
        raise SystemExit(f"{login} has permission={level!r}; the fixed reviewer must remain least-privilege write.")
    log(f"identity ok: {login} (permission={level})")
    return {"login": login, "id": user_id, "type": user_type, "permission": level}


def complete_nodes(block: object, label: str) -> list[dict]:
    if not isinstance(block, dict):
        raise SystemExit(f"{label} collection is missing or malformed; refusing incomplete state")
    page_info = block.get("pageInfo")
    nodes = block.get("nodes")
    if not isinstance(page_info, dict) or page_info.get("hasNextPage") is not False:
        raise SystemExit(f"{label} pagination is incomplete or malformed; refusing incomplete state")
    if not isinstance(nodes, list) or any(not isinstance(node, dict) for node in nodes):
        raise SystemExit(f"{label} nodes are missing or malformed; refusing incomplete state")
    return nodes


def review_threads(pr: dict) -> list[dict]:
    return complete_nodes(pr.get("reviewThreads"), "PR review threads")


def unresolved(pr: dict) -> list[dict]:
    threads = review_threads(pr)
    for thread in threads:
        thread_comments(thread)
    if any(t.get("isResolved") not in (True, False) for t in threads):
        raise SystemExit("A review thread has missing or malformed resolution state")
    return [t for t in threads if t.get("isResolved") is False]


def review_nodes(pr: dict) -> list[dict]:
    return complete_nodes(pr.get("reviews"), "PR reviews")


def thread_comments(thread: dict) -> list[dict]:
    return complete_nodes(thread.get("comments"), f"Thread {thread.get('id')} comments")


def validate_complete_thread_comments(pr: dict) -> None:
    for thread in review_threads(pr):
        thread_comments(thread)


def status_context_nodes(pr: dict) -> list[dict]:
    commits = (pr.get("commits") or {}).get("nodes")
    if not isinstance(commits, list) or len(commits) != 1 or not isinstance(commits[0], dict):
        raise SystemExit("Latest PR commit status collection is missing or malformed")
    commit = commits[0].get("commit")
    if not isinstance(commit, dict) or commit.get("oid") != pr.get("headRefOid"):
        raise SystemExit("Required-check rollup is not bound to the exact PR head")
    rollup = commit.get("statusCheckRollup")
    if not isinstance(rollup, dict):
        raise SystemExit("Required-check rollup is missing for the exact PR head")
    return complete_nodes(rollup.get("contexts"), "Exact-head status checks")


def normalized_changed_files(pr: dict) -> list[dict]:
    nodes = complete_nodes(pr.get("files"), "PR changed files")
    if not nodes:
        raise SystemExit("PR changed-file collection is empty; approval is HELD")
    normalized: list[dict] = []
    seen: set[str] = set()
    for node in nodes:
        path = node.get("path")
        additions = node.get("additions")
        deletions = node.get("deletions")
        change_type = node.get("changeType")
        if (
            not isinstance(path, str)
            or not path
            or path != path.strip()
            or path.startswith(("/", "\\"))
            or "\\" in path
            or any(segment in ("", ".", "..") for segment in path.split("/"))
            or re.search(r"[\x00-\x1f\x7f]", path)
        ):
            raise SystemExit("A PR changed path is malformed; approval is HELD")
        if not isinstance(additions, int) or additions < 0 or not isinstance(deletions, int) or deletions < 0:
            raise SystemExit(f"Changed-file counts are malformed for {path!r}")
        if not isinstance(change_type, str) or not change_type:
            raise SystemExit(f"Changed-file type is malformed for {path!r}")
        identity = path.casefold()
        if identity in seen:
            raise SystemExit(f"Changed path {path!r} is duplicated case-insensitively")
        seen.add(identity)
        normalized.append(
            {"path": path, "additions": additions, "deletions": deletions, "change_type": change_type.upper()}
        )
    normalized.sort(key=lambda entry: entry["path"].encode("utf-8"))
    return normalized


def changed_files_evidence(
    pr: dict,
    *,
    review_mode: str = "",
    human_critical_override: bool = False,
) -> dict:
    files = normalized_changed_files(pr)
    elevated_scope_allowed = (
        review_mode == HUMAN_CRITICAL_REVIEW_MODE and human_critical_override
    )
    for entry in files:
        if entry["change_type"] in ("RENAMED", "COPIED"):
            raise SystemExit(
                f"Changed path {entry['path']!r} is {entry['change_type']}; previous-path authority is unavailable, so approval is HELD"
            )
        if path_requires_elevated_scope(entry["path"]) and not elevated_scope_allowed:
            raise SystemExit(
                f"Changed path {entry['path']!r} is self-referential governance; human_critical approval is required"
            )
    digest = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return {"count": len(files), "sha256": digest, "files": files}


def fetch_immutable_pr_snapshot(token: str, pr_number: int) -> dict:
    try:
        return collect_pr_snapshot(
            http_json,
            API,
            token,
            DEFAULT_REPO,
            pr_number,
            require_patch=True,
        )
    except RuntimeError as exc:
        raise SystemExit(f"Immutable PR comparison failed: {exc}") from exc


def validate_immutable_pr_snapshot(
    *, pr: dict, snapshot: object, pr_number: int, base: str, head: str, changed_files: dict
) -> dict:
    try:
        immutable = validate_snapshot(snapshot, repo=DEFAULT_REPO, pr=pr_number)
    except RuntimeError as exc:
        raise SystemExit(f"Immutable PR comparison failed: {exc}") from exc
    if (
        immutable["meta"]["baseRefOid"] != base.lower()
        or immutable["meta"]["headRefOid"] != head.lower()
        or immutable["normalized_files"] != changed_files["files"]
        or immutable["changed_files_sha256"] != changed_files["sha256"]
    ):
        raise SystemExit("Immutable PR comparison differs from the GraphQL approval tuple")
    return {
        "sha256": immutable["diff_sha256"],
        "changed_files_sha256": immutable["changed_files_sha256"],
    }


def fetch_repository_safety(token: str, owner: str, name: str) -> dict:
    payload = http_json("GET", f"{API}/repos/{owner}/{name}", token=token)
    if not isinstance(payload, dict):
        raise SystemExit("Repository settings payload is malformed")
    if payload.get("full_name") != DEFAULT_REPO or payload.get("default_branch") != DEFAULT_BASE_BRANCH:
        raise SystemExit("Repository identity or default branch differs from the fixed approval scope")
    if payload.get("archived") is not False or payload.get("disabled") is not False:
        raise SystemExit("Archived, disabled, or malformed repository state cannot be approved")
    if payload.get("allow_auto_merge") is not False:
        raise SystemExit(
            "Repository-level auto-merge is not explicitly disabled; approve-only cannot be guaranteed, so approval is HELD"
        )
    normalized = {
        "full_name": DEFAULT_REPO,
        "default_branch": DEFAULT_BASE_BRANCH,
        "archived": False,
        "disabled": False,
        "allow_auto_merge": False,
    }
    normalized["sha256"] = hashlib.sha256(
        json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return normalized


def verify_protection_attestation(*, token: str, raw: str, base_branch: str) -> dict:
    """Verify the owner-minted signed protection snapshot.

    The write-scope reviewer receives HTTP 404 from the admin-only legacy
    protection endpoint, so the full policy arrives as an owner-signed packet
    (same shared-secret HMAC idiom as the approval capability). The broker
    still re-validates every policy field itself on the embedded snapshot.
    """
    if not raw:
        raise SystemExit(
            f"Branch protection verification requires an owner-minted {PROTECTION_ATTESTATION_ENV}; "
            "the least-privilege write reviewer cannot read the admin-only protection endpoint "
            "(mint one with mint_protection_attestation.py)"
        )
    if len(raw) > PROTECTION_ATTESTATION_MAX_CHARS:
        raise SystemExit("Protection attestation exceeds the protected size limit")
    encoded, separator, signature = raw.partition(".")
    if not separator or not re.fullmatch(r"[0-9a-fA-F]{64}", signature):
        raise SystemExit("Protection attestation format is invalid")
    try:
        padding = "=" * (-len(encoded) % 4)
        payload_text = base64.urlsafe_b64decode((encoded + padding).encode("ascii")).decode("utf-8")
    except (ValueError, UnicodeError):
        raise SystemExit("Protection attestation encoding is invalid") from None
    expected_signature = hmac.new(token.encode("utf-8"), payload_text.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature.lower(), expected_signature):
        raise SystemExit("Protection attestation signature is invalid")
    try:
        payload = json.loads(payload_text)
    except ValueError:
        raise SystemExit("Protection attestation payload is malformed") from None
    if not isinstance(payload, dict):
        raise SystemExit("Protection attestation payload is malformed")
    if payload.get("version") != PROTECTION_ATTESTATION_VERSION:
        raise SystemExit("Protection attestation version is unsupported")
    if payload.get("repository") != DEFAULT_REPO or payload.get("base_branch") != base_branch:
        raise SystemExit("Protection attestation is not bound to this exact repository and base branch")
    issued_at = payload.get("issued_at")
    expires_at = payload.get("expires_at")
    if (
        not isinstance(issued_at, int)
        or isinstance(issued_at, bool)
        or not isinstance(expires_at, int)
        or isinstance(expires_at, bool)
    ):
        raise SystemExit("Protection attestation timestamps are malformed")
    now = int(time.time())
    if issued_at > now + 300:
        raise SystemExit("Protection attestation issue time is in the future")
    if expires_at <= issued_at or expires_at <= now:
        raise SystemExit("Protection attestation is expired; ask the owner to re-mint it")
    if expires_at - issued_at > PROTECTION_ATTESTATION_MAX_VALIDITY_SECONDS:
        raise SystemExit("Protection attestation validity window is overlong")
    if payload.get("active_rules") != []:
        raise SystemExit("Protection attestation must record an empty active-ruleset state")
    protection = payload.get("protection")
    if not isinstance(protection, dict):
        raise SystemExit("Protection attestation payload is missing the protection snapshot")
    return {"issued_at": issued_at, "expires_at": expires_at, "protection": protection}


REF_UPDATE_RULE_QUERY = """
query($owner:String!, $name:String!, $qualifiedName:String!) {
  repository(owner:$owner, name:$name) {
    ref(qualifiedName:$qualifiedName) {
      refUpdateRule {
        pattern
        requiredApprovingReviewCount
        requiresCodeOwnerReviews
        requiresConversationResolution
        allowsForcePushes
        allowsDeletions
        blocksCreations
        requiresLinearHistory
        requiresSignatures
        requiredStatusCheckContexts
      }
    }
  }
}
"""


def fetch_live_ref_update_rule(token: str, owner: str, name: str, base_branch: str) -> dict:
    """Read the write-visible live protection subset (GraphQL `refUpdateRule`)."""
    data = graphql(
        token,
        REF_UPDATE_RULE_QUERY,
        {"owner": owner, "name": name, "qualifiedName": f"refs/heads/{base_branch}"},
    )
    ref = ((data.get("data") or {}).get("repository") or {}).get("ref")
    rule = (ref or {}).get("refUpdateRule")
    if not isinstance(rule, dict):
        raise SystemExit("Live branch protection is not visible on the base branch; approval is HELD")
    contexts = rule.get("requiredStatusCheckContexts")
    if not isinstance(contexts, list) or not all(
        isinstance(context, str) and context.strip() for context in contexts
    ):
        raise SystemExit("Live required status contexts are malformed")
    flags: dict[str, bool] = {}
    for field in (
        "requiresCodeOwnerReviews",
        "requiresConversationResolution",
        "allowsForcePushes",
        "allowsDeletions",
        "blocksCreations",
        "requiresLinearHistory",
        "requiresSignatures",
    ):
        value = rule.get(field)
        if not isinstance(value, bool):
            raise SystemExit(f"Live branch protection field {field!r} is malformed")
        flags[field] = value
    approvals = rule.get("requiredApprovingReviewCount")
    if not isinstance(approvals, int) or isinstance(approvals, bool):
        raise SystemExit("Live required approving review count is malformed")
    if rule.get("pattern") != base_branch:
        raise SystemExit("Live branch protection pattern is not bound to the base branch")
    return {
        "pattern": base_branch,
        "required_approving_review_count": approvals,
        "required_status_check_contexts": sorted({context.strip() for context in contexts}),
        "requires_code_owner_reviews": flags["requiresCodeOwnerReviews"],
        "requires_conversation_resolution": flags["requiresConversationResolution"],
        "allows_force_pushes": flags["allowsForcePushes"],
        "allows_deletions": flags["allowsDeletions"],
        "blocks_creations": flags["blocksCreations"],
        "requires_linear_history": flags["requiresLinearHistory"],
        "requires_signatures": flags["requiresSignatures"],
    }


def validate_protection_payload(protection: object, base_branch: str) -> dict:
    if not isinstance(protection, dict):
        raise SystemExit("Branch protection payload is missing or malformed")

    status = protection.get("required_status_checks")
    reviews = protection.get("required_pull_request_reviews")
    conversations = protection.get("required_conversation_resolution")
    enforce_admins = protection.get("enforce_admins")
    allow_force_pushes = protection.get("allow_force_pushes")
    allow_deletions = protection.get("allow_deletions")
    if not isinstance(status, dict) or status.get("strict") is not True:
        raise SystemExit("Branch protection must require strict status checks")
    if not isinstance(reviews, dict):
        raise SystemExit("Branch protection must require pull-request reviews")
    required_approvals = reviews.get("required_approving_review_count")
    if (
        not isinstance(required_approvals, int)
        or isinstance(required_approvals, bool)
        or required_approvals != 1
    ):
        raise SystemExit("Branch protection must require exactly one approving review")
    if reviews.get("dismiss_stale_reviews") is not True:
        raise SystemExit("Branch protection must dismiss stale reviews")
    if reviews.get("require_code_owner_reviews") is not True:
        raise SystemExit("Branch protection must require code-owner reviews")
    if not isinstance(conversations, dict) or conversations.get("enabled") is not True:
        raise SystemExit("Branch protection must require conversation resolution")
    if not isinstance(enforce_admins, dict) or enforce_admins.get("enabled") is not True:
        raise SystemExit("Branch protection must enforce administrators")
    if not isinstance(allow_force_pushes, dict) or allow_force_pushes.get("enabled") is not False:
        raise SystemExit("Branch protection must explicitly disallow force pushes")
    if not isinstance(allow_deletions, dict) or allow_deletions.get("enabled") is not False:
        raise SystemExit("Branch protection must explicitly disallow branch deletion")

    def enabled_setting(name: str) -> bool:
        value = protection.get(name)
        if not isinstance(value, dict) or not isinstance(value.get("enabled"), bool):
            raise SystemExit(f"Branch protection setting {name!r} is missing or malformed")
        return bool(value["enabled"])

    def require_empty_allowance(name: str, value: object) -> None:
        if value is None:
            return
        if not isinstance(value, dict):
            raise SystemExit(f"Branch protection {name} is malformed")
        for collection in ("users", "teams", "apps"):
            members = value.get(collection, [])
            if not isinstance(members, list):
                raise SystemExit(f"Branch protection {name}.{collection} is malformed")
            if members:
                raise SystemExit(f"Branch protection {name} grants a review bypass or dismissal allowance")

    require_empty_allowance("bypass_pull_request_allowances", reviews.get("bypass_pull_request_allowances"))
    require_empty_allowance("dismissal_restrictions", reviews.get("dismissal_restrictions"))
    if not isinstance(reviews.get("require_last_push_approval"), bool):
        raise SystemExit("Branch protection require_last_push_approval is missing or malformed")
    restrictions = protection.get("restrictions")
    if restrictions is not None:
        raise SystemExit("Branch push restrictions are outside the supported approval policy")

    raw_checks = status.get("checks")
    raw_contexts = status.get("contexts")
    if raw_checks is None:
        raw_checks = []
    if raw_contexts is None:
        raw_contexts = []
    if not isinstance(raw_checks, list) or not isinstance(raw_contexts, list):
        raise SystemExit("Required status-check definitions are malformed")

    required: dict[str, dict] = {}
    for entry in raw_checks:
        if not isinstance(entry, dict) or not isinstance(entry.get("context"), str):
            raise SystemExit("A required check definition is malformed")
        context = entry["context"].strip()
        app_id = entry.get("app_id")
        if not context or not isinstance(app_id, int) or app_id <= 0:
            raise SystemExit("A required check context or source is malformed")
        if context in required:
            raise SystemExit(f"Required check context {context!r} is duplicated or source-ambiguous")
        required[context] = {"context": context, "app_id": app_id}
    mirrored_contexts: set[str] = set()
    for context in raw_contexts:
        if not isinstance(context, str) or not context.strip():
            raise SystemExit("A required status context is malformed")
        context = context.strip()
        if context in mirrored_contexts:
            raise SystemExit(f"Required status context {context!r} is duplicated")
        mirrored_contexts.add(context)
    if mirrored_contexts != set(required):
        raise SystemExit("Required status contexts do not exactly mirror the source-bound check definitions")
    if not required:
        raise SystemExit("Branch protection has no non-empty required status checks")
    if not MANDATORY_REAL_SUCCESS_CHECKS.issubset(required):
        missing = ", ".join(sorted(MANDATORY_REAL_SUCCESS_CHECKS - set(required)))
        raise SystemExit(f"Automation governance checks are not required by branch protection: {missing}")
    governance_source = required["agent-governance"].get("app_id")
    if governance_source != AGENT_GOVERNANCE_APP_ID:
        raise SystemExit(
            "agent-governance must be source-bound to the fixed GitHub Actions App "
            f"id {AGENT_GOVERNANCE_APP_ID}, got {governance_source!r}"
        )

    normalized = {
        "base_branch": base_branch,
        "required": [required[key] for key in sorted(required)],
        "strict": True,
        "approvals": int(reviews.get("required_approving_review_count")),
        "dismiss_stale_reviews": True,
        "require_code_owner_reviews": True,
        "required_conversation_resolution": True,
        "enforce_admins": True,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "require_last_push_approval": reviews["require_last_push_approval"],
        "bypass_pull_request_allowances": {"users": [], "teams": [], "apps": []},
        "dismissal_restrictions": {"users": [], "teams": [], "apps": []},
        "required_linear_history": enabled_setting("required_linear_history"),
        "required_signatures": enabled_setting("required_signatures"),
        "lock_branch": enabled_setting("lock_branch"),
        "allow_fork_syncing": enabled_setting("allow_fork_syncing"),
        "block_creations": enabled_setting("block_creations"),
        "restrictions": None,
        "active_rulesets": [],
    }
    return normalized


def fetch_protection_policy(token: str, owner: str, name: str, base_branch: str) -> dict:
    encoded_branch = quote(base_branch, safe="")
    active_rules = http_json(
        "GET",
        f"{API}/repos/{owner}/{name}/rules/branches/{encoded_branch}?per_page=100",
        token=token,
    )
    if not isinstance(active_rules, list):
        raise SystemExit("Active branch rules payload is malformed")
    if len(active_rules) >= 100:
        raise SystemExit("Active branch rules may be paginated; refusing incomplete protection state")
    if active_rules:
        raise SystemExit("Active rulesets are present but this approval broker only supports verified legacy protection")

    attested = verify_protection_attestation(
        token=token,
        raw=os.environ.get(PROTECTION_ATTESTATION_ENV, "").strip(),
        base_branch=base_branch,
    )
    normalized = validate_protection_payload(attested["protection"], base_branch)

    live_rule = fetch_live_ref_update_rule(token, owner, name, base_branch)
    attested_expectations = [
        ("required_approving_review_count", normalized["approvals"]),
        ("requires_code_owner_reviews", normalized["require_code_owner_reviews"]),
        ("requires_conversation_resolution", normalized["required_conversation_resolution"]),
        ("allows_force_pushes", normalized["allow_force_pushes"]),
        ("allows_deletions", normalized["allow_deletions"]),
        ("blocks_creations", normalized["block_creations"]),
        ("requires_linear_history", normalized["required_linear_history"]),
        ("requires_signatures", normalized["required_signatures"]),
        ("required_status_check_contexts", sorted(entry["context"] for entry in normalized["required"])),
    ]
    for field, attested_value in attested_expectations:
        if live_rule[field] != attested_value:
            raise SystemExit(
                f"Live branch protection {field} differs from the owner attestation; approval is HELD"
            )
    normalized["live_rule"] = live_rule
    normalized["attestation"] = {
        "issued_at": attested["issued_at"],
        "expires_at": attested["expires_at"],
    }
    normalized["sha256"] = hashlib.sha256(
        json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return normalized


def validate_required_checks(pr: dict, policy: dict) -> dict:
    nodes = status_context_nodes(pr)
    by_name: dict[str, list[dict]] = {}
    for node in nodes:
        kind = node.get("__typename")
        if kind == "CheckRun":
            name = node.get("name")
        elif kind == "StatusContext":
            name = node.get("context")
        else:
            raise SystemExit(f"Unknown status-check node type {kind!r}")
        if not isinstance(name, str) or not name:
            raise SystemExit("A status-check node has no valid context name")
        by_name.setdefault(name, []).append(node)

    observed: list[dict] = []
    for required in policy["required"]:
        name = required["context"]
        candidates = by_name.get(name, [])
        app_id = required.get("app_id")
        if app_id is not None:
            candidates = [
                node
                for node in candidates
                if node.get("__typename") == "CheckRun"
                and (((node.get("checkSuite") or {}).get("app") or {}).get("databaseId") == app_id)
            ]
        if not candidates:
            raise SystemExit(f"Required check {name!r} is missing on the exact PR head")
        timestamps: list[str] = []
        for node in candidates:
            timestamp = node.get("completedAt") if node.get("__typename") == "CheckRun" else node.get("createdAt")
            if not isinstance(timestamp, str) or not timestamp:
                raise SystemExit(f"Required check {name!r} has no completion timestamp")
            timestamps.append(timestamp)
        latest_timestamp = max(timestamps)
        latest = [
            node
            for node in candidates
            if (node.get("completedAt") if node.get("__typename") == "CheckRun" else node.get("createdAt"))
            == latest_timestamp
        ]
        for node in latest:
            if node.get("__typename") == "CheckRun":
                status = node.get("status")
                conclusion = node.get("conclusion")
                allowed = {"SUCCESS"} if name in MANDATORY_REAL_SUCCESS_CHECKS else PLATFORM_SUCCESS_CONCLUSIONS
                if status != "COMPLETED" or conclusion not in allowed:
                    raise SystemExit(
                        f"Required check {name!r} is status={status!r} conclusion={conclusion!r}; approval is HELD"
                    )
                observed.append({"context": name, "kind": "CheckRun", "conclusion": conclusion})
            else:
                state = node.get("state")
                if state != "SUCCESS":
                    raise SystemExit(f"Required status {name!r} is state={state!r}; approval is HELD")
                observed.append({"context": name, "kind": "StatusContext", "conclusion": state})
    digest = hashlib.sha256(
        json.dumps(observed, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {"count": len(policy["required"]), "sha256": digest}


def validate_ship_attester_state(pr: dict, head: str) -> list[dict]:
    reviews = review_nodes(pr)
    if len(reviews) >= 100:
        raise SystemExit("Review collection is at capacity; post-submit readback would be incomplete")
    exact = [
        review
        for review in reviews
        if ((review.get("commit") or {}).get("oid") or "").lower() == head.lower()
        and ((review.get("author") or {}).get("login") in SHIP_ATTESTERS)
        and ((review.get("author") or {}).get("__typename") == "Bot")
        and ((review.get("author") or {}).get("databaseId") == SHIP_ATTESTER_ID)
    ]
    for review in exact:
        if review.get("state") == "APPROVED":
            raise SystemExit("The independent Codex App attester must never submit APPROVED")
        if review.get("state") == "CHANGES_REQUESTED":
            raise SystemExit(
                "Independent Codex attester requested changes on this exact head"
            )
        if BLOCKING_MARKER.search(str(review.get("body") or "")):
            raise SystemExit(
                "Independent Codex attester recorded NO-SHIP/HELD on this exact head"
            )
    return exact


def find_ship_attestation(
    pr: dict,
    base: str,
    head: str,
    review_mode: str,
    changed_files_sha256: str,
    diff_sha256: str,
) -> dict:
    exact = validate_ship_attester_state(pr, head)
    footer = (
        f"{SHIP_ATTESTATION_PREFIX}\n"
        f"repo={DEFAULT_REPO}\n"
        f"pr={pr.get('number')}\n"
        f"base={base.lower()}\n"
        f"head={head.lower()}\n"
        f"review_mode={review_mode}\n"
        f"changed_files_sha256={changed_files_sha256.lower()}\n"
        f"diff_sha256={diff_sha256.lower()}\n"
        "verdict=SHIP\n"
        "-->"
    )
    valid = [
        review
        for review in exact
        if review.get("state") == "COMMENTED"
        and str(review.get("body") or "").count(SHIP_ATTESTATION_PREFIX) == 1
        and str(review.get("body") or "").endswith(footer)
        and isinstance(review.get("databaseId"), int)
        and isinstance(review.get("submittedAt"), str)
        and str(review.get("url") or "").startswith("https://github.com/monkey1sai/AI-BIM-governance/pull/")
    ]
    if not valid:
        raise SystemExit(
            "No authenticated canonical base/head/mode/changed-files/diff-bound SHIP footer from the Codex Bot; "
            "approval is HELD"
        )
    if len(valid) != 1:
        raise SystemExit("The independent Codex App attestation must be unique on the exact head")
    selected = valid[0]
    return {
        "review_id": selected["databaseId"],
        "url": selected["url"],
        "submitted_at": selected["submittedAt"],
        "author": (selected.get("author") or {}).get("login"),
    }


def approval_capability_payload(
    *,
    repo: str,
    pr_number: int,
    base: str,
    head: str,
    review_mode: str,
    issued_at: int,
    expires_at: int,
    nonce: str,
    human_critical_override: bool = False,
) -> str:
    return "\n".join(
        [
            APPROVAL_CAPABILITY_VERSION,
            "approve",
            repo,
            str(pr_number),
            base.lower(),
            head.lower(),
            DEFAULT_REVIEWER,
            review_mode,
            f"human_critical_override={str(human_critical_override).lower()}",
            str(issued_at),
            str(expires_at),
            nonce.lower(),
        ]
    )


def verify_approval_capability(
    *,
    token: str,
    raw: str,
    repo: str,
    pr_number: int,
    base: str,
    head: str,
    review_mode: str,
    human_critical_override: bool = False,
) -> dict:
    encoded, separator, signature = raw.partition(".")
    if not separator or not re.fullmatch(r"[0-9a-fA-F]{64}", signature):
        raise SystemExit("Live approval requires a valid broker capability")
    try:
        padding = "=" * (-len(encoded) % 4)
        payload = base64.urlsafe_b64decode((encoded + padding).encode("ascii")).decode("utf-8")
    except (ValueError, UnicodeError):
        raise SystemExit("Approval capability encoding is invalid") from None
    fields = payload.split("\n")
    if len(fields) != 12:
        raise SystemExit("Approval capability payload is malformed")
    try:
        issued_at = int(fields[9])
        expires_at = int(fields[10])
    except ValueError:
        raise SystemExit("Approval capability timestamps are malformed") from None
    nonce = fields[11]
    if not re.fullmatch(r"[0-9a-f]{32}", nonce):
        raise SystemExit("Approval capability nonce is malformed")
    expected = approval_capability_payload(
        repo=repo,
        pr_number=pr_number,
        base=base,
        head=head,
        review_mode=review_mode,
        issued_at=issued_at,
        expires_at=expires_at,
        nonce=nonce,
        human_critical_override=human_critical_override,
    )
    if payload != expected:
        raise SystemExit("Approval capability is not bound to this exact operation")
    expected_signature = hmac.new(token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature.lower(), expected_signature):
        raise SystemExit("Approval capability signature is invalid")
    now = int(time.time())
    if issued_at > now + 30:
        raise SystemExit("Approval capability issue time is in the future")
    if expires_at <= issued_at or expires_at <= now or expires_at > issued_at + 600:
        raise SystemExit("Approval capability is expired or overlong")
    return {
        "nonce": nonce,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "human_critical_override": human_critical_override,
    }


def consume_capability_nonce(nonce: str) -> None:
    nonce_root = RUNTIME_STATE_ROOT / "approval-capability-nonces"
    nonce_root.mkdir(parents=True, exist_ok=True)
    nonce_path = nonce_root / f"{nonce}.used"
    try:
        descriptor = os.open(nonce_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    except FileExistsError:
        raise SystemExit("Approval capability nonce was already consumed; automatic retry is forbidden") from None
    with os.fdopen(descriptor, "wb", buffering=0) as stream:
        stream.write(str(int(time.time())).encode("ascii"))


def automated_approval_body(
    *,
    pr_number: int,
    base: str,
    head: str,
) -> str:
    return json.dumps(
        {
            "kind": "ai-bim-automated-approve-only",
            "version": 1,
            "automated": True,
            "repo": DEFAULT_REPO,
            "prNumber": pr_number,
            "headOid": head.lower(),
            "baseOid": base.lower(),
            "action": "approve-only",
        },
        separators=(",", ":"),
    )


def codex_fix_marker(pr_number: int, base: str, head: str, thread_id: str) -> str:
    return (
        f"<!-- codex-thread-fix:{CODEX_FIX_MARKER_VERSION} "
        f"pr={pr_number} base={base} head={head} thread={thread_id} -->"
    )


def codex_fix_body(pr_number: int, base: str, head: str, thread_id: str) -> str:
    marker = codex_fix_marker(pr_number, base, head, thread_id)
    return (
        "@codex Please fix the confirmed, in-scope `fix_now` finding in this review thread "
        f"for PR #{pr_number}, bound to exact base `{base}` and head `{head}`.\n\n"
        "Follow the applicable `AGENTS.md`, keep the change limited to this thread, and add or "
        "update the smallest targeted regression test. Do not resolve this conversation, approve, "
        "merge, change repository settings, or widen scope. If the head changed or the finding is "
        f"ambiguous, stop and report instead.\n\n{marker}"
    )


def validate_expected_ref(label: str, expected: str, actual: str) -> None:
    if len(expected) != 40 or any(char not in "0123456789abcdefABCDEF" for char in expected):
        raise SystemExit(f"--expected-{label} must be a full 40-character hexadecimal commit SHA")
    if expected.lower() != actual.lower():
        raise SystemExit(f"Expected {label} {expected[:7]}, but PR is now {actual[:7]}; rebuild the review cycle")


def validate_expected_head(expected: str, actual: str) -> None:
    validate_expected_ref("head", expected, actual)


def validate_cycle(pr: dict, pr_number: int, base: str, head: str, phase: str) -> None:
    if pr.get("state") != "OPEN":
        raise SystemExit(f"PR #{pr_number} is state={pr.get('state')!r} {phase}; refusing the mutation")
    validate_expected_ref("base", base, str(pr.get("baseRefOid") or ""))
    validate_expected_ref("head", head, str(pr.get("headRefOid") or ""))


@contextmanager
def exclusive_codex_fix_lock(pr_number: int, base: str, head: str, thread_id: str):
    lock_root = RUNTIME_STATE_ROOT / "codex-fix-locks"
    lock_root.mkdir(parents=True, exist_ok=True)
    thread_digest = hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:16]
    lock_path = lock_root / f"pr-{pr_number}-{base[:12]}-{head[:12]}-{thread_digest}.lock"
    try:
        descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_EXCL)
        os.write(descriptor, b"0")
        os.lseek(descriptor, 0, os.SEEK_SET)
    except FileExistsError:
        descriptor = os.open(lock_path, os.O_RDWR)
    handle = os.fdopen(descriptor, "r+b", buffering=0)
    try:
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise SystemExit(
                f"Another local @codex request is active for PR #{pr_number}, head {head[:7]}, thread {thread_id}"
            ) from None
        try:
            yield
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    finally:
        handle.close()


def select_codex_fix_target(pr: dict, thread_id: str, pr_number: int, base: str, head: str) -> dict:
    by_id = {t.get("id"): t for t in review_threads(pr)}
    target = by_id.get(thread_id)
    if not target:
        raise SystemExit(f"Thread {thread_id} is not a review thread on PR #{pr_number}")
    if target.get("isResolved") is not False:
        state = "already resolved" if target.get("isResolved") is True else "missing resolution state"
        raise SystemExit(f"Thread {thread_id} is {state}; refusing to trigger a repair")
    if target.get("isOutdated") is not False:
        state = "outdated" if target.get("isOutdated") is True else "missing outdated state"
        raise SystemExit(f"Thread {thread_id} is {state}; bind the repair request to a current thread")
    comments = thread_comments(target)
    if not comments:
        raise SystemExit(f"Thread {thread_id} has no root review comment; refusing unknown finding provenance")
    root = comments[0]
    first_author = ((root.get("author") or {}).get("login") or "")
    review = root.get("pullRequestReview")
    if not isinstance(review, dict):
        raise SystemExit(f"Thread {thread_id} root comment has no review provenance")
    review_author = ((review.get("author") or {}).get("login") or "")
    review_commit = ((review.get("commit") or {}).get("oid") or "")
    if first_author != review_author:
        raise SystemExit(f"Thread {thread_id} root comment/review authors do not match")
    if review_commit.lower() != head.lower():
        raise SystemExit(
            f"Thread {thread_id} finding review is bound to {review_commit[:7] or 'unknown'}, not head {head[:7]}"
        )
    producer_provider = REPAIR_FINDING_PROVIDER_BY_AUTHOR.get(review_author)
    if producer_provider is None:
        raise SystemExit(f"Thread {thread_id} review producer {review_author!r} has no governed provider mapping")
    if producer_provider == CODEX_FIXER_PROVIDER:
        raise SystemExit(f"Thread {thread_id} finding producer and fixer are both {CODEX_FIXER_PROVIDER}")
    comment_authors = [((comment.get("author") or {}).get("login") or "") for comment in comments]
    codex_authors = [author for author in comment_authors if "codex" in author.casefold()]
    if codex_authors:
        raise SystemExit(
            f"Thread {thread_id} contains Codex identity {codex_authors[0]!r}; "
            "reviewer and @codex fixer must be different assignments"
        )
    if first_author not in TRUSTED_REPAIR_FINDING_AUTHORS:
        raise SystemExit(
            f"Thread {thread_id} author {first_author!r} is not in the governed repair-finding allowlist"
        )
    marker = codex_fix_marker(pr_number, base, head, thread_id)
    if any(
        ((comment.get("author") or {}).get("login") == DEFAULT_REVIEWER)
        and marker in str(comment.get("body", ""))
        for comment in comments
    ):
        raise SystemExit(f"Thread {thread_id} already has an @codex repair request for head {head[:7]}")
    if len(comments) != 1:
        raise SystemExit(
            f"Thread {thread_id} has {len(comments)} comments; live repair accepts only the authenticated root finding"
        )
    if "@codex" in str(root.get("body", "")).casefold():
        raise SystemExit(f"Thread {thread_id} root finding already mentions @codex; refusing a nested trigger")
    return target


def request_codex_fixes(
    *,
    token: str,
    owner: str,
    name: str,
    pr_number: int,
    initial_pr: dict,
    base: str,
    head: str,
    thread_ids: list[str],
    live: bool,
    confirm_fix_now: bool,
    acknowledge_unverified: bool,
) -> None:
    if len(thread_ids) != 1:
        raise SystemExit("Exactly one --request-codex-fix thread is allowed per exact-head operation")

    for thread_id in thread_ids:
        validate_cycle(initial_pr, pr_number, base, head, "at survey")
        target = select_codex_fix_target(initial_pr, thread_id, pr_number, base, head)
        log(
            f"{'WOULD REQUEST' if not live else 'REQUESTING'} @codex repair on {thread_id} "
            f"({json.dumps(str(target.get('path')), ensure_ascii=True)}:{target.get('line') or '-'}) "
            f"base={base[:7]} head={head[:7]}"
        )

    if not live:
        log("dry-run — @codex thread-fix capability remains unverified; pass both acknowledgement flags and --live")
        return
    if not confirm_fix_now:
        raise SystemExit("Live @codex request requires --confirm-fix-now")
    if not acknowledge_unverified:
        raise SystemExit("Live @codex request requires --ack-unverified-codex-fix")

    thread_id = thread_ids[0]
    with exclusive_codex_fix_lock(pr_number, base, head, thread_id):
        before = fetch_pr(token, owner, name, pr_number)
        validate_cycle(before, pr_number, base, head, "before @codex request")
        select_codex_fix_target(before, thread_id, pr_number, base, head)
        body = codex_fix_body(pr_number, base, head, thread_id)
        result = graphql(
            token,
            "mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply("
            "input:{pullRequestReviewThreadId:$id, body:$body}){comment{id body}}}",
            {"id": thread_id, "body": body},
        )
        comment = (((result.get("data") or {}).get("addPullRequestReviewThreadReply") or {}).get("comment") or {})
        if codex_fix_marker(pr_number, base, head, thread_id) not in str(comment.get("body", "")):
            raise SystemExit(f"GitHub did not confirm the bound @codex reply for thread {thread_id}")
        after = fetch_pr(token, owner, name, pr_number)
        validate_cycle(after, pr_number, base, head, "after @codex request; the posted comment is stale")
        log(f"posted @codex repair request comment={comment.get('id')} thread={thread_id} head={head[:7]}")


@contextmanager
def exclusive_approval_lock(pr_number: int, base: str, head: str):
    lock_root = RUNTIME_STATE_ROOT / "approval-locks"
    lock_root.mkdir(parents=True, exist_ok=True)
    lock_path = lock_root / f"pr-{pr_number}-{base[:12]}-{head[:12]}-{DEFAULT_REVIEWER}.lock"
    try:
        descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_EXCL)
        os.write(descriptor, b"0")
        os.lseek(descriptor, 0, os.SEEK_SET)
    except FileExistsError:
        descriptor = os.open(lock_path, os.O_RDWR)
    handle = os.fdopen(descriptor, "r+b", buffering=0)
    try:
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise SystemExit(
                f"Another local approval is active for PR #{pr_number}, base {base[:7]}, head {head[:7]}"
            ) from None
        try:
            yield
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    finally:
        handle.close()


def approval_preflight(
    *,
    token: str,
    owner: str,
    name: str,
    pr_number: int,
    pr: dict,
    base: str,
    head: str,
    review_mode: str,
    human_critical_override: bool = False,
) -> dict:
    validate_cycle(pr, pr_number, base, head, "during approval preflight")
    if pr.get("baseRefName") != DEFAULT_BASE_BRANCH:
        raise SystemExit(
            f"Automatic approval is limited to base branch {DEFAULT_BASE_BRANCH!r}, got {pr.get('baseRefName')!r}"
        )
    if pr.get("isDraft") is not False:
        raise SystemExit("Draft or malformed PR state cannot be approved")
    if pr.get("autoMergeRequest") is not None:
        raise SystemExit("Auto-merge is enabled; approval could trigger a merge, so this approve-only broker is HELD")
    if review_mode in MACHINE_REVIEW_MODES:
        if human_critical_override:
            raise SystemExit("human_critical_override is forbidden for machine review modes")
    elif review_mode == HUMAN_CRITICAL_REVIEW_MODE:
        if not human_critical_override:
            raise SystemExit("human_critical review mode requires an explicit owner-broker override")
    else:
        raise SystemExit("Unknown review mode is not eligible for approval")
    author = ((pr.get("author") or {}).get("login") or "")
    if author == DEFAULT_REVIEWER:
        raise SystemExit("The reviewer account authored this PR; GitHub rejects self-approval")
    merge_state = pr.get("mergeStateStatus")
    if merge_state not in ("CLEAN", "BLOCKED"):
        raise SystemExit(f"PR merge state is {merge_state!r}; automatic approval requires CLEAN or review-only BLOCKED")
    review_decision = pr.get("reviewDecision")
    if review_decision not in ("REVIEW_REQUIRED", "APPROVED"):
        raise SystemExit(f"PR review decision is {review_decision!r}; automatic approval is HELD")

    remaining = unresolved(pr)
    if remaining:
        show_threads(remaining)
        raise SystemExit(f"Refusing to approve: {len(remaining)} unresolved review thread(s) remain")
    reviews = review_nodes(pr)
    duplicates = [
        review
        for review in reviews
        if ((review.get("author") or {}).get("login") == DEFAULT_REVIEWER)
        and review.get("state") == "APPROVED"
        and (((review.get("commit") or {}).get("oid") or "").lower() == head.lower())
    ]
    if duplicates:
        raise SystemExit(
            f"{DEFAULT_REVIEWER} already approved this exact head ({duplicates[0].get('databaseId') or duplicates[0].get('id')})"
        )

    changed_files = changed_files_evidence(
        pr,
        review_mode=review_mode,
        human_critical_override=human_critical_override,
    )
    immutable_diff = validate_immutable_pr_snapshot(
        pr=pr,
        snapshot=fetch_immutable_pr_snapshot(token, pr_number),
        pr_number=pr_number,
        base=base,
        head=head,
        changed_files=changed_files,
    )
    identity = verify_identity(token, DEFAULT_REPO)
    if review_mode in MACHINE_REVIEW_MODES:
        attestation = find_ship_attestation(
            pr,
            base,
            head,
            review_mode,
            changed_files["sha256"],
            immutable_diff["sha256"],
        )
    else:
        validate_ship_attester_state(pr, head)
        attestation = {"kind": "human_critical_override"}
    repository_safety = fetch_repository_safety(token, owner, name)
    policy = fetch_protection_policy(token, owner, name, str(pr.get("baseRefName")))
    checks = validate_required_checks(pr, policy)
    authority_label = (
        f"attestation_review_id={attestation['review_id']}"
        if "review_id" in attestation
        else attestation["kind"]
    )
    log(
        f"approval preflight ok: base={base[:7]} head={head[:7]} review_mode={review_mode} "
        f"changed_files={changed_files['count']} required_checks={checks['count']} "
        f"authority={authority_label}"
    )
    return {
        "identity": identity,
        "attestation": attestation,
        "changed_files": changed_files,
        "immutable_diff": immutable_diff,
        "repository_safety": repository_safety,
        "policy": policy,
        "checks": checks,
    }


def validate_approval_response(result: object, *, pr_number: int, head: str, body: str) -> dict:
    if not isinstance(result, dict):
        raise SystemExit("GitHub approval response is malformed")
    user = result.get("user")
    review_id = result.get("id")
    html_url = str(result.get("html_url") or "")
    if not isinstance(user, dict):
        raise SystemExit("GitHub approval response has no reviewer identity")
    if user.get("login") != DEFAULT_REVIEWER or user.get("id") != DEFAULT_REVIEWER_ID or user.get("type") != "User":
        raise SystemExit("GitHub approval response reviewer identity does not match the fixed User")
    if not isinstance(review_id, int) or review_id <= 0:
        raise SystemExit("GitHub approval response has no valid review id")
    if result.get("state") != "APPROVED":
        raise SystemExit(f"GitHub approval response state is {result.get('state')!r}, not APPROVED")
    if str(result.get("commit_id") or "").lower() != head.lower():
        raise SystemExit("GitHub approval response is not bound to the exact head")
    if str(result.get("body") or "") != body:
        raise SystemExit("GitHub approval response body differs from the canonical automated audit body")
    expected_prefix = f"https://github.com/monkey1sai/AI-BIM-governance/pull/{pr_number}#pullrequestreview-"
    if not html_url.startswith(expected_prefix):
        raise SystemExit("GitHub approval response URL is outside the expected PR")
    if not isinstance(result.get("submitted_at"), str) or not result.get("submitted_at"):
        raise SystemExit("GitHub approval response has no submission timestamp")
    return {"review_id": review_id, "html_url": html_url}


def submit_automated_approval(
    *,
    token: str,
    owner: str,
    name: str,
    repo: str,
    pr_number: int,
    base: str,
    head: str,
    review_mode: str,
    capability_raw: str,
    human_critical_override: bool = False,
) -> dict:
    capability = verify_approval_capability(
        token=token,
        raw=capability_raw,
        repo=repo,
        pr_number=pr_number,
        base=base,
        head=head,
        review_mode=review_mode,
        human_critical_override=human_critical_override,
    )
    with exclusive_approval_lock(pr_number, base, head):
        before = fetch_pr(token, owner, name, pr_number)
        first = approval_preflight(
            token=token,
            owner=owner,
            name=name,
            pr_number=pr_number,
            pr=before,
            base=base,
            head=head,
            review_mode=review_mode,
            human_critical_override=human_critical_override,
        )

        final = fetch_pr(token, owner, name, pr_number)
        ready = approval_preflight(
            token=token,
            owner=owner,
            name=name,
            pr_number=pr_number,
            pr=final,
            base=base,
            head=head,
            review_mode=review_mode,
            human_critical_override=human_critical_override,
        )
        if ready["policy"]["sha256"] != first["policy"]["sha256"]:
            raise SystemExit("Branch protection changed during approval preflight")
        if ready["identity"] != first["identity"]:
            raise SystemExit("Reviewer identity or permission changed during approval preflight")
        if ready["repository_safety"]["sha256"] != first["repository_safety"]["sha256"]:
            raise SystemExit("Repository safety settings changed during approval preflight")
        if ready["changed_files"]["sha256"] != first["changed_files"]["sha256"]:
            raise SystemExit("Changed-file evidence changed during approval preflight")
        if ready["immutable_diff"] != first["immutable_diff"]:
            raise SystemExit("Immutable patch evidence changed during approval preflight")
        if ready["attestation"] != first["attestation"]:
            raise SystemExit("Approval authority evidence changed during approval preflight")
        if ready["checks"]["sha256"] != first["checks"]["sha256"]:
            raise SystemExit("Required-check evidence changed during approval preflight")

        capability = verify_approval_capability(
            token=token,
            raw=capability_raw,
            repo=repo,
            pr_number=pr_number,
            base=base,
            head=head,
            review_mode=review_mode,
            human_critical_override=human_critical_override,
        )
        consume_capability_nonce(capability["nonce"])
        body = automated_approval_body(
            pr_number=pr_number,
            base=base,
            head=head,
        )
        result = http_json(
            "POST",
            f"{API}/repos/{owner}/{name}/pulls/{pr_number}/reviews",
            token=token,
            body={"commit_id": head, "event": "APPROVE", "body": body},
        )
        confirmed = validate_approval_response(result, pr_number=pr_number, head=head, body=body)

        after = fetch_pr(token, owner, name, pr_number)
        validate_cycle(after, pr_number, base, head, "after approval; review was submitted but the PR moved")
        if after.get("autoMergeRequest") is not None:
            raise SystemExit("Auto-merge became enabled after approval; review was submitted but no retry is allowed")
        if after.get("reviewDecision") != "APPROVED":
            raise SystemExit(
                f"Review {confirmed['review_id']} posted, but reviewDecision={after.get('reviewDecision')!r}; counted approval unconfirmed"
            )
        readback = [
            review
            for review in review_nodes(after)
            if review.get("databaseId") == confirmed["review_id"]
            and review.get("state") == "APPROVED"
            and ((review.get("author") or {}).get("login") == DEFAULT_REVIEWER)
            and ((review.get("author") or {}).get("__typename") == "User")
            and (((review.get("commit") or {}).get("oid") or "").lower() == head.lower())
            and str(review.get("body") or "") == body
        ]
        if len(readback) != 1:
            raise SystemExit(f"Approval review {confirmed['review_id']} could not be read back exactly once")
        after_identity = verify_identity(token, DEFAULT_REPO)
        if after_identity != ready["identity"]:
            raise SystemExit("Reviewer identity or permission changed after approval; review was submitted but no retry is allowed")
        after_policy = fetch_protection_policy(token, owner, name, str(after.get("baseRefName")))
        if after_policy["sha256"] != ready["policy"]["sha256"]:
            raise SystemExit("Branch protection changed after approval; review was submitted but no retry is allowed")
        after_repository_safety = fetch_repository_safety(token, owner, name)
        if after_repository_safety["sha256"] != ready["repository_safety"]["sha256"]:
            raise SystemExit("Repository safety settings changed after approval; review was submitted but no retry is allowed")
        after_changed_files = changed_files_evidence(
            after,
            review_mode=review_mode,
            human_critical_override=human_critical_override,
        )
        if after_changed_files["sha256"] != ready["changed_files"]["sha256"]:
            raise SystemExit("Changed-file evidence changed after approval; review was submitted but no retry is allowed")
        after_immutable_diff = validate_immutable_pr_snapshot(
            pr=after,
            snapshot=fetch_immutable_pr_snapshot(token, pr_number),
            pr_number=pr_number,
            base=base,
            head=head,
            changed_files=after_changed_files,
        )
        if after_immutable_diff != ready["immutable_diff"]:
            raise SystemExit("Immutable patch evidence changed after approval; review was submitted but no retry is allowed")
        after_checks = validate_required_checks(after, after_policy)
        if after_checks["sha256"] != ready["checks"]["sha256"]:
            raise SystemExit("Required-check evidence changed after approval; review was submitted but no retry is allowed")
        if review_mode in MACHINE_REVIEW_MODES:
            after_attestation = find_ship_attestation(
                after,
                base,
                head,
                review_mode,
                ready["changed_files"]["sha256"],
                ready["immutable_diff"]["sha256"],
            )
        else:
            validate_ship_attester_state(after, head)
            after_attestation = {"kind": "human_critical_override"}
        if after_attestation != ready["attestation"]:
            raise SystemExit("Approval authority evidence changed after approval; review was submitted but no retry is allowed")
        if unresolved(after):
            raise SystemExit("A review thread became unresolved after approval; review was submitted but no retry is allowed")
        log(
            f"APPROVAL_RESULT review_id={confirmed['review_id']} state=APPROVED head={head} "
            f"url={confirmed['html_url']} automated=true"
        )
        return confirmed


def validate_cli(cli: argparse.Namespace) -> None:
    requested = list(cli.request_codex_fix or [])
    human_critical_override = bool(getattr(cli, "human_critical_override", False))
    if cli.resolve_all:
        raise SystemExit("Bulk --resolve-all is disabled; resolve one explicitly reviewed thread per invocation")
    if len(cli.resolve) > 1:
        raise SystemExit("Resolve exactly one explicitly reviewed thread per invocation")
    if cli.reply and not cli.resolve:
        raise SystemExit("--reply requires one explicit --resolve target")
    if cli.body or cli.body_file:
        raise SystemExit("Caller-supplied approval bodies are disabled; the audit body is canonical")
    if cli.allow_unresolved or cli.allow_duplicate:
        raise SystemExit("Approval bypass flags --allow-unresolved and --allow-duplicate are disabled")
    if cli.live and (cli.resolve or cli.resolve_all):
        raise SystemExit("Live thread resolution is permanently disabled in this helper")
    if (cli.resolve or cli.resolve_all) and cli.approve:
        raise SystemExit("Resolve and approval are separate mutations and cannot be combined")
    if requested:
        if len(requested) != 1:
            raise SystemExit("Exactly one --request-codex-fix thread is allowed per exact-head operation")
        if not cli.expected_base or not cli.expected_head:
            raise SystemExit(
                "--request-codex-fix requires --expected-base and --expected-head from the validated review cycle"
            )
        incompatible = bool(
            cli.resolve
            or cli.resolve_all
            or cli.reply
            or cli.approve
            or cli.review_mode
            or human_critical_override
        )
        if incompatible:
            raise SystemExit("--request-codex-fix is reply-only and cannot be combined with resolve or approval options")
    elif cli.confirm_fix_now or cli.ack_unverified_codex_fix:
        raise SystemExit("Codex repair head and acknowledgement flags require --request-codex-fix")
    elif cli.approve:
        if not cli.expected_base or not cli.expected_head:
            raise SystemExit("Approval requires --expected-base and --expected-head from the validated review cycle")
        if not cli.review_mode:
            raise SystemExit("Approval requires --review-mode")
        if cli.review_mode == HUMAN_CRITICAL_REVIEW_MODE:
            if not human_critical_override:
                raise SystemExit("human_critical approval requires --human-critical-override")
            if not cli.live:
                raise SystemExit("--human-critical-override is valid only for a live owner-broker operation")
        elif human_critical_override:
            raise SystemExit("--human-critical-override is forbidden for machine review modes")
    elif human_critical_override:
        raise SystemExit("--human-critical-override is only valid with --approve")
    elif cli.review_mode:
        raise SystemExit("--review-mode is only valid with --approve")
    elif cli.expected_base:
        raise SystemExit("--expected-base is only valid with --request-codex-fix or --approve")
    elif cli.expected_head and not (cli.approve or cli.resolve):
        raise SystemExit("--expected-head requires a repair request, one resolve target, or approval dry-run")
    if cli.reply and "@codex" in cli.reply.casefold():
        raise SystemExit("Generic --reply cannot mention @codex; use the guarded --request-codex-fix mode")
    if cli.live and not (cli.approve or requested):
        raise SystemExit("--live requires one governed approval or @codex repair operation")
    if cli.live and cli.approve and not os.environ.get(APPROVAL_CAPABILITY_ENV, "").strip():
        raise SystemExit("Live approval requires an owner-broker capability")


def show_threads(threads: list[dict]) -> None:
    if not threads:
        log("no unresolved review threads")
        return
    log(f"{len(threads)} unresolved review thread(s):")
    for t in threads:
        first = ((t.get("comments") or {}).get("nodes") or [{}])[0]
        author = ((first.get("author") or {}) or {}).get("login", "?")
        raw_body = str(first.get("body", ""))
        body_digest = hashlib.sha256(raw_body.encode("utf-8")).hexdigest()[:12]
        thread_display = json.dumps(str(t.get("id")), ensure_ascii=True)
        path_display = json.dumps(str(t.get("path")), ensure_ascii=True)
        author_display = json.dumps(str(author), ensure_ascii=True)
        print(f"  - {thread_display}")
        print(f"    {path_display}:{t.get('line') or '-'}  outdated={t.get('isOutdated')}  by {author_display}")
        print(f"    body_chars={len(raw_body)} sha256={body_digest} (content not echoed)")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Survey PR state, request one repair, or submit one broker-capability-bound approval"
    )
    parser.add_argument("--repo", default=DEFAULT_REPO, choices=[DEFAULT_REPO])
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--resolve", action="append", default=[], metavar="THREAD_ID", help="Preview one resolution")
    parser.add_argument("--resolve-all", action="store_true", help="Resolve every unresolved thread")
    parser.add_argument("--reply", default="", help="Post this reply on each thread before resolving (audit trail)")
    parser.add_argument(
        "--request-codex-fix",
        action="append",
        default=[],
        metavar="THREAD_ID",
        help="Post a reply-only, exact-head @codex repair request to one unresolved current thread",
    )
    parser.add_argument(
        "--expected-base",
        default="",
        metavar="FULL_SHA",
        help="Full exact base SHA from the validated review cycle; required for repair or approval",
    )
    parser.add_argument(
        "--expected-head",
        default="",
        metavar="FULL_SHA",
        help="Full exact head SHA from the validated review cycle; required for repair or approval",
    )
    parser.add_argument(
        "--confirm-fix-now",
        action="store_true",
        help="Confirm each requested thread is a validated confirmed + in_scope + fix_now finding",
    )
    parser.add_argument(
        "--ack-unverified-codex-fix",
        action="store_true",
        help="Acknowledge that official/local evidence has not yet proven @codex can repair a review thread",
    )
    parser.add_argument("--approve", action="store_true", help="Run the guarded approval preflight")
    parser.add_argument(
        "--review-mode",
        choices=sorted(SUPPORTED_REVIEW_MODES),
        default="",
        help="Validated review mode",
    )
    parser.add_argument("--human-critical-override", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--body", default="", help=argparse.SUPPRESS)
    parser.add_argument("--body-file", type=Path, help=argparse.SUPPRESS)
    parser.add_argument(
        "--allow-unresolved",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    parser.add_argument("--allow-duplicate", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--live", action="store_true", help="Perform the capability-bound mutation")
    cli = parser.parse_args()
    validate_cli(cli)

    owner, _, name = cli.repo.partition("/")
    if not owner or not name:
        raise SystemExit(f"Bad --repo: {cli.repo}")

    token = read_token(DEFAULT_TOKEN_ENV)
    capability_raw = ""
    if cli.approve and cli.live:
        capability_raw = os.environ.get(APPROVAL_CAPABILITY_ENV, "").strip()
        verify_approval_capability(
            token=token,
            raw=capability_raw,
            repo=cli.repo,
            pr_number=cli.pr,
            base=cli.expected_base,
            head=cli.expected_head,
            review_mode=cli.review_mode,
            human_critical_override=cli.human_critical_override,
        )
    try:
        verify_identity(token, cli.repo)
        pr = fetch_pr(token, owner, name, cli.pr)
    except SystemExit as exc:
        raise SystemExit(redact(str(exc), token)) from None

    base = pr.get("baseRefOid", "")
    head = pr.get("headRefOid", "")
    author = (pr.get("author") or {}).get("login")
    log(f"#{cli.pr} {pr.get('title')!r} by {author} base={base[:7]} head={head[:7]} state={pr.get('state')} "
        f"reviewDecision={pr.get('reviewDecision')} mergeState={pr.get('mergeStateStatus')}")
    if author == DEFAULT_REVIEWER:
        raise SystemExit("The reviewer account authored this PR; GitHub rejects self-approval.")
    if cli.expected_base:
        validate_expected_ref("base", cli.expected_base, base)
    if cli.expected_head:
        validate_expected_head(cli.expected_head, head)
    if cli.live and (cli.request_codex_fix or cli.resolve or cli.approve) and pr.get("state") != "OPEN":
        raise SystemExit(f"PR #{cli.pr} is state={pr.get('state')}; refusing a live mutation")

    threads = unresolved(pr)
    show_threads(threads)

    if cli.request_codex_fix:
        if pr.get("state") != "OPEN":
            raise SystemExit(f"PR #{cli.pr} is state={pr.get('state')}; refusing an @codex repair request")
        validate_expected_ref("base", cli.expected_base, base)
        validate_expected_head(cli.expected_head, head)
        request_codex_fixes(
            token=token,
            owner=owner,
            name=name,
            pr_number=cli.pr,
            initial_pr=pr,
            base=base,
            head=head,
            thread_ids=cli.request_codex_fix,
            live=cli.live,
            confirm_fix_now=cli.confirm_fix_now,
            acknowledge_unverified=cli.ack_unverified_codex_fix,
        )

    targets: list[dict] = []
    if cli.resolve_all:
        targets = threads
    elif cli.resolve:
        by_id = {t["id"]: t for t in threads}
        for tid in cli.resolve:
            if tid not in by_id:
                raise SystemExit(f"Thread {tid} is not an unresolved thread on this PR")
            targets.append(by_id[tid])

    if targets:
        log(f"would resolve {len(targets)} thread(s)"
            + (f", replying first: {cli.reply!r}" if cli.reply else ""))

    if not cli.approve:
        log("done (no --approve requested)")
        return 0

    if not cli.live:
        approval_preflight(
            token=token,
            owner=owner,
            name=name,
            pr_number=cli.pr,
            pr=pr,
            base=cli.expected_base,
            head=cli.expected_head,
            review_mode=cli.review_mode,
            human_critical_override=cli.human_critical_override,
        )
        body = automated_approval_body(
            pr_number=cli.pr,
            base=cli.expected_base,
            head=cli.expected_head,
        )
        log(f"would submit APPROVE on exact head {head[:7]} ({len(body)} canonical audit chars)")
        log("dry-run only — live mutation requires the owner-controlled broker capability")
        return 0

    submit_automated_approval(
        token=token,
        owner=owner,
        name=name,
        repo=cli.repo,
        pr_number=cli.pr,
        base=cli.expected_base,
        head=cli.expected_head,
        review_mode=cli.review_mode,
        capability_raw=capability_raw,
        human_critical_override=cli.human_critical_override,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"[blip] FAILED: {str(exc)[:600]}", file=sys.stderr)
        sys.exit(1)
