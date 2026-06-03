"""SQLite store for governance issues（沿用 governance.db，新增 issues / issue_events）。

對齊 BCF 結合 USD 開發原則：
- issue 綁 model_version_id + ifc_guid（主鍵，BCF rule 3/4）；usd_prim_path 為執行期定位索引。
- 無 ifc_guid 只能建「視覺標註」（kind=annotation），不得當正式可交換 issue（BCF rule 10）。
- 所有狀態變更寫 issue_events audit（BCF rule 9：可重播、可驗證）。
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

ISSUE_STATUSES = ("open", "assigned", "in_progress", "resolved", "rejected", "reopened")
# 寬鬆但受控的狀態機：target 必為合法狀態；resolved/rejected 可 reopened。
_ALLOWED = {
    "open": {"assigned", "in_progress", "resolved", "rejected"},
    "assigned": {"in_progress", "resolved", "rejected", "open"},
    "in_progress": {"resolved", "rejected", "assigned"},
    "resolved": {"reopened"},
    "rejected": {"reopened"},
    "reopened": {"assigned", "in_progress", "resolved", "rejected"},
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS issues(
  id TEXT PRIMARY KEY,
  kind TEXT,                 -- 'issue'（有 ifc_guid，可交換）| 'annotation'（無 ifc_guid，僅視覺）
  title TEXT,
  description TEXT,
  status TEXT,
  severity TEXT,
  assignee TEXT,
  ifc_guid TEXT,
  usd_prim_path TEXT,
  model_version_id TEXT,
  source_type TEXT,          -- 'manual' | 'rule_result' | 'diff_item'
  source_ref TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS issue_events(
  id TEXT PRIMARY KEY,
  issue_id TEXT,
  event_type TEXT,           -- 'created' | 'transition' | 'comment'
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_issue_events_issue ON issue_events(issue_id);
CREATE INDEX IF NOT EXISTS idx_issues_mv ON issues(model_version_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class TransitionError(ValueError):
    pass


class IssueStore:
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

    def create_issue(
        self,
        title,
        description=None,
        severity="medium",
        ifc_guid=None,
        usd_prim_path=None,
        model_version_id=None,
        source_type="manual",
        source_ref=None,
        assignee=None,
    ) -> dict:
        # BCF rule 10：無 ifc_guid → annotation（非正式 issue）。
        kind = "issue" if ifc_guid else "annotation"
        issue_id = _new_id("iss")
        now = _now()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO issues(id, kind, title, description, status, severity, assignee, ifc_guid, usd_prim_path,"
                " model_version_id, source_type, source_ref, created_at, updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (issue_id, kind, title, description, "open", severity, assignee, ifc_guid, usd_prim_path,
                 model_version_id, source_type, source_ref, now, now),
            )
            conn.execute(
                "INSERT INTO issue_events(id, issue_id, event_type, from_status, to_status, note, created_at)"
                " VALUES(?,?,?,?,?,?,?)",
                (_new_id("ev"), issue_id, "created", None, "open", f"source={source_type}", now),
            )
        return self.get_issue(issue_id)

    def get_issue(self, issue_id: str):
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone()
            return dict(row) if row else None

    def get_events(self, issue_id: str) -> list[dict]:
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT * FROM issue_events WHERE issue_id=? ORDER BY created_at", (issue_id,)).fetchall()]

    def list_issues(self, status=None, severity=None, model_version_id=None, kind=None) -> list[dict]:
        query = "SELECT * FROM issues WHERE 1=1"
        args: list = []
        for col, val in (("status", status), ("severity", severity), ("model_version_id", model_version_id), ("kind", kind)):
            if val:
                query += f" AND {col}=?"
                args.append(val)
        query += " ORDER BY created_at DESC"
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(query, args).fetchall()]

    def transition(self, issue_id: str, to_status: str, note: str | None = None) -> dict:
        issue = self.get_issue(issue_id)
        if not issue:
            raise KeyError(issue_id)
        if to_status not in ISSUE_STATUSES:
            raise TransitionError(f"unknown status: {to_status}")
        frm = issue["status"]
        if to_status not in _ALLOWED.get(frm, set()):
            raise TransitionError(f"illegal transition {frm} -> {to_status}")
        now = _now()
        with self._conn() as conn:
            conn.execute("UPDATE issues SET status=?, updated_at=? WHERE id=?", (to_status, now, issue_id))
            conn.execute(
                "INSERT INTO issue_events(id, issue_id, event_type, from_status, to_status, note, created_at)"
                " VALUES(?,?,?,?,?,?,?)",
                (_new_id("ev"), issue_id, "transition", frm, to_status, note, now),
            )
        return self.get_issue(issue_id)
