#!/usr/bin/env python3
"""Strict, token-free PR evidence packet helpers for the protected Codex gate."""

from __future__ import annotations

import base64
import binascii
import difflib
import hashlib
import json
import re
from pathlib import Path
from typing import Callable


FIXED_REPO = "monkey1sai/AI-BIM-governance"
FIXED_BASE = "main"
PACKET_SCHEMA = "blip-codex-ship-gate-packet/v1"
MAX_PACKET_BYTES = 1_048_576
MAX_BLOB_BYTES = 8_388_608
MAX_TOTAL_BLOB_BYTES = 16_777_216

CHANGE_TYPE = {
    "added": "ADDED",
    "removed": "DELETED",
    "modified": "MODIFIED",
    "renamed": "RENAMED",
    "copied": "COPIED",
    "changed": "CHANGED",
}
NORMALIZED_FILE_KEYS = {"path", "additions", "deletions", "change_type"}
SNAPSHOT_KEYS = {
    "meta",
    "diff",
    "files",
    "normalized_files",
    "changed_files_sha256",
    "diff_sha256",
}
PACKET_KEYS = {"schema", "repo", "pr", *SNAPSHOT_KEYS}
META_KEYS = {
    "number",
    "title",
    "state",
    "url",
    "author",
    "headRefName",
    "headRefOid",
    "baseRefName",
    "baseRefOid",
    "isDraft",
    "files",
}
ELEVATED_SCOPE_PATTERNS = (
    re.compile(r"(?:^|/)(?:AGENTS|CLAUDE)\.md$", re.IGNORECASE),
    re.compile(r"^agent-skills-manifest\.json$", re.IGNORECASE),
    re.compile(r"^\.(?:agents|claude|codex|github)/", re.IGNORECASE),
    re.compile(r"^agent-contracts/", re.IGNORECASE),
    re.compile(r"^docs/agents/", re.IGNORECASE),
    re.compile(r"^(?:scripts|infra)/", re.IGNORECASE),
    re.compile(r"^compose[^/]*\.ya?ml$", re.IGNORECASE),
)
ELEVATED_SCOPE_TOKENS = frozenset(
    {
        "agent",
        "agents",
        "auth",
        "authentication",
        "authorization",
        "authority",
        "authn",
        "authz",
        "billing",
        "ci",
        "credential",
        "credentials",
        "deploy",
        "deployment",
        "destructive",
        "governance",
        "infra",
        "infrastructure",
        "migration",
        "migrations",
        "oauth",
        "payment",
        "permission",
        "permissions",
        "prod",
        "production",
        "secret",
        "secrets",
        "security",
        "sso",
    }
)


def canonical_digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _exact_dict(value: object, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise RuntimeError(f"{label} has unknown, missing, or duplicate fields")
    return value


def _valid_path(path: object) -> bool:
    return (
        isinstance(path, str)
        and bool(path)
        and path == path.strip()
        and not path.startswith(("/", "\\"))
        and "\\" not in path
        and all(segment not in ("", ".", "..") for segment in path.split("/"))
        and re.search(r"[\x00-\x1f\x7f]", path) is None
    )


def path_requires_elevated_scope(path: str) -> bool:
    """Classify protected paths, including hyphenated and camelCase authority names."""
    if any(pattern.search(path) for pattern in ELEVATED_SCOPE_PATTERNS):
        return True
    camel_split = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "/", path)
    camel_split = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "/", camel_split)
    tokens = {token.casefold() for token in re.findall(r"[A-Za-z0-9]+", camel_split)}
    return not tokens.isdisjoint(ELEVATED_SCOPE_TOKENS)


def normalize_rest_files(payload: object, *, require_patch: bool) -> tuple[list[dict], str]:
    if not isinstance(payload, list) or not payload:
        raise RuntimeError("changed-file payload is empty or malformed")
    if len(payload) >= 100:
        raise RuntimeError("changed-file pagination may be incomplete at the 100-file boundary")

    normalized: list[dict] = []
    evidence_parts: list[str] = []
    seen: set[str] = set()
    for raw in payload:
        if not isinstance(raw, dict):
            raise RuntimeError("a changed-file entry is malformed")
        path = raw.get("filename")
        additions = raw.get("additions")
        deletions = raw.get("deletions")
        changes = raw.get("changes")
        status = raw.get("status")
        blob_sha = raw.get("sha")
        previous = raw.get("previous_filename")
        if not _valid_path(path):
            raise RuntimeError("a changed path is malformed")
        assert isinstance(path, str)
        if path.casefold() in seen:
            raise RuntimeError(f"changed path {path!r} is duplicated case-insensitively")
        seen.add(path.casefold())
        if (
            type(additions) is not int
            or additions < 0
            or type(deletions) is not int
            or deletions < 0
            or type(changes) is not int
            or changes != additions + deletions
        ):
            raise RuntimeError(f"changed-file counts are malformed for {path!r}")
        if status not in CHANGE_TYPE:
            raise RuntimeError(f"changed-file status is unsupported for {path!r}: {status!r}")
        if not isinstance(blob_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", blob_sha):
            raise RuntimeError(f"changed-file blob SHA is malformed for {path!r}")
        if status in ("renamed", "copied"):
            if not _valid_path(previous):
                raise RuntimeError(f"changed-file previous path is missing or malformed for {path!r}")
        elif previous is not None:
            raise RuntimeError(f"unexpected previous path on {path!r}")

        if path.casefold() == ".gitmodules" or (
            isinstance(previous, str) and previous.casefold() == ".gitmodules"
        ):
            raise RuntimeError(f"submodule or .gitmodules change {path!r} requires human review")

        patch = raw.get("patch")
        if require_patch:
            if not isinstance(patch, str) or not patch.strip():
                raise RuntimeError(f"changed file {path!r} has no complete inspectable text patch")
            if re.search(r"(?m)^[+-]Subproject commit [0-9a-f]{40}(?:-dirty)?$", patch):
                raise RuntimeError(f"submodule or .gitmodules change {path!r} requires human review")
            counted_additions = sum(1 for line in patch.splitlines() if line.startswith("+"))
            counted_deletions = sum(1 for line in patch.splitlines() if line.startswith("-"))
            if counted_additions != additions or counted_deletions != deletions:
                raise RuntimeError(
                    f"changed file {path!r} patch is truncated or inconsistent with additions/deletions"
                )

        entry = {
            "path": path,
            "additions": additions,
            "deletions": deletions,
            "change_type": CHANGE_TYPE[status],
        }
        normalized.append(entry)
        if require_patch:
            evidence_parts.append(
                json.dumps(
                    {
                        **entry,
                        "blob_sha": blob_sha,
                        "previous_path": previous,
                        "patch": patch,
                    },
                    sort_keys=True,
                    ensure_ascii=False,
                )
            )

    normalized.sort(key=lambda entry: entry["path"].encode("utf-8"))
    evidence_parts.sort()
    return normalized, "\n\n".join(evidence_parts)


def _commit_tree_sha(commit: dict, label: str) -> str:
    detail = commit.get("commit")
    tree = detail.get("tree") if isinstance(detail, dict) else None
    tree_sha = str(tree.get("sha") or "").lower() if isinstance(tree, dict) else ""
    if not re.fullmatch(r"[0-9a-f]{40}", tree_sha):
        raise RuntimeError(f"immutable comparison {label} tree SHA is malformed")
    return tree_sha


def _tree_leaf_entries(payload: object, expected_sha: str, label: str) -> dict[str, dict]:
    if not isinstance(payload, dict):
        raise RuntimeError(f"{label} tree payload is malformed")
    if str(payload.get("sha") or "").lower() != expected_sha or payload.get("truncated") is not False:
        raise RuntimeError(f"{label} tree payload is truncated or tuple-mismatched")
    raw_entries = payload.get("tree")
    if not isinstance(raw_entries, list):
        raise RuntimeError(f"{label} tree entries are malformed")
    leaves: dict[str, dict] = {}
    seen: set[str] = set()
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise RuntimeError(f"{label} tree contains a malformed entry")
        path = raw.get("path")
        mode = raw.get("mode")
        item_type = raw.get("type")
        sha = str(raw.get("sha") or "").lower()
        if (
            not _valid_path(path)
            or not isinstance(mode, str)
            or not re.fullmatch(r"[0-7]{6}", mode)
            or item_type not in ("blob", "tree", "commit")
            or not re.fullmatch(r"[0-9a-f]{40}", sha)
        ):
            raise RuntimeError(f"{label} tree contains a malformed entry")
        assert isinstance(path, str)
        identity = path.casefold()
        if identity in seen:
            raise RuntimeError(f"{label} tree path {path!r} is duplicated case-insensitively")
        seen.add(identity)
        if item_type == "tree":
            if mode != "040000":
                raise RuntimeError(f"{label} tree directory {path!r} has an unexpected mode")
            continue
        leaves[path] = {"mode": mode, "type": item_type, "sha": sha}
    return leaves


def _decode_immutable_blob(payload: object, expected_sha: str, path: str) -> tuple[str, int]:
    if not isinstance(payload, dict):
        raise RuntimeError(f"immutable blob payload is malformed for {path!r}")
    size = payload.get("size")
    content = payload.get("content")
    if (
        str(payload.get("sha") or "").lower() != expected_sha
        or payload.get("encoding") != "base64"
        or type(size) is not int
        or size < 0
        or size > MAX_BLOB_BYTES
        or not isinstance(content, str)
    ):
        raise RuntimeError(f"immutable blob metadata is malformed or oversized for {path!r}")
    compact = "".join(content.split())
    try:
        raw = base64.b64decode(compact.encode("ascii"), validate=True)
    except (UnicodeEncodeError, binascii.Error) as exc:
        raise RuntimeError(f"immutable blob base64 is malformed for {path!r}") from exc
    git_sha = hashlib.sha1(f"blob {len(raw)}\0".encode("ascii") + raw).hexdigest()
    if len(raw) != size or git_sha != expected_sha:
        raise RuntimeError(f"immutable blob content does not match its tree binding for {path!r}")
    if b"\0" in raw:
        raise RuntimeError(f"binary changed file {path!r} requires human review")
    try:
        return raw.decode("utf-8", errors="strict"), len(raw)
    except UnicodeDecodeError as exc:
        raise RuntimeError(f"non-UTF-8 changed file {path!r} requires human review") from exc


def _immutable_file_evidence(
    *,
    fetch_json: Callable[..., object],
    api: str,
    token: str,
    owner: str,
    name: str,
    raw_files: list[dict],
    normalized: list[dict],
    base_tree_sha: str,
    head_tree_sha: str,
) -> str:
    base_tree = _tree_leaf_entries(
        fetch_json(
            "GET",
            f"{api}/repos/{owner}/{name}/git/trees/{base_tree_sha}?recursive=1",
            token=token,
        ),
        base_tree_sha,
        "merge-base",
    )
    head_tree = _tree_leaf_entries(
        fetch_json(
            "GET",
            f"{api}/repos/{owner}/{name}/git/trees/{head_tree_sha}?recursive=1",
            token=token,
        ),
        head_tree_sha,
        "head",
    )
    changed_tree_paths = {
        path
        for path in set(base_tree) | set(head_tree)
        if base_tree.get(path) != head_tree.get(path)
    }
    raw_by_path = {str(raw.get("filename")): raw for raw in raw_files}
    if changed_tree_paths != set(raw_by_path):
        raise RuntimeError("immutable tree diff differs from the comparison changed-file set")

    decoded: dict[str, tuple[str, int]] = {}
    total_blob_bytes = 0

    def blob(entry: dict | None, path: str) -> tuple[str, int] | None:
        nonlocal total_blob_bytes
        if entry is None:
            return None
        if entry["type"] != "blob" or entry["mode"] not in ("100644", "100755"):
            raise RuntimeError(f"symlink, gitlink, or unsupported mode change {path!r} requires human review")
        sha = entry["sha"]
        if sha not in decoded:
            decoded[sha] = _decode_immutable_blob(
                fetch_json(
                    "GET",
                    f"{api}/repos/{owner}/{name}/git/blobs/{sha}",
                    token=token,
                ),
                sha,
                path,
            )
            total_blob_bytes += decoded[sha][1]
            if total_blob_bytes > MAX_TOTAL_BLOB_BYTES:
                raise RuntimeError("immutable changed-file blob evidence exceeds the protected byte limit")
        return decoded[sha]

    evidence: list[dict] = []
    normalized_by_path = {entry["path"]: entry for entry in normalized}
    for path in sorted(raw_by_path, key=lambda item: item.encode("utf-8")):
        raw = raw_by_path[path]
        status = raw.get("status")
        if status in ("renamed", "copied"):
            raise RuntimeError(f"renamed or copied path {path!r} requires human review")
        base_entry = base_tree.get(path)
        head_entry = head_tree.get(path)
        if (
            (status == "added" and (base_entry is not None or head_entry is None))
            or (status == "removed" and (base_entry is None or head_entry is not None))
            or (status in ("modified", "changed") and (base_entry is None or head_entry is None))
        ):
            raise RuntimeError(f"changed-file status differs from immutable tree state for {path!r}")
        expected_blob_sha = head_entry["sha"] if head_entry is not None else base_entry["sha"]
        if str(raw.get("sha") or "").lower() != expected_blob_sha:
            raise RuntimeError(f"comparison blob SHA differs from immutable tree state for {path!r}")
        base_blob = blob(base_entry, path)
        head_blob = blob(head_entry, path)
        base_text = base_blob[0] if base_blob is not None else ""
        head_text = head_blob[0] if head_blob is not None else ""
        diff_lines = list(
            difflib.unified_diff(
                base_text.splitlines(keepends=True),
                head_text.splitlines(keepends=True),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
                n=3,
                lineterm="",
            )
        )
        content_changed = base_text != head_text
        if content_changed and not diff_lines:
            raise RuntimeError(f"immutable text diff could not be reconstructed for {path!r}")
        evidence.append(
            {
                **normalized_by_path[path],
                "status": status,
                "base": None
                if base_entry is None
                else {
                    "mode": base_entry["mode"],
                    "blob_sha": base_entry["sha"],
                    "bytes": base_blob[1],
                },
                "head": None
                if head_entry is None
                else {
                    "mode": head_entry["mode"],
                    "blob_sha": head_entry["sha"],
                    "bytes": head_blob[1],
                },
                "unified_diff_lines": diff_lines,
            }
        )
    return "\n\n".join(
        json.dumps(item, sort_keys=True, ensure_ascii=False) for item in evidence
    )


def _metadata_from_pr(raw_pr: object) -> tuple[dict, str, str]:
    if not isinstance(raw_pr, dict):
        raise RuntimeError("PR metadata is malformed")
    base = raw_pr.get("base")
    head = raw_pr.get("head")
    author = raw_pr.get("user")
    if not isinstance(base, dict) or not isinstance(head, dict) or not isinstance(author, dict):
        raise RuntimeError("PR base/head/author metadata is malformed")
    base_sha = str(base.get("sha") or "").lower()
    head_sha = str(head.get("sha") or "").lower()
    if not re.fullmatch(r"[0-9a-f]{40}", base_sha) or not re.fullmatch(r"[0-9a-f]{40}", head_sha):
        raise RuntimeError("PR base/head SHA is malformed")
    meta = {
        "number": raw_pr.get("number"),
        "title": raw_pr.get("title"),
        "state": str(raw_pr.get("state") or "").upper(),
        "url": raw_pr.get("html_url"),
        "author": {"login": author.get("login")},
        "headRefName": head.get("ref"),
        "headRefOid": head_sha,
        "baseRefName": base.get("ref"),
        "baseRefOid": base_sha,
        "isDraft": raw_pr.get("draft"),
    }
    return meta, base_sha, head_sha


def collect_pr_snapshot(
    fetch_json: Callable[..., object],
    api: str,
    token: str,
    repo: str,
    pr: int,
    *,
    require_patch: bool = True,
) -> dict:
    if repo != FIXED_REPO:
        raise RuntimeError("the protected collector is fixed to monkey1sai/AI-BIM-governance")
    if type(pr) is not int or pr < 1:
        raise RuntimeError("the protected collector PR number is invalid")
    if not isinstance(token, str) or not token:
        raise RuntimeError("the protected installation token is unavailable")
    owner, name = repo.split("/", 1)
    pr_url = f"{api}/repos/{owner}/{name}/pulls/{pr}"
    raw_pr_before = fetch_json("GET", pr_url, token=token)
    meta, base_sha, head_sha = _metadata_from_pr(raw_pr_before)
    expected_changed_files = (
        raw_pr_before.get("changed_files") if isinstance(raw_pr_before, dict) else None
    )
    if type(expected_changed_files) is not int or not 1 <= expected_changed_files < 100:
        raise RuntimeError("PR changed-file count is empty, malformed, or outside the protected bound")
    compare_url = (
        f"{api}/repos/{owner}/{name}/compare/{base_sha}...{head_sha}"
        "?per_page=100&page=1"
    )
    raw_compare = fetch_json("GET", compare_url, token=token)
    if not isinstance(raw_compare, dict):
        raise RuntimeError("immutable comparison payload is malformed")
    compare_base = raw_compare.get("base_commit")
    if "head_commit" in raw_compare:
        compare_head = raw_compare.get("head_commit")
    else:
        head_commit_url = f"{api}/repos/{owner}/{name}/commits/{head_sha}"
        compare_head = fetch_json("GET", head_commit_url, token=token)
    merge_base = raw_compare.get("merge_base_commit")
    if not isinstance(compare_base, dict) or not isinstance(compare_head, dict) or not isinstance(merge_base, dict):
        raise RuntimeError("immutable comparison commit tuple is malformed")
    merge_base_sha = str(merge_base.get("sha") or "").lower()
    if (
        str(compare_base.get("sha") or "").lower() != base_sha
        or str(compare_head.get("sha") or "").lower() != head_sha
        or not re.fullmatch(r"[0-9a-f]{40}", merge_base_sha)
    ):
        raise RuntimeError("immutable comparison is not bound to the requested base/head tuple")
    raw_files = raw_compare.get("files")
    files, _legacy_patch_evidence = normalize_rest_files(
        raw_files, require_patch=False
    )
    if len(files) != expected_changed_files:
        raise RuntimeError("immutable comparison file evidence is incomplete")
    if require_patch:
        assert isinstance(raw_files, list)
        merge_base_tree_sha = _commit_tree_sha(merge_base, "merge-base")
        head_tree_sha = _commit_tree_sha(compare_head, "head")
        file_evidence = _immutable_file_evidence(
            fetch_json=fetch_json,
            api=api,
            token=token,
            owner=owner,
            name=name,
            raw_files=raw_files,
            normalized=files,
            base_tree_sha=merge_base_tree_sha,
            head_tree_sha=head_tree_sha,
        )
    else:
        file_evidence = _legacy_patch_evidence
    raw_pr_after = fetch_json("GET", pr_url, token=token)
    final_meta, final_base, final_head = _metadata_from_pr(raw_pr_after)
    if (
        final_meta != meta
        or final_base != base_sha
        or final_head != head_sha
        or not isinstance(raw_pr_after, dict)
        or raw_pr_after.get("changed_files") != expected_changed_files
    ):
        raise RuntimeError("PR metadata changed while collecting immutable comparison evidence")
    evidence_header = json.dumps(
        {
            "base_sha": base_sha,
            "head_sha": head_sha,
            "merge_base_sha": merge_base_sha,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    evidence = evidence_header + "\n\n" + file_evidence
    meta["files"] = [
        {"path": item["path"], "additions": item["additions"], "deletions": item["deletions"]}
        for item in files
    ]
    snapshot = {
        "meta": meta,
        "diff": evidence,
        "files": [item["path"] for item in files],
        "normalized_files": files,
        "changed_files_sha256": canonical_digest(files),
        "diff_sha256": hashlib.sha256(evidence.encode("utf-8")).hexdigest(),
    }
    return validate_snapshot(snapshot, repo=repo, pr=pr)


def _validate_normalized_files(value: object) -> list[dict]:
    if not isinstance(value, list) or not value or len(value) >= 100:
        raise RuntimeError("packet normalized changed files are empty, malformed, or incomplete")
    normalized: list[dict] = []
    seen: set[str] = set()
    for raw in value:
        entry = _exact_dict(raw, NORMALIZED_FILE_KEYS, "packet changed-file entry")
        path = entry.get("path")
        additions = entry.get("additions")
        deletions = entry.get("deletions")
        change_type = entry.get("change_type")
        if (
            not _valid_path(path)
            or not isinstance(path, str)
            or path.casefold() in seen
            or type(additions) is not int
            or additions < 0
            or type(deletions) is not int
            or deletions < 0
            or change_type not in set(CHANGE_TYPE.values())
        ):
            raise RuntimeError("packet changed-file entry values are malformed")
        seen.add(path.casefold())
        normalized.append(dict(entry))
    expected = sorted(normalized, key=lambda entry: entry["path"].encode("utf-8"))
    if normalized != expected:
        raise RuntimeError("packet changed-file entries are not in canonical order")
    return normalized


def validate_snapshot(value: object, *, repo: str, pr: int) -> dict:
    snapshot = _exact_dict(value, SNAPSHOT_KEYS, "gate snapshot")
    if repo != FIXED_REPO or type(pr) is not int or pr < 1:
        raise RuntimeError("gate snapshot identity is outside the protected scope")
    meta = _exact_dict(snapshot.get("meta"), META_KEYS, "gate snapshot metadata")
    author = _exact_dict(meta.get("author"), {"login"}, "gate snapshot author")
    normalized = _validate_normalized_files(snapshot.get("normalized_files"))
    paths = [entry["path"] for entry in normalized]
    reduced = [
        {"path": entry["path"], "additions": entry["additions"], "deletions": entry["deletions"]}
        for entry in normalized
    ]
    if (
        type(meta.get("number")) is not int
        or meta.get("number") != pr
        or not isinstance(meta.get("title"), str)
        or len(meta["title"]) > 4096
        or meta.get("state") != "OPEN"
        or meta.get("url") != f"https://github.com/{repo}/pull/{pr}"
        or not isinstance(author.get("login"), str)
        or not author["login"]
        or not isinstance(meta.get("headRefName"), str)
        or not meta["headRefName"]
        or not re.fullmatch(r"[0-9a-f]{40}", str(meta.get("headRefOid") or ""))
        or meta.get("baseRefName") != FIXED_BASE
        or not re.fullmatch(r"[0-9a-f]{40}", str(meta.get("baseRefOid") or ""))
        or meta.get("isDraft") is not False
        or meta.get("files") != reduced
    ):
        raise RuntimeError("gate snapshot PR metadata is malformed or outside the protected state")
    diff = snapshot.get("diff")
    if not isinstance(diff, str):
        raise RuntimeError("gate snapshot inspectable patch evidence is malformed")
    if snapshot.get("files") != paths:
        raise RuntimeError("gate snapshot path list differs from normalized changed files")
    changed_digest = snapshot.get("changed_files_sha256")
    diff_digest = snapshot.get("diff_sha256")
    if not isinstance(changed_digest, str) or changed_digest != canonical_digest(normalized):
        raise RuntimeError("gate snapshot changed-file digest mismatch")
    if not isinstance(diff_digest, str) or diff_digest != hashlib.sha256(diff.encode("utf-8")).hexdigest():
        raise RuntimeError("gate snapshot inspectable-patch digest mismatch")
    return {
        "meta": dict(meta),
        "diff": diff,
        "files": list(paths),
        "normalized_files": [dict(entry) for entry in normalized],
        "changed_files_sha256": changed_digest,
        "diff_sha256": diff_digest,
    }


def packet_from_snapshot(snapshot: object, *, repo: str, pr: int) -> dict:
    validated = validate_snapshot(snapshot, repo=repo, pr=pr)
    return {"schema": PACKET_SCHEMA, "repo": repo, "pr": pr, **validated}


def write_packet(path: Path, snapshot: object, *, repo: str, pr: int) -> Path:
    if not path.is_absolute():
        raise RuntimeError("gate packet output path must be absolute")
    parent = path.parent.resolve(strict=True)
    if not parent.is_dir() or parent.is_symlink():
        raise RuntimeError("gate packet output parent is unavailable or linked")
    target = parent / path.name
    packet = packet_from_snapshot(snapshot, repo=repo, pr=pr)
    payload = (
        json.dumps(packet, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")
    if len(payload) > MAX_PACKET_BYTES:
        raise RuntimeError("gate packet exceeds the protected byte limit")
    with target.open("xb") as stream:
        stream.write(payload)
        stream.flush()
    return target


def _reject_duplicate_pairs(pairs: list[tuple[str, object]]) -> dict:
    out: dict = {}
    for key, value in pairs:
        if key in out:
            raise RuntimeError(f"gate packet contains duplicate field {key!r}")
        out[key] = value
    return out


def load_packet(path: Path, *, repo: str, pr: int) -> dict:
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise RuntimeError("gate packet path is not an absolute regular file")
    size = path.stat().st_size
    if size < 2 or size > MAX_PACKET_BYTES:
        raise RuntimeError("gate packet byte length is outside the protected limit")
    raw = path.read_bytes()
    try:
        packet = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=_reject_duplicate_pairs)
    except UnicodeDecodeError as exc:
        raise RuntimeError("gate packet is not strict UTF-8") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("gate packet JSON is malformed") from exc
    packet = _exact_dict(packet, PACKET_KEYS, "gate packet")
    if packet.get("schema") != PACKET_SCHEMA or packet.get("repo") != repo or packet.get("pr") != pr:
        raise RuntimeError("gate packet schema or protected identity is invalid")
    return validate_snapshot(
        {key: packet[key] for key in SNAPSHOT_KEYS},
        repo=repo,
        pr=pr,
    )
