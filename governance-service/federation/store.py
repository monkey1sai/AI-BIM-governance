"""SQLite store for A3 federation（沿用 governance.db，新增 federated_model_sets / members）。"""
from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone

_SCHEMA = """
CREATE TABLE IF NOT EXISTS federated_model_sets(
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT,
  status TEXT,
  build_usda_path TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS federated_model_members(
  id TEXT PRIMARY KEY,
  set_id TEXT,
  model_version_id TEXT,
  discipline TEXT,
  usd_path TEXT,
  layer_order INTEGER,
  visibility_default INTEGER,
  root_prim TEXT,
  transform_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_fed_members_set ON federated_model_members(set_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class FederationStore:
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

    def create_set(self, name: str, project_id: str | None) -> str:
        set_id = _new_id("fed")
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO federated_model_sets(id, project_id, name, status, created_at) VALUES(?,?,?,?,?)",
                (set_id, project_id, name, "draft", _now()),
            )
        return set_id

    def add_member(self, set_id, model_version_id, discipline, usd_path, layer_order, visibility_default, root_prim, transform_json) -> str:
        member_id = _new_id("fm")
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO federated_model_members(id, set_id, model_version_id, discipline, usd_path, layer_order, visibility_default, root_prim, transform_json)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (member_id, set_id, model_version_id, discipline, usd_path, layer_order, 1 if visibility_default else 0, root_prim, transform_json),
            )
        return member_id

    def get_set(self, set_id: str):
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM federated_model_sets WHERE id=?", (set_id,)).fetchone()
            return dict(row) if row else None

    def get_members(self, set_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM federated_model_members WHERE set_id=? ORDER BY layer_order", (set_id,)
            ).fetchall()
        members = []
        for r in rows:
            d = dict(r)
            d["visibility_default"] = bool(d["visibility_default"])
            members.append(d)
        return members

    def set_build_result(self, set_id: str, usda_path: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE federated_model_sets SET status='built', build_usda_path=? WHERE id=?",
                (usda_path, set_id),
            )
