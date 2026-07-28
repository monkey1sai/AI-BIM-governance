import json
import sys
from pathlib import Path

MODULE_DIR = (
    Path(__file__).resolve().parents[1]
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))

import struct_log as struct_log_module  # noqa: E402
from struct_log import create_logger, redact_data_before_write  # noqa: E402


def _deep_payload():
    root = {}
    cursor = root
    for _ in range(8):
        child = {}
        cursor["child"] = child
        cursor = child
    cursor["beyond"] = {"password": "python-depth-secret"}
    return root


def test_recursive_redaction_is_bounded_cycle_safe_and_dag_safe():
    cycle = {"visible": "cycle-visible", "credential": "python-cycle-secret"}
    cycle["self"] = cycle
    shared = {"visible": "shared-visible"}
    sanitized = redact_data_before_write({
        "auth": "python-auth-secret",
        "nested": [{
            "key": "python-key-secret",
            "password": "python-password-secret",
            "api_key": "python-api-key-secret",
            "token": "python-token-secret",
        }],
        "deep": _deep_payload(),
        "cycle": cycle,
        "shared_a": shared,
        "shared_b": shared,
    })

    assert sanitized["auth"] == "[REDACTED]"
    assert sanitized["nested"][0] == {
        "key": "[REDACTED]",
        "password": "[REDACTED]",
        "api_key": "[REDACTED]",
        "token": "[REDACTED]",
    }
    assert sanitized["cycle"]["self"] == "[Circular]"
    assert sanitized["shared_a"] == {"visible": "shared-visible"}
    assert sanitized["shared_b"] == {"visible": "shared-visible"}
    bounded = sanitized["deep"]
    for _ in range(7):
        bounded = bounded["child"]
    assert bounded["child"] == "[Truncated]"


def test_serialized_sink_preserves_event_type_and_env_structure(monkeypatch):
    records = []
    logger = create_logger(
        "streaming-server",
        run_id="run_20260728_120000_a3f900",
        initial_trace_id="ifcready_python_redaction",
        skip_env_snapshot=True,
        in_memory_only=True,
        record_sink=records.append,
    )
    logger._emit(  # noqa: SLF001 - contract-level adapter test
        "info",
        "env_snapshot",
        "redaction",
        "env snapshot",
        {
            "vars": [{
                "key": "STREAMING_PORT",
                "source": "default",
                "value_or_redacted": "49100",
                "type": "string",
            }],
            "auth": "python-env-auth-secret",
        },
    )
    assert records[0]["event_type"] == "env_snapshot"
    assert records[0]["data"]["vars"][0]["key"] == "STREAMING_PORT"
    assert records[0]["data"]["auth"] == "[REDACTED]"
    assert "python-env-auth-secret" not in json.dumps(records[0])

    monkeypatch.setattr(
        struct_log_module,
        "redact_data_before_write",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("python-redaction-failure-secret")),
    )
    logger.network(
        "redaction",
        "sanitizer failure",
        {"direction": "outbound", "protocol": "http", "peer": "coordinator"},
    )
    assert records[1]["event_type"] == "network"
    assert records[1]["level"] == "info"
    assert records[1]["data"] == {"redaction_failure": "[Truncated]"}
    assert "python-redaction-failure-secret" not in json.dumps(records[1])
