"""Cross-service trace_id correlation integration test.

The cross-service-structured-log-baseline capability promises that records
emitted by every adapter (coordinator / streaming-server / viewer / scripts)
can be joined by a single ``trace_id`` after a closed-loop IFC-ready →
conversion → session → close run.

This test simulates that flow by writing records from multiple adapters into
the same ``LOG_ROOT`` and then grepping for the shared ``trace_id``. The
adapters used are:

    * Python ``struct_log`` (streaming-server side) — imported directly via
      file-spec to bypass Kit's package ``__init__``.
    * Direct JSONL writes that mirror what the TS coordinator adapter would
      produce (we cannot easily invoke the TS code from pytest, but the file
      layout and record shape are documented; this test validates the
      shared schema and grep-by-trace_id contract at the file-layout layer).
    * Viewer records produced by Python helper, identical in shape to what
      coordinator's ``POST /api/internal/viewer-log`` would persist.

What this test does NOT cover:

    * Live coordinator HTTP intake — that path is exercised by
      ``bim-review-coordinator/tests/app/viewerLogIntake.test.ts``.
    * Kit subprocess in-process emission — that requires the Kit harness and
      is deferred to the smoke evidence stage (group 10).
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path
from typing import Dict, Iterable, List

import pytest
from jsonschema import Draft7Validator

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SCHEMA_PATH = REPO_ROOT / "tests" / "contracts" / "structured-log" / "schema.json"
STRUCT_LOG_SRC = (
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


def _load_struct_log():
    """Load struct_log.py directly without triggering the Kit package init."""
    spec = importlib.util.spec_from_file_location("_struct_log_integration", STRUCT_LOG_SRC)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["_struct_log_integration"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def validator() -> Draft7Validator:
    return Draft7Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))


@pytest.fixture
def struct_log():
    module = _load_struct_log()
    module.reset_allowlist_cache()
    yield module
    module.reset_allowlist_cache()


def _persist_raw_record(log_root: Path, record: Dict[str, object]) -> Path:
    """Mimic the coordinator's persistRecordsToServicePaths sink layout."""
    service = str(record["service"])
    date_dir = str(record["ts"])[:10]
    run_id = str(record["run_id"])
    file_path = log_root / service / date_dir / f"{service}-{run_id}.jsonl"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    return file_path


def _grep_records_by_trace(log_root: Path, trace_id: str) -> List[Dict[str, object]]:
    """Return all records under ``log_root`` whose ``trace_id`` matches."""
    found: List[Dict[str, object]] = []
    for path in sorted(log_root.rglob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if record.get("trace_id") == trace_id:
                found.append(record)
    return found


def test_one_trace_id_joins_records_across_four_services(tmp_path, struct_log, validator):
    """Closed-loop simulation: a single trace_id surfaces records in
    coordinator / streaming-server / viewer / scripts sub-trees, sorts by ``ts``
    correctly, and every record passes the shared schema.
    """
    log_root = tmp_path / "logs"
    log_root.mkdir()
    trace_id = "ifcready_1779687625000_064c6813"

    # 1) coordinator inbound: external IFC-ready POST observed
    _persist_raw_record(
        log_root,
        {
            "ts": "2026-05-26T14:23:11.500Z",
            "level": "info",
            "event_type": "network",
            "service": "coordinator",
            "component": "ifcReadyIntake",
            "run_id": "run_20260526_142010_a3f900",
            "trace_id": trace_id,
            "msg": "POST /api/external/ifc-ready 200",
            "data": {
                "direction": "inbound",
                "protocol": "http",
                "peer": "external-edge",
                "status": 200,
                "duration_ms": 47,
                "path": "/api/external/ifc-ready",
            },
            "seq": 1,
        },
    )

    # 2) coordinator lifecycle: IFC-ready job created
    _persist_raw_record(
        log_root,
        {
            "ts": "2026-05-26T14:23:11.520Z",
            "level": "info",
            "event_type": "lifecycle",
            "service": "coordinator",
            "component": "externalIfcReady",
            "run_id": "run_20260526_142010_a3f900",
            "trace_id": trace_id,
            "msg": "ifc_ready_job created",
            "data": {
                "phase": "start",
                "subject_kind": "ifc_ready_job",
                "subject_id": trace_id,
            },
            "seq": 2,
        },
    )

    # 3) scripts (PowerShell wrapper) launches Kit subprocess
    _persist_raw_record(
        log_root,
        {
            "ts": "2026-05-26T14:23:12.100Z",
            "level": "info",
            "event_type": "lifecycle",
            "service": "scripts",
            "component": "convert-ifc-to-usdc",
            "run_id": "run_20260526_142312_b1c200",
            "trace_id": trace_id,
            "msg": "kit subprocess started",
            "data": {
                "phase": "start",
                "subject_kind": "kit_subprocess",
                "subject_id": "12345",
            },
            "seq": 1,
        },
    )

    # 4) streaming-server (Python adapter — real write to demonstrate the
    # adapter participates in trace_id correlation)
    py_logger = struct_log.create_logger(
        "streaming-server",
        log_root=log_root,
        run_id="run_20260526_142312_b1c200",
        initial_trace_id=trace_id,
        now=lambda: dt.datetime(2026, 5, 26, 14, 23, 12, 200_000, tzinfo=dt.timezone.utc),
        skip_env_snapshot=True,
    )
    py_logger.lifecycle(
        "conversion_authority",
        "conversion job started",
        {
            "phase": "start",
            "subject_kind": "conversion_job",
            "subject_id": "stream_conv_20260526_142312_demo",
        },
    )
    py_logger.anomaly(
        "conversion_authority",
        "HOOPS A3D failed; fallback to ifcopenshell",
        {
            "anomaly_kind": "fallback",
            "reason": "hoops_a3d_failed",
            "fallback_method": "ifcopenshell_openusd",
        },
    )

    # 5) viewer-side record (as if persisted via coordinator's intake)
    _persist_raw_record(
        log_root,
        {
            "ts": "2026-05-26T14:24:01.000Z",
            "level": "info",
            "event_type": "network",
            "service": "viewer",
            "component": "webrtcClient",
            "run_id": "run_20260526_142401_d3e400",
            "trace_id": trace_id,
            "msg": "DataChannel openStageRequest sent",
            "data": {
                "direction": "outbound",
                "protocol": "datachannel",
                "peer": "streaming-server",
                "status": "openStageRequest",
            },
            "seq": 1,
        },
    )

    # 6) coordinator audit: callback outbox push
    _persist_raw_record(
        log_root,
        {
            "ts": "2026-05-26T14:25:00.000Z",
            "level": "info",
            "event_type": "audit",
            "service": "coordinator",
            "component": "callbackOutbox",
            "run_id": "run_20260526_142010_a3f900",
            "trace_id": trace_id,
            "msg": "callback outbox push",
            "data": {
                "action": "callback-outbox-push",
                "actor": "coordinator",
                "target": "external-cloud",
            },
            "seq": 3,
        },
    )

    # 7) coordinator lifecycle: ifc_ready_job closed
    _persist_raw_record(
        log_root,
        {
            "ts": "2026-05-26T14:25:00.250Z",
            "level": "info",
            "event_type": "lifecycle",
            "service": "coordinator",
            "component": "externalIfcReady",
            "run_id": "run_20260526_142010_a3f900",
            "trace_id": trace_id,
            "msg": "ifc_ready_job closed",
            "data": {
                "phase": "closed",
                "subject_kind": "ifc_ready_job",
                "subject_id": trace_id,
            },
            "seq": 4,
        },
    )

    # --- Assertions ------------------------------------------------------
    records = _grep_records_by_trace(log_root, trace_id)
    # 6 hand-rolled records + 2 Python-adapter records = 8
    assert len(records) == 8, f"expected 8 records, got {len(records)}: {records}"

    # 4 different services should be represented.
    services = {r["service"] for r in records}
    assert services == {"coordinator", "streaming-server", "viewer", "scripts"}, services

    # Sortable by ts (string sort works for ISO-8601 UTC ms timestamps). The
    # grep walks files in path order so records arrive interleaved by service;
    # the contract is that *sorting* by ``ts`` reconstructs the timeline, not
    # that they happen to land sorted on disk.
    timestamps = sorted(r["ts"] for r in records)
    assert timestamps[0] == "2026-05-26T14:23:11.500Z"
    assert timestamps[-1] == "2026-05-26T14:25:00.250Z"

    # Every record passes the shared schema.
    for record in records:
        assert validator.is_valid(record), list(validator.iter_errors(record))


def test_parent_trace_id_links_review_session_to_ifc_ready_origin(tmp_path, validator):
    """Review session traces should keep a ``parent_trace_id`` pointer back to the
    originating IFC-ready trace per docs/contracts/structured-log-schema.md §4.1.
    """
    log_root = tmp_path / "logs"
    log_root.mkdir()
    parent_trace = "ifcready_1779687625000_064c6813"
    child_trace = "rev_20260526_1234abcd"

    _persist_raw_record(
        log_root,
        {
            "ts": "2026-05-26T14:23:00.000Z",
            "level": "info",
            "event_type": "lifecycle",
            "service": "coordinator",
            "component": "reviewSession",
            "run_id": "run_20260526_142010_a3f900",
            "trace_id": child_trace,
            "parent_trace_id": parent_trace,
            "msg": "review_session_xxx created",
            "data": {
                "phase": "start",
                "subject_kind": "review_session",
                "subject_id": "review_session_xxx",
            },
            "seq": 1,
        },
    )

    rev_records = _grep_records_by_trace(log_root, child_trace)
    assert len(rev_records) == 1
    assert rev_records[0]["parent_trace_id"] == parent_trace

    # Schema permits parent_trace_id; validate to keep the contract honest.
    for record in rev_records:
        assert validator.is_valid(record), list(validator.iter_errors(record))


def test_grep_by_trace_id_is_sorted_chronologically(tmp_path, validator):
    """Records emitted out of order should still sort by ``ts`` when grepped."""
    log_root = tmp_path / "logs"
    log_root.mkdir()
    trace_id = "stream_conv_20260525055218_115177da"

    # Write records in reverse chronological order.
    records_to_emit = [
        ("2026-05-25T06:01:43.300Z", "lifecycle", "closed"),
        ("2026-05-25T05:52:18.300Z", "operation_anomaly", "fallback"),
        ("2026-05-25T05:52:18.115Z", "lifecycle", "start"),
    ]
    for ts, event_type, msg in records_to_emit:
        record: Dict[str, object] = {
            "ts": ts,
            "level": "info",
            "event_type": event_type,
            "service": "streaming-server",
            "component": "conversion_authority",
            "run_id": "run_20260525_055201_115177",
            "trace_id": trace_id,
            "msg": msg,
            "data": {},
            "seq": 1,
        }
        if event_type == "lifecycle":
            record["data"] = {
                "phase": "closed" if msg == "closed" else "start",
                "subject_kind": "conversion_job",
                "subject_id": trace_id,
            }
        elif event_type == "operation_anomaly":
            record["data"] = {"anomaly_kind": "fallback", "reason": "hoops_a3d_failed"}
        _persist_raw_record(log_root, record)

    found = sorted(_grep_records_by_trace(log_root, trace_id), key=lambda r: r["ts"])
    assert [r["ts"] for r in found] == sorted(r["ts"] for r in found)
    assert found[0]["data"]["phase"] == "start"
    assert found[-1]["data"]["phase"] == "closed"
