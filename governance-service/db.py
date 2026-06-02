"""SQLite store for governance rule-runs（stdlib sqlite3，零額外依賴）。

完整 schema（rule_sets / rules / rule_runs / rule_results）見 OpenSpec design.md；
MVP 持久化 run 輸出（rule_runs / rule_results），規則定義來自版本化 YAML 檔。
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

from rule_engine.models import RuleRunResult

_SCHEMA = """
CREATE TABLE IF NOT EXISTS rule_runs(
  id TEXT PRIMARY KEY,
  model_version_id TEXT,
  ifc_source_path TEXT,
  rule_set TEXT,
  status TEXT,
  started_at TEXT,
  finished_at TEXT,
  score REAL,
  summary_json TEXT
);
CREATE TABLE IF NOT EXISTS rule_results(
  id TEXT PRIMARY KEY,
  rule_run_id TEXT,
  ifc_guid TEXT,
  usd_prim_path TEXT,
  rule_code TEXT,
  severity TEXT,
  status TEXT,
  message TEXT,
  evidence_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_results_run ON rule_results(rule_run_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Store:
    def __init__(self, db_path: str):
        self.db_path = db_path
        parent = os.path.dirname(db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(_SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def create_run(self, model_version_id, ifc_source_path, rule_set) -> str:
        run_id = _new_id("rr")
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO rule_runs(id, model_version_id, ifc_source_path, rule_set, status, started_at)"
                " VALUES(?,?,?,?,?,?)",
                (run_id, model_version_id, ifc_source_path, rule_set, "queued", _now()),
            )
        return run_id

    def mark_running(self, run_id: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE rule_runs SET status='running' WHERE id=?", (run_id,))

    def complete_run(self, run_id: str, run: RuleRunResult) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE rule_runs SET status='succeeded', finished_at=?, score=?, summary_json=? WHERE id=?",
                (_now(), run.score, json.dumps(run.summary_dict(), ensure_ascii=False), run_id),
            )
            conn.executemany(
                "INSERT INTO rule_results(id, rule_run_id, ifc_guid, usd_prim_path, rule_code, severity, status, message, evidence_json)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                [
                    (
                        _new_id("res"),
                        run_id,
                        r.ifc_guid,
                        r.usd_prim_path,
                        r.rule_code,
                        r.severity,
                        r.status,
                        r.message,
                        json.dumps(r.evidence, ensure_ascii=False),
                    )
                    for r in run.results
                ],
            )

    def fail_run(self, run_id: str, error: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE rule_runs SET status='failed', finished_at=?, summary_json=? WHERE id=?",
                (_now(), json.dumps({"error": error}, ensure_ascii=False), run_id),
            )

    def get_run(self, run_id: str):
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM rule_runs WHERE id=?", (run_id,)).fetchone()
            return dict(row) if row else None

    def get_results(self, run_id: str, status: str | None = None):
        query = "SELECT * FROM rule_results WHERE rule_run_id=?"
        args: list = [run_id]
        if status:
            query += " AND status=?"
            args.append(status)
        query += " ORDER BY rule_code"
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(query, args).fetchall()]
