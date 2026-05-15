from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_ROOT))

from app.batch_queue import (
    batch_queue_status,
    cleanup_batch_scratch,
    enqueue_batch_queue,
    retry_batch_queue,
    run_next_batch_queue,
    summarize_batch_queue,
)
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
    parser.add_argument(
        "--profile-source-entities",
        action="store_true",
        help="Collect fine-grained source entity enumeration timings for verification evidence.",
    )
    parser.add_argument(
        "--enqueue",
        action="store_true",
        help="Build/refresh the persisted batch_queue.json manifest from the IFC source listing (idempotent).",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print read-only batch queue progress from the persisted manifest.",
    )
    parser.add_argument(
        "--run-next",
        action="store_true",
        help="Dispatch exactly one pending fixture via the persisted queue (short-lived, no drain).",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Compute outcome_distribution + minimum_coverage_locked from the persisted manifest.",
    )
    parser.add_argument(
        "--retry",
        metavar="SOURCE_ID",
        default=None,
        help="Explicitly reset one recorded-failure (failed/timed_out) row back to pending.",
    )
    parser.add_argument(
        "--cleanup-scratch",
        action="store_true",
        help="Idempotently remove the canonical-verification scratch tenant tree (throwaway evidence).",
    )
    args = parser.parse_args()

    # Queue subcommands are additive and short-circuit before the existing
    # monolithic path; the one-shot CLI (--limit / --timeout-seconds /
    # --profile-source-entities) keeps working unchanged (design Decision 6).
    if args.enqueue:
        manifest = enqueue_batch_queue(Settings.from_env())
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        print(
            f"enqueued: manifest_version={manifest['manifest_version']} "
            f"fixtures={len(manifest['fixtures'])}"
        )
        return 0
    if args.status:
        status_payload = batch_queue_status(Settings.from_env())
        print(json.dumps(status_payload, ensure_ascii=False, indent=2))
        return 0
    if args.run_next:
        outcome = run_next_batch_queue(
            Settings.from_env(),
            timeout_seconds=args.timeout_seconds,
            profile_source_entities=args.profile_source_entities,
        )
        print(json.dumps(outcome, ensure_ascii=False, indent=2))
        return 0 if outcome.get("dispatched") or outcome.get("all_dispatched") else 1
    if args.summary:
        summary = summarize_batch_queue(Settings.from_env())
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    if args.retry:
        result = retry_batch_queue(Settings.from_env(), args.retry)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("retried") else 1
    if args.cleanup_scratch:
        cleaned = cleanup_batch_scratch(Settings.from_env())
        print(json.dumps(cleaned, ensure_ascii=False, indent=2))
        return 0

    payload = run_storage_batch_verification(
        Settings.from_env(),
        limit=args.limit,
        dry_run=args.dry_run,
        timeout_seconds=None if args.dry_run else args.timeout_seconds,
        profile_source_entities=args.profile_source_entities,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    distribution = payload.get("outcome_distribution")
    if isinstance(distribution, dict):
        total = distribution.get("total")
        parts = [f"total={total}"]
        for bucket in (
            "passed",
            "passed_with_quality_warning",
            "timed_out",
            "failed",
            "blocked",
        ):
            entry = distribution.get(bucket)
            if isinstance(entry, dict):
                parts.append(f"{bucket}={entry.get('count')}")
        print(
            "outcome_distribution: "
            + " ".join(parts)
            + f" minimum_coverage_locked={payload.get('minimum_coverage_locked')}"
        )
    if payload["status"] in {"failed", "timed_out"}:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
