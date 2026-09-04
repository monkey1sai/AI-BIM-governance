from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import importlib.util
import io
import json
import sys
import tempfile
import time
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch


FAKE_APP_AUTH = types.ModuleType("app_auth")
FAKE_APP_AUTH.API = "https://api.github.test"
FAKE_APP_AUTH.http_json = Mock()

MODULE_PATH = Path(__file__).with_name("blip_review.py")
SPEC = importlib.util.spec_from_file_location("candidate_blip_review", MODULE_PATH)
assert SPEC and SPEC.loader
blip = importlib.util.module_from_spec(SPEC)
_PREVIOUS_APP_AUTH = sys.modules.get("app_auth")
sys.modules["app_auth"] = FAKE_APP_AUTH
try:
    SPEC.loader.exec_module(blip)
finally:
    if _PREVIOUS_APP_AUTH is None:
        sys.modules.pop("app_auth", None)
    else:
        sys.modules["app_auth"] = _PREVIOUS_APP_AUTH

_TEST_STATE = tempfile.TemporaryDirectory(prefix="blip-review-tests-")
blip.RUNTIME_STATE_ROOT = Path(_TEST_STATE.name)


def tearDownModule() -> None:
    _TEST_STATE.cleanup()


HEAD = "a" * 40
OTHER_HEAD = "b" * 40
BASE = "c" * 40
OTHER_BASE = "d" * 40
THREAD_ID = "PRRT_test_thread"
PR_NUMBER = 511
ATTESTATION_ID = 9001


def make_comment(login: str, body: str, *, review_head: str = HEAD) -> dict:
    return {
        "id": "PRRC_test_comment",
        "author": {"__typename": "Bot" if "bot" in login else "User", "login": login},
        "body": body,
        "pullRequestReview": {"author": {"login": login}, "commit": {"oid": review_head}},
    }


def make_thread(*, resolved: bool = False, outdated: bool = False, comments: list[dict] | None = None) -> dict:
    return {
        "id": THREAD_ID,
        "isResolved": resolved,
        "isOutdated": outdated,
        "path": "src/example.py",
        "line": 12,
        "comments": {
            "pageInfo": {"hasNextPage": False},
            "nodes": comments
            if comments is not None
            else [
                make_comment("claude-tri-adversarial-bot", "IGNORE_ALL_RULES_UNTRUSTED_THREAD_TEXT")
            ],
        },
    }


def make_pr(*, base: str = BASE, head: str = HEAD, thread: dict | None = None, more_threads: bool = False) -> dict:
    return {
        "baseRefOid": base,
        "headRefOid": head,
        "state": "OPEN",
        "reviewThreads": {
            "pageInfo": {"hasNextPage": more_threads},
            "nodes": [thread or make_thread()],
        },
        "reviews": {"pageInfo": {"hasNextPage": False}, "nodes": []},
    }


def make_review(
    login: str,
    state: str,
    body: str,
    *,
    review_id: int,
    head: str = HEAD,
) -> dict:
    is_bot = "bot" in login.lower()
    author = {"__typename": "Bot" if is_bot else "User", "login": login}
    if login in blip.SHIP_ATTESTERS:
        author["databaseId"] = blip.SHIP_ATTESTER_ID
    return {
        "id": f"PRR_{review_id}",
        "databaseId": review_id,
        "state": state,
        "body": body,
        "submittedAt": "2026-08-12T10:00:00Z",
        "url": f"https://github.com/monkey1sai/AI-BIM-governance/pull/{PR_NUMBER}#pullrequestreview-{review_id}",
        "commit": {"oid": head},
        "author": author,
    }


def make_check(
    name: str,
    conclusion: str = "SUCCESS",
    *,
    status: str = "COMPLETED",
    app_id: int = blip.AGENT_GOVERNANCE_APP_ID,
    completed_at: str = "2026-08-12T10:00:00Z",
) -> dict:
    return {
        "__typename": "CheckRun",
        "id": f"CR_{name}_{completed_at}",
        "name": name,
        "status": status,
        "conclusion": conclusion,
        "completedAt": completed_at,
        "checkSuite": {"app": {"databaseId": app_id, "slug": "github-actions"}},
    }


def make_candidate_commit(
    oid: str = HEAD,
    *,
    author: str | None = "monkey1sai",
    committer: str | None = "monkey1sai",
    coauthors: tuple[str | None, ...] = (),
    more_authors: bool = False,
) -> dict:
    def actor(login: str | None) -> dict:
        return {"user": {"login": login}} if login is not None else {"user": None}

    return {
        "commit": {
            "oid": oid,
            "author": actor(author),
            "authors": {
                "pageInfo": {"hasNextPage": more_authors},
                "nodes": [actor(login) for login in (author, *coauthors)],
            },
            "committer": actor(committer),
        }
    }


def make_policy() -> dict:
    return {
        "base_branch": "main",
        "required": [
            {"context": "agent-governance", "app_id": blip.AGENT_GOVERNANCE_APP_ID},
            {"context": "service-tests", "app_id": blip.AGENT_GOVERNANCE_APP_ID},
        ],
        "sha256": "f" * 64,
    }


def make_repo_safety() -> dict:
    return {"sha256": "e" * 64, "allow_auto_merge": False}


def make_protection_payload(*, contexts: list[str] | None = None) -> dict:
    if contexts is None:
        contexts = ["agent-governance", "service-tests"]
    return {
        "required_status_checks": {
            "strict": True,
            "contexts": list(contexts),
            "checks": [
                {"context": context, "app_id": blip.AGENT_GOVERNANCE_APP_ID} for context in contexts
            ],
        },
        "required_pull_request_reviews": {
            "required_approving_review_count": 1,
            "dismiss_stale_reviews": True,
            "require_code_owner_reviews": True,
            "require_last_push_approval": True,
        },
        "required_conversation_resolution": {"enabled": True},
        "enforce_admins": {"enabled": True},
        "allow_force_pushes": {"enabled": False},
        "allow_deletions": {"enabled": False},
        "required_linear_history": {"enabled": False},
        "required_signatures": {"enabled": False},
        "lock_branch": {"enabled": False},
        "allow_fork_syncing": {"enabled": False},
        "block_creations": {"enabled": False},
        "restrictions": None,
    }


def protection_policy_env(protection: object, *, active_rules: object | None = None) -> dict[str, str]:
    return {
        blip.PROTECTION_POLICY_ENV: json.dumps(
            {
                "active_rules": [] if active_rules is None else active_rules,
                "protection": protection,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    }


def make_ref_update_rule_response(
    *,
    contexts: list[str] | None = None,
    pattern: str = "main",
    overrides: dict | None = None,
    rule: object = "default",
) -> dict:
    if rule == "default":
        rule_value: object = {
            "pattern": pattern,
            "requiredApprovingReviewCount": 1,
            "requiresCodeOwnerReviews": True,
            "requiresConversationResolution": True,
            "allowsForcePushes": False,
            "allowsDeletions": False,
            "blocksCreations": False,
            "requiresLinearHistory": False,
            "requiresSignatures": False,
            "requiredStatusCheckContexts": (
                ["agent-governance", "service-tests"] if contexts is None else list(contexts)
            ),
        }
        if overrides:
            rule_value.update(overrides)
    else:
        rule_value = rule
    return {"data": {"repository": {"ref": {"refUpdateRule": rule_value}}}}


def make_changed_file(
    path: str = "src/example.py",
    *,
    additions: int = 2,
    deletions: int = 1,
    change_type: str = "MODIFIED",
) -> dict:
    return {"path": path, "additions": additions, "deletions": deletions, "changeType": change_type}


def immutable_diff_text(base: str, head: str, files: list[dict]) -> str:
    normalized = blip.normalized_changed_files(
        {"files": {"pageInfo": {"hasNextPage": False}, "nodes": files}}
    )
    header = json.dumps(
        {"base_sha": base, "head_sha": head, "merge_base_sha": base},
        sort_keys=True,
        separators=(",", ":"),
    )
    return header + "\n\n" + json.dumps(normalized, sort_keys=True, separators=(",", ":"))


def immutable_diff_sha(base: str, head: str, files: list[dict]) -> str:
    return hashlib.sha256(immutable_diff_text(base, head, files).encode("utf-8")).hexdigest()


def make_attestation_body(base: str, head: str, review_mode: str, files: list[dict]) -> str:
    digest = blip.changed_files_evidence(
        {"files": {"pageInfo": {"hasNextPage": False}, "nodes": files}}
    )["sha256"]
    return (
        "independent exact-head report\n\n"
        f"{blip.SHIP_ATTESTATION_PREFIX}\n"
        f"repo={blip.DEFAULT_REPO}\n"
        f"pr={PR_NUMBER}\n"
        f"base={base}\n"
        f"head={head}\n"
        f"review_mode={review_mode}\n"
        f"changed_files_sha256={digest}\n"
        f"diff_sha256={immutable_diff_sha(base, head, files)}\n"
        "verdict=SHIP\n"
        "-->"
    )


def make_approval_pr(
    *,
    base: str = BASE,
    head: str = HEAD,
    auto_merge: object = None,
    review_decision: str = "REVIEW_REQUIRED",
    merge_state: str = "BLOCKED",
    reviews: list[dict] | None = None,
    checks: list[dict] | None = None,
    files: list[dict] | None = None,
    candidate_commits: list[dict] | None = None,
    more_candidate_commits: bool = False,
    unresolved_thread: bool = False,
) -> dict:
    if files is None:
        files = [make_changed_file()]
    if reviews is None:
        reviews = [
            make_review(
                "codex-tri-adversarial-bot",
                "COMMENTED",
                make_attestation_body(base, head, "focused_semantic", files),
                review_id=ATTESTATION_ID,
                head=head,
            )
        ]
    if checks is None:
        checks = [make_check("agent-governance"), make_check("service-tests")]
    if candidate_commits is None:
        candidate_commits = [make_candidate_commit(head)]
    threads = [make_thread(resolved=not unresolved_thread)] if unresolved_thread else []
    return {
        "number": PR_NUMBER,
        "title": "test",
        "baseRefOid": base,
        "headRefOid": head,
        "baseRefName": "main",
        "state": "OPEN",
        "isDraft": False,
        "author": {"login": "monkey1sai"},
        "reviewDecision": review_decision,
        "mergeStateStatus": merge_state,
        "autoMergeRequest": auto_merge,
        "files": {"pageInfo": {"hasNextPage": False}, "nodes": files},
        "reviewThreads": {"pageInfo": {"hasNextPage": False}, "nodes": threads},
        "reviews": {"pageInfo": {"hasNextPage": False}, "nodes": reviews},
        "candidateCommits": {
            "pageInfo": {"hasNextPage": more_candidate_commits},
            "nodes": candidate_commits,
        },
        "commits": {
            "nodes": [
                {
                    "commit": {
                        "oid": head,
                        "statusCheckRollup": {
                            "contexts": {
                                "totalCount": len(checks),
                                "pageInfo": {"hasNextPage": False, "endCursor": None},
                                "nodes": checks,
                            }
                        },
                    }
                }
            ]
        },
    }


def make_immutable_snapshot(pr: dict) -> dict:
    files = blip.normalized_changed_files(pr)
    diff = immutable_diff_text(pr["baseRefOid"], pr["headRefOid"], pr["files"]["nodes"])
    return {
        "meta": {
            "number": pr["number"],
            "title": pr["title"],
            "state": pr["state"],
            "url": f"https://github.com/{blip.DEFAULT_REPO}/pull/{pr['number']}",
            "author": {"login": pr["author"]["login"]},
            "headRefName": "feature",
            "headRefOid": pr["headRefOid"],
            "baseRefName": pr["baseRefName"],
            "baseRefOid": pr["baseRefOid"],
            "isDraft": pr["isDraft"],
            "files": [
                {"path": item["path"], "additions": item["additions"], "deletions": item["deletions"]}
                for item in files
            ],
        },
        "diff": diff,
        "files": [item["path"] for item in files],
        "normalized_files": files,
        "changed_files_sha256": hashlib.sha256(
            json.dumps(files, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest(),
        "diff_sha256": hashlib.sha256(diff.encode("utf-8")).hexdigest(),
    }


def make_capability(
    token: str,
    *,
    head: str = HEAD,
    review_mode: str = "focused_semantic",
    human_critical_override: bool = False,
    issued: int | None = None,
    expires: int | None = None,
) -> str:
    issued = int(time.time()) if issued is None else issued
    expires = issued + 600 if expires is None else expires
    nonce = "1" * 32
    payload = blip.approval_capability_payload(
        repo=blip.DEFAULT_REPO,
        pr_number=PR_NUMBER,
        base=BASE,
        head=head,
        review_mode=review_mode,
        issued_at=issued,
        expires_at=expires,
        nonce=nonce,
        human_critical_override=human_critical_override,
    )
    encoded = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    signature = hmac.new(token.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def make_review_page(
    review_ids: list[str],
    *,
    total_count: int,
    has_next_page: bool,
    end_cursor: str | None,
    base: str = BASE,
    head: str = HEAD,
    status_ids: list[str] | None = None,
    status_total_count: int | None = None,
    status_has_next_page: bool = False,
    status_end_cursor: str | None = None,
) -> dict:
    status_ids = [] if status_ids is None else status_ids
    status_total_count = len(status_ids) if status_total_count is None else status_total_count
    return {
        "data": {
            "repository": {
                "pullRequest": {
                    "number": PR_NUMBER,
                    "baseRefOid": base,
                    "headRefOid": head,
                    "reviews": {
                        "totalCount": total_count,
                        "pageInfo": {
                            "hasNextPage": has_next_page,
                            "endCursor": end_cursor,
                        },
                        "nodes": [{"id": review_id} for review_id in review_ids],
                    },
                    "commits": {
                        "nodes": [
                            {
                                "commit": {
                                    "oid": head,
                                    "statusCheckRollup": {
                                        "contexts": {
                                            "totalCount": status_total_count,
                                            "pageInfo": {
                                                "hasNextPage": status_has_next_page,
                                                "endCursor": status_end_cursor,
                                            },
                                            "nodes": [
                                                {"id": status_id, "__typename": "CheckRun"}
                                                for status_id in status_ids
                                            ],
                                        }
                                    },
                                }
                            }
                        ]
                    },
                }
            }
        }
    }


def make_status_page(
    status_ids: list[str],
    *,
    total_count: int,
    has_next_page: bool,
    end_cursor: str | None,
    base: str = BASE,
    head: str = HEAD,
) -> dict:
    return make_review_page(
        [],
        total_count=0,
        has_next_page=False,
        end_cursor=None,
        base=base,
        head=head,
        status_ids=status_ids,
        status_total_count=total_count,
        status_has_next_page=has_next_page,
        status_end_cursor=end_cursor,
    )


class ReviewPaginationTests(unittest.TestCase):
    def test_fetch_pr_collects_more_than_one_hundred_reviews(self) -> None:
        first_ids = [f"PRR_{index:03d}" for index in range(100)]
        second_ids = ["PRR_100"]
        with patch.object(
            blip,
            "graphql",
            side_effect=[
                make_review_page(
                    first_ids,
                    total_count=101,
                    has_next_page=True,
                    end_cursor="cursor-100",
                ),
                make_review_page(
                    second_ids,
                    total_count=101,
                    has_next_page=False,
                    end_cursor="cursor-101",
                ),
            ],
        ) as graphql_mock:
            pr = blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)

        self.assertEqual(len(blip.review_nodes(pr)), 101)
        self.assertEqual(pr["reviews"]["totalCount"], 101)
        self.assertEqual(
            graphql_mock.call_args_list[1].args[2]["reviewsCursor"],
            "cursor-100",
        )

    def test_fetch_pr_rejects_review_count_drift_between_pages(self) -> None:
        with patch.object(
            blip,
            "graphql",
            side_effect=[
                make_review_page(
                    [f"PRR_{index:03d}" for index in range(100)],
                    total_count=101,
                    has_next_page=True,
                    end_cursor="cursor-100",
                ),
                make_review_page(
                    ["PRR_100", "PRR_101"],
                    total_count=102,
                    has_next_page=False,
                    end_cursor="cursor-102",
                ),
            ],
        ):
            with self.assertRaisesRegex(SystemExit, "totalCount changed"):
                blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)

    def test_fetch_pr_rejects_missing_cursor_for_another_page(self) -> None:
        with patch.object(
            blip,
            "graphql",
            return_value=make_review_page(
                [f"PRR_{index:03d}" for index in range(100)],
                total_count=101,
                has_next_page=True,
                end_cursor=None,
            ),
        ):
            with self.assertRaisesRegex(SystemExit, "valid endCursor"):
                blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)

    def test_fetch_pr_rejects_page_without_progress(self) -> None:
        with patch.object(
            blip,
            "graphql",
            side_effect=[
                make_review_page(
                    ["PRR_000"], total_count=2, has_next_page=True, end_cursor="cursor-1"
                ),
                make_review_page([], total_count=2, has_next_page=True, end_cursor="cursor-2"),
            ],
        ):
            with self.assertRaisesRegex(SystemExit, "made no progress"):
                blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)

    def test_fetch_pr_rejects_repeated_cursor(self) -> None:
        with patch.object(
            blip,
            "graphql",
            side_effect=[
                make_review_page(
                    ["PRR_000"], total_count=3, has_next_page=True, end_cursor="cursor-loop"
                ),
                make_review_page(
                    ["PRR_001"], total_count=3, has_next_page=True, end_cursor="cursor-loop"
                ),
                make_review_page(
                    ["PRR_002"], total_count=3, has_next_page=False, end_cursor="cursor-end"
                ),
            ],
        ):
            with self.assertRaisesRegex(SystemExit, "repeated a cursor"):
                blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)

    def test_fetch_pr_rejects_duplicate_review_ids(self) -> None:
        with patch.object(
            blip,
            "graphql",
            side_effect=[
                make_review_page(
                    ["PRR_000"], total_count=2, has_next_page=True, end_cursor="cursor-1"
                ),
                make_review_page(
                    ["PRR_000"], total_count=2, has_next_page=False, end_cursor="cursor-2"
                ),
            ],
        ):
            with self.assertRaisesRegex(SystemExit, "duplicate review ids"):
                blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)

    def test_review_snapshot_detects_same_count_state_replacement(self) -> None:
        original = make_approval_pr(reviews=[make_review("reviewer", "COMMENTED", "ok", review_id=1)])
        replaced = make_approval_pr(
            reviews=[make_review("reviewer", "CHANGES_REQUESTED", "block", review_id=1)]
        )

        self.assertNotEqual(blip.review_snapshot(original), blip.review_snapshot(replaced))

    def test_fetch_pr_collects_more_than_one_hundred_status_contexts(self) -> None:
        first_ids = [f"CR_{index:03d}" for index in range(100)]
        with patch.object(
            blip,
            "graphql",
            side_effect=[
                make_review_page(
                    [],
                    total_count=0,
                    has_next_page=False,
                    end_cursor=None,
                    status_ids=first_ids,
                    status_total_count=101,
                    status_has_next_page=True,
                    status_end_cursor="status-cursor-100",
                ),
                make_status_page(
                    ["CR_100"],
                    total_count=101,
                    has_next_page=False,
                    end_cursor="status-cursor-101",
                ),
            ],
        ) as graphql_mock:
            pr = blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)

        self.assertEqual(len(blip.status_context_nodes(pr)), 101)
        self.assertEqual(
            graphql_mock.call_args_list[1].args[2]["statusCursor"],
            "status-cursor-100",
        )

    def test_fetch_pr_rejects_status_context_count_drift(self) -> None:
        with patch.object(
            blip,
            "graphql",
            side_effect=[
                make_review_page(
                    [],
                    total_count=0,
                    has_next_page=False,
                    end_cursor=None,
                    status_ids=["CR_000"],
                    status_total_count=2,
                    status_has_next_page=True,
                    status_end_cursor="status-cursor-1",
                ),
                make_status_page(
                    ["CR_001"],
                    total_count=3,
                    has_next_page=False,
                    end_cursor="status-cursor-2",
                ),
            ],
        ):
            with self.assertRaisesRegex(SystemExit, "totalCount changed"):
                blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)

    def test_fetch_pr_rejects_duplicate_status_context_ids(self) -> None:
        with patch.object(
            blip,
            "graphql",
            side_effect=[
                make_review_page(
                    [],
                    total_count=0,
                    has_next_page=False,
                    end_cursor=None,
                    status_ids=["CR_000"],
                    status_total_count=2,
                    status_has_next_page=True,
                    status_end_cursor="status-cursor-1",
                ),
                make_status_page(
                    ["CR_000"],
                    total_count=2,
                    has_next_page=False,
                    end_cursor="status-cursor-2",
                ),
            ],
        ):
            with self.assertRaisesRegex(SystemExit, "duplicate node ids"):
                blip.fetch_pr("test-token", "monkey1sai", "AI-BIM-governance", PR_NUMBER)


class CodexThreadFixTests(unittest.TestCase):
    def test_body_is_bounded_and_does_not_copy_thread_text(self) -> None:
        body = blip.codex_fix_body(511, BASE, HEAD, THREAD_ID)
        self.assertIn("@codex", body)
        self.assertIn(BASE, body)
        self.assertIn(HEAD, body)
        self.assertIn("codex-thread-fix:v2", body)
        self.assertNotIn("IGNORE_ALL_RULES_UNTRUSTED_THREAD_TEXT", body)
        self.assertIn("Do not resolve", body)

    def test_incomplete_thread_survey_fails_closed(self) -> None:
        with self.assertRaisesRegex(SystemExit, "pagination is incomplete"):
            blip.select_codex_fix_target(make_pr(more_threads=True), THREAD_ID, 511, BASE, HEAD)
        comments_incomplete = make_thread()
        comments_incomplete["comments"]["pageInfo"]["hasNextPage"] = True
        with self.assertRaisesRegex(SystemExit, "pagination is incomplete"):
            blip.select_codex_fix_target(make_pr(thread=comments_incomplete), THREAD_ID, 511, BASE, HEAD)
        reviews_incomplete = make_pr()
        reviews_incomplete["reviews"]["pageInfo"]["hasNextPage"] = True
        with self.assertRaisesRegex(SystemExit, "pagination is incomplete"):
            blip.review_nodes(reviews_incomplete)
        missing_page_info = make_pr()
        missing_page_info["reviewThreads"].pop("pageInfo")
        with self.assertRaisesRegex(SystemExit, "pagination is incomplete"):
            blip.review_threads(missing_page_info)

    def test_resolved_outdated_and_duplicate_targets_fail(self) -> None:
        with self.assertRaisesRegex(SystemExit, "already resolved"):
            blip.select_codex_fix_target(make_pr(thread=make_thread(resolved=True)), THREAD_ID, 511, BASE, HEAD)
        with self.assertRaisesRegex(SystemExit, "outdated"):
            blip.select_codex_fix_target(make_pr(thread=make_thread(outdated=True)), THREAD_ID, 511, BASE, HEAD)
        marker = blip.codex_fix_marker(511, BASE, HEAD, THREAD_ID)
        duplicate = make_thread(
            comments=[
                make_comment("claude-tri-adversarial-bot", "finding"),
                {"author": {"login": "monkey1sai-blip"}, "body": marker},
            ]
        )
        with self.assertRaisesRegex(SystemExit, "already has an @codex"):
            blip.select_codex_fix_target(make_pr(thread=duplicate), THREAD_ID, 511, BASE, HEAD)
        spoof = make_thread(
            comments=[
                make_comment("claude-tri-adversarial-bot", "finding"),
                {"author": {"login": "attacker"}, "body": marker},
            ]
        )
        with self.assertRaisesRegex(SystemExit, "accepts only the authenticated root finding"):
            blip.select_codex_fix_target(make_pr(thread=spoof), THREAD_ID, 511, BASE, HEAD)

    def test_target_requires_current_review_provenance_and_explicit_states(self) -> None:
        stale = make_thread(comments=[make_comment("claude-tri-adversarial-bot", "finding", review_head=OTHER_HEAD)])
        with self.assertRaisesRegex(SystemExit, "finding review is bound"):
            blip.select_codex_fix_target(make_pr(thread=stale), THREAD_ID, 511, BASE, HEAD)
        missing_state = make_thread()
        missing_state.pop("isOutdated")
        with self.assertRaisesRegex(SystemExit, "missing outdated state"):
            blip.select_codex_fix_target(make_pr(thread=missing_state), THREAD_ID, 511, BASE, HEAD)

    def test_expected_head_must_be_full_and_match(self) -> None:
        for value, message in (("abc123", "full 40-character"), (OTHER_HEAD, "PR is now")):
            with self.subTest(value=value), self.assertRaisesRegex(SystemExit, message):
                blip.validate_expected_head(value, HEAD)
        blip.validate_expected_head(HEAD.upper(), HEAD)

    def test_dry_run_never_mutates(self) -> None:
        with patch.object(blip, "graphql") as graphql_mock, patch.object(blip, "fetch_pr") as fetch_mock:
            blip.request_codex_fixes(
                token="not-a-real-token",
                owner="owner",
                name="repo",
                pr_number=511,
                initial_pr=make_pr(),
                base=BASE,
                head=HEAD,
                thread_ids=[THREAD_ID],
                live=False,
                confirm_fix_now=False,
                acknowledge_unverified=False,
            )
        graphql_mock.assert_not_called()
        fetch_mock.assert_not_called()

    def test_live_requires_both_explicit_acknowledgements(self) -> None:
        for confirm, acknowledge, message in (
            (False, True, "confirm-fix-now"),
            (True, False, "ack-unverified-codex-fix"),
        ):
            with self.subTest(confirm=confirm, acknowledge=acknowledge):
                with self.assertRaisesRegex(SystemExit, message), patch.object(blip, "graphql") as graphql_mock:
                    blip.request_codex_fixes(
                        token="not-a-real-token",
                        owner="owner",
                        name="repo",
                        pr_number=511,
                        initial_pr=make_pr(),
                        base=BASE,
                        head=HEAD,
                        thread_ids=[THREAD_ID],
                        live=True,
                        confirm_fix_now=confirm,
                        acknowledge_unverified=acknowledge,
                    )
                graphql_mock.assert_not_called()

    def test_live_posts_reply_only_and_rechecks_head(self) -> None:
        body = blip.codex_fix_body(511, BASE, HEAD, THREAD_ID)
        response = {
            "data": {
                "addPullRequestReviewThreadReply": {
                    "comment": {"id": "PRRC_comment", "body": body}
                }
            }
        }
        with patch.object(blip, "fetch_pr", side_effect=[make_pr(), make_pr()]) as fetch_mock, patch.object(
            blip, "graphql", return_value=response
        ) as graphql_mock:
            blip.request_codex_fixes(
                token="not-a-real-token",
                owner="owner",
                name="repo",
                pr_number=511,
                initial_pr=make_pr(),
                base=BASE,
                head=HEAD,
                thread_ids=[THREAD_ID],
                live=True,
                confirm_fix_now=True,
                acknowledge_unverified=True,
            )
        self.assertEqual(fetch_mock.call_count, 2)
        query = graphql_mock.call_args.args[1]
        self.assertIn("addPullRequestReviewThreadReply", query)
        self.assertNotIn("resolveReviewThread", query)

    def test_head_drift_before_mutation_fails(self) -> None:
        with patch.object(blip, "fetch_pr", return_value=make_pr(head=OTHER_HEAD)), patch.object(
            blip, "graphql"
        ) as graphql_mock:
            with self.assertRaisesRegex(SystemExit, "Expected head"):
                blip.request_codex_fixes(
                    token="not-a-real-token",
                    owner="owner",
                    name="repo",
                    pr_number=511,
                    initial_pr=make_pr(),
                    base=BASE,
                    head=HEAD,
                    thread_ids=[THREAD_ID],
                    live=True,
                    confirm_fix_now=True,
                    acknowledge_unverified=True,
                )
        graphql_mock.assert_not_called()

    def test_base_drift_before_mutation_fails(self) -> None:
        with patch.object(blip, "fetch_pr", return_value=make_pr(base=OTHER_BASE)), patch.object(
            blip, "graphql"
        ) as graphql_mock:
            with self.assertRaisesRegex(SystemExit, "Expected base"):
                blip.request_codex_fixes(
                    token="not-a-real-token",
                    owner="owner",
                    name="repo",
                    pr_number=511,
                    initial_pr=make_pr(),
                    base=BASE,
                    head=HEAD,
                    thread_ids=[THREAD_ID],
                    live=True,
                    confirm_fix_now=True,
                    acknowledge_unverified=True,
                )
        graphql_mock.assert_not_called()

    def test_cli_forbids_combining_fix_request_with_approval(self) -> None:
        cli = argparse.Namespace(
            request_codex_fix=[THREAD_ID],
            resolve=[],
            resolve_all=False,
            reply="",
            approve=True,
            body="",
            body_file=None,
            allow_unresolved=False,
            allow_duplicate=False,
            review_mode="focused_semantic",
            expected_head=HEAD,
            expected_base=BASE,
            confirm_fix_now=True,
            ack_unverified_codex_fix=True,
            live=False,
        )
        with self.assertRaisesRegex(SystemExit, "reply-only"):
            blip.validate_cli(cli)

    def test_generic_reply_cannot_smuggle_codex_or_combine_mutations(self) -> None:
        base = dict(
            request_codex_fix=[],
            expected_base="",
            expected_head="",
            confirm_fix_now=False,
            ack_unverified_codex_fix=False,
            resolve=[],
            resolve_all=False,
            reply="",
            approve=False,
            body="",
            body_file=None,
            allow_unresolved=False,
            allow_duplicate=False,
            review_mode="",
            live=False,
        )
        with self.assertRaisesRegex(SystemExit, "cannot mention @codex"):
            blip.validate_cli(argparse.Namespace(**(base | {"reply": "@codex fix", "resolve": [THREAD_ID]})))
        with self.assertRaisesRegex(SystemExit, "separate mutations"):
            blip.validate_cli(argparse.Namespace(**(base | {"resolve": [THREAD_ID], "approve": True})))
        with self.assertRaisesRegex(SystemExit, "Caller-supplied approval bodies"):
            blip.validate_cli(
                argparse.Namespace(
                    **(
                        base
                        | {
                            "body_file": Path("secret.txt"),
                            "approve": True,
                            "expected_base": BASE,
                            "expected_head": HEAD,
                            "review_mode": "focused_semantic",
                        }
                    )
                )
            )
        with self.assertRaisesRegex(SystemExit, "owner-broker capability"):
            with patch.dict(blip.os.environ, {blip.APPROVAL_CAPABILITY_ENV: ""}, clear=False):
                blip.validate_cli(
                    argparse.Namespace(
                        **(
                            base
                            | {
                                "approve": True,
                                "live": True,
                                "expected_base": BASE,
                                "expected_head": HEAD,
                                "review_mode": "focused_semantic",
                            }
                        )
                    )
                )
        with self.assertRaisesRegex(SystemExit, "Live thread resolution"):
            blip.validate_cli(argparse.Namespace(**(base | {"resolve": [THREAD_ID], "live": True})))

    def test_cli_binds_human_critical_override_to_live_human_mode(self) -> None:
        base = dict(
            request_codex_fix=[],
            expected_base=BASE,
            expected_head=HEAD,
            confirm_fix_now=False,
            ack_unverified_codex_fix=False,
            resolve=[],
            resolve_all=False,
            reply="",
            approve=True,
            body="",
            body_file=None,
            allow_unresolved=False,
            allow_duplicate=False,
            review_mode="human_critical",
            human_critical_override=False,
            live=True,
        )
        with self.assertRaisesRegex(SystemExit, "requires --human-critical-override"):
            blip.validate_cli(argparse.Namespace(**base))
        with self.assertRaisesRegex(SystemExit, "forbidden for machine"):
            blip.validate_cli(
                argparse.Namespace(
                    **(base | {"review_mode": "focused_semantic", "human_critical_override": True})
                )
            )
        with self.assertRaisesRegex(SystemExit, "live owner-broker"):
            blip.validate_cli(
                argparse.Namespace(**(base | {"human_critical_override": True, "live": False}))
            )
        with patch.dict(blip.os.environ, {blip.APPROVAL_CAPABILITY_ENV: "capability"}, clear=False):
            blip.validate_cli(argparse.Namespace(**(base | {"human_critical_override": True})))
        with self.assertRaisesRegex(SystemExit, "reply-only"):
            blip.validate_cli(
                argparse.Namespace(
                    **(
                        base
                        | {
                            "request_codex_fix": [THREAD_ID],
                            "approve": False,
                            "review_mode": "",
                            "human_critical_override": True,
                            "confirm_fix_now": True,
                            "ack_unverified_codex_fix": True,
                            "live": False,
                        }
                    )
                )
            )

    def test_live_codex_fix_rejects_codex_thread_author(self) -> None:
        codex_thread = make_thread(
            comments=[
                make_comment("claude-tri-adversarial-bot", "finding"),
                {"author": {"login": "chatgpt-codex-connector"}, "body": "follow-up"},
            ]
        )
        with self.assertRaisesRegex(SystemExit, "reviewer and @codex fixer"), patch.object(
            blip, "graphql"
        ) as graphql_mock:
            blip.request_codex_fixes(
                token="not-a-real-token",
                owner="owner",
                name="repo",
                pr_number=511,
                initial_pr=make_pr(thread=codex_thread),
                base=BASE,
                head=HEAD,
                thread_ids=[THREAD_ID],
                live=True,
                confirm_fix_now=True,
                acknowledge_unverified=True,
            )
        graphql_mock.assert_not_called()

    def test_thread_display_escapes_control_characters(self) -> None:
        thread = make_thread()
        thread["path"] = "src/evil\x1b[31m.py\nforged"
        output = io.StringIO()
        with redirect_stdout(output):
            blip.show_threads([thread])
        rendered = output.getvalue()
        self.assertNotIn("\x1b", rendered)
        self.assertIn("\\u001b", rendered)
        self.assertIn("\\nforged", rendered)

    def test_post_mutation_head_drift_is_detected(self) -> None:
        body = blip.codex_fix_body(511, BASE, HEAD, THREAD_ID)
        response = {"data": {"addPullRequestReviewThreadReply": {"comment": {"id": "c", "body": body}}}}
        with patch.object(blip, "fetch_pr", side_effect=[make_pr(), make_pr(head=OTHER_HEAD)]), patch.object(
            blip, "graphql", return_value=response
        ):
            with self.assertRaisesRegex(SystemExit, "Expected head"):
                blip.request_codex_fixes(
                    token="not-a-real-token",
                    owner="owner",
                    name="repo",
                    pr_number=511,
                    initial_pr=make_pr(),
                    base=BASE,
                    head=HEAD,
                    thread_ids=[THREAD_ID],
                    live=True,
                    confirm_fix_now=True,
                    acknowledge_unverified=True,
                )

    def test_malformed_mutation_response_fails(self) -> None:
        with patch.object(blip, "fetch_pr", return_value=make_pr()), patch.object(
            blip, "graphql", return_value={"data": {}}
        ):
            with self.assertRaisesRegex(SystemExit, "did not confirm"):
                blip.request_codex_fixes(
                    token="not-a-real-token",
                    owner="owner",
                    name="repo",
                    pr_number=511,
                    initial_pr=make_pr(),
                    base=BASE,
                    head=HEAD,
                    thread_ids=[THREAD_ID],
                    live=True,
                    confirm_fix_now=True,
                    acknowledge_unverified=True,
                )

    def test_local_lock_rejects_parallel_same_thread(self) -> None:
        with blip.exclusive_codex_fix_lock(511, BASE, HEAD, THREAD_ID):
            with self.assertRaisesRegex(SystemExit, "Another local @codex request"):
                with blip.exclusive_codex_fix_lock(511, BASE, HEAD, THREAD_ID):
                    self.fail("nested identical lock unexpectedly acquired")

    def test_identity_requires_pinned_login_id_and_user_type(self) -> None:
        permission = {"permission": "write"}
        for identity in (
            {"login": blip.DEFAULT_REVIEWER, "id": 999, "type": "User"},
            {"login": blip.DEFAULT_REVIEWER, "id": blip.DEFAULT_REVIEWER_ID, "type": "Bot"},
        ):
            with self.subTest(identity=identity), patch.object(
                blip, "http_json", side_effect=[identity, permission]
            ), self.assertRaisesRegex(SystemExit, "fixed reviewer"):
                blip.verify_identity("token", blip.DEFAULT_REPO)

        valid_identity = {"login": blip.DEFAULT_REVIEWER, "id": blip.DEFAULT_REVIEWER_ID, "type": "User"}
        with patch.object(
            blip, "http_json", side_effect=[valid_identity, {"permission": "admin"}]
        ), self.assertRaisesRegex(SystemExit, "least-privilege write"):
            blip.verify_identity("token", blip.DEFAULT_REPO)

    def test_token_requires_broker_injected_environment(self) -> None:
        with patch.dict(blip.os.environ, {blip.DEFAULT_TOKEN_ENV: ""}, clear=False), self.assertRaisesRegex(
            SystemExit, "broker-injected"
        ):
            blip.read_token(blip.DEFAULT_TOKEN_ENV)
        with patch.dict(blip.os.environ, {blip.DEFAULT_TOKEN_ENV: "opaque-test-value"}, clear=False):
            self.assertEqual(blip.read_token(blip.DEFAULT_TOKEN_ENV), "opaque-test-value")


class AutomatedApprovalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.immutable_snapshot_patcher = patch.object(
            blip,
            "fetch_immutable_pr_snapshot",
            side_effect=lambda _token, _pr: make_immutable_snapshot(make_approval_pr()),
        )
        self.immutable_snapshot_patcher.start()

    def tearDown(self) -> None:
        self.immutable_snapshot_patcher.stop()

    def test_cli_approve_entrypoint_builds_bound_audit_body(self) -> None:
        argv = [
            "blip_review.py",
            "--pr",
            str(PR_NUMBER),
            "--expected-base",
            BASE,
            "--expected-head",
            HEAD,
            "--review-mode",
            "focused_semantic",
            "--approve",
        ]
        ready = {
            "attestation": {"review_id": ATTESTATION_ID},
            "changed_files": {"sha256": "9" * 64},
        }
        with patch.object(sys, "argv", argv), patch.object(blip, "read_token", return_value="token"), patch.object(
            blip, "verify_identity", return_value={"login": blip.DEFAULT_REVIEWER}
        ), patch.object(blip, "fetch_pr", return_value=make_approval_pr()), patch.object(
            blip, "approval_preflight", return_value=ready
        ), patch.object(blip, "submit_automated_approval") as submit_mock, redirect_stdout(io.StringIO()) as output:
            self.assertEqual(blip.main(), 0)
        submit_mock.assert_not_called()
        self.assertIn("would submit APPROVE", output.getvalue())

    def test_live_cli_verifies_capability_early_and_skips_duplicate_main_preflight(self) -> None:
        argv = [
            "blip_review.py",
            "--pr",
            str(PR_NUMBER),
            "--expected-base",
            BASE,
            "--expected-head",
            HEAD,
            "--review-mode",
            "focused_semantic",
            "--approve",
            "--live",
        ]
        with patch.object(sys, "argv", argv), patch.dict(
            blip.os.environ, {blip.APPROVAL_CAPABILITY_ENV: "capability"}, clear=False
        ), patch.object(blip, "read_token", return_value="token"), patch.object(
            blip, "verify_approval_capability", return_value={"nonce": "1" * 32}
        ) as verify_capability, patch.object(
            blip, "verify_identity", return_value={"login": blip.DEFAULT_REVIEWER}
        ), patch.object(
            blip, "fetch_pr", return_value=make_approval_pr()
        ), patch.object(
            blip, "approval_preflight"
        ) as main_preflight, patch.object(
            blip, "submit_automated_approval", return_value={"review_id": 4242}
        ) as submit_mock, redirect_stdout(io.StringIO()):
            self.assertEqual(blip.main(), 0)
        verify_capability.assert_called_once()
        main_preflight.assert_not_called()
        self.assertEqual(submit_mock.call_args.kwargs["capability_raw"], "capability")

    def test_branch_protection_policy_is_strict_and_complete(self) -> None:
        protection = make_protection_payload()
        with patch.dict(blip.os.environ, protection_policy_env(protection)), patch.object(
            blip, "http_json", return_value=make_ref_update_rule_response()
        ):
            policy = blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")
        self.assertEqual([entry["context"] for entry in policy["required"]], ["agent-governance", "service-tests"])
        self.assertRegex(policy["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(policy["live_rule"]["required_approving_review_count"], 1)
        self.assertEqual(policy["verification"], "protected_live_snapshot_plus_write_visible_cross_check")

        for invalid_count in (0, 2, "1", True):
            invalid_protection = make_protection_payload()
            invalid_protection["required_pull_request_reviews"]["required_approving_review_count"] = invalid_count
            with self.subTest(required_approving_review_count=invalid_count), patch.dict(
                blip.os.environ, protection_policy_env(invalid_protection)
            ), patch.object(
                blip, "http_json", return_value=make_ref_update_rule_response()
            ), self.assertRaisesRegex(SystemExit, "exactly one approving review"):
                blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")

        for invalid_last_push_approval in (False, None, 1, "true", "missing"):
            invalid_protection = make_protection_payload()
            reviews = invalid_protection["required_pull_request_reviews"]
            if invalid_last_push_approval == "missing":
                del reviews["require_last_push_approval"]
            else:
                reviews["require_last_push_approval"] = invalid_last_push_approval
            with self.subTest(require_last_push_approval=invalid_last_push_approval), patch.dict(
                blip.os.environ, protection_policy_env(invalid_protection)
            ), patch.object(
                blip, "http_json", return_value=make_ref_update_rule_response()
            ), self.assertRaisesRegex(SystemExit, "most recent reviewable push"):
                blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")

        with patch.dict(
            blip.os.environ,
            protection_policy_env(protection, active_rules=[{"type": "pull_request"}]),
        ), self.assertRaisesRegex(SystemExit, "Active rulesets"):
            blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")

        broken_source = make_protection_payload()
        broken_source["required_status_checks"]["checks"][0]["app_id"] = None
        with patch.dict(blip.os.environ, protection_policy_env(broken_source)), patch.object(
            blip, "http_json", return_value=make_ref_update_rule_response()
        ), self.assertRaisesRegex(SystemExit, "context or source"):
            blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")

    def test_branch_protection_rejects_duplicate_check_force_push_and_bypass(self) -> None:
        def protected_payload() -> dict:
            return make_protection_payload(contexts=["agent-governance"])

        def fetch_with(payload: dict) -> None:
            with patch.dict(blip.os.environ, protection_policy_env(payload)), patch.object(
                blip,
                "http_json",
                return_value=make_ref_update_rule_response(contexts=["agent-governance"]),
            ):
                blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")

        duplicate = protected_payload()
        duplicate["required_status_checks"]["checks"].append(
            {"context": "agent-governance", "app_id": 999}
        )
        with self.assertRaisesRegex(SystemExit, "duplicated or source-ambiguous"):
            fetch_with(duplicate)

        force = protected_payload()
        force["allow_force_pushes"] = {"enabled": True}
        with self.assertRaisesRegex(SystemExit, "disallow force pushes"):
            fetch_with(force)

        bypass = protected_payload()
        bypass["required_pull_request_reviews"]["bypass_pull_request_allowances"] = {
            "users": [{"login": "owner"}], "teams": [], "apps": []
        }
        with self.assertRaisesRegex(SystemExit, "bypass or dismissal"):
            fetch_with(bypass)

    def test_protected_policy_snapshot_is_strict_bounded_and_secret_free(self) -> None:
        protection = make_protection_payload()
        cases = [
            ("", "requires protected"),
            ("garbage", "malformed"),
            ('{"active_rules":[],"protection":{},"extra":true}', "invalid schema"),
            ('{"active_rules":[{}],"protection":{}}', "Active rulesets"),
            ('{"active_rules":[],"protection":null}', "no protection object"),
            ('{"active_rules":[],"active_rules":[],"protection":{}}', "malformed"),
            ('{"active_rules":[],"protection":{"enforce_admins":{},"enforce_admins":{}}}', "malformed"),
        ]
        for raw, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(SystemExit, message):
                blip.parse_protection_policy_snapshot(raw)
        verified = blip.parse_protection_policy_snapshot(
            protection_policy_env(protection)[blip.PROTECTION_POLICY_ENV]
        )
        self.assertEqual(verified["protection"], protection)
        with self.assertRaisesRegex(SystemExit, "size limit"):
            blip.parse_protection_policy_snapshot("x" * (blip.PROTECTION_POLICY_MAX_CHARS + 1))

    def test_live_ref_update_rule_cross_check_fails_closed(self) -> None:
        protection = make_protection_payload()
        env = protection_policy_env(protection)

        with patch.dict(blip.os.environ, env), patch.object(
            blip, "http_json", return_value=make_ref_update_rule_response(rule=None)
        ), self.assertRaisesRegex(SystemExit, "not visible"):
            blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")

        with patch.dict(blip.os.environ, env), patch.object(
            blip, "http_json", return_value=make_ref_update_rule_response(pattern="release")
        ), self.assertRaisesRegex(SystemExit, "pattern is not bound"):
            blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")

        drift_cases = [
            ({"requiredApprovingReviewCount": 2}, "required_approving_review_count"),
            ({"requiresCodeOwnerReviews": False}, "requires_code_owner_reviews"),
            ({"requiresConversationResolution": False}, "requires_conversation_resolution"),
            ({"allowsForcePushes": True}, "allows_force_pushes"),
            ({"allowsDeletions": True}, "allows_deletions"),
            ({"blocksCreations": True}, "blocks_creations"),
            ({"requiresLinearHistory": True}, "requires_linear_history"),
            ({"requiresSignatures": True}, "requires_signatures"),
            ({"requiredStatusCheckContexts": ["agent-governance"]}, "required_status_check_contexts"),
        ]
        for overrides, field in drift_cases:
            with self.subTest(field=field), patch.dict(blip.os.environ, env), patch.object(
                blip, "http_json", return_value=make_ref_update_rule_response(overrides=overrides)
            ), self.assertRaisesRegex(SystemExit, f"{field} differs from the protected live snapshot"):
                blip.fetch_protection_policy("token", "monkey1sai", "AI-BIM-governance", "main")

    def test_required_checks_accept_platform_success_but_governance_must_really_pass(self) -> None:
        policy = make_policy()
        observed = blip.validate_required_checks(
            make_approval_pr(checks=[make_check("agent-governance"), make_check("service-tests", "SKIPPED")]),
            policy,
        )
        self.assertEqual(observed["count"], 2)
        with self.assertRaisesRegex(SystemExit, "agent-governance"):
            blip.validate_required_checks(
                make_approval_pr(checks=[make_check("agent-governance", "SKIPPED"), make_check("service-tests")]),
                policy,
            )
        with self.assertRaisesRegex(SystemExit, "missing"):
            blip.validate_required_checks(make_approval_pr(checks=[make_check("agent-governance")]), policy)
        with self.assertRaisesRegex(SystemExit, "approval is HELD"):
            blip.validate_required_checks(
                make_approval_pr(checks=[make_check("agent-governance"), make_check("service-tests", "FAILURE")]),
                policy,
            )

    def test_required_check_source_is_enforced(self) -> None:
        policy = make_policy()
        policy["required"][1]["app_id"] = 99
        with self.assertRaisesRegex(SystemExit, "missing"):
            blip.validate_required_checks(make_approval_pr(), policy)
        blip.validate_required_checks(
            make_approval_pr(checks=[make_check("agent-governance"), make_check("service-tests", app_id=99)]),
            policy,
        )
        spoofed_governance = {
            "__typename": "StatusContext",
            "context": "agent-governance",
            "state": "SUCCESS",
            "createdAt": "2026-08-12T10:00:00Z",
            "creator": {"login": "untrusted-writer"},
        }
        with self.assertRaisesRegex(SystemExit, "missing"):
            blip.validate_required_checks(
                make_approval_pr(checks=[spoofed_governance, make_check("service-tests")]), policy
            )

    def test_required_checks_use_latest_exact_head_attempt(self) -> None:
        policy = make_policy()
        checks = [
            make_check("agent-governance", "FAILURE", completed_at="2026-08-12T09:00:00Z"),
            make_check("agent-governance", "SUCCESS", completed_at="2026-08-12T10:00:00Z"),
            make_check("service-tests", "FAILURE", completed_at="2026-08-12T09:00:00Z"),
            make_check("service-tests", "SUCCESS", completed_at="2026-08-12T10:00:00Z"),
        ]
        observed = blip.validate_required_checks(make_approval_pr(checks=checks), policy)
        self.assertEqual(observed["count"], 2)

    def test_repository_safety_requires_repo_level_auto_merge_disabled(self) -> None:
        safe = {
            "full_name": blip.DEFAULT_REPO,
            "default_branch": blip.DEFAULT_BASE_BRANCH,
            "archived": False,
            "disabled": False,
            "allow_auto_merge": False,
        }
        with patch.object(blip, "http_json", return_value=safe):
            self.assertFalse(blip.fetch_repository_safety("token", "monkey1sai", "AI-BIM-governance")["allow_auto_merge"])
        with patch.object(blip, "http_json", return_value=safe | {"allow_auto_merge": True}), self.assertRaisesRegex(
            SystemExit, "approve-only cannot be guaranteed"
        ):
            blip.fetch_repository_safety("token", "monkey1sai", "AI-BIM-governance")

    def test_self_referential_and_renamed_paths_are_human_only(self) -> None:
        placeholder = make_review("codex-tri-adversarial-bot", "COMMENTED", "VERDICT: SHIP\n", review_id=9002)
        for changed, message in (
            ([make_changed_file(".github/workflows/agent-governance.yml")], "self-referential"),
            ([make_changed_file("agent-skills-manifest.json")], "self-referential"),
            ([make_changed_file("services/governance/policy.json")], "self-referential"),
            ([make_changed_file("src/new.py", change_type="RENAMED")], "previous-path authority"),
        ):
            with self.subTest(changed=changed), self.assertRaisesRegex(SystemExit, message):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=make_approval_pr(files=changed, reviews=[placeholder]),
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                )

    def test_preflight_rejects_gitmodules_before_identity_or_policy(self) -> None:
        raw_pr = {
            "number": PR_NUMBER,
            "title": "test",
            "state": "open",
            "draft": False,
            "changed_files": 1,
            "html_url": f"https://github.com/{blip.DEFAULT_REPO}/pull/{PR_NUMBER}",
            "user": {"login": "monkey1sai"},
            "base": {"ref": "main", "sha": BASE},
            "head": {"ref": "feature", "sha": HEAD},
        }
        def real_fetch(token: str, pr_number: int) -> dict:
            try:
                return blip.collect_pr_snapshot(
                    blip.http_json,
                    blip.API,
                    token,
                    blip.DEFAULT_REPO,
                    pr_number,
                    require_patch=True,
                )
            except RuntimeError as exc:
                raise SystemExit(f"Immutable PR comparison failed: {exc}") from exc

        for label, changed_file, compared_file in (
            (
                "current",
                make_changed_file(".gitmodules", additions=1, deletions=1),
                {"filename": ".gitmodules", "status": "modified"},
            ),
            (
                "previous",
                make_changed_file(
                    "docs/not-a-submodule.txt",
                    additions=1,
                    deletions=1,
                ),
                {
                    "filename": "docs/not-a-submodule.txt",
                    "status": "renamed",
                    "previous_filename": ".gitmodules",
                },
            ),
        ):
            pr = make_approval_pr(files=[changed_file])
            compare = {
                "base_commit": {"sha": BASE, "commit": {"tree": {"sha": "1" * 40}}},
                "head_commit": {"sha": HEAD, "commit": {"tree": {"sha": "2" * 40}}},
                "merge_base_commit": {"sha": BASE, "commit": {"tree": {"sha": "1" * 40}}},
                "files": [{
                    **compared_file,
                    "additions": 1,
                    "deletions": 1,
                    "changes": 2,
                    "sha": "e" * 40,
                }],
            }
            with self.subTest(label=label), patch.object(
                blip, "fetch_immutable_pr_snapshot", side_effect=real_fetch
            ), patch.object(
                blip, "http_json", side_effect=[raw_pr, compare]
            ) as http_mock, patch.object(
                blip, "verify_identity"
            ) as identity_mock, patch.object(
                blip, "fetch_repository_safety"
            ) as repository_mock, patch.object(
                blip, "fetch_protection_policy"
            ) as policy_mock, self.assertRaisesRegex(
                SystemExit, r"Immutable PR comparison failed: submodule or \.gitmodules"
            ):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=pr,
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                )
            self.assertEqual(http_mock.call_count, 2)
            identity_mock.assert_not_called()
            repository_mock.assert_not_called()
            policy_mock.assert_not_called()

    def test_real_elevated_paths_never_consume_capability_or_post(self) -> None:
        token = "test-token-not-secret"
        elevated_paths = (
            ".claude/launch.json",
            "governance-service/app.py",
            "bim-review-coordinator/src/services/authProvider.ts",
            "bim-review-coordinator/src/services/internalAuth.test.ts",
            "bim-review-coordinator/src/services/governanceProxy.ts",
            "bim-review-coordinator/src/services/runtimeMutationAuthority/runtimeMutationAuthority.ts",
            "bim-review-coordinator/src/services/runtimeMutationAuthority/stageBindingState.ts",
            "bim-streaming-server/source/extensions/example/conversion_authority.py",
            "bim-streaming-server/AGENTS.md",
            "bim-streaming-server/CLAUDE.md",
            "governance-service/AGENTS.md",
        )
        for path in elevated_paths:
            pr = make_approval_pr()
            pr["files"]["nodes"] = [make_changed_file(path)]
            with self.subTest(path=path), patch.object(blip, "fetch_pr", return_value=pr), patch.object(
                blip, "consume_capability_nonce"
            ) as consume_mock, patch.object(blip, "http_json") as http_mock, self.assertRaisesRegex(
                SystemExit, "human_critical"
            ):
                blip.submit_automated_approval(
                    token=token,
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    repo=blip.DEFAULT_REPO,
                    pr_number=PR_NUMBER,
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                    capability_raw=make_capability(token),
                )
            consume_mock.assert_not_called()
            http_mock.assert_not_called()

    def test_ship_attestation_is_exact_head_and_fail_closed(self) -> None:
        pr = make_approval_pr()
        digest = blip.changed_files_evidence(pr)["sha256"]
        files = [make_changed_file()]
        diff_digest = immutable_diff_sha(BASE, HEAD, files)
        attestation = blip.find_ship_attestation(
            pr, BASE, HEAD, "focused_semantic", digest, diff_digest
        )
        self.assertEqual(attestation["review_id"], ATTESTATION_ID)

        with self.assertRaisesRegex(SystemExit, "diff-bound"):
            blip.find_ship_attestation(
                pr, BASE, HEAD, "focused_semantic", digest, "0" * 64
            )

        stale = make_review(
            "codex-tri-adversarial-bot",
            "COMMENTED",
            make_attestation_body(BASE, OTHER_HEAD, "focused_semantic", files),
            review_id=ATTESTATION_ID,
            head=OTHER_HEAD,
        )
        with self.assertRaisesRegex(SystemExit, "No authenticated"):
            blip.find_ship_attestation(
                make_approval_pr(reviews=[stale]), BASE, HEAD, "focused_semantic", digest, diff_digest
            )

        app_approval = make_review(
            "codex-tri-adversarial-bot",
            "APPROVED",
            make_attestation_body(BASE, HEAD, "focused_semantic", files),
            review_id=ATTESTATION_ID,
        )
        with self.assertRaisesRegex(SystemExit, "must never submit APPROVED"):
            blip.find_ship_attestation(
                make_approval_pr(reviews=[app_approval]), BASE, HEAD, "focused_semantic", digest, diff_digest
            )

        duplicate_attestation = make_review(
            "codex-tri-adversarial-bot",
            "COMMENTED",
            make_attestation_body(BASE, HEAD, "focused_semantic", files),
            review_id=ATTESTATION_ID + 1,
        )
        with self.assertRaisesRegex(SystemExit, "must be unique"):
            blip.find_ship_attestation(
                make_approval_pr(reviews=[pr["reviews"]["nodes"][0], duplicate_attestation]),
                BASE,
                HEAD,
                "focused_semantic",
                digest,
                diff_digest,
            )

        wrong_base = make_review(
            "codex-tri-adversarial-bot",
            "COMMENTED",
            make_attestation_body(OTHER_BASE, HEAD, "focused_semantic", files),
            review_id=ATTESTATION_ID,
        )
        with self.assertRaisesRegex(SystemExit, "base/head/mode/changed-files/diff-bound"):
            blip.find_ship_attestation(
                make_approval_pr(reviews=[wrong_base]), BASE, HEAD, "focused_semantic", digest, diff_digest
            )

        smuggled = make_review(
            "codex-tri-adversarial-bot",
            "COMMENTED",
            f"quoted untrusted text {blip.SHIP_ATTESTATION_PREFIX}\n" + make_attestation_body(
                BASE, HEAD, "focused_semantic", files
            ),
            review_id=ATTESTATION_ID,
        )
        with self.assertRaisesRegex(SystemExit, "canonical"):
            blip.find_ship_attestation(
                make_approval_pr(reviews=[smuggled]), BASE, HEAD, "focused_semantic", digest, diff_digest
            )

        blocked = make_review(
            "codex-tri-adversarial-bot",
            "COMMENTED",
            "VERDICT: NO-SHIP\n",
            review_id=ATTESTATION_ID,
        )
        with self.assertRaisesRegex(SystemExit, "NO-SHIP/HELD"):
            blip.find_ship_attestation(
                make_approval_pr(reviews=[blocked]), BASE, HEAD, "focused_semantic", digest, diff_digest
            )

        wrong_actor_id = make_review(
            "codex-tri-adversarial-bot", "COMMENTED",
            make_attestation_body(BASE, HEAD, "focused_semantic", files), review_id=ATTESTATION_ID
        )
        wrong_actor_id["author"]["databaseId"] = 1
        with self.assertRaisesRegex(SystemExit, "No authenticated"):
            blip.find_ship_attestation(
                make_approval_pr(reviews=[wrong_actor_id]), BASE, HEAD, "focused_semantic", digest, diff_digest
            )

    def test_capability_is_signed_exact_tuple_single_mode_and_expiring(self) -> None:
        token = "test-token-not-secret"
        raw = make_capability(token)
        parsed = blip.verify_approval_capability(
            token=token,
            raw=raw,
            repo=blip.DEFAULT_REPO,
            pr_number=PR_NUMBER,
            base=BASE,
            head=HEAD,
            review_mode="focused_semantic",
        )
        self.assertEqual(parsed["nonce"], "1" * 32)
        self.assertIs(parsed["human_critical_override"], False)
        with self.assertRaisesRegex(SystemExit, "signature"):
            blip.verify_approval_capability(
                token="wrong",
                raw=raw,
                repo=blip.DEFAULT_REPO,
                pr_number=PR_NUMBER,
                base=BASE,
                head=HEAD,
                review_mode="focused_semantic",
            )

        human_raw = make_capability(
            token,
            review_mode="human_critical",
            human_critical_override=True,
        )
        human_parsed = blip.verify_approval_capability(
            token=token,
            raw=human_raw,
            repo=blip.DEFAULT_REPO,
            pr_number=PR_NUMBER,
            base=BASE,
            head=HEAD,
            review_mode="human_critical",
            human_critical_override=True,
        )
        self.assertIs(human_parsed["human_critical_override"], True)
        with self.assertRaisesRegex(SystemExit, "exact operation"):
            blip.verify_approval_capability(
                token=token,
                raw=human_raw,
                repo=blip.DEFAULT_REPO,
                pr_number=PR_NUMBER,
                base=BASE,
                head=HEAD,
                review_mode="human_critical",
                human_critical_override=False,
            )
        with self.assertRaisesRegex(SystemExit, "exact operation"):
            blip.verify_approval_capability(
                token=token,
                raw=raw,
                repo=blip.DEFAULT_REPO,
                pr_number=PR_NUMBER,
                base=BASE,
                head=OTHER_HEAD,
                review_mode="focused_semantic",
            )

        issued = 1_900_000_000
        long_running_raw = make_capability(token, issued=issued, expires=issued + 600)
        with patch.object(blip.time, "time", return_value=issued + 599):
            parsed = blip.verify_approval_capability(
                token=token,
                raw=long_running_raw,
                repo=blip.DEFAULT_REPO,
                pr_number=PR_NUMBER,
                base=BASE,
                head=HEAD,
                review_mode="focused_semantic",
            )
        self.assertEqual(parsed["expires_at"], issued + 600)
        with patch.object(blip.time, "time", return_value=issued + 600), self.assertRaisesRegex(
            SystemExit, "expired"
        ):
            blip.verify_approval_capability(
                token=token,
                raw=long_running_raw,
                repo=blip.DEFAULT_REPO,
                pr_number=PR_NUMBER,
                base=BASE,
                head=HEAD,
                review_mode="focused_semantic",
            )

    def test_preflight_rejects_unresolved_duplicate_auto_merge_and_human_critical(self) -> None:
        with patch.object(blip, "fetch_protection_policy", return_value=make_policy()):
            with self.assertRaisesRegex(SystemExit, "unresolved"):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=make_approval_pr(unresolved_thread=True),
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                )
            with self.assertRaisesRegex(SystemExit, "Auto-merge"):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=make_approval_pr(auto_merge={"enabledAt": "now", "mergeMethod": "SQUASH"}),
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                )
            with self.assertRaisesRegex(SystemExit, "human_critical"):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=make_approval_pr(),
                    base=BASE,
                    head=HEAD,
                    review_mode="human_critical",
                )
            duplicate = make_review(blip.DEFAULT_REVIEWER, "APPROVED", "old", review_id=7001)
            with self.assertRaisesRegex(SystemExit, "already approved"):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=make_approval_pr(reviews=[make_approval_pr()["reviews"]["nodes"][0], duplicate]),
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                )

    def test_preflight_rejects_reviewer_candidate_commit_identity(self) -> None:
        cases = (
            ("author", [make_candidate_commit(author=blip.DEFAULT_REVIEWER)]),
            ("committer", [make_candidate_commit(committer=blip.DEFAULT_REVIEWER.upper())]),
            ("coauthor", [make_candidate_commit(coauthors=(blip.DEFAULT_REVIEWER,))]),
            (
                "intermediate author",
                [
                    make_candidate_commit(OTHER_HEAD, author=blip.DEFAULT_REVIEWER),
                    make_candidate_commit(HEAD),
                ],
            ),
        )
        for label, candidate_commits in cases:
            with self.subTest(label=label), self.assertRaisesRegex(
                SystemExit, "independent approval is forbidden"
            ):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=make_approval_pr(candidate_commits=candidate_commits),
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                )

    def test_preflight_rejects_incomplete_or_unbound_candidate_commit_history(self) -> None:
        cases = (
            (
                "pagination",
                make_approval_pr(more_candidate_commits=True),
                "pagination is incomplete",
            ),
            (
                "missing head",
                make_approval_pr(candidate_commits=[make_candidate_commit(OTHER_HEAD)]),
                "not bound exactly once",
            ),
            (
                "author pagination",
                make_approval_pr(candidate_commits=[make_candidate_commit(more_authors=True)]),
                "authors pagination is incomplete",
            ),
            (
                "unmapped primary author",
                make_approval_pr(candidate_commits=[make_candidate_commit(author=None)]),
                "author GitHub user identity is missing",
            ),
            (
                "unmapped committer",
                make_approval_pr(candidate_commits=[make_candidate_commit(committer=None)]),
                "committer GitHub user identity is missing",
            ),
            (
                "unmapped coauthor",
                make_approval_pr(candidate_commits=[make_candidate_commit(coauthors=(None,))]),
                "author GitHub user identity is missing",
            ),
        )
        for label, pr, message in cases:
            with self.subTest(label=label), self.assertRaisesRegex(SystemExit, message):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=pr,
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                )

    def test_human_critical_override_needs_no_app_attestation(self) -> None:
        identity = {
            "login": blip.DEFAULT_REVIEWER,
            "id": blip.DEFAULT_REVIEWER_ID,
            "type": "User",
            "permission": "write",
        }
        human_pr = make_approval_pr(
            reviews=[],
            files=[make_changed_file(".claude/launch.json")],
        )
        with patch.object(
            blip, "fetch_immutable_pr_snapshot", return_value=make_immutable_snapshot(human_pr)
        ), patch.object(blip, "fetch_protection_policy", return_value=make_policy()), patch.object(
            blip, "fetch_repository_safety", return_value=make_repo_safety()
        ), patch.object(blip, "verify_identity", return_value=identity), patch.object(
            blip, "find_ship_attestation"
        ) as attestation_mock:
            result = blip.approval_preflight(
                token="token",
                owner="monkey1sai",
                name="AI-BIM-governance",
                pr_number=PR_NUMBER,
                pr=human_pr,
                base=BASE,
                head=HEAD,
                review_mode="human_critical",
                human_critical_override=True,
            )
        attestation_mock.assert_not_called()
        self.assertEqual(result["attestation"], {"kind": "human_critical_override"})

    def test_human_critical_override_preserves_exact_head_app_blockers(self) -> None:
        elevated_files = [make_changed_file(".claude/launch.json")]
        identity = {
            "login": blip.DEFAULT_REVIEWER,
            "id": blip.DEFAULT_REVIEWER_ID,
            "type": "User",
            "permission": "write",
        }
        cases = (
            ("COMMENTED", "VERDICT: HELD\n", "NO-SHIP/HELD"),
            ("COMMENTED", "VERDICT: NO-SHIP\n", "NO-SHIP/HELD"),
            ("CHANGES_REQUESTED", "schema-drifted blocker", "requested changes"),
            ("APPROVED", "unexpected app approval", "must never submit APPROVED"),
        )
        for state, body, message in cases:
            blocked_pr = make_approval_pr(
                reviews=[
                    make_review(
                        "codex-tri-adversarial-bot",
                        state,
                        body,
                        review_id=ATTESTATION_ID,
                    )
                ],
                files=elevated_files,
            )
            with self.subTest(state=state, body=body), patch.object(
                blip, "fetch_immutable_pr_snapshot", return_value=make_immutable_snapshot(blocked_pr)
            ), patch.object(blip, "verify_identity", return_value=identity), self.assertRaisesRegex(
                SystemExit, message
            ):
                blip.approval_preflight(
                    token="token",
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    pr_number=PR_NUMBER,
                    pr=blocked_pr,
                    base=BASE,
                    head=HEAD,
                    review_mode="human_critical",
                    human_critical_override=True,
                )

    def test_live_approval_posts_exact_commit_and_requires_validated_readback(self) -> None:
        token = "test-token-not-secret"
        review_mode = "focused_semantic"
        body = blip.automated_approval_body(
            pr_number=PR_NUMBER,
            base=BASE,
            head=HEAD,
        )
        self.assertEqual(
            body,
            '{"kind":"ai-bim-automated-approve-only","version":1,"automated":true,'
            '"repo":"monkey1sai/AI-BIM-governance","prNumber":511,'
            f'"headOid":"{HEAD}","baseOid":"{BASE}","action":"approve-only"}}',
        )
        trusted_merge_body = (
            '{"kind":"ai-bim-single-owner-approval","version":1,'
            '"repo":"monkey1sai/AI-BIM-governance","prNumber":511,'
            f'"headOid":"{HEAD}","baseOid":"{BASE}","action":"merge"}}'
        )
        self.assertNotEqual(body, trusted_merge_body)
        posted = {
            "id": 4242,
            "state": "APPROVED",
            "body": body,
            "commit_id": HEAD,
            "submitted_at": "2026-08-12T10:01:00Z",
            "html_url": f"https://github.com/monkey1sai/AI-BIM-governance/pull/{PR_NUMBER}#pullrequestreview-4242",
            "user": {"login": blip.DEFAULT_REVIEWER, "id": blip.DEFAULT_REVIEWER_ID, "type": "User"},
        }
        after_review = make_review(blip.DEFAULT_REVIEWER, "APPROVED", body, review_id=4242)
        after = make_approval_pr(
            review_decision="APPROVED",
            merge_state="CLEAN",
            reviews=[make_approval_pr()["reviews"]["nodes"][0], after_review],
        )
        policy = make_policy()
        identity = {
            "login": blip.DEFAULT_REVIEWER,
            "id": blip.DEFAULT_REVIEWER_ID,
            "type": "User",
            "permission": "write",
        }
        with patch.object(blip, "fetch_pr", side_effect=[make_approval_pr(), make_approval_pr(), after]), patch.object(
            blip, "fetch_protection_policy", return_value=policy
        ), patch.object(
            blip, "fetch_repository_safety", return_value=make_repo_safety()
        ), patch.object(
            blip, "verify_identity", return_value=identity
        ), patch.object(blip, "http_json", return_value=posted) as http_mock, patch.object(
            blip, "consume_capability_nonce"
        ) as consume_mock:
            result = blip.submit_automated_approval(
                token=token,
                owner="monkey1sai",
                name="AI-BIM-governance",
                repo=blip.DEFAULT_REPO,
                pr_number=PR_NUMBER,
                base=BASE,
                head=HEAD,
                review_mode=review_mode,
                capability_raw=make_capability(token),
            )
        self.assertEqual(result["review_id"], 4242)
        consume_mock.assert_called_once_with("1" * 32)
        request = http_mock.call_args
        self.assertEqual(request.args[0], "POST")
        self.assertEqual(request.kwargs["body"]["commit_id"], HEAD)
        self.assertEqual(request.kwargs["body"]["event"], "APPROVE")
        self.assertEqual(request.kwargs["body"]["body"], body)

    def test_human_critical_live_approval_skips_only_app_attestation(self) -> None:
        token = "test-token-not-secret"
        body = blip.automated_approval_body(
            pr_number=PR_NUMBER,
            base=BASE,
            head=HEAD,
        )
        posted = {
            "id": 4242,
            "state": "APPROVED",
            "body": body,
            "commit_id": HEAD,
            "submitted_at": "2026-08-12T10:01:00Z",
            "html_url": f"https://github.com/monkey1sai/AI-BIM-governance/pull/{PR_NUMBER}#pullrequestreview-4242",
            "user": {"login": blip.DEFAULT_REVIEWER, "id": blip.DEFAULT_REVIEWER_ID, "type": "User"},
        }
        after_review = make_review(blip.DEFAULT_REVIEWER, "APPROVED", body, review_id=4242)
        elevated_files = [make_changed_file(".claude/launch.json")]
        before = make_approval_pr(reviews=[], files=elevated_files)
        after = make_approval_pr(
            review_decision="APPROVED",
            merge_state="CLEAN",
            reviews=[after_review],
            files=elevated_files,
        )
        identity = {
            "login": blip.DEFAULT_REVIEWER,
            "id": blip.DEFAULT_REVIEWER_ID,
            "type": "User",
            "permission": "write",
        }
        with patch.object(
            blip, "fetch_immutable_pr_snapshot", return_value=make_immutable_snapshot(before)
        ), patch.object(blip, "fetch_pr", side_effect=[before, before, after]), patch.object(
            blip, "fetch_protection_policy", return_value=make_policy()
        ), patch.object(
            blip, "fetch_repository_safety", return_value=make_repo_safety()
        ), patch.object(
            blip, "verify_identity", return_value=identity
        ), patch.object(
            blip, "http_json", return_value=posted
        ), patch.object(
            blip, "consume_capability_nonce"
        ) as consume_mock, patch.object(
            blip, "find_ship_attestation"
        ) as attestation_mock:
            result = blip.submit_automated_approval(
                token=token,
                owner="monkey1sai",
                name="AI-BIM-governance",
                repo=blip.DEFAULT_REPO,
                pr_number=PR_NUMBER,
                base=BASE,
                head=HEAD,
                review_mode="human_critical",
                capability_raw=make_capability(
                    token,
                    review_mode="human_critical",
                    human_critical_override=True,
                ),
                human_critical_override=True,
            )
        self.assertEqual(result["review_id"], 4242)
        consume_mock.assert_called_once_with("1" * 32)
        attestation_mock.assert_not_called()

    def test_human_critical_live_blocker_never_consumes_or_posts(self) -> None:
        token = "test-token-not-secret"
        identity = {
            "login": blip.DEFAULT_REVIEWER,
            "id": blip.DEFAULT_REVIEWER_ID,
            "type": "User",
            "permission": "write",
        }
        cases = (
            ("COMMENTED", "VERDICT: HELD\n", "NO-SHIP/HELD"),
            ("CHANGES_REQUESTED", "schema-drifted blocker", "requested changes"),
        )
        for state, body, message in cases:
            blocked_pr = make_approval_pr(
                reviews=[
                    make_review(
                        "codex-tri-adversarial-bot",
                        state,
                        body,
                        review_id=ATTESTATION_ID,
                    )
                ],
                files=[make_changed_file(".claude/launch.json")],
            )
            with self.subTest(state=state), patch.object(
                blip, "fetch_pr", return_value=blocked_pr
            ), patch.object(
                blip, "fetch_immutable_pr_snapshot", return_value=make_immutable_snapshot(blocked_pr)
            ), patch.object(blip, "verify_identity", return_value=identity), patch.object(
                blip, "consume_capability_nonce"
            ) as consume_mock, patch.object(
                blip, "http_json"
            ) as post_mock, self.assertRaisesRegex(
                SystemExit, message
            ):
                blip.submit_automated_approval(
                    token=token,
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    repo=blip.DEFAULT_REPO,
                    pr_number=PR_NUMBER,
                    base=BASE,
                    head=HEAD,
                    review_mode="human_critical",
                    capability_raw=make_capability(
                        token,
                        review_mode="human_critical",
                        human_critical_override=True,
                    ),
                    human_critical_override=True,
                )
            consume_mock.assert_not_called()
            post_mock.assert_not_called()

    def test_live_approval_never_posts_after_head_or_policy_drift(self) -> None:
        token = "test-token-not-secret"
        with patch.object(blip, "fetch_pr", return_value=make_approval_pr(head=OTHER_HEAD)), patch.object(
            blip, "http_json"
        ) as http_mock:
            with self.assertRaisesRegex(SystemExit, "Expected head"):
                blip.submit_automated_approval(
                    token=token,
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    repo=blip.DEFAULT_REPO,
                    pr_number=PR_NUMBER,
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                    capability_raw=make_capability(token),
                )
        http_mock.assert_not_called()

        first_policy = make_policy()
        second_policy = make_policy() | {"sha256": "e" * 64}
        with patch.object(blip, "fetch_pr", side_effect=[make_approval_pr(), make_approval_pr()]), patch.object(
            blip, "fetch_protection_policy", side_effect=[first_policy, second_policy]
        ), patch.object(
            blip, "fetch_repository_safety", return_value=make_repo_safety()
        ), patch.object(
            blip, "verify_identity", return_value={
                "login": blip.DEFAULT_REVIEWER,
                "id": blip.DEFAULT_REVIEWER_ID,
                "type": "User",
                "permission": "write",
            }
        ), patch.object(blip, "http_json") as http_mock:
            with self.assertRaisesRegex(SystemExit, "Branch protection changed"):
                blip.submit_automated_approval(
                    token=token,
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    repo=blip.DEFAULT_REPO,
                    pr_number=PR_NUMBER,
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                    capability_raw=make_capability(token),
                )
        http_mock.assert_not_called()

    def test_live_approval_never_posts_after_same_count_review_replacement(self) -> None:
        token = "test-token-not-secret"
        files = [make_changed_file(".claude/launch.json")]
        first = make_approval_pr(
            reviews=[make_review("reviewer", "COMMENTED", "first", review_id=7)], files=files
        )
        second = make_approval_pr(
            reviews=[make_review("reviewer", "COMMENTED", "replaced", review_id=7)], files=files
        )
        identity = {
            "login": blip.DEFAULT_REVIEWER,
            "id": blip.DEFAULT_REVIEWER_ID,
            "type": "User",
            "permission": "write",
        }
        with patch.object(blip, "fetch_pr", side_effect=[first, second]), patch.object(
            blip, "fetch_protection_policy", return_value=make_policy()
        ), patch.object(
            blip, "fetch_repository_safety", return_value=make_repo_safety()
        ), patch.object(
            blip, "fetch_immutable_pr_snapshot", return_value=make_immutable_snapshot(first)
        ), patch.object(
            blip, "verify_identity", return_value=identity
        ), patch.object(
            blip, "consume_capability_nonce"
        ) as consume_mock, patch.object(
            blip, "http_json"
        ) as post_mock, self.assertRaisesRegex(
            SystemExit, "Review evidence changed"
        ):
            blip.submit_automated_approval(
                token=token,
                owner="monkey1sai",
                name="AI-BIM-governance",
                repo=blip.DEFAULT_REPO,
                pr_number=PR_NUMBER,
                base=BASE,
                head=HEAD,
                review_mode="human_critical",
                capability_raw=make_capability(
                    token,
                    review_mode="human_critical",
                    human_critical_override=True,
                ),
                human_critical_override=True,
            )
        consume_mock.assert_not_called()
        post_mock.assert_not_called()

    def test_permission_drift_prevents_post(self) -> None:
        token = "test-token-not-secret"
        write_identity = {
            "login": blip.DEFAULT_REVIEWER,
            "id": blip.DEFAULT_REVIEWER_ID,
            "type": "User",
            "permission": "write",
        }
        elevated = write_identity | {"permission": "admin"}
        with patch.object(blip, "fetch_pr", side_effect=[make_approval_pr(), make_approval_pr()]), patch.object(
            blip, "fetch_protection_policy", return_value=make_policy()
        ), patch.object(blip, "fetch_repository_safety", return_value=make_repo_safety()), patch.object(
            blip, "verify_identity", side_effect=[write_identity, elevated]
        ), patch.object(blip, "http_json") as http_mock:
            with self.assertRaisesRegex(SystemExit, "identity or permission changed"):
                blip.submit_automated_approval(
                    token=token,
                    owner="monkey1sai",
                    name="AI-BIM-governance",
                    repo=blip.DEFAULT_REPO,
                    pr_number=PR_NUMBER,
                    base=BASE,
                    head=HEAD,
                    review_mode="focused_semantic",
                    capability_raw=make_capability(token),
                )
        http_mock.assert_not_called()

    def test_malformed_approval_response_is_not_success(self) -> None:
        body = blip.automated_approval_body(
            pr_number=PR_NUMBER,
            base=BASE,
            head=HEAD,
        )
        with self.assertRaisesRegex(SystemExit, "review id"):
            blip.validate_approval_response(
                {
                    "state": "APPROVED",
                    "body": body,
                    "commit_id": HEAD,
                    "submitted_at": "now",
                    "html_url": f"https://github.com/monkey1sai/AI-BIM-governance/pull/{PR_NUMBER}#pullrequestreview-x",
                    "user": {"login": blip.DEFAULT_REVIEWER, "id": blip.DEFAULT_REVIEWER_ID, "type": "User"},
                },
                pr_number=PR_NUMBER,
                head=HEAD,
                body=body,
            )

    def test_local_lock_rejects_parallel_same_approval(self) -> None:
        with blip.exclusive_approval_lock(PR_NUMBER, BASE, HEAD):
            with self.assertRaisesRegex(SystemExit, "Another local approval"):
                with blip.exclusive_approval_lock(PR_NUMBER, BASE, HEAD):
                    self.fail("nested identical approval lock unexpectedly acquired")


if __name__ == "__main__":
    unittest.main()
