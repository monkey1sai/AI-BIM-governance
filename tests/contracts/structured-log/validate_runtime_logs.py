"""Validate production structured-log JSONL artifacts.

The report is deliberately metadata-only: it identifies files and line
numbers, aggregates event counts, and reports redaction violations without
serializing the source record or any environment value.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import datetime as dt
import json
from pathlib import Path
import re
import sys
from typing import Iterable, Sequence

from jsonschema import Draft7Validator


SCHEMA_PATH = Path(__file__).with_name("schema.json")
SECRET_KEY_TERMS = ("TOKEN", "SECRET", "KEY", "PASSWORD", "AUTH", "CREDENTIAL")
REDACTION_MARKER_PATTERN = re.compile(
    r"^\[REDACTED:type=(?:string|number|boolean|null|object|array), len=\d+\]$"
)
RUN_ID_PATTERN = re.compile(r"^run_\d{8}_\d{6}_[0-9a-f]{6}$")
DATE_DIRECTORY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CAMEL_LOWER_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
CAMEL_ACRONYM_BOUNDARY = re.compile(r"(?<=[A-Z])(?=[A-Z][a-z])")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate structured-log runtime JSONL with the canonical schema."
    )
    parser.add_argument("--log-root", type=Path, required=True)
    parser.add_argument("--trace-id", required=True)
    parser.add_argument(
        "--require-services",
        nargs="+",
        required=True,
        metavar="SERVICE",
        help="Required services, separated by spaces or commas.",
    )
    parser.add_argument(
        "--require-one-env-snapshot-per-run",
        action="store_true",
        help="Require exactly one env_snapshot for every observed (service, run_id).",
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser


def _normalize_services(values: Iterable[str]) -> tuple[str, ...]:
    services: list[str] = []
    for value in values:
        for service in value.split(","):
            stripped = service.strip()
            if stripped and stripped not in services:
                services.append(stripped)
    return tuple(services)


def _relative_file(path: Path, log_root: Path) -> str:
    try:
        return path.relative_to(log_root).as_posix()
    except ValueError:
        return path.name


def _violation(file: str, line: int, code: str) -> dict[str, object]:
    return {"file": file, "line": line, "code": code}


def _is_redaction_marker(value: object, *, allow_plain: bool) -> bool:
    return isinstance(value, str) and (
        (allow_plain and value == "[REDACTED]")
        or REDACTION_MARKER_PATTERN.fullmatch(value) is not None
    )


def is_secret_key_name(name: str) -> bool:
    """Match documented secret tokens without arbitrary substring matches.

    Separators and camel-case transitions create token boundaries (for example
    ``API_KEY`` and ``authHeader``). Acronym-to-word transitions also preserve
    the AUTH token in ``OAuthHeader`` and ``JWTAuthHeader``. A terminal token
    supports concatenated forms such as ``APIKEY``; unrelated interior
    fragments in ``monkey_name`` and ``keyboard_layout`` stay clean.
    """

    normalized = name.upper()
    segmented = CAMEL_ACRONYM_BOUNDARY.sub("_", name)
    segmented = CAMEL_LOWER_BOUNDARY.sub("_", segmented)
    tokens = {
        token
        for token in re.split(r"[^A-Z0-9]+", segmented.upper())
        if token
    }
    return any(
        term in tokens or normalized.endswith(term) for term in SECRET_KEY_TERMS
    )


def _scan_generic_redaction(
    value: object, file: str, line_number: int
) -> list[dict[str, object]]:
    violations: list[dict[str, object]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(key, str) and is_secret_key_name(key):
                if not _is_redaction_marker(child, allow_plain=True):
                    violations.append(
                        {
                            "file": file,
                            "line": line_number,
                            "code": "raw_secret_value",
                        }
                    )
                if _is_redaction_marker(child, allow_plain=True):
                    continue
            violations.extend(_scan_generic_redaction(child, file, line_number))
    elif isinstance(value, list):
        for child in value:
            violations.extend(_scan_generic_redaction(child, file, line_number))
    return violations


def _redaction_violations(
    record: object, file: str, line_number: int
) -> list[dict[str, object]]:
    if not isinstance(record, dict):
        return []
    data = record.get("data")
    if not isinstance(data, dict):
        return []

    if record.get("event_type") != "env_snapshot":
        return _scan_generic_redaction(data, file, line_number)

    variables = data.get("vars")
    generic_data = {key: value for key, value in data.items() if key != "vars"}
    violations = _scan_generic_redaction(generic_data, file, line_number)
    if not isinstance(variables, list):
        return violations

    for variable in variables:
        if not isinstance(variable, dict):
            continue
        key = variable.get("key")
        value = variable.get("value_or_redacted")
        if (
            isinstance(key, str)
            and is_secret_key_name(key)
            and not _is_redaction_marker(value, allow_plain=False)
        ):
            violations.append(
                {"file": file, "line": line_number, "code": "raw_secret_value"}
            )
    return violations


def _path_contract(
    path: Path, log_root: Path
) -> tuple[tuple[str, str] | None, list[dict[str, object]]]:
    file_name = _relative_file(path, log_root)
    try:
        relative = path.relative_to(log_root)
    except ValueError:
        return None, [_violation(file_name, 0, "outside_log_root")]
    if len(relative.parts) != 3:
        return None, [_violation(file_name, 0, "invalid_path_layout")]

    service, date_text, filename = relative.parts
    if not DATE_DIRECTORY_PATTERN.fullmatch(date_text):
        return None, [_violation(file_name, 0, "invalid_path_date")]
    try:
        parsed_date = dt.date.fromisoformat(date_text)
    except ValueError:
        return None, [_violation(file_name, 0, "invalid_path_date")]
    if parsed_date.isoformat() != date_text:
        return None, [_violation(file_name, 0, "invalid_path_date")]

    prefix = f"{service}-"
    if not filename.startswith(prefix) or not filename.endswith(".jsonl"):
        return None, [_violation(file_name, 0, "invalid_path_filename")]
    run_id = filename[len(prefix) : -len(".jsonl")]
    if RUN_ID_PATTERN.fullmatch(run_id) is None:
        return None, [_violation(file_name, 0, "invalid_path_filename")]
    return (service, run_id), []


def _has_symlink_component(path: Path, log_root: Path) -> bool:
    current = path
    while True:
        if current.is_symlink():
            return True
        if current == log_root:
            return False
        if current.parent == current:
            return False
        current = current.parent


def _is_contained(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _discover_jsonl_files(log_root: Path) -> list[Path]:
    return sorted(
        path
        for path in log_root.rglob("*.jsonl")
        if path.is_file() or path.is_symlink()
    )


def _output_is_unsafe(output: Path, log_root: Path, files: Sequence[Path]) -> bool:
    if output.is_symlink():
        return True
    resolved_output = output.resolve(strict=False)
    resolved_root = log_root.resolve(strict=False)
    if _is_contained(resolved_output, resolved_root):
        return True
    for path in files:
        if resolved_output == path.resolve(strict=False):
            return True
        if output.exists():
            try:
                if output.samefile(path):
                    return True
            except OSError:
                continue
    return False


def validate_runtime_logs(
    *,
    log_root: Path,
    trace_id: str,
    require_services: Sequence[str],
    require_one_env_snapshot_per_run: bool,
    files: Sequence[Path] | None = None,
) -> dict[str, object]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    validator = Draft7Validator(schema)

    input_files = list(files) if files is not None else _discover_jsonl_files(log_root)
    file_names = [_relative_file(path, log_root) for path in input_files]
    line_counts: dict[str, int] = {}
    event_counts: dict[str, Counter[str]] = defaultdict(Counter)
    violations: list[dict[str, object]] = []
    redaction_violations: list[dict[str, object]] = []
    services_with_consistent_records: set[str] = set()
    services_with_trace: set[str] = set()
    observed_runs: dict[tuple[str, str], str] = {}
    env_counts: Counter[tuple[str, str]] = Counter()

    resolved_root = log_root.resolve(strict=False)
    for path in input_files:
        file_name = _relative_file(path, log_root)
        line_count = 0
        if _has_symlink_component(path, log_root):
            violations.append(_violation(file_name, 0, "symlink_input"))
            line_counts[file_name] = 0
            continue
        resolved_path = path.resolve(strict=False)
        if not _is_contained(resolved_path, resolved_root):
            violations.append(_violation(file_name, 0, "outside_log_root"))
            line_counts[file_name] = 0
            continue

        path_metadata, path_violations = _path_contract(path, log_root)
        violations.extend(path_violations)
        with path.open("rb") as stream:
            for line_number, binary_line in enumerate(stream, start=1):
                line_count = line_number
                try:
                    line = binary_line.decode("utf-8")
                except UnicodeDecodeError:
                    violations.append(_violation(file_name, line_number, "invalid_utf8"))
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    violations.append(
                        _violation(file_name, line_number, "malformed_json")
                    )
                    continue

                redaction_violations.extend(
                    _redaction_violations(record, file_name, line_number)
                )
                if list(validator.iter_errors(record)):
                    violations.append(
                        _violation(file_name, line_number, "schema_validation")
                    )
                    continue

                service = record["service"]
                run_id = record["run_id"]
                event_type = record["event_type"]
                if path_metadata is None:
                    continue
                path_service, path_run_id = path_metadata
                record_consistent = True
                if service != path_service:
                    violations.append(
                        _violation(file_name, line_number, "path_service_mismatch")
                    )
                    record_consistent = False
                if run_id != path_run_id:
                    violations.append(
                        _violation(file_name, line_number, "path_run_id_mismatch")
                    )
                    record_consistent = False
                if not record_consistent:
                    continue

                services_with_consistent_records.add(service)
                event_counts[service][event_type] += 1
                observed_runs.setdefault((service, run_id), file_name)
                if record["trace_id"] == trace_id:
                    services_with_trace.add(service)
                if event_type == "env_snapshot":
                    env_counts[(service, run_id)] += 1
        line_counts[file_name] = line_count

    for service in require_services:
        if service not in services_with_consistent_records:
            violations.append(_violation(service, 0, "missing_service"))
        elif service not in services_with_trace:
            violations.append(_violation(service, 0, "missing_trace_service"))

    if require_one_env_snapshot_per_run:
        for run_key, file_name in sorted(observed_runs.items()):
            if env_counts[run_key] != 1:
                violations.append(_violation(file_name, 0, "env_snapshot_count"))

    report: dict[str, object] = {
        "files": file_names,
        "line_counts": line_counts,
        "event_counts": {
            service: dict(sorted(counts.items()))
            for service, counts in sorted(event_counts.items())
        },
        "violations": violations,
        "redaction_violations": redaction_violations,
    }
    return report


def _write_report(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    require_services = _normalize_services(args.require_services)
    log_root = args.log_root.resolve(strict=False)
    files = _discover_jsonl_files(log_root)
    if _output_is_unsafe(args.output, log_root, files):
        print("unsafe_output", file=sys.stderr)
        return 2
    report = validate_runtime_logs(
        log_root=log_root,
        trace_id=args.trace_id,
        require_services=require_services,
        require_one_env_snapshot_per_run=args.require_one_env_snapshot_per_run,
        files=files,
    )
    _write_report(args.output, report)
    return 1 if report["violations"] or report["redaction_violations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
