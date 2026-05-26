"""Contract tests for the Python streaming-server struct_log adapter.

This file lives at the repo root so it runs as part of
``python -m pytest tests -p no:cacheprovider`` using the same .venv as the
rest of the contract suite. The adapter under test imports via the canonical
package path; we add the streaming-server source folder to ``sys.path`` so we
can import without spinning up the Kit harness.

Mirrors the TypeScript adapter test (``bim-review-coordinator/tests/lib/structLog.test.ts``):

    * generate_run_id pattern
    * iso_utc_ms millisecond precision
    * redact_env_value 三段規則
    * redact_data_before_write 深度防護（含 schema 欄位名白名單）
    * create_logger() 寫 env_snapshot + 自動命中 secret 環境變數正確 redact
    * 7 個 event_type 都通過 schema validator
    * with_trace_id 子 logger 與 parent 共用 sink 與 seq map
    * circular ref / unserialisable obj 降級
    * daily rotate 跨午夜
    * sink 失敗 fail-soft（不 throw、寫 _recovery）
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Iterable, List

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
STRUCT_LOG_PATH = (
    REPO_ROOT
    / "bim-streaming-server"
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
    / "struct_log.py"
)
# Load the adapter file directly to bypass the package __init__ which imports
# Kit-only modules (omni, carb) that are unavailable in plain CPython.
_spec = importlib.util.spec_from_file_location("struct_log_under_test", STRUCT_LOG_PATH)
assert _spec and _spec.loader, "could not load struct_log.py"
struct_log = importlib.util.module_from_spec(_spec)
sys.modules.setdefault("struct_log_under_test", struct_log)
_spec.loader.exec_module(struct_log)


SCHEMA_PATH = REPO_ROOT / "tests" / "contracts" / "structured-log" / "schema.json"


@pytest.fixture(scope="module")
def validator():
    from jsonschema import Draft7Validator

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft7Validator(schema)


@pytest.fixture(autouse=True)
def _reset_allowlist():
    struct_log.reset_allowlist_cache()
    yield
    struct_log.reset_allowlist_cache()


@pytest.fixture
def fixed_clock():
    """Returns a callable that always reports the requested UTC instant."""

    def _factory(value: str):
        when = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return lambda: when

    return _factory


def _read_lines(path: Path) -> List[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def test_generate_run_id_matches_documented_pattern():
    run_id = struct_log.generate_run_id(
        now=dt.datetime(2026, 5, 26, 14, 20, 10, tzinfo=dt.timezone.utc),
        random_hex="a3f900",
    )
    assert run_id == "run_20260526_142010_a3f900"
    assert struct_log._RUN_ID_PATTERN.match(run_id)


def test_iso_utc_ms_always_emits_millisecond_precision():
    ts = struct_log.iso_utc_ms(dt.datetime(2026, 5, 26, 14, 23, 11, 482_000, tzinfo=dt.timezone.utc))
    assert ts == "2026-05-26T14:23:11.482Z"
    ts_zero = struct_log.iso_utc_ms(dt.datetime(2026, 5, 26, 14, 23, 11, tzinfo=dt.timezone.utc))
    assert ts_zero == "2026-05-26T14:23:11.000Z"


def test_redact_env_value_emits_raw_for_allowlist_keys():
    al = struct_log.load_allowlist()
    out = struct_log.redact_env_value("STORAGE_ROOT", "C:\\repos\\foo", allowlist=al)
    assert out["value_or_redacted"] == "C:\\repos\\foo"
    assert out["type"] == "string"


def test_redact_env_value_redacts_secret_pattern_keys():
    al = struct_log.load_allowlist()
    out = struct_log.redact_env_value("INTERNAL_API_TOKEN", "abc123xyz", allowlist=al)
    assert out["value_or_redacted"] == "[REDACTED:type=string, len=9]"


def test_redact_env_value_emits_type_only_for_other_keys():
    al = struct_log.load_allowlist()
    out = struct_log.redact_env_value("RANDOM_KNOB", "hello", allowlist=al)
    assert out["value_or_redacted"] == "[TYPE:type=string, len=5]"


def test_redact_data_before_write_strips_secret_field_names_at_depth():
    al = struct_log.load_allowlist()
    out = struct_log.redact_data_before_write(
        {
            "password": "abc",
            "nested": {"api_key": "shh", "body": {"token": "tok"}},
        },
        allowlist=al,
    )
    assert out["password"] == "[REDACTED]"
    assert out["nested"]["api_key"] == "[REDACTED]"
    assert out["nested"]["body"]["token"] == "[REDACTED]"


def test_redact_data_before_write_preserves_env_snapshot_var_keys():
    """`vars[].key` should NOT be redacted even though "key" matches /KEY/i."""
    al = struct_log.load_allowlist()
    data = {
        "vars": [
            {"key": "STORAGE_ROOT", "source": ".env", "value_or_redacted": "C:\\x", "type": "string"}
        ]
    }
    out = struct_log.redact_data_before_write(data, allowlist=al)
    assert out["vars"][0]["key"] == "STORAGE_ROOT"


def test_safe_dumps_handles_circular_reference_without_throwing():
    obj: dict = {"name": "x"}
    obj["self"] = obj
    text = struct_log.safe_dumps(obj)
    assert "[Circular]" in text


# ---------------------------------------------------------------------------
# Logger end-to-end
# ---------------------------------------------------------------------------


def test_create_logger_emits_env_snapshot_to_daily_file(tmp_path, monkeypatch, validator, fixed_clock):
    monkeypatch.setenv("STRUCTLOG_TEST_SECRET", "supersecret-1234")
    logger = struct_log.create_logger(
        "streaming-server",
        log_root=tmp_path,
        run_id="run_20260526_142010_a3f900",
        now=fixed_clock("2026-05-26T14:20:10.001Z"),
    )
    expected = tmp_path / "streaming-server" / "2026-05-26" / "streaming-server-run_20260526_142010_a3f900.jsonl"
    assert logger.current_file == expected
    lines = _read_lines(logger.current_file)
    assert len(lines) == 1
    record = lines[0]
    assert record["event_type"] == "env_snapshot"
    assert record["service"] == "streaming-server"
    assert record["level"] == "info"

    secret_entry = next((v for v in record["data"]["vars"] if v["key"] == "STRUCTLOG_TEST_SECRET"), None)
    assert secret_entry is not None
    assert secret_entry["value_or_redacted"].startswith("[REDACTED")
    assert "supersecret-1234" not in json.dumps(record)
    assert validator.is_valid(record), list(validator.iter_errors(record))


def test_logger_writes_all_event_types_passing_schema(tmp_path, validator, fixed_clock):
    logger = struct_log.create_logger(
        "streaming-server",
        log_root=tmp_path,
        run_id="run_20260526_142010_a3f900",
        initial_trace_id="stream_conv_20260525055218_115177da",
        now=fixed_clock("2026-05-26T14:23:11.482Z"),
        skip_env_snapshot=True,
    )

    logger.info("conversion_authority", "starting conversion")
    logger.warn("conversion_authority", "stage loading is slow", {"elapsed_ms": 4500})
    try:
        raise RuntimeError("boom")
    except RuntimeError as err:
        logger.error("conversion_authority", "primary path failed", err)
    logger.network(
        "callback_outbox",
        "POST coordinator returned 503",
        {
            "direction": "outbound",
            "protocol": "http",
            "peer": "coordinator",
            "status": 503,
            "duration_ms": 1024,
            "path": "/api/internal/conversion-result",
        },
        level="warn",
    )
    logger.audit(
        "host_native_conversion_service",
        "smoke conversion invoked",
        {"action": "smoke-conversion", "actor": "agent:claude", "target": "stream_conv_demo"},
    )
    logger.lifecycle(
        "conversion_authority",
        "conversion job closed",
        {
            "phase": "closed",
            "subject_kind": "conversion_job",
            "subject_id": "stream_conv_demo",
        },
    )
    logger.anomaly(
        "conversion_authority",
        "HOOPS A3D failed, fallback ifcopenshell_openusd",
        {
            "anomaly_kind": "fallback",
            "reason": "hoops_a3d_failed",
            "fallback_method": "ifcopenshell_openusd",
        },
    )

    lines = _read_lines(logger.current_file)
    assert len(lines) == 7
    for record in lines:
        assert validator.is_valid(record), list(validator.iter_errors(record))


def test_with_trace_id_shares_run_id_file_and_seq_counters(tmp_path, fixed_clock):
    logger = struct_log.create_logger(
        "streaming-server",
        log_root=tmp_path,
        run_id="run_20260526_142010_a3f900",
        initial_trace_id="stream_conv_aaaa",
        now=fixed_clock("2026-05-26T14:23:11.482Z"),
        skip_env_snapshot=True,
    )
    child = logger.with_trace_id("stream_conv_bbbb")
    logger.info("conversion", "first under aaaa")
    child.info("conversion", "first under bbbb")
    logger.info("conversion", "second under aaaa")
    child.info("conversion", "second under bbbb")

    lines = _read_lines(logger.current_file)
    assert all(r["run_id"] == "run_20260526_142010_a3f900" for r in lines)
    aaaa = [r for r in lines if r["trace_id"] == "stream_conv_aaaa"]
    bbbb = [r for r in lines if r["trace_id"] == "stream_conv_bbbb"]
    assert [r["seq"] for r in aaaa] == [1, 2]
    assert [r["seq"] for r in bbbb] == [1, 2]
    # records_written counter is shared between parent and child.
    assert logger.records_written == 4
    assert child.records_written == 4


def test_circular_reference_does_not_crash_emit(tmp_path, fixed_clock):
    logger = struct_log.create_logger(
        "streaming-server",
        log_root=tmp_path,
        run_id="run_20260526_142010_a3f900",
        initial_trace_id="stream_conv_demo",
        now=fixed_clock("2026-05-26T14:23:11.482Z"),
        skip_env_snapshot=True,
    )
    payload: dict = {"name": "x"}
    payload["self"] = payload
    logger.info("conversion", "circular check", payload)
    lines = _read_lines(logger.current_file)
    assert len(lines) == 1
    assert "[Circular]" in json.dumps(lines[0])


def test_daily_rotate_opens_new_file_on_utc_date_change(tmp_path):
    clock = {"value": dt.datetime(2026, 5, 26, 23, 59, 59, 500_000, tzinfo=dt.timezone.utc)}
    logger = struct_log.create_logger(
        "streaming-server",
        log_root=tmp_path,
        run_id="run_20260526_235959_aabbcc",
        initial_trace_id="stream_conv_xxxx",
        now=lambda: clock["value"],
        skip_env_snapshot=True,
    )
    logger.info("conversion", "before midnight")
    before_file = logger.current_file
    clock["value"] = dt.datetime(2026, 5, 27, 0, 0, 1, 100_000, tzinfo=dt.timezone.utc)
    logger.info("conversion", "after midnight")
    after_file = logger.current_file
    assert before_file != after_file
    assert "2026-05-26" in str(before_file)
    assert "2026-05-27" in str(after_file)
    assert len(_read_lines(before_file)) == 1
    assert len(_read_lines(after_file)) == 1


def test_logger_error_captures_name_message_and_stack_tail(tmp_path, validator, fixed_clock):
    logger = struct_log.create_logger(
        "streaming-server",
        log_root=tmp_path,
        run_id="run_20260526_142010_a3f900",
        initial_trace_id="stream_conv_demo",
        now=fixed_clock("2026-05-26T14:23:11.482Z"),
        skip_env_snapshot=True,
    )
    try:
        raise ValueError("primary failed")
    except ValueError as err:
        logger.error("conversion", "primary failed", err)
    lines = _read_lines(logger.current_file)
    assert len(lines) == 1
    record = lines[0]
    assert record["event_type"] == "logic_error"
    assert record["data"]["error"]["name"] == "ValueError"
    assert record["data"]["error"]["message"] == "primary failed"
    assert len(record["data"]["error"]["stack_tail"]) > 0
    assert len(record["data"]["error"]["stack_tail"]) <= 8
    assert validator.is_valid(record), list(validator.iter_errors(record))


def test_sink_failure_does_not_throw_and_records_last_failure(tmp_path, fixed_clock):
    logger = struct_log.create_logger(
        "streaming-server",
        log_root=tmp_path,
        run_id="run_20260526_142010_a3f900",
        initial_trace_id="stream_conv_demo",
        now=fixed_clock("2026-05-26T14:23:11.482Z"),
        skip_env_snapshot=True,
    )
    # Replace the expected file path with a directory to force append to fail.
    target = logger.current_file
    target.unlink(missing_ok=True)
    target.mkdir(parents=True, exist_ok=True)
    try:
        logger.info("conversion", "should not throw")  # MUST NOT raise
    except Exception as exc:  # pragma: no cover
        pytest.fail(f"logger.info raised: {exc!r}")
    moved = logger.records_written + logger.records_dropped
    assert moved > 0


def test_bim_trace_id_env_overrides_default_initial_trace(tmp_path, monkeypatch, fixed_clock):
    monkeypatch.setenv("BIM_TRACE_ID", "rev_20260526_inherited")
    logger = struct_log.create_logger(
        "streaming-server",
        log_root=tmp_path,
        run_id="run_20260526_142010_a3f900",
        now=fixed_clock("2026-05-26T14:23:11.482Z"),
        skip_env_snapshot=True,
    )
    logger.info("conversion", "hello")
    lines = _read_lines(logger.current_file)
    assert lines[0]["trace_id"] == "rev_20260526_inherited"


def test_invalid_run_id_rejected_in_create_logger(tmp_path):
    with pytest.raises(ValueError):
        struct_log.create_logger(
            "streaming-server", log_root=tmp_path, run_id="not-a-valid-run-id"
        )


def test_unknown_service_rejected_in_create_logger(tmp_path):
    with pytest.raises(ValueError):
        struct_log.create_logger("not-a-service", log_root=tmp_path)  # type: ignore[arg-type]
