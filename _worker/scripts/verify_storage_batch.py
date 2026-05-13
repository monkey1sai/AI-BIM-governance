from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_ROOT))

from app.batch_verification import run_storage_batch_verification
from app.settings import Settings


def main() -> int:
    parser = argparse.ArgumentParser(description="Run worker storage/*.ifc batch verification.")
    parser.add_argument("--dry-run", action="store_true", help="List selected fixtures without converting them.")
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of fixtures to process.")
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=600.0,
        help="Per-fixture timeout for real conversion runs.",
    )
    args = parser.parse_args()

    payload = run_storage_batch_verification(
        Settings.from_env(),
        limit=args.limit,
        dry_run=args.dry_run,
        timeout_seconds=None if args.dry_run else args.timeout_seconds,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if payload["status"] in {"failed", "timed_out"}:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
