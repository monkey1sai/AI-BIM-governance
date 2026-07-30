#!/usr/bin/env python3
"""Validate the repository's executable architecture contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate architecture/architecture-contract.json and architecture/deltas/*.json."
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
        from scripts.lib.architecture_contract import validate_repository
    except ModuleNotFoundError as exc:
        print(
            f"ERROR: could not import scripts.lib.architecture_contract from {repo_root}: {exc}",
            file=sys.stderr,
        )
        return 2

    result = validate_repository(repo_root)
    payload = result.to_dict()
    if args.format == "json":
        rendered = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    else:
        lines = [
            f"Architecture contract validation: {result.status.upper()}",
            f"Repository: {result.repo_root}",
            f"Checked files: {len(result.checked_files)}",
            f"Errors: {result.error_count}; Warnings: {result.warning_count}",
        ]
        if result.issues:
            lines.append("")
            for issue in result.issues:
                lines.append(f"[{issue.severity.upper()}] {issue.code} {issue.path}: {issue.message}")
        rendered = "\n".join(lines) + "\n"

    if args.output:
        output = Path(args.output)
        if not output.is_absolute():
            output = repo_root / output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)

    failed = result.error_count > 0 or (args.strict and result.warning_count > 0)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
