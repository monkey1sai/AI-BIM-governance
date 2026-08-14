#!/usr/bin/env python3
"""Re-check a Codex App gate tuple and bind SHIP evidence before any review post."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

SOURCE_PARENT = Path(__file__).resolve().parent
APP_SCRIPTS_PARENT = (
    SOURCE_PARENT if (SOURCE_PARENT / "ship_gate_packet.py").is_file() else SOURCE_PARENT / "app-scripts"
)
sys.path.insert(0, str(SOURCE_PARENT))
sys.path.insert(0, str(APP_SCRIPTS_PARENT))
from app_auth import API, http_json, load_bot_config, protected_installation_token  # noqa: E402
from ship_gate_packet import (  # noqa: E402
    FIXED_BASE,
    FIXED_REPO,
    canonical_digest,
    collect_pr_snapshot,
    path_requires_elevated_scope,
    validate_snapshot,
)


FIXED_APP_ID = "4445344"
FIXED_INSTALLATION_ID = "150304409"
FIXED_APP_SLUG = "codex-tri-adversarial-bot"
MARKER_PREFIX = "<!-- blip-ship-attestation:v1"
MAX_DIFF_CHARS = 200000
EXPECTED_MODELS = {
    "tiers": {"terra": "gpt-5.6-terra", "luna": "gpt-5.6-luna", "gpt55": "gpt-5.5"},
    "guard": "gpt-5.6-sol",
    "apex": "gpt-5.6-sol",
    "apex_effort": "max",
    "refuter_effort": "xhigh",
}
TIER_EFFORT = {"terra": "low", "luna": "medium", "gpt55": "xhigh"}
LENSES = ("correctness", "security", "simplification", "test-gap")

def fail(message: str) -> None:
    raise SystemExit(f"bind-ship-attestation: {message}")


def _reject_duplicate_pairs(pairs: list[tuple[str, object]]) -> dict:
    out: dict = {}
    for key, value in pairs:
        if key in out:
            fail(f"JSON input contains duplicate field {key!r}")
        out[key] = value
    return out


def read_strict_json(path: Path, label: str) -> dict:
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        fail(f"{label} path is not an absolute regular file")
    size = path.stat().st_size
    if size < 2 or size > 1_048_576:
        fail(f"{label} byte length is outside the protected limit")
    try:
        value = json.loads(
            path.read_bytes().decode("utf-8", errors="strict"),
            object_pairs_hook=_reject_duplicate_pairs,
        )
    except UnicodeDecodeError:
        fail(f"{label} is not strict UTF-8")
    except json.JSONDecodeError:
        fail(f"{label} JSON is malformed")
    if not isinstance(value, dict):
        fail(f"{label} JSON root is not an object")
    return value


def normalize_files(block: object) -> list[dict]:
    if not isinstance(block, dict):
        fail("changed-file collection is missing")
    page_info = block.get("pageInfo")
    nodes = block.get("nodes")
    if not isinstance(page_info, dict) or page_info.get("hasNextPage") is not False:
        fail("changed-file pagination is incomplete")
    if not isinstance(nodes, list) or not nodes or any(not isinstance(node, dict) for node in nodes):
        fail("changed-file nodes are empty or malformed")

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
            fail("a changed path is malformed")
        if not isinstance(additions, int) or additions < 0 or not isinstance(deletions, int) or deletions < 0:
            fail(f"changed-file counts are malformed for {path!r}")
        if not isinstance(change_type, str) or not change_type:
            fail(f"changed-file type is malformed for {path!r}")
        identity = path.casefold()
        if identity in seen:
            fail(f"changed path {path!r} is duplicated case-insensitively")
        seen.add(identity)
        normalized.append(
            {"path": path, "additions": additions, "deletions": deletions, "change_type": change_type.upper()}
        )
    normalized.sort(key=lambda entry: entry["path"].encode("utf-8"))
    return normalized


def files_digest(files: list[dict]) -> str:
    return canonical_digest(files)


def normalize_gate_files(value: object) -> list[dict]:
    if not isinstance(value, list) or not value:
        fail("gate changed-file evidence is empty or malformed")
    normalized: list[dict] = []
    seen: set[str] = set()
    for entry in value:
        if not isinstance(entry, dict) or set(entry) != {"path", "additions", "deletions", "change_type"}:
            fail("gate changed-file entry shape is malformed")
        path = entry.get("path")
        additions = entry.get("additions")
        deletions = entry.get("deletions")
        change_type = entry.get("change_type")
        if (
            not isinstance(path, str)
            or not path
            or path.casefold() in seen
            or not isinstance(additions, int)
            or additions < 0
            or not isinstance(deletions, int)
            or deletions < 0
            or change_type not in {"ADDED", "DELETED", "MODIFIED", "RENAMED", "COPIED", "CHANGED"}
        ):
            fail("gate changed-file entry values are malformed")
        seen.add(path.casefold())
        normalized.append(dict(entry))
    normalized.sort(key=lambda entry: entry["path"].encode("utf-8"))
    return normalized


def runtime_root() -> Path:
    source_parent = Path(__file__).resolve().parent
    return source_parent if (source_parent / "bots.json").is_file() else source_parent.parent


def fixed_installation_token() -> str:
    entry = load_bot_config(runtime_root(), "codex", override=True)
    expected = {
        "app_id": FIXED_APP_ID,
        "installation_id": FIXED_INSTALLATION_ID,
        "app_slug": FIXED_APP_SLUG,
        "repo": FIXED_REPO,
    }
    for key, value in expected.items():
        if str(entry.get(key) or "") != value:
            fail(f"codex bot config {key} differs from the protected fixed identity")
    return protected_installation_token(FIXED_APP_ID, FIXED_INSTALLATION_ID)


def _final_calls(calls: object) -> dict[str, dict]:
    if not isinstance(calls, list) or not calls:
        fail("gate agent-call evidence is empty or malformed")
    grouped: dict[str, list[dict]] = {}
    for call in calls:
        if not isinstance(call, dict):
            fail("an agent-call entry is malformed")
        label = call.get("label")
        model = call.get("model")
        effort = call.get("effort")
        attempt = call.get("attempt")
        ok = call.get("ok")
        if (
            not isinstance(label, str)
            or not label
            or not isinstance(model, str)
            or not isinstance(effort, str)
            or not isinstance(attempt, int)
            or attempt < 1
            or not isinstance(ok, bool)
        ):
            fail("an agent-call entry has invalid label/model/effort/attempt/status")
        grouped.setdefault(label, []).append(call)
    final: dict[str, dict] = {}
    for label, attempts in grouped.items():
        numbers = sorted(call["attempt"] for call in attempts)
        if numbers != list(range(1, len(numbers) + 1)):
            fail(f"agent-call retry sequence is incomplete for {label!r}")
        selected = max(attempts, key=lambda call: call["attempt"])
        if selected.get("ok") is not True:
            fail(f"required agent call {label!r} did not finish successfully")
        final[label] = selected
    return final


def validate_agent_calls(gate: dict) -> None:
    if gate.get("models") != EXPECTED_MODELS:
        fail("gate model and effort map differs from the protected review composition")
    if gate.get("max_diff_chars") != MAX_DIFF_CHARS:
        fail("gate diff cap differs from the protected 200000-character limit")
    if gate.get("block_severity") != ["critical", "high"]:
        fail("gate blocking severities differ from the protected policy")
    difficulty = gate.get("difficulty")
    if not isinstance(difficulty, dict) or difficulty.get("source") != "terra-triage":
        fail("gate did not complete the required independent terra triage")
    tiers = difficulty.get("lens_tiers")
    if not isinstance(tiers, dict) or set(tiers) != set(LENSES):
        fail("gate lens routing is missing or malformed")
    if tiers.get("security") != "gpt55":
        fail("gate security lens did not use the required gpt-5.5 floor")

    layer1 = gate.get("layer1")
    if not isinstance(layer1, dict) or layer1.get("failures") != 0 or layer1.get("failed_lenses") != []:
        fail("gate did not complete all four required finder lenses")
    verified_ids = layer1.get("verified_ids")
    if not isinstance(verified_ids, list) or any(not isinstance(item, str) or not item for item in verified_ids):
        fail("gate verified-finding identifiers are malformed")
    if len(verified_ids) != len(set(verified_ids)):
        fail("gate verified-finding identifiers are duplicated")
    if layer1.get("verified") != len(verified_ids):
        fail("gate verified-finding count differs from its identifiers")

    layer2 = gate.get("layer2")
    if not isinstance(layer2, dict) or layer2.get("unverified") != 0:
        fail("gate has an unavailable or failed required refuter")

    evidence_items = []
    for collection_name in ("findings", "killed"):
        collection = gate.get(collection_name)
        if not isinstance(collection, list) or any(not isinstance(item, dict) for item in collection):
            fail(f"gate {collection_name} evidence is malformed")
        evidence_items.extend(collection)
    by_id: dict[str, dict] = {}
    for item in evidence_items:
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            fail("gate finding evidence has no valid id")
        if item_id in by_id:
            fail(f"gate finding id {item_id!r} is duplicated across final evidence")
        by_id[item_id] = item
    if set(by_id) != set(verified_ids):
        fail("gate final finding evidence does not cover every verified finding exactly once")

    final = _final_calls(gate.get("agent_calls"))
    expected_labels: dict[str, tuple[str, str]] = {
        "triage": (EXPECTED_MODELS["tiers"]["terra"], "low"),
        "apex": (EXPECTED_MODELS["apex"], EXPECTED_MODELS["apex_effort"]),
    }
    for lens in LENSES:
        tier = tiers.get(lens)
        if tier not in TIER_EFFORT:
            fail(f"gate tier for lens {lens!r} is invalid")
        expected_labels[f"find:{lens}:{tier}"] = (EXPECTED_MODELS["tiers"][tier], TIER_EFFORT[tier])
    for finding_id in verified_ids:
        finder_tier = by_id[finding_id].get("finder_tier")
        if finder_tier not in TIER_EFFORT:
            fail(f"gate finding {finding_id!r} has no valid finder provenance")
        refuter_model = EXPECTED_MODELS["guard"] if finder_tier == "gpt55" else EXPECTED_MODELS["tiers"]["gpt55"]
        expected_labels[f"refute:{finding_id}"] = (refuter_model, EXPECTED_MODELS["refuter_effort"])
    if set(final) != set(expected_labels):
        fail("gate agent-call labels do not exactly match triage, four finders, refuters, and apex")
    for label, (model, effort) in expected_labels.items():
        call = final[label]
        if call.get("model") != model or call.get("effort") != effort:
            fail(f"gate agent call {label!r} used an unexpected model or effort")


def select_mode(difficulty: object, files: list[dict]) -> str:
    if any(
        entry["change_type"] in ("RENAMED", "COPIED")
        or path_requires_elevated_scope(entry["path"])
        for entry in files
    ):
        return "human_critical"
    if difficulty == "critical":
        return "human_critical"
    if difficulty == "high":
        return "risk_scoped_specialists"
    if difficulty in ("low", "medium"):
        return "focused_semantic"
    fail("gate difficulty is missing or unknown")


def canonical_footer(
    *, pr: int, base: str, head: str, mode: str, digest: str, diff_digest: str
) -> str:
    return (
        f"{MARKER_PREFIX}\n"
        f"repo={FIXED_REPO}\n"
        f"pr={pr}\n"
        f"base={base.lower()}\n"
        f"head={head.lower()}\n"
        f"review_mode={mode}\n"
        f"changed_files_sha256={digest.lower()}\n"
        f"diff_sha256={diff_digest.lower()}\n"
        "verdict=SHIP\n"
        "-->"
    )


GATE_KEYS = {
    "held", "base_ref", "files_changed", "difficulty", "layer1", "layer2",
    "final_count", "findings", "killed", "summary", "coverage", "notes",
    "verdict", "mapped_event", "repo", "pr", "base_sha", "head_sha",
    "changed_files", "changed_files_sha256", "diff_sha256", "max_diff_chars",
    "block_severity", "approve_on_ship", "engine", "models", "generated_at",
    "agent_calls", "engine_seconds", "report_sha256",
}


def _validate_outcome(gate: dict) -> str:
    if set(gate) != GATE_KEYS:
        fail("gate JSON has unknown or missing top-level fields")
    verdict = gate.get("verdict")
    event = gate.get("mapped_event")
    held = gate.get("held")
    findings = gate.get("findings")
    if not isinstance(findings, list) or any(not isinstance(item, dict) for item in findings):
        fail("gate findings are malformed")
    blockers = [item for item in findings if item.get("severity") in {"critical", "high"}]
    if verdict == "SHIP":
        if event != "COMMENT" or held is not None or blockers:
            fail("SHIP must be a non-held COMMENT with no blocking finding")
    elif verdict == "NO-SHIP":
        if event != "REQUEST_CHANGES" or held is not None or not blockers:
            fail("NO-SHIP must be a non-held REQUEST_CHANGES with a blocking finding")
    elif verdict == "HELD":
        if event != "COMMENT" or not isinstance(held, str) or not held:
            fail("HELD must be a COMMENT with a concrete held reason")
    else:
        fail("gate verdict is outside the protected mapping")
    if gate.get("approve_on_ship") is not False:
        fail("App gate must map SHIP to COMMENT, never APPROVE")
    return verdict


def bind_report(*, report: str, gate: dict, pr_state: dict, expected_head: str, pr_number: int) -> tuple[str, dict]:
    if MARKER_PREFIX in report:
        fail("untrusted gate report already contains the reserved attestation marker")
    if len(report) > 55_000:
        fail("gate report is too large for the protected GitHub review body")
    verdict = _validate_outcome(gate)
    if gate.get("repo") != FIXED_REPO or gate.get("pr") != pr_number:
        fail("gate JSON is not bound to the fixed repository and PR")
    if not re.fullmatch(r"[0-9a-f]{40}", str(gate.get("base_sha") or "")):
        fail("gate JSON base SHA is missing or malformed")
    if str(gate.get("head_sha") or "").lower() != expected_head.lower():
        fail("gate JSON head differs from the wrapper's exact head")
    if gate.get("engine") != "codex-tri-layer-4model":
        fail("gate JSON does not identify the pinned Codex engine")
    if not re.fullmatch(r"[0-9a-f]{64}", str(gate.get("diff_sha256") or "")):
        fail("gate inspectable-diff digest is missing or malformed")
    if hashlib.sha256(report.encode("utf-8")).hexdigest() != gate.get("report_sha256"):
        fail("gate report bytes differ from the report digest recorded in gate JSON")
    gate_files = normalize_gate_files(gate.get("changed_files"))
    gate_files_digest = files_digest(gate_files)
    if gate_files_digest != gate.get("changed_files_sha256"):
        fail("gate changed-file digest does not match its normalized file evidence")
    if gate.get("files_changed") != [entry["path"] for entry in gate_files]:
        fail("gate path list differs from its normalized changed-file evidence")

    try:
        live = validate_snapshot(pr_state, repo=FIXED_REPO, pr=pr_number)
    except RuntimeError as exc:
        fail(str(exc))
    base = live["meta"]["baseRefOid"]
    head = live["meta"]["headRefOid"]
    if head != expected_head.lower():
        fail("live PR head moved after the gate")
    if base != str(gate.get("base_sha") or "").lower():
        fail("live PR base moved after the gate")

    files = live["normalized_files"]
    digest = live["changed_files_sha256"]
    if files != gate_files or digest != gate_files_digest:
        fail("live changed-file evidence differs from the exact evidence reviewed by the gate")
    if live["diff_sha256"] != gate.get("diff_sha256"):
        fail("live inspectable patch evidence differs from the exact evidence reviewed by the gate")

    if verdict != "HELD":
        validate_agent_calls(gate)
    difficulty = ((gate.get("difficulty") or {}).get("overall") if isinstance(gate.get("difficulty"), dict) else None)
    mode = select_mode(difficulty, files) if difficulty in ("low", "medium", "high", "critical") else None
    if verdict == "SHIP":
        if mode is None:
            fail("SHIP gate has no valid review mode")
        footer = canonical_footer(
            pr=pr_number,
            base=base,
            head=head,
            mode=mode,
            digest=digest,
            diff_digest=live["diff_sha256"],
        )
        output = report.rstrip() + "\n\n" + footer
    else:
        output = report
    return output, {
        "base": base,
        "head": head,
        "review_mode": mode,
        "changed_files_sha256": digest,
        "diff_sha256": live["diff_sha256"],
        "verdict": verdict,
    }


def fetch_pr(repo: str, pr_number: int) -> dict:
    token = fixed_installation_token()
    try:
        return collect_pr_snapshot(http_json, API, token, repo, pr_number, require_patch=True)
    except RuntimeError as exc:
        fail(str(exc))
    finally:
        token = None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", choices=[FIXED_REPO], required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--gate-json", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--pr-state-json", type=Path, help=argparse.SUPPRESS)
    cli = parser.parse_args()
    if not re.fullmatch(r"[0-9a-fA-F]{40}", cli.expected_head):
        fail("expected head must be a full 40-character Git SHA")
    gate = read_strict_json(cli.gate_json, "gate artifact")
    report = cli.report.read_text(encoding="utf-8")
    pr_state = (
        read_strict_json(cli.pr_state_json, "offline PR snapshot")
        if cli.pr_state_json is not None
        else fetch_pr(cli.repo, cli.pr)
    )
    bound, evidence = bind_report(
        report=report,
        gate=gate,
        pr_state=pr_state,
        expected_head=cli.expected_head,
        pr_number=cli.pr,
    )
    if not cli.out.is_absolute() or not cli.out.parent.is_dir() or cli.out.parent.is_symlink():
        fail("verified report output parent is unavailable or linked")
    with cli.out.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(bound)
    print("BLIP_TUPLE_VERIFIED=true")
    print(f"BLIP_TUPLE_BASE={evidence['base']}")
    print(f"BLIP_TUPLE_HEAD={evidence['head']}")
    print(f"BLIP_TUPLE_CHANGED_FILES_SHA256={evidence['changed_files_sha256']}")
    print(f"BLIP_TUPLE_DIFF_SHA256={evidence['diff_sha256']}")
    print(f"BLIP_TUPLE_VERDICT={evidence['verdict']}")
    if evidence["review_mode"] is not None:
        print(f"BLIP_ATTESTATION_REVIEW_MODE={evidence['review_mode']}")
    print(f"BLIP_VERIFIED_REPORT={cli.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
