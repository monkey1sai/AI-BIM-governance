#!/usr/bin/env python3
"""Check the lifecycle contract's machine consistency and source synchronization."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate architecture/lifecycle-contract.json: well-formed state machines, "
            "forbidden shortcuts without direct edges, evidence reference integrity, state "
            "sets synchronized with the owning TypeScript unions, and a readiness binding "
            "matching the architecture contract."
        )
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root containing architecture/ and scripts/ (default: current directory).",
    )
    parser.add_argument(
        "--format",
        choices=("human", "json"),
        default="human",
        help="Output format (default: human).",
    )
    parser.add_argument(
        "--output",
        help="Optional output path. Stdout is still used when omitted.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as a failing result in addition to errors.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    repo_root = Path(args.repo_root).resolve()
    sys.path.insert(0, str(repo_root))

    try:
        from scripts.lib.lifecycle_contracts import check_lifecycle_contracts
    except ModuleNotFoundError as exc:
        print(
            f"ERROR: could not import scripts.lib.lifecycle_contracts from {repo_root}: {exc}",
            file=sys.stderr,
        )
        return 2

    result = check_lifecycle_contracts(repo_root)
    if args.format == "json":
        rendered = json.dumps(result.to_dict(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    else:
        lines = [
            f"Lifecycle contracts: {result.status.upper()}",
            f"Repository: {result.repo_root}",
            f"Machines: {result.machine_count}; states: {result.state_count}; "
            f"transitions: {result.transition_count}",
            f"Errors: {result.error_count}; Warnings: {result.warning_count}",
        ]
        if result.issues:
            lines.append("")
            for issue in result.issues:
                lines.append(f"[{issue.severity.upper()}] {issue.code} {issue.path}: {issue.message}")
        rendered = "\n".join(lines) + "\n"

    _emit(rendered, args.output, repo_root)
    failed = result.error_count > 0 or (args.strict and result.warning_count > 0)
    return 1 if failed else 0


def _emit(rendered: str, output: str | None, repo_root: Path) -> None:
    if output:
        path = Path(output)
        if not path.is_absolute():
            path = repo_root / path
        path.parent.mkdir(parents=True, exist_ok=True)
        # newline="" keeps the LF endings the renderer produced, so the same tree
        # yields a byte-identical file on Windows and Linux.
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(rendered)
    else:
        sys.stdout.write(rendered)


if __name__ == "__main__":
    raise SystemExit(main())
