#!/usr/bin/env python3
"""Publish the architecture quality snapshot: gate statuses, debt, and grade."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Aggregate the observed-graph, layer-boundary, lifecycle, and learning-ledger "
            "gates into one deterministic quality snapshot with an explainable grade "
            "(A: all green, no debt; B: all green, attributed debt remains; C: a gate "
            "fails). The report never repairs anything."
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
        help="Treat learning-ledger warnings as a failing result in addition to errors, "
        "matching the sibling checkers. The grade itself never fails the run; only a "
        "failing gate or an unreadable baseline does.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    repo_root = Path(args.repo_root).resolve()
    sys.path.insert(0, str(repo_root))

    try:
        from scripts.lib.architecture_learning import build_quality_report
    except ModuleNotFoundError as exc:
        print(
            f"ERROR: could not import scripts.lib.architecture_learning from {repo_root}: {exc}",
            file=sys.stderr,
        )
        return 2

    report, aggregation_issues = build_quality_report(repo_root)
    failed = (
        not report.all_gates_passed
        or bool(aggregation_issues)
        or (args.strict and report.ledger.warning_count > 0)
    )

    if args.format == "json":
        payload = report.to_dict()
        payload["aggregation_issues"] = [issue.to_dict() for issue in aggregation_issues]
        payload["cli_status"] = "failed" if failed else "passed"
        payload["strict"] = args.strict
        rendered = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    else:
        lines = [
            f"Architecture quality: grade {report.grade} ({'FAILED' if failed else 'OK'})",
            f"Repository: {report.repo_root}",
        ]
        for name, status in report.gates:
            lines.append(f"  gate {name}: {status}")
        for name, count in report.debt:
            lines.append(f"  debt {name}: {count}")
        lines.append(f"  total attributed debt: {report.total_debt}")
        for issue in aggregation_issues:
            lines.append(f"[{issue.severity.upper()}] {issue.code} {issue.path}: {issue.message}")
        for issue in report.ledger.issues:
            lines.append(f"[{issue.severity.upper()}] {issue.code} {issue.path}: {issue.message}")
        rendered = "\n".join(lines) + "\n"

    _emit(rendered, args.output, repo_root)
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
