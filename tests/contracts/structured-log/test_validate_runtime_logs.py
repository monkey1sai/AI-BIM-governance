"""Contract tests for the production structured-log runtime validator."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


HERE = Path(__file__).resolve().parent
VALIDATOR_PATH = HERE / "validate_runtime_logs.py"
TRACE_ID = "ifcready_1779687625000_064c6813"
SERVICES = ("coordinator", "streaming-server", "viewer", "scripts")
DATE = "2026-07-24"


def _load_validator_module():
    spec = importlib.util.spec_from_file_location(
        "structured_log_runtime_validator", VALIDATOR_PATH
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


validator_module = _load_validator_module()


def _record(
    service: str,
    run_id: str,
    *,
    event_type: str,
    trace_id: str = TRACE_ID,
) -> dict[str, object]:
    base: dict[str, object] = {
        "ts": "2026-07-24T08:30:00.000Z",
        "level": "info",
        "event_type": event_type,
        "service": service,
        "component": "runtime-evidence",
        "run_id": run_id,
        "trace_id": trace_id,
        "msg": f"{service} {event_type}",
        "data": {},
    }
    if event_type == "env_snapshot":
        base["data"] = {
            "vars": [
                {
                    "key": "INTERNAL_API_TOKEN",
                    "source": "system",
                    "value_or_redacted": "[REDACTED:type=string, len=16]",
                    "type": "string",
                }
            ]
        }
    elif event_type == "lifecycle":
        base["data"] = {
            "phase": "active",
            "subject_kind": "ifc_ready_job",
            "subject_id": TRACE_ID,
        }
    return base


def _run_id(service_index: int, suffix: int = 0) -> str:
    return f"run_20260724_08300{service_index}_{service_index:05x}{suffix:x}"


def _write_service_run(
    log_root: Path,
    service: str,
    service_index: int,
    *,
    env_count: int = 1,
    trace_id: str = TRACE_ID,
    run_id: str | None = None,
) -> Path:
    effective_run_id = run_id or _run_id(service_index)
    path = (
        log_root
        / service
        / DATE
        / f"{service}-{effective_run_id}.jsonl"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    records = [
        _record(
            service,
            effective_run_id,
            event_type="env_snapshot",
            # The scripts logger exists before intake returns the root trace.
            trace_id=(f"script_{effective_run_id}" if service == "scripts" else trace_id),
        )
        for _ in range(env_count)
    ]
    records.append(
        _record(
            service,
            effective_run_id,
            event_type="lifecycle",
            trace_id=trace_id,
        )
    )
    path.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )
    return path


def _four_service_log_root(tmp_path: Path) -> Path:
    log_root = tmp_path / "logs"
    for index, service in enumerate(SERVICES, start=1):
        _write_service_run(log_root, service, index)
    return log_root


def _invoke(log_root: Path, output: Path, services: tuple[str, ...] = SERVICES):
    completed = _run_cli(log_root, output, services)
    result = json.loads(output.read_text(encoding="utf-8"))
    return completed, result, output.read_text(encoding="utf-8")


def _run_cli(log_root: Path, output: Path, services: tuple[str, ...] = SERVICES):
    command = [
        sys.executable,
        str(VALIDATOR_PATH),
        "--log-root",
        str(log_root),
        "--trace-id",
        TRACE_ID,
        "--require-services",
        *services,
        "--require-one-env-snapshot-per-run",
        "--output",
        str(output),
    ]
    return subprocess.run(command, capture_output=True, text=True, check=False)


def _violation_codes(result: dict[str, object]) -> list[str]:
    return [item["code"] for item in result["violations"]]


def test_help_exposes_runtime_evidence_flags():
    completed = subprocess.run(
        [sys.executable, str(VALIDATOR_PATH), "--help"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0
    for flag in (
        "--log-root",
        "--trace-id",
        "--require-services",
        "--require-one-env-snapshot-per-run",
        "--output",
    ):
        assert flag in completed.stdout


def test_success_validates_actual_four_service_log_layout(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    output = tmp_path / "runtime-log-validation.json"

    completed, result, serialized = _invoke(log_root, output)

    assert completed.returncode == 0, completed.stderr
    assert set(result) == {
        "files",
        "line_counts",
        "event_counts",
        "violations",
        "redaction_violations",
    }
    assert len(result["files"]) == 4
    assert sum(result["line_counts"].values()) == 8
    assert result["event_counts"] == {
        service: {"env_snapshot": 1, "lifecycle": 1} for service in SERVICES
    }
    assert result["violations"] == []
    assert result["redaction_violations"] == []
    assert "INTERNAL_API_TOKEN" not in serialized
    assert "[REDACTED:type=string, len=16]" not in serialized


def test_malformed_json_reports_file_and_line_without_raw_content(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    with target.open("a", encoding="utf-8") as stream:
        stream.write('{"raw_secret":"must-not-leak"\n')

    completed, result, serialized = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "malformed_json" in _violation_codes(result)
    malformed = next(
        item for item in result["violations"] if item["code"] == "malformed_json"
    )
    assert malformed["line"] == 3
    assert "must-not-leak" not in serialized


def test_schema_failure_is_nonzero_and_does_not_echo_record(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "viewer" / DATE).glob("*.jsonl"))
    invalid = _record("viewer", _run_id(3), event_type="lifecycle")
    invalid.pop("msg")
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(invalid) + "\n")

    completed, result, serialized = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "schema_validation" in _violation_codes(result)
    assert TRACE_ID not in serialized


def test_missing_required_service_is_nonzero(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    viewer_dir = log_root / "viewer"
    for path in viewer_dir.rglob("*.jsonl"):
        path.unlink()

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "missing_service" in _violation_codes(result)


def test_wrong_trace_for_required_service_is_nonzero(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "viewer" / DATE).glob("*.jsonl"))
    records = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()]
    for record in records:
        record["trace_id"] = "ifcready_different_root"
    target.write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "missing_trace_service" in _violation_codes(result)


@pytest.mark.parametrize("env_count", [0, 2], ids=["missing", "duplicate"])
def test_requires_exactly_one_env_snapshot_per_service_run(
    tmp_path: Path, env_count: int
):
    log_root = _four_service_log_root(tmp_path)
    second_run_id = _run_id(1, suffix=1)
    _write_service_run(
        log_root,
        "coordinator",
        1,
        run_id=second_run_id,
        env_count=env_count,
    )

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    matches = [
        item
        for item in result["violations"]
        if item["code"] == "env_snapshot_count"
    ]
    assert len(matches) == 1


def test_secret_pattern_raw_value_is_redaction_violation_and_never_echoed(
    tmp_path: Path,
):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "streaming-server" / DATE).glob("*.jsonl"))
    records = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()]
    raw_value = "raw-value-must-never-appear"
    records[0]["data"]["vars"][0]["value_or_redacted"] = raw_value
    target.write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )

    completed, result, serialized = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert len(result["redaction_violations"]) == 1
    assert result["redaction_violations"][0]["line"] == 1
    assert raw_value not in serialized


def test_validator_uses_canonical_schema_artifact():
    assert validator_module.SCHEMA_PATH == HERE / "schema.json"


def test_output_cannot_overwrite_an_input_jsonl(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    source = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    original = source.read_bytes()

    completed = _run_cli(log_root, source)

    assert completed.returncode != 0
    assert source.read_bytes() == original


def test_output_cannot_be_created_anywhere_inside_log_root(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    output = log_root / "runtime-log-validation.json"

    completed = _run_cli(log_root, output)

    assert completed.returncode != 0
    assert not output.exists()


def test_record_service_must_match_service_directory_before_counting(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    records = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()]
    for record in records:
        record["service"] = "viewer"
    target.write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "path_service_mismatch" in _violation_codes(result)
    assert "missing_service" in _violation_codes(result)
    assert "coordinator" not in result["event_counts"]
    assert result["event_counts"]["viewer"] == {
        "env_snapshot": 1,
        "lifecycle": 1,
    }


def test_log_directory_date_must_be_a_real_calendar_date(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    valid_dir = log_root / "viewer" / DATE
    invalid_dir = log_root / "viewer" / "2026-02-30"
    valid_dir.rename(invalid_dir)

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "invalid_path_date" in _violation_codes(result)
    assert "missing_service" in _violation_codes(result)
    assert "viewer" not in result["event_counts"]


def test_filename_run_id_must_match_every_record_before_counting(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "streaming-server" / DATE).glob("*.jsonl"))
    wrong_name = target.with_name(
        f"streaming-server-{_run_id(2, suffix=1)}.jsonl"
    )
    target.rename(wrong_name)

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "path_run_id_mismatch" in _violation_codes(result)
    assert "missing_service" in _violation_codes(result)
    assert "streaming-server" not in result["event_counts"]


def test_nested_generic_secret_keys_in_dicts_and_lists_require_redaction(
    tmp_path: Path,
):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    raw_value = "nested-raw-value-must-not-leak"
    record = _record("coordinator", _run_id(1), event_type="general")
    record["data"] = {"outer": [{"api_token": raw_value}]}
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record) + "\n")

    completed, result, serialized = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert result["redaction_violations"] == [
        {"code": "raw_secret_value", "file": result["files"][0], "line": 3}
    ]
    assert raw_value not in serialized


def test_nested_generic_secret_keys_accept_plain_and_typed_markers(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    plain = _record("coordinator", _run_id(1), event_type="general")
    plain["data"] = {"nested": [{"password": "[REDACTED]"}]}
    typed = _record("coordinator", _run_id(1), event_type="general")
    typed["data"] = {"nested": {"auth_token": "[REDACTED:type=string, len=3]"}}
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(plain) + "\n")
        stream.write(json.dumps(typed) + "\n")

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode == 0
    assert result["redaction_violations"] == []


def test_invalid_utf8_is_a_line_violation_instead_of_a_crash(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "viewer" / DATE).glob("*.jsonl"))
    with target.open("ab") as stream:
        stream.write(b'{"payload":"raw-byte-prefix-\xff-raw-byte-suffix"}\n')

    completed, result, serialized = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    violation = next(
        item for item in result["violations"] if item["code"] == "invalid_utf8"
    )
    assert violation["line"] == 3
    assert "raw-byte-prefix" not in serialized
    assert "raw-byte-suffix" not in serialized
    assert "\\ufffd" not in serialized


def test_symlink_jsonl_input_is_rejected_without_reading_target(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    outside = tmp_path / "outside.jsonl"
    outside.write_text("raw-outside-content-must-not-leak\n", encoding="utf-8")
    link = (
        log_root
        / "coordinator"
        / DATE
        / f"coordinator-{_run_id(1, suffix=1)}.jsonl"
    )
    try:
        link.symlink_to(outside)
    except OSError as error:
        pytest.skip(f"symlink creation unavailable on this Windows host: {error}")

    completed, result, serialized = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "symlink_input" in _violation_codes(result)
    assert "raw-outside-content-must-not-leak" not in serialized


def test_dangling_symlink_jsonl_input_is_also_rejected(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    link = (
        log_root
        / "scripts"
        / DATE
        / f"scripts-{_run_id(4, suffix=1)}.jsonl"
    )
    try:
        link.symlink_to(tmp_path / "missing-target.jsonl")
    except OSError as error:
        pytest.skip(f"symlink creation unavailable on this Windows host: {error}")

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert "symlink_input" in _violation_codes(result)


def test_existing_output_hardlink_to_input_is_rejected_by_filesystem_identity(
    tmp_path: Path,
):
    log_root = _four_service_log_root(tmp_path)
    source = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    original = source.read_bytes()
    output = tmp_path / "external-hardlink-result.json"
    try:
        os.link(source, output)
    except OSError as error:
        pytest.skip(f"hardlink creation unavailable on this Windows host: {error}")

    completed = _run_cli(log_root, output)

    assert completed.returncode != 0
    assert source.read_bytes() == original
    assert output.read_bytes() == original


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("API_KEY", True),
        ("APIKEY", True),
        ("INTERNAL_API_TOKEN", True),
        ("accessToken", True),
        ("DB_PASSWORD", True),
        ("CLIENT_AUTH", True),
        ("SERVICE_CREDENTIAL", True),
        ("authHeader", True),
        ("tokenValue", True),
        ("secretValue", True),
        ("passwordHash", True),
        ("credentialId", True),
        ("OAuthHeader", True),
        ("JWTAuthHeader", True),
        ("monkey_name", False),
        ("keyboard_layout", False),
        ("secretariat_name", False),
        ("authentication_mode", False),
    ],
)
def test_secret_key_matcher_uses_tokens_and_suffixes(
    key: str, expected: bool
):
    assert validator_module.is_secret_key_name(key) is expected


def test_api_key_forms_with_raw_values_are_rejected_without_value_disclosure(
    tmp_path: Path,
):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    first_raw = "first-api-key-raw-value"
    second_raw = "second-api-key-raw-value"
    record = _record("coordinator", _run_id(1), event_type="general")
    record["data"] = {"API_KEY": first_raw, "APIKEY": second_raw}
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record) + "\n")

    completed, result, serialized = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert len(result["redaction_violations"]) == 2
    assert first_raw not in serialized
    assert second_raw not in serialized


def test_non_secret_key_substrings_remain_clean_in_generic_data(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    record = _record("coordinator", _run_id(1), event_type="general")
    record["data"] = {
        "monkey_name": "capuchin",
        "keyboard_layout": "zh-TW",
    }
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record) + "\n")

    completed, result, _ = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode == 0
    assert result["redaction_violations"] == []


def test_raw_camel_and_acronym_secret_keys_are_rejected(tmp_path: Path):
    log_root = _four_service_log_root(tmp_path)
    target = next((log_root / "coordinator" / DATE).glob("*.jsonl"))
    secret_keys = (
        "authHeader",
        "tokenValue",
        "secretValue",
        "passwordHash",
        "credentialId",
        "OAuthHeader",
        "JWTAuthHeader",
    )
    raw_values = {key: f"raw-value-{index}" for index, key in enumerate(secret_keys)}
    record = _record("coordinator", _run_id(1), event_type="general")
    record["data"] = raw_values
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record) + "\n")

    completed, result, serialized = _invoke(log_root, tmp_path / "result.json")

    assert completed.returncode != 0
    assert len(result["redaction_violations"]) == len(secret_keys)
    for raw_value in raw_values.values():
        assert raw_value not in serialized
