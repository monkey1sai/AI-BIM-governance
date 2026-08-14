from __future__ import annotations

import base64
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ship_gate_packet as packet


BASE = "c" * 40
HEAD = "a" * 40
BASE_TREE = "1" * 40
HEAD_TREE = "2" * 40
BASE_TEXT = "old\n"
HEAD_TEXT = "new\n"


def git_blob_sha(text: str) -> str:
    raw = text.encode("utf-8")
    return hashlib.sha1(f"blob {len(raw)}\0".encode("ascii") + raw).hexdigest()


def raw_blob(text: str, *, claimed_sha: str | None = None) -> dict:
    raw = text.encode("utf-8")
    return {
        "sha": claimed_sha or git_blob_sha(text),
        "size": len(raw),
        "encoding": "base64",
        "content": base64.b64encode(raw).decode("ascii"),
    }


def raw_pr() -> dict:
    return {
        "number": 511,
        "title": "test",
        "state": "open",
        "draft": False,
        "changed_files": 1,
        "html_url": f"https://github.com/{packet.FIXED_REPO}/pull/511",
        "user": {"login": "owner"},
        "base": {"ref": "main", "sha": BASE},
        "head": {"ref": "feature", "sha": HEAD},
    }


def raw_files(*, head_text: str = HEAD_TEXT, patch: str = "@@ -1 +1 @@\n-old\n+new") -> list[dict]:
    return [{
        "filename": "src/example.py",
        "status": "modified",
        "additions": 1,
        "deletions": 1,
        "changes": 2,
        "sha": git_blob_sha(head_text),
        "patch": patch,
    }]


def raw_compare(
    files: list[dict] | None = None,
    *,
    head: str = HEAD,
    base_tree: str = BASE_TREE,
    head_tree: str = HEAD_TREE,
) -> dict:
    return {
        "base_commit": {"sha": BASE, "commit": {"tree": {"sha": base_tree}}},
        "head_commit": {"sha": head, "commit": {"tree": {"sha": head_tree}}},
        "merge_base_commit": {"sha": BASE, "commit": {"tree": {"sha": base_tree}}},
        "files": raw_files() if files is None else files,
    }


def raw_tree(tree_sha: str, blob_sha: str, *, mode: str = "100644") -> dict:
    return {
        "sha": tree_sha,
        "truncated": False,
        "tree": [
            {"path": "src/example.py", "mode": mode, "type": "blob", "sha": blob_sha}
        ],
    }


def snapshot_responses(
    *,
    before: dict | None = None,
    after: dict | None = None,
    base_text: str = BASE_TEXT,
    head_text: str = HEAD_TEXT,
    patch: str = "@@ -1 +1 @@\n-old\n+new",
) -> list[object]:
    files = raw_files(head_text=head_text, patch=patch)
    return [
        before or raw_pr(),
        raw_compare(files),
        raw_tree(BASE_TREE, git_blob_sha(base_text)),
        raw_tree(HEAD_TREE, git_blob_sha(head_text)),
        raw_blob(base_text),
        raw_blob(head_text),
        after or raw_pr(),
    ]


def snapshot() -> dict:
    responses = snapshot_responses()

    def fetch(*_args: object, **_kwargs: object) -> object:
        return responses.pop(0)

    return packet.collect_pr_snapshot(fetch, "https://api.github.test", "opaque", packet.FIXED_REPO, 511)


class ShipGatePacketTests(unittest.TestCase):
    def test_collect_write_and_load_round_trip(self) -> None:
        value = snapshot()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "packet.json"
            packet.write_packet(path, value, repo=packet.FIXED_REPO, pr=511)
            loaded = packet.load_packet(path, repo=packet.FIXED_REPO, pr=511)
        self.assertEqual(loaded, value)
        self.assertEqual(loaded["changed_files_sha256"], packet.canonical_digest(loaded["normalized_files"]))
        self.assertEqual(loaded["diff_sha256"], hashlib.sha256(loaded["diff"].encode("utf-8")).hexdigest())

    def test_unknown_duplicate_and_digest_tampering_fail_closed(self) -> None:
        value = packet.packet_from_snapshot(snapshot(), repo=packet.FIXED_REPO, pr=511)
        cases: list[tuple[str, str]] = []
        extra = {**value, "unexpected": True}
        cases.append((json.dumps(extra), "unknown, missing, or duplicate"))
        duplicate = json.dumps(value, separators=(",", ":"))
        duplicate = duplicate[:-1] + ',"schema":"duplicate"}'
        cases.append((duplicate, "duplicate field"))
        wrong_digest = {**value, "diff_sha256": "0" * 64}
        cases.append((json.dumps(wrong_digest), "digest mismatch"))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for index, (content, message) in enumerate(cases):
                path = root / f"bad-{index}.json"
                path.write_text(content, encoding="utf-8")
                with self.subTest(message=message), self.assertRaisesRegex(RuntimeError, message):
                    packet.load_packet(path, repo=packet.FIXED_REPO, pr=511)

    def test_packet_byte_limit_and_exclusive_create(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            oversized = root / "oversized.json"
            oversized.write_bytes(b"{" + b" " * packet.MAX_PACKET_BYTES + b"}")
            with self.assertRaisesRegex(RuntimeError, "byte length"):
                packet.load_packet(oversized, repo=packet.FIXED_REPO, pr=511)

            target = root / "packet.json"
            target.write_text("occupied", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                packet.write_packet(target, snapshot(), repo=packet.FIXED_REPO, pr=511)

    def test_collection_uses_immutable_compare_and_rejects_mixed_tuple(self) -> None:
        calls: list[str] = []
        moved = raw_pr()
        moved["head"] = {"ref": "feature", "sha": "b" * 40}
        responses = snapshot_responses(after=moved)

        def fetch(_method: str, url: str, **_kwargs: object) -> object:
            calls.append(url)
            return responses.pop(0)

        with self.assertRaisesRegex(RuntimeError, "changed while collecting"):
            packet.collect_pr_snapshot(
                fetch, "https://api.github.test", "opaque", packet.FIXED_REPO, 511
            )
        self.assertIn(f"/compare/{BASE}...{HEAD}?per_page=100&page=1", calls[1])

        responses = [raw_pr(), raw_compare(head="b" * 40)]
        with self.assertRaisesRegex(RuntimeError, "not bound to the requested"):
            packet.collect_pr_snapshot(
                lambda *_args, **_kwargs: responses.pop(0),
                "https://api.github.test",
                "opaque",
                packet.FIXED_REPO,
                511,
            )

    def test_collection_rejects_gitmodules_before_tree_or_blob_fetch(self) -> None:
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
            files = raw_files()
            files[0].update(changed)
            calls: list[str] = []
            responses = [raw_pr(), raw_compare(files)]

            def fetch(_method: str, url: str, **_kwargs: object) -> object:
                calls.append(url)
                return responses.pop(0)

            with self.subTest(label=label), self.assertRaisesRegex(
                RuntimeError, r"submodule or \.gitmodules"
            ):
                packet.collect_pr_snapshot(
                    fetch, "https://api.github.test", "opaque", packet.FIXED_REPO, 511
                )
            self.assertEqual(len(calls), 2)
            self.assertEqual(responses, [])

    def test_collection_rejects_changed_count_symlink_and_blob_mismatch(self) -> None:
        wrong_count = raw_pr()
        wrong_count["changed_files"] = 2
        responses = [wrong_count, raw_compare()]
        with self.assertRaisesRegex(RuntimeError, "file evidence is incomplete"):
            packet.collect_pr_snapshot(
                lambda *_args, **_kwargs: responses.pop(0),
                "https://api.github.test",
                "opaque",
                packet.FIXED_REPO,
                511,
            )

        symlink_text = "../../outside"
        symlink_sha = git_blob_sha(symlink_text)
        symlink_file = raw_files(head_text=symlink_text)
        responses = [
            raw_pr(),
            raw_compare(symlink_file),
            raw_tree(BASE_TREE, git_blob_sha(BASE_TEXT)),
            raw_tree(HEAD_TREE, symlink_sha, mode="120000"),
            raw_blob(BASE_TEXT),
        ]
        with self.assertRaisesRegex(RuntimeError, "symlink, gitlink, or unsupported mode"):
            packet.collect_pr_snapshot(
                lambda *_args, **_kwargs: responses.pop(0),
                "https://api.github.test",
                "opaque",
                packet.FIXED_REPO,
                511,
            )

        responses = snapshot_responses()
        responses[5] = raw_blob("tampered", claimed_sha=git_blob_sha(HEAD_TEXT))
        with self.assertRaisesRegex(RuntimeError, "does not match its tree binding"):
            packet.collect_pr_snapshot(
                lambda *_args, **_kwargs: responses.pop(0),
                "https://api.github.test",
                "opaque",
                packet.FIXED_REPO,
                511,
            )

    def test_long_changed_line_is_rebuilt_from_complete_immutable_blobs(self) -> None:
        base_text = "A" * 12000 + "safe\n"
        head_text = "A" * 12000 + "TAIL_RISK_AUTHORIZATION_BYPASS\n"
        responses = snapshot_responses(
            base_text=base_text,
            head_text=head_text,
            patch="@@ -1 +1 @@\n-" + base_text[:32] + "\n+" + head_text[:32],
        )
        value = packet.collect_pr_snapshot(
            lambda *_args, **_kwargs: responses.pop(0),
            "https://api.github.test",
            "opaque",
            packet.FIXED_REPO,
            511,
        )
        self.assertIn("TAIL_RISK_AUTHORIZATION_BYPASS", value["diff"])
        self.assertEqual(responses, [])


if __name__ == "__main__":
    unittest.main()
