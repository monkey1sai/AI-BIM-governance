#!/usr/bin/env python3
"""Collect one bounded GitHub PR packet, then exit before any model process starts."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_auth import API, http_json, load_bot_config, protected_installation_token  # noqa: E402
from ship_gate_packet import FIXED_REPO, collect_pr_snapshot, write_packet  # noqa: E402


FIXED_APP_ID = "4445344"
FIXED_INSTALLATION_ID = "150304409"
FIXED_APP_SLUG = "codex-tri-adversarial-bot"
FIXED_BOT_ID = 311390181


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
            raise RuntimeError(f"codex bot config {key} differs from the protected fixed identity")
    return protected_installation_token(FIXED_APP_ID, FIXED_INSTALLATION_ID)


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect a protected PR evidence packet")
    parser.add_argument("--repo", choices=[FIXED_REPO], required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--stamp", required=True)
    cli = parser.parse_args()
    if cli.pr < 1 or not re.fullmatch(r"\d{8}T\d{9}", cli.stamp):
        raise SystemExit("collect-ship-gate-packet: PR number or fixed timestamp shape is invalid")
    if not cli.out_dir.is_absolute() or not cli.out_dir.is_dir():
        raise SystemExit("collect-ship-gate-packet: output directory must be an existing absolute directory")
    target = cli.out_dir / f"codex-gate-packet-pr-{cli.pr}-{cli.stamp}.json"
    token: str | None = None
    try:
        token = fixed_installation_token()
        snapshot = collect_pr_snapshot(http_json, API, token, cli.repo, cli.pr, require_patch=True)
        written = write_packet(target, snapshot, repo=cli.repo, pr=cli.pr)
    except Exception as exc:  # noqa: BLE001 - fail closed at the privilege boundary
        raise SystemExit(f"collect-ship-gate-packet: {str(exc)[:600]}") from exc
    finally:
        token = None
    print(f"BLIP_GATE_PACKET={written}")
    print(f"BLIP_GATE_PACKET_BASE={snapshot['meta']['baseRefOid']}")
    print(f"BLIP_GATE_PACKET_HEAD={snapshot['meta']['headRefOid']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
