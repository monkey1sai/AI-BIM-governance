"""SQLite store for A2 model diffs（沿用 governance.db，新增 model_diffs / model_diff_items）。"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

from .models import DiffResult

_SCHEMA = """
CREATE TABLE IF NOT EXISTS model_diffs(
  id TEXT PRIMARY KEY,
  base_model_version_id TEXT,
  target_model_version_id TEXT,
  base_ifc_path TEXT,
  target_ifc_path TEXT,
  status TEXT,
  started_at TEXT,
  finished_at TEXT,
  summary_json TEXT
);
CREATE TABLE IF NOT EXISTS model_diff_items(
  id TEXT PRIMARY KEY,
  model_diff_id TEXT,
  change_type TEXT,
  ifc_guid TEXT,
  ifc_type TEXT,
  ifc_name TEXT,
  base_usd_prim_path TEXT,
  target_usd_prim_path TEXT,
  change_summary TEXT,
  evidence_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_diff_items_diff ON model_diff_items(model_diff_id);
"""

# 冪等 migration：為已存在的舊 db（無 ifc_type / ifc_name 欄）自動補欄。
# 使用 PRAGMA table_info + execute（不用 executescript，後者不支援參數化亦難動態判斷）。
_MIGRATIONS = [
    ("ifc_type", "ALTER TABLE model_diff_items ADD COLUMN ifc_type TEXT"),
    ("ifc_name", "ALTER TABLE model_diff_items ADD COLUMN ifc_name TEXT"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class DiffStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        parent = os.path.dirname(db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(_SCHEMA)
            # 冪等 migration：補舊 db 缺的欄位（新 db 已由 _SCHEMA 建好，ALTER 會被 try/except 略過）。
            existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(model_diff_items)").fetchall()}
            for col_name, alter_sql in _MIGRATIONS:
                if col_name not in existing_cols:
                    conn.execute(alter_sql)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def create_diff(self, base_mv, target_mv, base_path, target_path) -> str:
        diff_id = _new_id("diff")
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO model_diffs(id, base_model_version_id, target_model_version_id, base_ifc_path, target_ifc_path, status, started_at)"
                " VALUES(?,?,?,?,?,?,?)",
                (diff_id, base_mv, target_mv, base_path, target_path, "queued", _now()),
            )
        return diff_id

    def mark_running(self, diff_id: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE model_diffs SET status='running' WHERE id=?", (diff_id,))

    def complete_diff(self, diff_id: str, result: DiffResult) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE model_diffs SET status='succeeded', finished_at=?, summary_json=? WHERE id=?",
                (_now(), json.dumps(result.summary_dict(), ensure_ascii=False), diff_id),
            )
            conn.executemany(
                "INSERT INTO model_diff_items(id, model_diff_id, change_type, ifc_guid, ifc_type, ifc_name, base_usd_prim_path, target_usd_prim_path, change_summary, evidence_json)"
                " VALUES(?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        _new_id("di"),
                        diff_id,
                        it.change_type,
                        it.ifc_guid,
                        it.ifc_type,
                        it.ifc_name,
                        it.base_usd_prim_path,
                        it.target_usd_prim_path,
                        it.change_summary,
                        json.dumps(it.evidence, ensure_ascii=False),
                    )
                    for it in result.items
                ],
            )

    def fail_diff(self, diff_id: str, error: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE model_diffs SET status='failed', finished_at=?, summary_json=? WHERE id=?",
                (_now(), json.dumps({"error": error}, ensure_ascii=False), diff_id),
            )

    def get_diff(self, diff_id: str):
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM model_diffs WHERE id=?", (diff_id,)).fetchone()
            return dict(row) if row else None

    def get_items(self, diff_id: str, change_type: str | None = None):
        query = "SELECT * FROM model_diff_items WHERE model_diff_id=?"
        args: list = [diff_id]
        if change_type:
            query += " AND change_type=?"
            args.append(change_type)
        query += " ORDER BY change_type"
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(query, args).fetchall()]
