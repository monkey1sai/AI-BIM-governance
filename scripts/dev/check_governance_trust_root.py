#!/usr/bin/env python3
"""Default-branch-owned checks that a PR cannot weaken its own governance.

This program is designed to be executed from the base checkout by a
``pull_request_target`` workflow.  The candidate checkout is treated as data:
no module, action, hook, or executable from it is loaded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


MAX_DOCUMENT_BYTES = 1_048_576
REVIEWER_LOGIN = "monkey1sai-blip"
REVIEWER_ID = 311287868
REVIEWER_PERMISSION = "write"

OBSERVED_BASELINE = "architecture/observed-baseline.json"
LAYER_BASELINE = "architecture/layer-baseline.json"
REVIEW_POLICY = "scripts/autonomous-codex-review-policy.json"
REVIEW_POLICY_SCHEMA = "scripts/tests/autonomous-codex-review-policy.schema.json"
REVIEW_OPEN_SPEC = "openspec/changes/parallel-delivery-fabric/specs/parallel-delivery-fabric/spec.md"
REVIEW_OPEN_SPEC_BASE_SHA = "df227cc1e07cb0bb6a683ef4c6df6c9f22284529"
REVIEW_OPEN_SPEC_SHA256 = "fb3d378d17688721238516061ac8fe9d8e45d2d6d8566adb083269518367a0ae"
REVIEW_POLICY_INVENTORY_MAX_DEPTH = 12
REVIEW_POLICY_INVENTORY_MAX_ENTRIES = 512
REVIEW_POLICY_IGNORED_DIRECTORIES = {".generated", ".git", "generated", "node_modules"}
REVIEW_POLICY_FILENAME = re.compile(
    r"^autonomous-codex-review-policy.*\.json(?:[.~_-].*)?$", re.IGNORECASE
)

CANONICAL_REVIEW_POLICY: dict[str, Any] = {
    "schema_version": "autonomous-codex-review-policy/v1",
    "phase": "LEGACY_GUARDED",
    "phase_order": [
        "LEGACY_GUARDED",
        "SHADOW_DUAL",
        "CUTOVER_ARMED",
        "CANARY_ACTIVE",
        "AUTONOMOUS_ACTIVE",
    ],
    "open_spec": {
        "source_kind": "base_pinned_openspec",
        "source_path": REVIEW_OPEN_SPEC,
        "base_sha": REVIEW_OPEN_SPEC_BASE_SHA,
        "source_sha256": REVIEW_OPEN_SPEC_SHA256,
    },
    "external_check": {
        "source_kind": "github_app",
        "source_ref": "base:monkey1sai-codex",
        "app_slug": "monkey1sai-codex",
        "app_id": 481516,
        "check_name": "monkey1sai-codex/ready",
        "required": True,
    },
    "external_activation": {
        "evidence_refs": [
            "external:settings-lease",
            "external:rollback-snapshot",
            "external:authoritative-reread",
            "external:activation-canary",
        ],
        "machine_sink_enabled": False,
        "candidate_inaccessible_authenticity": "HELD_EXTERNAL_ACTIVATION",
    },
    "legacy_gate": {
        "counted_review_required": True,
        "direct_stack": "HELD",
    },
    "publisher_capabilities": {
        "can_checks": True,
        "can_contents": False,
        "can_approve": False,
        "can_merge": False,
    },
    "role_separation": {
        "writer_or_fixer": "candidate_writer_or_fixer",
        "reviewer": "monkey1sai-codex-reviewer",
        "self_review": "ADVISORY_ONLY",
    },
    "review_binding": {
        "repository": "monkey1sai/AI-BIM-governance",
        "reviewer_engine": "monkey1sai-codex",
        "packet_schema_version": "autonomous-codex-review-check-packet/v1",
        "required_fields": [
            "pr_number",
            "base_sha",
            "head_sha",
            "changed_files_sha256",
            "reviewer_engine",
            "evidence_sha256",
        ],
        "identity_fields": [
            "writer_execution_id",
            "fixer_execution_id",
            "reviewer_execution_id",
        ],
    },
}

PROTECTED_EXACT_PATHS = {
    "AGENTS.md",
    "CLAUDE.md",
    ".github/CODEOWNERS",
    "agent-skills-manifest.json",
    "skills-lock.json",
    "scripts/verification-manifest.json",
    "scripts/lib/architecture_contract.py",
    "scripts/lib/observed_architecture.py",
    "scripts/lib/layered_architecture.py",
    "scripts/dev/validate_architecture_contract.py",
    "scripts/dev/export_observed_architecture.py",
    "scripts/dev/check_layered_architecture.py",
    "scripts/dev/check_governance_trust_root.py",
    REVIEW_POLICY,
    REVIEW_POLICY_SCHEMA,
    REVIEW_OPEN_SPEC,
    "scripts/tests/test-agent-governance-check.ps1",
    "scripts/tests/verification-manifest.schema.json",
    "tests/test_architecture_contract.py",
    "tests/test_observed_architecture.py",
    "tests/test_layered_architecture.py",
    "tests/test_governance_trust_root.py",
    "tests/test_governed_dispatch_runtime.mjs",
    "tests/test_ship_item_runtime.mjs",
    "tests/test_spec_to_done_state_contract.py",
    "tests/conftest.py",
    ".claude/workflows/ship-item.js",
    ".claude/workflows/ship-item.md",
    ".claude/workflows/fu-adversarial-verify-generic.js",
    ".claude/skills/spec-to-done/SKILL.md",
    ".claude/skills/spec-to-done/validate-state.mjs",
    ".codex/skills/spec-to-done/SKILL.md",
    "agent-contracts/spec-to-done.contract.json",
    "agent-contracts/spec-to-done.contract.schema.json",
}
PROTECTED_PREFIXES = (
    ".github/",
    ".claude/",
    ".codex/",
    "agent-contracts/",
    "architecture/deltas/",
    "docs/agents/",
    "scripts/",
)
PROTECTED_ARCHITECTURE_PATHS = {
    "architecture/architecture-contract.json",
    "architecture/architecture-contract.schema.json",
    "architecture/architecture-delta.schema.json",
    "architecture/observed-graph.config.json",
    "architecture/observed-graph.config.schema.json",
    "architecture/layer-contract.json",
    "architecture/layer-contract.schema.json",
    "architecture/observed-baseline.schema.json",
    "architecture/layer-baseline.schema.json",
}


class TrustRootError(ValueError):
    """Raised when untrusted input cannot be interpreted safely."""


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare a PR candidate against base-owned AI coding governance policy."
    )
    parser.add_argument("--base-root", required=True)
    parser.add_argument("--candidate-root", required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--reviews-json")
    parser.add_argument("--permission-json")
    parser.add_argument("--format", choices=("human", "json"), default="human")
    parser.add_argument("--output")
    return parser.parse_args()


def _finding(code: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "path": path, "message": message}


def _json_semantically_equal(left: Any, right: Any) -> bool:
    """Compare JSON values without conflating booleans, integers, and floats."""

    options = {"ensure_ascii": False, "sort_keys": True, "separators": (",", ":")}
    return json.dumps(left, **options) == json.dumps(right, **options)


def _safe_path(root: Path, relative: str) -> Path:
    if not relative or relative.startswith(("/", "\\")) or ".." in Path(relative).parts:
        raise TrustRootError(f"unsafe repository path: {relative!r}")
    target = root / relative
    if target.is_symlink():
        raise TrustRootError(f"symbolic links are not accepted as governance input: {relative}")
    try:
        target.resolve(strict=False).relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise TrustRootError(f"path escapes repository root: {relative}") from exc
    return target


def _read_bytes(root: Path, relative: str, *, required: bool = True) -> bytes | None:
    target = _safe_path(root, relative)
    if not target.exists():
        if required:
            raise TrustRootError(f"required governance file is missing: {relative}")
        return None
    if not target.is_file():
        raise TrustRootError(f"governance input is not a regular file: {relative}")
    size = target.stat().st_size
    if size > MAX_DOCUMENT_BYTES:
        raise TrustRootError(f"governance input exceeds {MAX_DOCUMENT_BYTES} bytes: {relative}")
    return target.read_bytes()


def _load_json(root: Path, relative: str) -> dict[str, Any]:
    raw = _read_bytes(root, relative)
    assert raw is not None
    try:
        parsed = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TrustRootError(f"invalid UTF-8 JSON in {relative}: {exc}") from exc
    if not isinstance(parsed, dict):
        raise TrustRootError(f"JSON document must be an object: {relative}")
    return parsed


def _canonical_review_policy_schema_node(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return {
            "type": "object",
            "additionalProperties": False,
            "required": list(value),
            "properties": {
                key: _canonical_review_policy_schema_node(nested)
                for key, nested in value.items()
            },
        }
    if isinstance(value, list):
        return {"type": "array", "const": value}
    if isinstance(value, bool):
        return {"type": "boolean", "const": value}
    if isinstance(value, int):
        return {"type": "integer", "const": value}
    if isinstance(value, str):
        return {"type": "string", "const": value}
    raise TrustRootError("canonical review policy contains an unsupported value")


def _canonical_review_policy_schema() -> dict[str, Any]:
    policy_schema = _canonical_review_policy_schema_node(CANONICAL_REVIEW_POLICY)
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://ai-bim-governance.local/schemas/autonomous-codex-review-policy/v1",
        "title": "Base-owned autonomous Codex review policy",
        **policy_schema,
    }


def _review_policy_inventory(root: Path) -> None:
    scripts_root = _safe_path(root, "scripts")
    if not scripts_root.exists() or not scripts_root.is_dir():
        raise TrustRootError("canonical review policy inventory is missing scripts")
    stack: list[tuple[Path, str, int]] = [(scripts_root, "scripts", 0)]
    candidates: list[str] = []
    entries_seen = 0
    while stack:
        directory, relative_directory, depth = stack.pop()
        try:
            entries = sorted(directory.iterdir(), key=lambda entry: entry.name)
        except OSError as exc:
            raise TrustRootError("canonical review policy inventory cannot be read") from exc
        for entry in entries:
            entries_seen += 1
            if entries_seen > REVIEW_POLICY_INVENTORY_MAX_ENTRIES:
                raise TrustRootError("canonical review policy inventory exceeds entry budget")
            relative = f"{relative_directory}/{entry.name}"
            try:
                if entry.is_symlink():
                    raise TrustRootError("canonical review policy inventory contains a symbolic link")
                if entry.is_dir():
                    if entry.name.casefold() in REVIEW_POLICY_IGNORED_DIRECTORIES:
                        continue
                    if depth >= REVIEW_POLICY_INVENTORY_MAX_DEPTH:
                        raise TrustRootError("canonical review policy inventory exceeds depth budget")
                    stack.append((entry, relative, depth + 1))
                elif entry.is_file():
                    if REVIEW_POLICY_FILENAME.fullmatch(entry.name):
                        candidates.append(relative)
                else:
                    raise TrustRootError("canonical review policy inventory contains an unknown entry")
            except OSError as exc:
                raise TrustRootError("canonical review policy inventory cannot inspect an entry") from exc
    canonical_count = candidates.count(REVIEW_POLICY)
    schema_count = candidates.count(REVIEW_POLICY_SCHEMA)
    unexpected = [
        candidate
        for candidate in candidates
        if candidate not in {REVIEW_POLICY, REVIEW_POLICY_SCHEMA}
    ]
    if canonical_count != 1:
        raise TrustRootError("canonical review policy is missing or duplicated")
    if schema_count != 1 or unexpected:
        raise TrustRootError("canonical review policy schema is missing, duplicated, or shadowed")


def _validate_review_policy_root(root: Path, label: str) -> None:
    _review_policy_inventory(root)
    policy = _load_json(root, REVIEW_POLICY)
    schema = _load_json(root, REVIEW_POLICY_SCHEMA)
    if not _json_semantically_equal(policy, CANONICAL_REVIEW_POLICY):
        raise TrustRootError(f"{label} review policy is not the canonical LEGACY_GUARDED policy")
    if not _json_semantically_equal(schema, _canonical_review_policy_schema()):
        raise TrustRootError(f"{label} review policy schema is not the closed canonical schema")
    source = _read_bytes(root, REVIEW_OPEN_SPEC)
    assert source is not None
    if hashlib.sha256(source).hexdigest() != REVIEW_OPEN_SPEC_SHA256:
        raise TrustRootError(f"{label} review policy OpenSpec source digest does not match its pin")


def _objects(document: dict[str, Any], key: str, relative: str) -> list[dict[str, Any]]:
    value = document.get(key)
    if not isinstance(value, list) or any(not isinstance(entry, dict) for entry in value):
        raise TrustRootError(f"{relative}:{key} must be an array of objects")
    return value


def _string(entry: dict[str, Any], key: str, relative: str) -> str:
    value = entry.get(key)
    if not isinstance(value, str) or not value:
        raise TrustRootError(f"{relative} entry requires non-empty string {key}")
    return value


def _non_negative_integer(entry: dict[str, Any], key: str, relative: str) -> int:
    value = entry.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise TrustRootError(f"{relative} entry requires non-negative integer {key}")
    return value


def _budget_records(
    document: dict[str, Any],
    key: str,
    identity_key: str,
    relative: str,
) -> dict[str, dict[str, Any]]:
    budgets: dict[str, dict[str, Any]] = {}
    for entry in _objects(document, key, relative):
        identity = _string(entry, identity_key, relative)
        if identity in budgets:
            raise TrustRootError(f"duplicate budget identity {identity!r} in {relative}")
        _non_negative_integer(entry, "maximum", relative)
        budgets[identity] = entry
    return budgets


def _compare_budgets(
    *,
    base: dict[str, dict[str, Any]],
    candidate: dict[str, dict[str, Any]],
    code_prefix: str,
    relative: str,
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for identity, base_record in sorted(base.items()):
        candidate_record = candidate.get(identity)
        if candidate_record is None:
            continue
        base_maximum = _non_negative_integer(base_record, "maximum", relative)
        candidate_maximum = _non_negative_integer(candidate_record, "maximum", relative)
        if candidate_maximum > base_maximum:
            findings.append(
                _finding(
                    f"{code_prefix}.budget_increased",
                    relative,
                    f"candidate raised {identity!r} from {base_maximum} to {candidate_maximum}",
                )
            )
        base_metadata = {key: value for key, value in base_record.items() if key != "maximum"}
        candidate_metadata = {
            key: value for key, value in candidate_record.items() if key != "maximum"
        }
        if not _json_semantically_equal(candidate_metadata, base_metadata):
            findings.append(
                _finding(
                    f"{code_prefix}.budget_metadata_changed",
                    relative,
                    f"candidate changed retained budget metadata for {identity!r}",
                )
            )
    for identity, candidate_record in sorted(candidate.items()):
        candidate_maximum = _non_negative_integer(candidate_record, "maximum", relative)
        if identity not in base and candidate_maximum > 0:
            findings.append(
                _finding(
                    f"{code_prefix}.budget_increased",
                    relative,
                    f"new budget {identity!r} must start at zero, got {candidate_maximum}",
                )
            )
    return findings


def _top_level_metadata(
    document: dict[str, Any], collection_keys: tuple[str, ...]
) -> dict[str, Any]:
    """Return every top-level field other than the ratcheted record collections."""

    return {key: value for key, value in document.items() if key not in collection_keys}


def _compare_observed(base_root: Path, candidate_root: Path) -> list[dict[str, str]]:
    base = _load_json(base_root, OBSERVED_BASELINE)
    candidate = _load_json(candidate_root, OBSERVED_BASELINE)
    findings: list[dict[str, str]] = []
    if candidate.get("schema_version") != base.get("schema_version"):
        findings.append(
            _finding(
                "observed_baseline.schema_changed",
                OBSERVED_BASELINE,
                "candidate baseline schema_version differs from the trusted base",
            )
        )
    collection_keys = ("service_edges", "cycles", "cycle_budgets")
    if not _json_semantically_equal(
        _top_level_metadata(candidate, collection_keys),
        _top_level_metadata(base, collection_keys),
    ):
        findings.append(
            _finding(
                "observed_baseline.metadata_changed",
                OBSERVED_BASELINE,
                "candidate changed top-level metadata from the trusted baseline",
            )
        )

    def edge_records(document: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
        records: dict[tuple[str, str], dict[str, Any]] = {}
        for entry in _objects(document, "service_edges", OBSERVED_BASELINE):
            identity = (
                _string(entry, "from", OBSERVED_BASELINE),
                _string(entry, "to", OBSERVED_BASELINE),
            )
            if identity in records:
                raise TrustRootError(f"duplicate service edge identity in {OBSERVED_BASELINE}")
            records[identity] = entry
        return records

    base_edges = edge_records(base)
    candidate_edges = edge_records(candidate)
    findings.extend(
        _finding(
            "observed_baseline.edge_added",
            OBSERVED_BASELINE,
            f"candidate added grandfathered edge {source!r} -> {target!r}",
        )
        for source, target in sorted(candidate_edges.keys() - base_edges.keys())
    )
    findings.extend(
        _finding(
            "observed_baseline.edge_metadata_changed",
            OBSERVED_BASELINE,
            f"candidate changed retained edge metadata for {identity!r}",
        )
        for identity in sorted(candidate_edges.keys() & base_edges.keys())
        if not _json_semantically_equal(candidate_edges[identity], base_edges[identity])
    )

    def cycle_records(document: dict[str, Any]) -> dict[tuple[str, ...], dict[str, Any]]:
        records: dict[tuple[str, ...], dict[str, Any]] = {}
        for entry in _objects(document, "cycles", OBSERVED_BASELINE):
            scope = _string(entry, "scope", OBSERVED_BASELINE)
            members = entry.get("members")
            if (
                not isinstance(members, list)
                or len(members) < 2
                or any(not isinstance(member, str) or not member for member in members)
                or len(set(members)) != len(members)
            ):
                raise TrustRootError(f"{OBSERVED_BASELINE} cycle members must be unique strings")
            identity = (scope, *sorted(members))
            if identity in records:
                raise TrustRootError(f"duplicate cycle identity in {OBSERVED_BASELINE}")
            records[identity] = entry
        return records

    base_cycles = cycle_records(base)
    candidate_cycles = cycle_records(candidate)
    added_cycles = candidate_cycles.keys() - base_cycles.keys()
    findings.extend(
        _finding(
            "observed_baseline.cycle_added",
            OBSERVED_BASELINE,
            f"candidate added grandfathered cycle {identity!r}",
        )
        for identity in sorted(added_cycles)
    )
    findings.extend(
        _finding(
            "observed_baseline.cycle_metadata_changed",
            OBSERVED_BASELINE,
            f"candidate changed retained cycle metadata for {identity!r}",
        )
        for identity in sorted(candidate_cycles.keys() & base_cycles.keys())
        if not _json_semantically_equal(candidate_cycles[identity], base_cycles[identity])
    )
    findings.extend(
        _compare_budgets(
            base=_budget_records(base, "cycle_budgets", "scope", OBSERVED_BASELINE),
            candidate=_budget_records(candidate, "cycle_budgets", "scope", OBSERVED_BASELINE),
            code_prefix="observed_baseline",
            relative=OBSERVED_BASELINE,
        )
    )
    return findings


def _compare_layered(base_root: Path, candidate_root: Path) -> list[dict[str, str]]:
    base = _load_json(base_root, LAYER_BASELINE)
    candidate = _load_json(candidate_root, LAYER_BASELINE)
    findings: list[dict[str, str]] = []
    if candidate.get("schema_version") != base.get("schema_version"):
        findings.append(
            _finding(
                "layer_baseline.schema_changed",
                LAYER_BASELINE,
                "candidate baseline schema_version differs from the trusted base",
            )
        )
    collection_keys = ("violations", "violation_budgets")
    if not _json_semantically_equal(
        _top_level_metadata(candidate, collection_keys),
        _top_level_metadata(base, collection_keys),
    ):
        findings.append(
            _finding(
                "layer_baseline.metadata_changed",
                LAYER_BASELINE,
                "candidate changed top-level metadata from the trusted baseline",
            )
        )

    def violation_records(
        document: dict[str, Any],
    ) -> dict[tuple[str, str, str], dict[str, Any]]:
        records: dict[tuple[str, str, str], dict[str, Any]] = {}
        for entry in _objects(document, "violations", LAYER_BASELINE):
            identity = (
                _string(entry, "service", LAYER_BASELINE),
                _string(entry, "from", LAYER_BASELINE),
                _string(entry, "to", LAYER_BASELINE),
            )
            if identity in records:
                raise TrustRootError(f"duplicate layer violation identity in {LAYER_BASELINE}")
            records[identity] = entry
        return records

    base_violations = violation_records(base)
    candidate_violations = violation_records(candidate)
    added = candidate_violations.keys() - base_violations.keys()
    findings.extend(
        _finding(
            "layer_baseline.violation_added",
            LAYER_BASELINE,
            f"candidate added grandfathered layer violation {identity!r}",
        )
        for identity in sorted(added)
    )
    findings.extend(
        _finding(
            "layer_baseline.violation_metadata_changed",
            LAYER_BASELINE,
            f"candidate changed retained layer violation metadata for {identity!r}",
        )
        for identity in sorted(candidate_violations.keys() & base_violations.keys())
        if not _json_semantically_equal(candidate_violations[identity], base_violations[identity])
    )
    findings.extend(
        _compare_budgets(
            base=_budget_records(base, "violation_budgets", "service", LAYER_BASELINE),
            candidate=_budget_records(candidate, "violation_budgets", "service", LAYER_BASELINE),
            code_prefix="layer_baseline",
            relative=LAYER_BASELINE,
        )
    )
    return findings


def _protected_paths(base_root: Path, candidate_root: Path) -> list[str]:
    paths = set(PROTECTED_EXACT_PATHS) | set(PROTECTED_ARCHITECTURE_PATHS)
    for prefix in PROTECTED_PREFIXES:
        for root in (base_root, candidate_root):
            directory = _safe_path(root, prefix.rstrip("/"))
            if directory.exists() and directory.is_dir():
                for target in directory.rglob("*"):
                    if target.is_file() or target.is_symlink():
                        paths.add(target.relative_to(root).as_posix())
    changed: list[str] = []
    for relative in sorted(paths):
        base = _read_bytes(base_root, relative, required=False)
        candidate = _read_bytes(candidate_root, relative, required=False)
        if base != candidate:
            changed.append(relative)
    return changed


def _load_external_json(path_value: str | None, label: str) -> Any:
    if not path_value:
        return None
    path = Path(path_value)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_DOCUMENT_BYTES:
        raise TrustRootError(f"invalid {label} evidence file")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TrustRootError(f"invalid {label} evidence JSON: {exc}") from exc


def _has_exact_head_approval(
    reviews_payload: Any,
    permission_payload: Any,
    head_sha: str,
) -> bool:
    if not isinstance(permission_payload, dict):
        return False
    permission_user = permission_payload.get("user")
    if (
        permission_payload.get("permission") != REVIEWER_PERMISSION
        or permission_payload.get("role_name") != REVIEWER_PERMISSION
        or not isinstance(permission_user, dict)
        or permission_user.get("login") != REVIEWER_LOGIN
        or permission_user.get("id") != REVIEWER_ID
        or permission_user.get("type") != "User"
    ):
        return False
    reviews = reviews_payload
    if isinstance(reviews, list) and reviews and all(isinstance(page, list) for page in reviews):
        reviews = [entry for page in reviews for entry in page]
    if not isinstance(reviews, list):
        return False
    decisive_reviews = []
    for review in reviews:
        if not isinstance(review, dict) or review.get("state") not in {
            "APPROVED", "CHANGES_REQUESTED", "DISMISSED"
        }:
            continue
        user = review.get("user")
        if not (
            isinstance(user, dict)
            and user.get("login") == REVIEWER_LOGIN
            and user.get("id") == REVIEWER_ID
            and user.get("type") == "User"
        ):
            continue
        submitted_at = review.get("submitted_at")
        review_id = review.get("id")
        if not isinstance(submitted_at, str) or not submitted_at or not isinstance(review_id, int):
            continue
        decisive_reviews.append((submitted_at, review_id, review))
    if not decisive_reviews:
        return False
    latest = max(decisive_reviews, key=lambda item: (item[0], item[1]))[2]
    return (
        latest.get("state") == "APPROVED"
        and str(latest.get("commit_id", "")).lower() == head_sha
    )


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    if not isinstance(args.head_sha, str) or len(args.head_sha) != 40 or any(
        character not in "0123456789abcdefABCDEF" for character in args.head_sha
    ):
        raise TrustRootError("--head-sha must be a full 40-character hexadecimal commit SHA")
    base_root = Path(args.base_root).resolve(strict=True)
    candidate_root = Path(args.candidate_root).resolve(strict=True)
    if not base_root.is_dir() or not candidate_root.is_dir() or base_root == candidate_root:
        raise TrustRootError("base and candidate roots must be distinct directories")

    _validate_review_policy_root(base_root, "base")
    _validate_review_policy_root(candidate_root, "candidate")
    findings = _compare_observed(base_root, candidate_root)
    findings.extend(_compare_layered(base_root, candidate_root))
    changed_policy_paths = _protected_paths(base_root, candidate_root)
    if changed_policy_paths:
        reviews = _load_external_json(args.reviews_json, "review")
        permission = _load_external_json(args.permission_json, "permission")
        if not _has_exact_head_approval(reviews, permission, args.head_sha.lower()):
            findings.append(
                _finding(
                    "policy_change.exact_head_approval_missing",
                    ",".join(changed_policy_paths),
                    (
                        f"policy-bearing files changed without an exact-head APPROVED review from "
                        f"{REVIEWER_LOGIN} ({REVIEWER_ID}) with live {REVIEWER_PERMISSION} permission"
                    ),
                )
            )
    findings.sort(key=lambda item: (item["code"], item["path"], item["message"]))
    return {
        "schema_version": "ai-bim-governance-trust-root-result/v1",
        "status": "failed" if findings else "passed",
        "head_sha": args.head_sha.lower(),
        "base_path_fingerprint": hashlib.sha256(str(base_root).encode("utf-8")).hexdigest(),
        "candidate_path_fingerprint": hashlib.sha256(str(candidate_root).encode("utf-8")).hexdigest(),
        "candidate_executed": False,
        "protected_changed_paths": changed_policy_paths,
        "findings": findings,
    }


def _render_human(result: dict[str, Any]) -> str:
    lines = [
        f"Governance trust root: {str(result['status']).upper()}",
        f"Subject: {result['head_sha']}",
        f"Candidate code executed: {str(result['candidate_executed']).lower()}",
    ]
    for finding in result["findings"]:
        lines.append(f"[ERROR] {finding['code']} {finding['path']}: {finding['message']}")
    return "\n".join(lines) + "\n"


def main() -> int:
    args = _parse_args()
    try:
        result = evaluate(args)
    except (OSError, TrustRootError) as exc:
        result = {
            "schema_version": "ai-bim-governance-trust-root-result/v1",
            "status": "failed",
            "head_sha": str(args.head_sha).lower(),
            "base_path_fingerprint": None,
            "candidate_path_fingerprint": None,
            "candidate_executed": False,
            "protected_changed_paths": [],
            "findings": [_finding("trust_root.input_invalid", "<input>", str(exc))],
        }
    rendered = (
        json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        if args.format == "json"
        else _render_human(result)
    )
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8", newline="")
    else:
        sys.stdout.write(rendered)
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
