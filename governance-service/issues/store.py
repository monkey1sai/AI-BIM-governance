"""SQLite store for governance issues（沿用 governance.db，新增 issues / issue_events）。

對齊 BCF 結合 USD 開發原則：
- issue 綁 model_version_id + ifc_guid（主鍵，BCF rule 3/4）；usd_prim_path 為執行期定位索引。
- 無 ifc_guid 只能建「視覺標註」（kind=annotation），不得當正式可交換 issue（BCF rule 10）。
- 所有狀態變更寫 issue_events audit（BCF rule 9：可重播、可驗證）。
"""
from __future__ import annotations

import hmac
import json
import os
import sqlite3
import threading
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
  source_type TEXT,          -- 'manual' | 'rule_result' | 'diff_item' | 'a4_search'
  source_ref TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS issue_events(
  id TEXT PRIMARY KEY,
  issue_id TEXT,
  event_type TEXT,           -- 'created' | 'transition' | 'comment' | 'binding_migration'
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_issue_events_issue ON issue_events(issue_id);
CREATE INDEX IF NOT EXISTS idx_issues_mv ON issues(model_version_id);
CREATE TABLE IF NOT EXISTS a4_issue_evidence(
  issue_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  evidence_snapshot TEXT NOT NULL,
  review_session_id TEXT NOT NULL,
  principal_ref TEXT NOT NULL,
  primary_artifact_id TEXT NOT NULL,
  active_binding_revision TEXT NOT NULL,
  proof_id TEXT NOT NULL UNIQUE,
  snapshot_hash TEXT NOT NULL,
  proof_digest TEXT NOT NULL,
  creation_request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(issue_id) REFERENCES issues(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_a4_issue_evidence_proof ON a4_issue_evidence(proof_id);
"""

_BINDING_TRIGGERS = """
CREATE TRIGGER IF NOT EXISTS trg_issues_model_version_insert
BEFORE INSERT ON issues
WHEN NEW.kind = 'issue' AND (
  NEW.ifc_guid IS NULL OR trim(NEW.ifc_guid) = '' OR
  NEW.model_version_id IS NULL OR trim(NEW.model_version_id) = ''
)
BEGIN
  SELECT RAISE(ABORT, 'formal issue requires ifc_guid and model_version_id');
END;
CREATE TRIGGER IF NOT EXISTS trg_issues_model_version_update
BEFORE UPDATE OF kind, ifc_guid, model_version_id ON issues
WHEN NEW.kind = 'issue' AND (
  NEW.ifc_guid IS NULL OR trim(NEW.ifc_guid) = '' OR
  NEW.model_version_id IS NULL OR trim(NEW.model_version_id) = ''
)
BEGIN
  SELECT RAISE(ABORT, 'formal issue requires ifc_guid and model_version_id');
END;
"""

_SCHEMA_INIT_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _migrate_legacy_unbound_formal_issues(conn: sqlite3.Connection) -> None:
    """Preserve legacy rows without pretending they satisfy the formal Issue contract."""
    rows = conn.execute(
        "SELECT id, status FROM issues WHERE kind='issue' AND "
        "((ifc_guid IS NULL OR trim(ifc_guid)='') OR "
        "(model_version_id IS NULL OR trim(model_version_id)=''))"
    ).fetchall()
    if not rows:
        return
    now = _now()
    conn.execute("BEGIN IMMEDIATE")
    try:
        for row in rows:
            conn.execute(
                "INSERT INTO issue_events(id, issue_id, event_type, from_status, to_status, note, created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (
                    _new_id("ev"),
                    row["id"],
                    "binding_migration",
                    row["status"],
                    row["status"],
                    "reclassified issue->annotation: missing formal binding",
                    now,
                ),
            )
        conn.execute(
            "UPDATE issues SET kind='annotation', updated_at=? WHERE kind='issue' AND "
            "((ifc_guid IS NULL OR trim(ifc_guid)='') OR "
            "(model_version_id IS NULL OR trim(model_version_id)=''))",
            (now,),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


class TransitionError(ValueError):
    pass


class IssueBindingError(ValueError):
    """A formal issue is missing its immutable model-version binding."""


class A4IssueReplayConflict(ValueError):
    """A consumed proof ID was replayed with different immutable bytes."""


class A4IssueUnauthorized(PermissionError):
    """Current trusted session/principal does not own the consumed proof."""


class IssueStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        parent = os.path.dirname(db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        # journal_mode changes require an exclusive SQLite lock. Keep that
        # transition out of the hot _conn() path and serialize lazy store
        # construction inside this service process.
        with _SCHEMA_INIT_LOCK:
            with self._conn() as conn:
                journal_mode = conn.execute("PRAGMA journal_mode=WAL").fetchone()[0]
                if str(journal_mode).lower() != "wal":
                    raise RuntimeError(f"IssueStore requires WAL mode, got {journal_mode!r}")
                conn.executescript(_SCHEMA)
                _migrate_legacy_unbound_formal_issues(conn)
                conn.executescript(_BINDING_TRIGGERS)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @staticmethod
    def _normalize_issue_binding(ifc_guid, model_version_id) -> tuple[str | None, str | None]:
        normalized_guid = str(ifc_guid).strip() if ifc_guid is not None else ""
        normalized_version = str(model_version_id).strip() if model_version_id is not None else ""
        if normalized_guid and not normalized_version:
            raise IssueBindingError("formal issue requires model_version_id")
        return normalized_guid or None, normalized_version or None

    @staticmethod
    def _attach_a4_evidence(issue: dict, evidence: sqlite3.Row | None) -> dict:
        if evidence is None:
            return issue
        issue.update(
            {
                "primary_artifact_id": evidence["primary_artifact_id"],
                "active_binding_revision": evidence["active_binding_revision"],
                "a4_evidence_snapshot": json.loads(evidence["evidence_snapshot"]),
                "a4_proof_id": evidence["proof_id"],
                "snapshot_hash": evidence["snapshot_hash"],
                "proof_digest": evidence["proof_digest"],
                "creation_request_hash": evidence["creation_request_hash"],
            }
        )
        return issue

    def _a4_record_by_proof(self, conn: sqlite3.Connection, proof_id: str):
        evidence = conn.execute(
            "SELECT * FROM a4_issue_evidence WHERE proof_id=?",
            (proof_id,),
        ).fetchone()
        if evidence is None:
            return None
        issue_row = conn.execute("SELECT * FROM issues WHERE id=?", (evidence["issue_id"],)).fetchone()
        if issue_row is None:
            # The two rows are inserted atomically. Treat corruption as a hard
            # failure rather than fabricating an Issue or accepting a replay.
            raise RuntimeError("A4 Issue evidence has no owning Issue")
        return {
            "issue": self._attach_a4_evidence(dict(issue_row), evidence),
            "review_session_id": evidence["review_session_id"],
            "principal_ref": evidence["principal_ref"],
            "snapshot_hash": evidence["snapshot_hash"],
            "proof_digest": evidence["proof_digest"],
            "creation_request_hash": evidence["creation_request_hash"],
        }

    @staticmethod
    def _validated_a4_replay(
        record: dict,
        *,
        review_session_id: str,
        principal_ref: str,
        snapshot_hash: str,
        proof_digest: str,
        creation_request_hash: str,
    ) -> dict:
        # Authorization deliberately precedes digest comparisons so an
        # authenticated but different session cannot use replay responses as a
        # proof-existence oracle.
        if (
            record["review_session_id"] != review_session_id
            or record["principal_ref"] != principal_ref
        ):
            raise A4IssueUnauthorized("A4 Issue replay is not authorized")

        # Evaluate all three comparisons before combining their results. This
        # avoids a data-dependent short circuit across immutable replay fields.
        snapshot_matches = hmac.compare_digest(record["snapshot_hash"], snapshot_hash)
        proof_matches = hmac.compare_digest(record["proof_digest"], proof_digest)
        request_matches = hmac.compare_digest(
            record["creation_request_hash"], creation_request_hash
        )
        if not (snapshot_matches and proof_matches and request_matches):
            raise A4IssueReplayConflict("A4 Issue replay conflicts with the stored request")
        return record["issue"]

    def find_a4_issue_replay(
        self,
        *,
        proof_id: str,
        review_session_id: str,
        principal_ref: str,
        snapshot_hash: str,
        proof_digest: str,
        creation_request_hash: str,
    ) -> dict | None:
        """Return an exact consumed-proof replay without consulting live keys."""
        with self._conn() as conn:
            record = self._a4_record_by_proof(conn, proof_id)
        if record is None:
            return None
        return self._validated_a4_replay(
            record,
            review_session_id=review_session_id,
            principal_ref=principal_ref,
            snapshot_hash=snapshot_hash,
            proof_digest=proof_digest,
            creation_request_hash=creation_request_hash,
        )

    def create_a4_issue(
        self,
        *,
        title: str,
        description: str | None,
        severity: str,
        assignee: str | None,
        ifc_guid: str,
        usd_prim_path: str | None,
        model_version_id: str,
        primary_artifact_id: str,
        active_binding_revision: str,
        query_id: str,
        schema_version: str,
        evidence_snapshot_json: str,
        review_session_id: str,
        principal_ref: str,
        proof_id: str,
        snapshot_hash: str,
        proof_digest: str,
        creation_request_hash: str,
    ) -> tuple[dict, bool]:
        """Atomically create one confirmed A4 Issue or return its exact replay."""
        issue_id = _new_id("iss")
        now = _now()
        conn = self._conn()
        conn.isolation_level = None
        try:
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("BEGIN IMMEDIATE")
            existing = self._a4_record_by_proof(conn, proof_id)
            if existing is not None:
                issue = self._validated_a4_replay(
                    existing,
                    review_session_id=review_session_id,
                    principal_ref=principal_ref,
                    snapshot_hash=snapshot_hash,
                    proof_digest=proof_digest,
                    creation_request_hash=creation_request_hash,
                )
                conn.execute("COMMIT")
                return issue, True

            conn.execute(
                "INSERT INTO issues(id, kind, title, description, status, severity, assignee, ifc_guid,"
                " usd_prim_path, model_version_id, source_type, source_ref, created_at, updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    issue_id,
                    "issue",
                    title,
                    description,
                    "open",
                    severity,
                    assignee,
                    ifc_guid,
                    usd_prim_path,
                    model_version_id,
                    "a4_search",
                    query_id,
                    now,
                    now,
                ),
            )
            conn.execute(
                "INSERT INTO a4_issue_evidence(issue_id, schema_version, evidence_snapshot,"
                " review_session_id, principal_ref, primary_artifact_id, active_binding_revision,"
                " proof_id, snapshot_hash, proof_digest, creation_request_hash, created_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    issue_id,
                    schema_version,
                    evidence_snapshot_json,
                    review_session_id,
                    principal_ref,
                    primary_artifact_id,
                    active_binding_revision,
                    proof_id,
                    snapshot_hash,
                    proof_digest,
                    creation_request_hash,
                    now,
                ),
            )
            conn.execute(
                "INSERT INTO issue_events(id, issue_id, event_type, from_status, to_status, note, created_at)"
                " VALUES(?,?,?,?,?,?,?)",
                (
                    _new_id("ev"),
                    issue_id,
                    "created",
                    None,
                    "open",
                    f"source=a4_search;query_id={query_id}",
                    now,
                ),
            )
            conn.execute("COMMIT")
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            conn.close()
        issue = self.get_a4_issue(issue_id)
        if issue is None:
            raise RuntimeError("A4 Issue transaction committed without a readable Issue")
        return issue, False

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
        ifc_guid, model_version_id = self._normalize_issue_binding(ifc_guid, model_version_id)
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

    def create_issues_batch(self, items: list[dict]) -> dict:
        """批次建立 issue：單一交易（全有或全無，ISS-004）+ 來源冪等（同
        (source_type, source_ref) 不重複建，ISS-002）。每筆 dict 含 create_issue
        參數。回傳 {"created": [issue_id...], "skipped": int}。"""
        created_ids: list[str] = []
        skipped = 0
        now = _now()
        conn = self._conn()
        conn.isolation_level = None
        try:
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("BEGIN IMMEDIATE")
            for it in items:
                source_type = it.get("source_type", "manual")
                source_ref = it.get("source_ref")
                if source_ref is not None:
                    existing = conn.execute(
                        "SELECT id FROM issues WHERE source_type=? AND source_ref=?",
                        (source_type, source_ref),
                    ).fetchone()
                    if existing:
                        skipped += 1
                        continue
                ifc_guid, model_version_id = self._normalize_issue_binding(
                    it.get("ifc_guid"), it.get("model_version_id")
                )
                kind = "issue" if ifc_guid else "annotation"
                issue_id = _new_id("iss")
                conn.execute(
                    "INSERT INTO issues(id, kind, title, description, status, severity, assignee, ifc_guid, usd_prim_path,"
                    " model_version_id, source_type, source_ref, created_at, updated_at)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (issue_id, kind, it.get("title"), it.get("description"), "open", it.get("severity", "medium"),
                     it.get("assignee"), ifc_guid, it.get("usd_prim_path"), model_version_id,
                     source_type, source_ref, now, now),
                )
                conn.execute(
                    "INSERT INTO issue_events(id, issue_id, event_type, from_status, to_status, note, created_at)"
                    " VALUES(?,?,?,?,?,?,?)",
                    (_new_id("ev"), issue_id, "created", None, "open", f"source={source_type}", now),
                )
                created_ids.append(issue_id)
            conn.execute("COMMIT")
        except Exception:
            # BEGIN IMMEDIATE 自身失敗（如 busy_timeout 後 database is locked）時無交易可
            # rollback，guard 住以免次生例外遮蔽原始主因；無交易時等同零部分寫入。
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            conn.close()
        return {"created": created_ids, "skipped": skipped}

    def get_issue(self, issue_id: str):
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone()
            return dict(row) if row is not None else None

    def get_a4_issue(self, issue_id: str):
        """Read A4 evidence only for the trusted internal creation boundary."""
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone()
            if row is None:
                return None
            evidence = conn.execute(
                "SELECT * FROM a4_issue_evidence WHERE issue_id=?",
                (issue_id,),
            ).fetchone()
            return self._attach_a4_evidence(dict(row), evidence)

    def get_events(self, issue_id: str) -> list[dict]:
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT * FROM issue_events WHERE issue_id=? ORDER BY created_at", (issue_id,)).fetchall()]

    def list_issues(
        self,
        status=None,
        severity=None,
        model_version_id=None,
        kind=None,
        *,
        include_a4: bool = False,
    ) -> list[dict]:
        query = "SELECT * FROM issues WHERE 1=1"
        args: list = []
        if not include_a4:
            # The generic issue surface is not session-authorized.  Keep A4
            # records non-enumerable until a trusted lifecycle route exists.
            query += " AND (source_type IS NULL OR source_type <> 'a4_search')"
        for col, val in (("status", status), ("severity", severity), ("model_version_id", model_version_id), ("kind", kind)):
            if val:
                query += f" AND {col}=?"
                args.append(val)
        query += " ORDER BY created_at DESC"
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(query, args).fetchall()]

    def transition(self, issue_id: str, to_status: str, note: str | None = None) -> dict:
        if to_status not in ISSUE_STATUSES:
            raise TransitionError(f"unknown status: {to_status}")
        conn = self._conn()
        conn.isolation_level = None  # 自行控制交易；BEGIN IMMEDIATE 序列化並發 transition
        try:
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT status FROM issues WHERE id=?", (issue_id,)).fetchone()
            if row is None:
                conn.execute("ROLLBACK")
                raise KeyError(issue_id)
            frm = row["status"]
            if to_status not in _ALLOWED.get(frm, set()):
                conn.execute("ROLLBACK")
                raise TransitionError(f"illegal transition {frm} -> {to_status}")
            now = _now()
            cur = conn.execute(
                "UPDATE issues SET status=?, updated_at=? WHERE id=? AND status=?",
                (to_status, now, issue_id, frm),
            )
            if cur.rowcount == 0:
                conn.execute("ROLLBACK")
                raise TransitionError("concurrent modification; please retry")
            conn.execute(
                "INSERT INTO issue_events(id, issue_id, event_type, from_status, to_status, note, created_at)"
                " VALUES(?,?,?,?,?,?,?)",
                (_new_id("ev"), issue_id, "transition", frm, to_status, note, now),
            )
            conn.execute("COMMIT")
        finally:
            conn.close()
        return self.get_issue(issue_id)
