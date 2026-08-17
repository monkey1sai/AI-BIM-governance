from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import urllib.error


MODULE_PATH = Path(__file__).with_name("app_auth.py")
SPEC = importlib.util.spec_from_file_location("candidate_app_auth", MODULE_PATH)
assert SPEC and SPEC.loader
auth = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(auth)


class AppAuthConfigTests(unittest.TestCase):
    def test_protected_token_requires_exact_companion_identity(self) -> None:
        env = {
            auth.PROTECTED_INSTALLATION_TOKEN_ENV: "ghs_abcdefghijklmnopqrstuvwxyz",
            auth.PROTECTED_APP_ID_ENV: "4445344",
            auth.PROTECTED_INSTALLATION_ID_ENV: "150304409",
        }
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(
                auth.protected_installation_token("4445344", "150304409"),
                "ghs_abcdefghijklmnopqrstuvwxyz",
            )
            self.assertNotIn(auth.PROTECTED_INSTALLATION_TOKEN_ENV, os.environ)
            self.assertNotIn(auth.PROTECTED_APP_ID_ENV, os.environ)
            self.assertNotIn(auth.PROTECTED_INSTALLATION_ID_ENV, os.environ)
        env[auth.PROTECTED_APP_ID_ENV] = "attacker"
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit):
                auth.protected_installation_token("4445344", "150304409")

    def test_module_has_no_legacy_credential_or_token_print_surface(self) -> None:
        self.assertNotIn("jwt", auth.__dict__)
        source = MODULE_PATH.read_text(encoding="utf-8")
        for forbidden in (
            "load_env_file",
            "read_private_key",
            "make_app_jwt",
            "jwt_token",
            "--print-token",
            "GITHUB_APP_PRIVATE_KEY_PATH",
        ):
            self.assertNotIn(forbidden, source)

    def test_http_error_body_is_never_relayed(self) -> None:
        error = urllib.error.HTTPError(
            "https://api.github.com/private",
            401,
            "Unauthorized",
            {},
            io.BytesIO(b"secret-token-adjacent-body"),
        )
        with patch.object(auth._NO_REDIRECT_OPENER, "open", side_effect=error), self.assertRaises(
            SystemExit
        ) as raised:
            auth.http_json("GET", "https://api.github.com/private", token="opaque")
        self.assertNotIn("secret-token-adjacent-body", str(raised.exception))
        self.assertEqual(
            str(raised.exception), "HTTP 401 GET https://api.github.com/private"
        )

    def test_http_json_rejects_off_origin_and_oversized_response(self) -> None:
        with patch.object(auth._NO_REDIRECT_OPENER, "open") as open_mock, self.assertRaisesRegex(
            SystemExit, "non-canonical API origin"
        ):
            auth.http_json("GET", "https://attacker.example/private", token="opaque")
        open_mock.assert_not_called()

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, limit: int) -> bytes:
                return b"x" * limit

        with patch.object(auth._NO_REDIRECT_OPENER, "open", return_value=Response()), self.assertRaisesRegex(
            SystemExit, "protected byte limit"
        ):
            auth.http_json("GET", "https://api.github.com/private", token="opaque")

    def test_redirect_handler_refuses_before_following(self) -> None:
        request = auth.urllib.request.Request(
            "https://api.github.com/source",
            headers={"Authorization": "Bearer opaque"},
        )
        with self.assertRaises(urllib.error.HTTPError):
            auth._NoRedirectHandler().redirect_request(
                request,
                io.BytesIO(),
                302,
                "Found",
                {"Location": "https://attacker.example/sink"},
                "https://attacker.example/sink",
            )

    def test_protected_bot_config_overrides_ambient_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bots.json").write_text(
                json.dumps(
                    {
                        "schema": "blip-protected-bot-config/v1",
                        "bots": {
                            "codex": {
                                "app_id": "4445344",
                                "installation_id": "150304409",
                                "app_slug": "codex-tri-adversarial-bot",
                                "repo": "monkey1sai/AI-BIM-governance",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {
                    "GITHUB_APP_ID": "attacker",
                    "GITHUB_APP_INSTALLATION_ID": "attacker-installation",
                    "APP_SLUG": "attacker-app",
                    "GITHUB_REPO": "attacker/repo",
                },
                clear=True,
            ):
                auth.load_bot_config(root, "codex", override=True)
                self.assertEqual(os.environ["GITHUB_APP_ID"], "4445344")
                self.assertEqual(os.environ["GITHUB_APP_INSTALLATION_ID"], "150304409")
                self.assertEqual(os.environ["APP_SLUG"], "codex-tri-adversarial-bot")
                self.assertEqual(os.environ["GITHUB_REPO"], "monkey1sai/AI-BIM-governance")

    def test_config_rejects_non_protected_mode_and_unknown_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bots.json").write_text(
                json.dumps(
                    {
                        "schema": "blip-protected-bot-config/v1",
                        "bots": {
                            "codex": {
                                "app_slug": "codex-tri-adversarial-bot",
                                "app_id": "4445344",
                                "installation_id": "150304409",
                                "repo": "monkey1sai/AI-BIM-governance",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"GITHUB_APP_ID": "ambient"}, clear=True):
                with self.assertRaisesRegex(SystemExit, "fixed Codex identity"):
                    auth.load_bot_config(root, "codex")
            payload = json.loads((root / "bots.json").read_text(encoding="utf-8"))
            payload["bots"]["codex"]["unexpected"] = "value"
            (root / "bots.json").write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "unknown or missing"):
                auth.load_bot_config(root, "codex", override=True)


if __name__ == "__main__":
    unittest.main()
