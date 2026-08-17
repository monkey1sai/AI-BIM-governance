from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ship_gate_packet as packet


FAKE_AUTH = types.ModuleType("app_auth")
FAKE_AUTH.API = "https://api.github.test"
FAKE_AUTH.http_json = Mock()
FAKE_AUTH.load_bot_config = Mock()
FAKE_AUTH.protected_installation_token = Mock()

MODULE_PATH = Path(__file__).with_name("collect_ship_gate_packet.py")
SPEC = importlib.util.spec_from_file_location("candidate_collect_ship_gate_packet", MODULE_PATH)
assert SPEC and SPEC.loader
collector = importlib.util.module_from_spec(SPEC)
_PREVIOUS_APP_AUTH = sys.modules.get("app_auth")
sys.modules["app_auth"] = FAKE_AUTH
try:
    SPEC.loader.exec_module(collector)
finally:
    if _PREVIOUS_APP_AUTH is None:
        sys.modules.pop("app_auth", None)
    else:
        sys.modules["app_auth"] = _PREVIOUS_APP_AUTH


def snapshot() -> dict:
    normalized = [{"path": "src/example.py", "additions": 1, "deletions": 0, "change_type": "MODIFIED"}]
    diff = json.dumps({"patch": "+new"})
    import hashlib

    return {
        "meta": {
            "number": 511,
            "title": "test",
            "state": "OPEN",
            "url": f"https://github.com/{packet.FIXED_REPO}/pull/511",
            "author": {"login": "owner"},
            "headRefName": "feature",
            "headRefOid": "a" * 40,
            "baseRefName": "main",
            "baseRefOid": "c" * 40,
            "isDraft": False,
            "files": [{"path": "src/example.py", "additions": 1, "deletions": 0}],
        },
        "diff": diff,
        "files": ["src/example.py"],
        "normalized_files": normalized,
        "changed_files_sha256": packet.canonical_digest(normalized),
        "diff_sha256": hashlib.sha256(diff.encode("utf-8")).hexdigest(),
    }


class CollectShipGatePacketTests(unittest.TestCase):
    def test_collector_writes_one_strict_packet_and_fixed_markers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            argv = [
                "collect_ship_gate_packet.py", "--repo", packet.FIXED_REPO, "--pr", "511",
                "--out-dir", str(root), "--stamp", "20260814T123456789",
            ]
            output = io.StringIO()
            with patch.object(sys, "argv", argv), patch.object(
                collector, "fixed_installation_token", return_value="opaque"
            ), patch.object(collector, "collect_pr_snapshot", return_value=snapshot()) as collect, redirect_stdout(output):
                self.assertEqual(collector.main(), 0)
            target = root / "codex-gate-packet-pr-511-20260814T123456789.json"
            loaded = packet.load_packet(target, repo=packet.FIXED_REPO, pr=511)
        self.assertEqual(loaded["meta"]["headRefOid"], "a" * 40)
        self.assertEqual(collect.call_count, 1)
        self.assertIn(f"BLIP_GATE_PACKET={target}", output.getvalue())
        self.assertNotIn("opaque", output.getvalue())

    def test_collector_rejects_invalid_stamp_before_token_acquisition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            argv = [
                "collect_ship_gate_packet.py", "--repo", packet.FIXED_REPO, "--pr", "511",
                "--out-dir", str(Path(directory).resolve()), "--stamp", "bad",
            ]
            with patch.object(sys, "argv", argv), patch.object(collector, "fixed_installation_token") as token:
                with self.assertRaisesRegex(SystemExit, "timestamp shape"):
                    collector.main()
            token.assert_not_called()


if __name__ == "__main__":
    unittest.main()
