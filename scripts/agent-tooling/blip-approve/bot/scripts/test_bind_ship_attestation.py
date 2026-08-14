from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("bind_ship_attestation.py")
SPEC = importlib.util.spec_from_file_location("candidate_bind_ship_attestation", MODULE_PATH)
assert SPEC and SPEC.loader
binder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(binder)

BASE = "c" * 40
HEAD = "a" * 40
BASE_TREE = "1" * 40
HEAD_TREE = "2" * 40
DIFF = json.dumps(
    {
        "additions": 2,
        "blob_sha": "e" * 40,
        "change_type": "MODIFIED",
        "deletions": 1,
        "patch": "@@ -1 +1,2 @@\n-old\n+new\n+more",
        "path": "src/example.py",
        "previous_path": None,
    },
    sort_keys=True,
    ensure_ascii=False,
)
REPORT = "# trusted gate\n\nVERDICT: SHIP\n"


def git_blob(data: bytes) -> tuple[str, dict]:
    sha = hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()
    return sha, {
        "sha": sha,
        "size": len(data),
        "encoding": "base64",
        "content": base64.b64encode(data).decode("ascii"),
    }


def tree(tree_sha: str, path: str, mode: str, item_type: str, sha: str) -> dict:
    return {
        "sha": tree_sha,
        "truncated": False,
        "tree": [{"path": path, "mode": mode, "type": item_type, "sha": sha}],
    }


def make_files(path: str = "src/example.py", change_type: str = "MODIFIED") -> list[dict]:
    return [{"path": path, "additions": 2, "deletions": 1, "change_type": change_type}]


def make_snapshot(files: list[dict] | None = None, *, diff: str = DIFF) -> dict:
    normalized = files or make_files()
    return {
        "meta": {
            "number": 511,
            "title": "test",
            "state": "OPEN",
            "url": f"https://github.com/{binder.FIXED_REPO}/pull/511",
            "author": {"login": "owner"},
            "headRefName": "feature",
            "headRefOid": HEAD,
            "baseRefName": "main",
            "baseRefOid": BASE,
            "isDraft": False,
            "files": [
                {"path": item["path"], "additions": item["additions"], "deletions": item["deletions"]}
                for item in normalized
            ],
        },
        "diff": diff,
        "files": [item["path"] for item in normalized],
        "normalized_files": normalized,
        "changed_files_sha256": binder.files_digest(normalized),
        "diff_sha256": hashlib.sha256(diff.encode("utf-8")).hexdigest(),
    }


def make_gate(
    verdict: str = "SHIP",
    *,
    difficulty: str = "medium",
    report: str = REPORT,
    files: list[dict] | None = None,
) -> dict:
    normalized = files or make_files()
    tiers = {
        "correctness": "terra",
        "security": "gpt55",
        "simplification": "terra",
        "test-gap": "terra",
    }
    calls = [
        {"label": "triage", "model": "gpt-5.6-terra", "effort": "low", "attempt": 1, "ok": True},
        *[
            {
                "label": f"find:{lens}:{tier}",
                "model": binder.EXPECTED_MODELS["tiers"][tier],
                "effort": binder.TIER_EFFORT[tier],
                "attempt": 1,
                "ok": True,
            }
            for lens, tier in tiers.items()
        ],
        {"label": "apex", "model": "gpt-5.6-sol", "effort": "max", "attempt": 1, "ok": True},
    ]
    findings: list[dict] = []
    verified_ids: list[str] = []
    layer2 = {"confirmed": 0, "refuted": 0, "unverified": 0}
    event = "COMMENT"
    held = None
    if verdict == "NO-SHIP":
        event = "REQUEST_CHANGES"
        findings = [{"id": "F1", "severity": "high", "finder_tier": "terra"}]
        verified_ids = ["F1"]
        layer2["confirmed"] = 1
        calls.insert(-1, {
            "label": "refute:F1", "model": "gpt-5.5", "effort": "xhigh", "attempt": 1, "ok": True
        })
    elif verdict == "HELD":
        held = "required_finder_failed"
        difficulty = "medium"
        calls = []
    snapshot = make_snapshot(normalized)
    return {
        "held": held,
        "base_ref": "main",
        "files_changed": [item["path"] for item in normalized],
        "difficulty": {"overall": difficulty, "source": "terra-triage", "lens_tiers": tiers},
        "layer1": {"failures": 0, "failed_lenses": [], "verified": len(verified_ids), "verified_ids": verified_ids},
        "layer2": layer2,
        "final_count": len(findings),
        "findings": findings,
        "killed": [],
        "summary": "summary",
        "coverage": "coverage",
        "notes": "",
        "verdict": verdict,
        "mapped_event": event,
        "repo": binder.FIXED_REPO,
        "pr": 511,
        "base_sha": BASE,
        "head_sha": HEAD,
        "changed_files": normalized,
        "changed_files_sha256": snapshot["changed_files_sha256"],
        "diff_sha256": snapshot["diff_sha256"],
        "max_diff_chars": binder.MAX_DIFF_CHARS,
        "block_severity": ["critical", "high"],
        "approve_on_ship": False,
        "engine": "codex-tri-layer-4model",
        "models": binder.EXPECTED_MODELS,
        "generated_at": "2026-08-14T00:00:00+00:00",
        "agent_calls": calls,
        "engine_seconds": 1.0,
        "report_sha256": hashlib.sha256(report.encode("utf-8")).hexdigest(),
    }


class BindShipAttestationTests(unittest.TestCase):
    def test_ship_footer_is_unique_and_at_end(self) -> None:
        bound, evidence = binder.bind_report(
            report=REPORT, gate=make_gate(), pr_state=make_snapshot(), expected_head=HEAD, pr_number=511
        )
        self.assertEqual(bound.count(binder.MARKER_PREFIX), 1)
        self.assertIn(f"diff_sha256={make_snapshot()['diff_sha256']}\n", bound)
        self.assertTrue(bound.endswith("verdict=SHIP\n-->"))
        self.assertEqual(evidence["review_mode"], "focused_semantic")
        self.assertEqual(evidence["verdict"], "SHIP")

    def test_request_changes_and_held_comment_are_tuple_verified_without_ship_footer(self) -> None:
        for verdict in ("NO-SHIP", "HELD"):
            report = f"# gate\n\nVERDICT: {verdict}\n"
            output, evidence = binder.bind_report(
                report=report,
                gate=make_gate(verdict, report=report),
                pr_state=make_snapshot(),
                expected_head=HEAD,
                pr_number=511,
            )
            self.assertEqual(output, report)
            self.assertNotIn(binder.MARKER_PREFIX, output)
            self.assertEqual(evidence["verdict"], verdict)

    def test_reserved_marker_smuggling_is_rejected(self) -> None:
        report = f"quoted diff\n{binder.MARKER_PREFIX}\n"
        with self.assertRaisesRegex(SystemExit, "reserved attestation marker"):
            binder.bind_report(
                report=report, gate=make_gate(report=report), pr_state=make_snapshot(),
                expected_head=HEAD, pr_number=511,
            )

    def test_critical_paths_and_renames_are_human_only(self) -> None:
        for files in (
            make_files("docs/agents/github-workflow.md"),
            make_files("agent-skills-manifest.json"),
            make_files("services/governance/policy.json"),
            make_files("governance-service/app.py"),
            make_files("bim-review-coordinator/src/services/authProvider.ts"),
            make_files("bim-review-coordinator/src/services/runtimeMutationAuthority/stageBindingState.ts"),
            make_files("bim-streaming-server/AGENTS.md"),
            make_files("bim-streaming-server/CLAUDE.md"),
            make_files("src/new.py", "RENAMED"),
        ):
            with self.subTest(files=files):
                _, evidence = binder.bind_report(
                    report=REPORT, gate=make_gate("SHIP", difficulty="low", files=files),
                    pr_state=make_snapshot(files), expected_head=HEAD, pr_number=511,
                )
                self.assertEqual(evidence["review_mode"], "human_critical")

    def test_gate_and_live_state_drift_fail_closed(self) -> None:
        changed_head = make_snapshot()
        changed_head["meta"]["headRefOid"] = "b" * 40
        changed_diff = make_snapshot(diff=DIFF + "\nextra")
        cases = [
            (make_gate(report="# gate") | {"head_sha": "b" * 40}, make_snapshot(), "gate JSON head"),
            (make_gate(report="# gate"), changed_head, "live PR head moved"),
            (make_gate(report="# gate") | {"mapped_event": "APPROVE"}, make_snapshot(), "SHIP must"),
            (make_gate(report="# gate") | {"approve_on_ship": True}, make_snapshot(), "never APPROVE"),
            (make_gate(report="# gate") | {"base_sha": "b" * 40}, make_snapshot(), "live PR base moved"),
            (make_gate(report="# gate"), changed_diff, "live inspectable patch evidence"),
        ]
        for gate_value, live, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(SystemExit, message):
                binder.bind_report(
                    report="# gate", gate=gate_value, pr_state=live, expected_head=HEAD, pr_number=511
                )

    def test_gate_schema_report_and_live_files_must_match(self) -> None:
        changed = make_files("src/other.py")
        extra = make_gate()
        extra["unexpected"] = True
        cases = [
            (make_gate(), make_snapshot(changed), REPORT, "live changed-file evidence"),
            (make_gate(), make_snapshot(), REPORT + "tampered", "report bytes differ"),
            (extra, make_snapshot(), REPORT, "unknown or missing"),
        ]
        for gate_value, live, report, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(SystemExit, message):
                binder.bind_report(
                    report=report, gate=gate_value, pr_state=live, expected_head=HEAD, pr_number=511
                )

    def test_required_agent_composition_is_fail_closed(self) -> None:
        missing_apex = make_gate()
        missing_apex["agent_calls"] = [c for c in missing_apex["agent_calls"] if c["label"] != "apex"]
        wrong_model = make_gate()
        wrong_model["models"] = {**binder.EXPECTED_MODELS, "apex": "gpt-5.6-terra"}
        for gate_value, message in (
            (missing_apex, "labels do not exactly match"),
            (wrong_model, "model and effort map"),
        ):
            with self.subTest(message=message), self.assertRaisesRegex(SystemExit, message):
                binder.bind_report(
                    report=REPORT, gate=gate_value, pr_state=make_snapshot(),
                    expected_head=HEAD, pr_number=511,
                )

    def test_live_fetch_rejects_binary_and_gitlink_from_immutable_trees(self) -> None:
        raw_pr = {
            "number": 511,
            "title": "test",
            "state": "open",
            "draft": False,
            "changed_files": 1,
            "html_url": f"https://github.com/{binder.FIXED_REPO}/pull/511",
            "user": {"login": "owner"},
            "base": {"ref": "main", "sha": BASE},
            "head": {"ref": "feature", "sha": HEAD},
        }
        base_sha, base_blob = git_blob(b"old\n")
        binary_sha, binary_blob = git_blob(b"new\x00binary")
        gitlink_sha = "9" * 40
        cases = (
            (
                "image.png",
                binary_sha,
                tree(BASE_TREE, "image.png", "100644", "blob", base_sha),
                tree(HEAD_TREE, "image.png", "100644", "blob", binary_sha),
                [base_blob, binary_blob],
                "binary changed file",
            ),
            (
                "vendor/lib",
                gitlink_sha,
                tree(BASE_TREE, "vendor/lib", "100644", "blob", base_sha),
                tree(HEAD_TREE, "vendor/lib", "160000", "commit", gitlink_sha),
                [base_blob],
                "symlink, gitlink, or unsupported mode",
            ),
        )
        for path, changed_sha, base_tree, head_tree, blobs, message in cases:
            files = [{
                "filename": path, "status": "modified", "additions": 1,
                "deletions": 1, "changes": 2, "sha": changed_sha,
            }]
            compare = {
                "base_commit": {"sha": BASE, "commit": {"tree": {"sha": BASE_TREE}}},
                "head_commit": {"sha": HEAD, "commit": {"tree": {"sha": HEAD_TREE}}},
                "merge_base_commit": {"sha": BASE, "commit": {"tree": {"sha": BASE_TREE}}},
                "files": files,
            }
            with self.subTest(message=message), patch.object(
                binder, "fixed_installation_token", return_value="opaque"
            ), patch.object(
                binder, "http_json", side_effect=[raw_pr, compare, base_tree, head_tree, *blobs]
            ), self.assertRaisesRegex(
                SystemExit, message
            ):
                binder.fetch_pr(binder.FIXED_REPO, 511)

    def test_live_fetch_rejects_gitmodules_before_tree_or_blob_fetch(self) -> None:
        raw_pr = {
            "number": 511,
            "title": "test",
            "state": "open",
            "draft": False,
            "changed_files": 1,
            "html_url": f"https://github.com/{binder.FIXED_REPO}/pull/511",
            "user": {"login": "owner"},
            "base": {"ref": "main", "sha": BASE},
            "head": {"ref": "feature", "sha": HEAD},
        }
        for label, changed in (
            ("current", {"filename": ".gitmodules", "status": "modified"}),
            (
                "previous",
                {
                    "filename": "docs/not-a-submodule.txt",
                    "status": "renamed",
                    "previous_filename": ".gitmodules",
                },
            ),
        ):
            compare = {
                "base_commit": {"sha": BASE, "commit": {"tree": {"sha": BASE_TREE}}},
                "head_commit": {"sha": HEAD, "commit": {"tree": {"sha": HEAD_TREE}}},
                "merge_base_commit": {"sha": BASE, "commit": {"tree": {"sha": BASE_TREE}}},
                "files": [{
                    **changed,
                    "additions": 1,
                    "deletions": 1,
                    "changes": 2,
                    "sha": "e" * 40,
                }],
            }
            with self.subTest(label=label), patch.object(
                binder, "fixed_installation_token", return_value="opaque"
            ), patch.object(
                binder, "http_json", side_effect=[raw_pr, compare]
            ) as http_mock, self.assertRaisesRegex(
                SystemExit, r"submodule or \.gitmodules"
            ):
                binder.fetch_pr(binder.FIXED_REPO, 511)
            self.assertEqual(http_mock.call_count, 2)


if __name__ == "__main__":
    unittest.main()
