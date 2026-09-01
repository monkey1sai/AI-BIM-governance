from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import time
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch


FAKE_APP_AUTH = types.ModuleType("app_auth")
FAKE_APP_AUTH.API = "https://api.github.test"
FAKE_APP_AUTH.http_json = Mock()

BLIP_PATH = Path(__file__).with_name("blip_review.py")
MINT_PATH = Path(__file__).with_name("mint_protection_attestation.py")
SIGNING_KEY = "k" * 64

_PREVIOUS_APP_AUTH = sys.modules.get("app_auth")
_PREVIOUS_BLIP = sys.modules.get("blip_review")
sys.modules["app_auth"] = FAKE_APP_AUTH
try:
    _BLIP_SPEC = importlib.util.spec_from_file_location("blip_review", BLIP_PATH)
    assert _BLIP_SPEC and _BLIP_SPEC.loader
    blip = importlib.util.module_from_spec(_BLIP_SPEC)
    sys.modules["blip_review"] = blip
    _BLIP_SPEC.loader.exec_module(blip)

    _MINT_SPEC = importlib.util.spec_from_file_location("candidate_mint_protection", MINT_PATH)
    assert _MINT_SPEC and _MINT_SPEC.loader
    mint = importlib.util.module_from_spec(_MINT_SPEC)
    _MINT_SPEC.loader.exec_module(mint)
finally:
    if _PREVIOUS_APP_AUTH is None:
        sys.modules.pop("app_auth", None)
    else:
        sys.modules["app_auth"] = _PREVIOUS_APP_AUTH
    if _PREVIOUS_BLIP is None:
        sys.modules.pop("blip_review", None)
    else:
        sys.modules["blip_review"] = _PREVIOUS_BLIP


def make_protection_payload() -> dict:
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
            "require_last_push_approval": False,
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


class BuildAttestationTests(unittest.TestCase):
    def test_round_trip_verifies_with_the_broker_verifier(self) -> None:
        protection = make_protection_payload()
        raw = mint.build_attestation(
            signing_key=SIGNING_KEY,
            protection=protection,
            base_branch="main",
            valid_seconds=600,
        )
        verified = blip.verify_protection_attestation(
            signing_key=SIGNING_KEY, raw=raw, base_branch="main"
        )
        self.assertEqual(verified["protection"], protection)
        self.assertEqual(verified["expires_at"] - verified["issued_at"], 600)

    def test_wrong_signing_token_fails_verification(self) -> None:
        raw = mint.build_attestation(
            signing_key=SIGNING_KEY,
            protection=make_protection_payload(),
            base_branch="main",
            valid_seconds=600,
        )
        with self.assertRaisesRegex(SystemExit, "signature is invalid"):
            blip.verify_protection_attestation(
                signing_key="x" * 64, raw=raw, base_branch="main"
            )

    def test_expired_build_is_rejected(self) -> None:
        raw = mint.build_attestation(
            signing_key=SIGNING_KEY,
            protection=make_protection_payload(),
            base_branch="main",
            valid_seconds=600,
            now=int(time.time()) - 1200,
        )
        with self.assertRaisesRegex(SystemExit, "expired"):
            blip.verify_protection_attestation(
                signing_key=SIGNING_KEY, raw=raw, base_branch="main"
            )


class FetchSnapshotTests(unittest.TestCase):
    def test_snapshot_requires_empty_rulesets_and_dict_payload(self) -> None:
        protection = make_protection_payload()
        with patch.object(blip, "http_json", side_effect=[[], protection]):
            self.assertEqual(mint.fetch_protection_snapshot("admin-token", "main"), protection)
        with patch.object(blip, "http_json", return_value=[{"type": "pull_request"}]), self.assertRaisesRegex(
            SystemExit, "Active rulesets"
        ):
            mint.fetch_protection_snapshot("admin-token", "main")
        with patch.object(blip, "http_json", side_effect=[[], None]), self.assertRaisesRegex(
            SystemExit, "missing or malformed"
        ):
            mint.fetch_protection_snapshot("admin-token", "main")


class MintMainTests(unittest.TestCase):
    def run_main(self, argv: list[str], env: dict[str, str]) -> int:
        with patch.object(sys, "argv", ["mint_protection_attestation.py", *argv]), patch.dict(
            mint.os.environ, env, clear=False
        ), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return mint.main()

    def test_main_writes_a_verifiable_attestation_file(self) -> None:
        protection = make_protection_payload()
        env = {
            mint.DEFAULT_ADMIN_TOKEN_ENV: "admin-token",
            mint.DEFAULT_SIGNING_KEY_ENV: SIGNING_KEY,
        }
        with tempfile.TemporaryDirectory(prefix="mint-attestation-") as workdir:
            out_path = Path(workdir) / "attestation.txt"
            with patch.object(blip, "http_json", side_effect=[[], protection]):
                exit_code = self.run_main(["--out", str(out_path)], env)
            self.assertEqual(exit_code, 0)
            raw = out_path.read_text(encoding="ascii").strip()
        verified = blip.verify_protection_attestation(
            signing_key=SIGNING_KEY, raw=raw, base_branch="main"
        )
        self.assertEqual(verified["protection"], protection)

    def test_main_enforces_validity_bounds_and_required_envs(self) -> None:
        env = {
            mint.DEFAULT_ADMIN_TOKEN_ENV: "admin-token",
            mint.DEFAULT_SIGNING_KEY_ENV: SIGNING_KEY,
        }
        for seconds in ("59", "601"):
            with self.subTest(seconds=seconds), self.assertRaisesRegex(SystemExit, "--valid-seconds"):
                self.run_main(["--valid-seconds", seconds], env)
        with patch.dict(mint.os.environ, {mint.DEFAULT_ADMIN_TOKEN_ENV: ""}), self.assertRaisesRegex(
            SystemExit, mint.DEFAULT_ADMIN_TOKEN_ENV
        ):
            self.run_main([], {mint.DEFAULT_SIGNING_KEY_ENV: SIGNING_KEY})
        with patch.dict(mint.os.environ, {mint.DEFAULT_SIGNING_KEY_ENV: ""}), self.assertRaisesRegex(
            SystemExit, mint.DEFAULT_SIGNING_KEY_ENV
        ):
            self.run_main([], {mint.DEFAULT_ADMIN_TOKEN_ENV: "admin-token"})


if __name__ == "__main__":
    unittest.main()
