#!/usr/bin/env python3
"""Check language-level layer boundaries and enforce the ratchet against the baseline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Classify statically scanned modules into architecture layers and compare the "
            "resulting cross-layer violations against architecture/layer-baseline.json."
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
        "--report-only",
        action="store_true",
        help=(
            "Write the observed layer report without applying the baseline ratchet. "
            "The report is always JSON, so --format is ignored; the baseline comparison "
            "never runs, so --strict is ignored. Unreadable or unparseable sources still "
            "fail, because a report built from a partial scan is not a report."
        ),
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help=(
            "Treat warnings as a failing result in addition to errors. Ignored with "
            "--report-only, which performs no comparison."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    repo_root = Path(args.repo_root).resolve()
    sys.path.insert(0, str(repo_root))

    try:
        from scripts.lib.layered_architecture import (
            _load_layer_contract,
            build_layer_report,
            check_layered_architecture,
            render_layer_report_json,
        )
        from scripts.lib.observed_architecture import _load_config as _load_observed_config
    except ModuleNotFoundError as exc:
        print(
            f"ERROR: could not import scripts.lib.layered_architecture from {repo_root}: {exc}",
            file=sys.stderr,
        )
        return 2

    if args.report_only:
        observed_config, observed_issues = _load_observed_config(repo_root)
        contract, contract_issues = _load_layer_contract(repo_root)
        blocking = [
            issue
            for issue in list(observed_issues) + list(contract_issues)
            if issue.severity == "error"
        ]
        if observed_config is None or contract is None or blocking:
            for issue in blocking:
                print(f"[ERROR] {issue.code} {issue.path}: {issue.message}", file=sys.stderr)
            return 1
        report = build_layer_report(repo_root, observed_config, contract)
        # A report produced from a scan that could not read part of the tree
        # understates the module graph. Emitting it with exit 0 would let a
        # partial scan be committed as a baseline.
        read_failures = report.read_failures()
        rendered = render_layer_report_json(report)
        _emit(rendered, args.output, repo_root)
        if read_failures:
            for issue in read_failures:
                print(f"[ERROR] {issue.code} {issue.path}: {issue.message}", file=sys.stderr)
            return 1
        return 0

    result = check_layered_architecture(repo_root)
    if args.format == "json":
        rendered = json.dumps(result.to_dict(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    else:
        report = result.report
        lines = [
            f"Layer boundary ratchet: {result.status.upper()}",
            f"Repository: {result.repo_root}",
            f"Scanned files: {report.scanned_file_count if report else 0}",
            f"Layered services: {len(report.services) if report else 0}; "
            f"violations: {len(report.violations) if report else 0}",
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
