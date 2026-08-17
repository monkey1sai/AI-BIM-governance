from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch


FAKE_AUTH = types.ModuleType("app_auth")
FAKE_AUTH.API = "https://api.github.test"
FAKE_AUTH.http_json = Mock()
FAKE_AUTH.installation_token = Mock(return_value="installation-token")
FAKE_AUTH.load_bot_config = Mock(
    return_value={
        "app_id": "4445344",
        "installation_id": "150304409",
        "app_slug": "codex-tri-adversarial-bot",
        "repo": "monkey1sai/AI-BIM-governance",
    }
)
FAKE_AUTH.load_env_file = Mock()
FAKE_AUTH.protected_installation_token = Mock(return_value="protected-installation-token")
FAKE_AUTH.read_private_key = Mock(return_value=b"key")
FAKE_AUTH.require_env = Mock(
    return_value={
        "GITHUB_APP_ID": "1",
        "GITHUB_APP_INSTALLATION_ID": "2",
        "GITHUB_APP_PRIVATE_KEY_PATH": "C:/secret.pem",
    }
)

MODULE_PATH = Path(__file__).with_name("post_review.py")
SPEC = importlib.util.spec_from_file_location("candidate_post_review", MODULE_PATH)
assert SPEC and SPEC.loader
post = importlib.util.module_from_spec(SPEC)
_PREVIOUS_APP_AUTH = sys.modules.get("app_auth")
sys.modules["app_auth"] = FAKE_AUTH
try:
    SPEC.loader.exec_module(post)
finally:
    if _PREVIOUS_APP_AUTH is None:
        sys.modules.pop("app_auth", None)
    else:
        sys.modules["app_auth"] = _PREVIOUS_APP_AUTH


class PostReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        FAKE_AUTH.http_json.reset_mock()
        FAKE_AUTH.protected_installation_token.reset_mock()
        FAKE_AUTH.installation_token.reset_mock()
        FAKE_AUTH.read_private_key.reset_mock()

    def run_main(self, argv: list[str]) -> str:
        with patch.object(sys, "argv", ["post_review.py", *argv]), redirect_stdout(io.StringIO()) as output:
            post.main()
        return output.getvalue()

    @staticmethod
    def attested_body() -> str:
        return (
            "VERDICT: SHIP\n\n"
            "<!-- blip-ship-attestation:v1\n"
            "repo=monkey1sai/AI-BIM-governance\n"
            "pr=511\nbase=" + "c" * 40 + "\nhead=" + "a" * 40 + "\n"
            "review_mode=focused_semantic\nchanged_files_sha256=" + "d" * 64 + "\n"
            "diff_sha256=" + "e" * 64 + "\n"
            "verdict=SHIP\n-->"
        )

    def test_dry_run_emits_validated_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            body = Path(directory) / "report.md"
            body.write_text(self.attested_body(), encoding="utf-8")
            with patch.object(post, "__file__", str(Path(directory) / "scripts" / "post_review.py")):
                output = self.run_main(
                    [
                        "--bot",
                        "codex",
                        "--repo",
                        "monkey1sai/AI-BIM-governance",
                        "--pr",
                        "511",
                        "--body-file",
                        str(body),
                        "--event",
                        "comment",
                        "--commit-id",
                        "a" * 40,
                        "--dry-run",
                    ]
                )
        self.assertIn("POST_REVIEW_RESULT event=COMMENT dry_run=True", output)
        FAKE_AUTH.http_json.assert_not_called()

    def test_live_response_requires_exact_state_and_url(self) -> None:
        body = self.attested_body()
        header = post.review_header("comment")
        full_body = header + body
        valid = {
            "id": 4242,
            "state": "COMMENTED",
            "html_url": "https://github.com/monkey1sai/AI-BIM-governance/pull/511#pullrequestreview-4242",
            "commit_id": "a" * 40,
            "body": full_body,
            "user": {"login": post.CODEX_BOT_LOGIN, "id": post.CODEX_BOT_ID, "type": "Bot"},
        }
        readback = dict(valid)
        with patch.dict(os.environ, {}, clear=True), patch.object(
            post, "http_json", side_effect=[[], valid, readback]
        ):
            output = self.run_main(
                [
                    "--bot",
                    "codex",
                    "--repo",
                    "monkey1sai/AI-BIM-governance",
                    "--pr",
                    "511",
                    "--body",
                    body,
                    "--event",
                    "comment",
                    "--commit-id",
                    "a" * 40,
                    "--live",
                ]
            )
        self.assertIn("POST_REVIEW_RESULT event=COMMENT dry_run=False", output)
        FAKE_AUTH.protected_installation_token.assert_called_with(
            post.CODEX_APP_ID, post.CODEX_INSTALLATION_ID
        )
        FAKE_AUTH.read_private_key.assert_not_called()
        FAKE_AUTH.installation_token.assert_not_called()

        for response in (
            valid | {"state": "APPROVED"},
            valid | {"html_url": "https://github.com/attacker/repo/pull/511#pullrequestreview-4242"},
            {"unexpected": True},
        ):
            with self.subTest(response=json.dumps(response)), patch.dict(os.environ, {}, clear=True), patch.object(
                post, "http_json", side_effect=[[], response]
            ), self.assertRaises(SystemExit):
                self.run_main(
                    [
                        "--bot",
                        "codex",
                        "--repo",
                        "monkey1sai/AI-BIM-governance",
                        "--pr",
                        "511",
                        "--body",
                        body,
                        "--event",
                        "comment",
                        "--commit-id",
                        "a" * 40,
                        "--live",
                    ]
                )

    def test_codex_identity_config_overrides_ambient_and_live_env_does_not_enable_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "GITHUB_APP_ID": "attacker",
                "GITHUB_REPO": "attacker/repo",
                "BOT_LIVE_SUBMIT": "1",
            },
            clear=True,
        ):
            body = Path(directory) / "report.md"
            body.write_text(self.attested_body(), encoding="utf-8")
            with patch.object(post, "__file__", str(Path(directory) / "scripts" / "post_review.py")):
                output = self.run_main(
                    [
                        "--bot", "codex", "--repo", post.FIXED_REPO, "--pr", "511",
                        "--body-file", str(body), "--event", "comment", "--commit-id", "a" * 40,
                    ]
                )
        self.assertIn("dry_run=True", output)
        FAKE_AUTH.load_bot_config.assert_called_with(Path(directory), "codex", override=True)
        FAKE_AUTH.http_json.assert_not_called()

    def test_codex_rejects_missing_footer_malformed_pagination_and_readback(self) -> None:
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(SystemExit, "canonical SHIP"):
            self.run_main(
                ["--bot", "codex", "--repo", post.FIXED_REPO, "--pr", "511", "--body", "VERDICT: SHIP",
                 "--event", "comment", "--commit-id", "a" * 40, "--dry-run"]
            )

        body = self.attested_body()
        for existing, message in (({"bad": True}, "enumeration is malformed"), ([{}] * 100, "may be incomplete")):
            with self.subTest(message=message), patch.dict(os.environ, {}, clear=True), patch.object(
                post, "http_json", return_value=existing
            ), self.assertRaisesRegex(SystemExit, message):
                self.run_main(
                    ["--bot", "codex", "--repo", post.FIXED_REPO, "--pr", "511", "--body", body,
                     "--event", "comment", "--commit-id", "a" * 40, "--live"]
                )

        header = post.review_header("comment")
        valid = {
            "id": 4242,
            "state": "COMMENTED",
            "html_url": f"https://github.com/{post.FIXED_REPO}/pull/511#pullrequestreview-4242",
            "commit_id": "a" * 40,
            "body": header + body,
            "user": {"login": post.CODEX_BOT_LOGIN, "id": post.CODEX_BOT_ID, "type": "Bot"},
        }
        for readback, message in (([], "readback is malformed"), (valid | {"body": "forged"}, "readback differs")):
            with self.subTest(message=message), patch.dict(os.environ, {}, clear=True), patch.object(
                post, "http_json", side_effect=[[], valid, readback]
            ), self.assertRaisesRegex(SystemExit, message):
                self.run_main(
                    ["--bot", "codex", "--repo", post.FIXED_REPO, "--pr", "511", "--body", body,
                     "--event", "comment", "--commit-id", "a" * 40, "--live"]
                )

    def test_outbound_dlp_rejects_malicious_sentinel_before_token_or_http(self) -> None:
        body = "VERDICT: HELD\n\nBLIP_DLP_SENTINEL_MUST_NEVER_REACH_GITHUB"
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(
            SystemExit, "outbound content safety policy: dlp_sentinel"
        ):
            self.run_main(
                [
                    "--bot", "codex", "--repo", post.FIXED_REPO, "--pr", "511",
                    "--body", body, "--event", "comment", "--commit-id", "a" * 40, "--live",
                ]
            )
        FAKE_AUTH.protected_installation_token.assert_not_called()
        FAKE_AUTH.http_json.assert_not_called()

    def test_body_grammar_rejects_active_markdown_conflicting_verdicts_and_unicode(self) -> None:
        valid = self.attested_body()
        cases = (
            ("VERDICT: HELD\n\n" + valid, "exactly one canonical verdict"),
            ("@example-team\n\n" + valid, "active Markdown: mention"),
            ("![x](https://example.test)\n\n" + valid, "active Markdown: link_or_image"),
            ("<img src=x>\n\n" + valid, "active Markdown: html"),
            ("/command\n\n" + valid, "active Markdown: command"),
            ("- [x] task\n\n" + valid, "active Markdown: task_list"),
            (valid.replace("\n", "\r\n"), "line or direction controls"),
            ("\u202e" + valid, "line or direction controls"),
            (
                valid.replace("head=" + "a" * 40, "head=" + "b" * 40),
                "exact PR/head tuple",
            ),
            (valid.replace("review_mode=focused_semantic", "review_mode=unknown"), "footer grammar"),
            ("VERDICT: HELD\nextra", "terminal boundary"),
        )
        for body, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(SystemExit, message):
                post.validate_body("comment", body, pr_number=511, commit_id="a" * 40)

        self.assertEqual(
            post.validate_body("comment", valid, pr_number=511, commit_id="a" * 40),
            post.review_header("comment") + valid,
        )


if __name__ == "__main__":
    unittest.main()
