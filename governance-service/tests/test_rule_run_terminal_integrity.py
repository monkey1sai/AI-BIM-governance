"""Persisted rule-run terminal writes; synthetic results, real SQLite."""
from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from db import Store
from rule_engine.models import RuleResult, RuleRunResult


def result(label="first", status="pass", codes=("A",)):
    return RuleRunResult(
        rule_set="test-rules", version="1", target_summary={code: 1 for code in codes},
        total=len(codes), passed=len(codes) if status == "pass" else 0,
        failed=len(codes) if status == "fail" else 0, errored=0,
        score=100.0 if status == "pass" else 0.0, unique_elements=1,
        results=[
            RuleResult(ifc_guid="TEST_GUID", ifc_type="IfcWall", ifc_name=None,
                       rule_code=code, severity="high", status=status,
                       message=label, evidence={"label": label})
            for code in codes
        ],
    )


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "governance.db"))


def seed(store, state="queued"):
    run_id = store.create_run("test-v1", "synthetic.ifc", "test-rules")
    if state == "running":
        store.mark_running(run_id)
    return run_id


def snapshot(store, run_id):
    return store.get_run(run_id), store.get_results(run_id)


@pytest.mark.parametrize("terminal", ["succeeded", "failed"])
@pytest.mark.parametrize("operation", ["running", "complete", "fail"])
def test_terminal_run_rejects_late_writes_without_changing_persisted_evidence(
    store, terminal, operation,
):
    run_id = seed(store)
    if terminal == "succeeded":
        store.complete_run(run_id, result())
    else:
        store.fail_run(run_id, "original failure")
    before = snapshot(store, run_id)
    restarted = Store(store.db_path)
    for _ in range(2):
        if operation == "running":
            restarted.mark_running(run_id)
        elif operation == "complete":
            restarted.complete_run(run_id, result("replacement", "fail"))
        else:
            restarted.fail_run(run_id, "replacement failure")
        assert snapshot(restarted, run_id) == before


@pytest.mark.parametrize("initial", ["queued", "running"])
@pytest.mark.parametrize("terminal", ["succeeded", "failed"])
def test_pending_run_can_finish(store, initial, terminal):
    run_id = seed(store, initial)
    if terminal == "succeeded":
        store.complete_run(run_id, result())
    else:
        store.fail_run(run_id, "test failure")
    row, rows = snapshot(store, run_id)
    assert row["status"] == terminal
    assert row["finished_at"]
    assert len(rows) == (1 if terminal == "succeeded" else 0)


def test_missing_run_cannot_create_orphan_results(store):
    store.mark_running("absent")
    store.complete_run("absent", result())
    store.fail_run("absent", "failure")
    assert snapshot(store, "absent") == (None, [])


def test_concurrent_completions_persist_only_one_result_batch(store):
    run_id = seed(store, "running")
    barrier = Barrier(2)

    def finish(label):
        local = Store(store.db_path)
        barrier.wait(timeout=5)
        local.complete_run(run_id, result(label))

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(finish, label) for label in ("first", "second")]
        for future in futures:
            future.result(timeout=10)
    row, rows = snapshot(store, run_id)
    assert row["status"] == "succeeded"
    assert len(rows) == 1
    assert rows[0]["message"] in {"first", "second"}


def test_partial_result_insert_failure_rolls_back_terminal_and_all_results(store):
    run_id = seed(store, "running")
    before = snapshot(store, run_id)
    with sqlite3.connect(store.db_path) as conn:
        conn.execute("""
            CREATE TRIGGER reject_second_result BEFORE INSERT ON rule_results
            WHEN NEW.rule_code = 'B'
            BEGIN SELECT RAISE(ABORT, 'test insert failure'); END
        """)
    with pytest.raises(sqlite3.IntegrityError, match="test insert failure"):
        store.complete_run(run_id, result(codes=("A", "B")))
    assert snapshot(store, run_id) == before
    store.complete_run(run_id, result())
    assert store.get_run(run_id)["status"] == "succeeded"
    assert len(store.get_results(run_id)) == 1


def test_concurrent_success_and_failure_keep_one_terminal_snapshot(store):
    run_id = seed(store, "running")
    barrier = Barrier(2)

    def finish(succeed):
        local = Store(store.db_path)
        barrier.wait(timeout=5)
        if succeed:
            local.complete_run(run_id, result())
        else:
            local.fail_run(run_id, "competing failure")

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(finish, succeed) for succeed in (True, False)]
        for future in futures:
            future.result(timeout=10)
    row, rows = snapshot(store, run_id)
    assert row["status"] in {"succeeded", "failed"}
    assert len(rows) == (1 if row["status"] == "succeeded" else 0)
    before = snapshot(store, run_id)
    store.complete_run(run_id, result("late"))
    store.fail_run(run_id, "late")
    assert snapshot(Store(store.db_path), run_id) == before
