"""Backend-only A1 confirmation. No HTTP authority or production fallback.

The injected callable is a trusted, bounded in-process adapter, not a caller
credential. It must independently verify source lineage and current access.
Metadata equality below checks consistency only; it never grants permission.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from .store import _ALLOWED, _new_id, _now


class ConfirmationError(ValueError):
    pass


class ConfirmationConflict(ConfirmationError):
    pass


class ConfirmationUnauthorized(PermissionError):
    pass


@dataclass(frozen=True)
class ConfirmationCommand:
    issue_id: str
    expected_revision: int
    revised_model_version_id: str
    revised_run_id: str
    revised_result_id: str
    idempotency_key: str
    note: str = ""


@dataclass(frozen=True)
class ConfirmationContext:
    request_hash: str
    issue_id: str
    expected_revision: int
    project_id: str
    original_model_version_id: str
    original_run_id: str
    revised_model_version_id: str
    revised_run_id: str
    ifc_guid: str
    rule_code: str
    tenant_id: str
    original_source_sha256: str
    revised_source_sha256: str


@dataclass(frozen=True)
class ConfirmationDecision:
    context: ConfirmationContext
    principal_ref: str
    authorization_ref: str
    correspondence_ref: str
    expires_at: str
    actor_kind: str = "external_authority"
    source_identity: dict | None = None


def _canonical(value, limit=512):
    return (type(value) is str and 0 < len(value) <= limit
            and value == value.strip()
            and not any(ord(c) < 32 or ord(c) == 127 for c in value))


def _json_object(raw):
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        raise ConfirmationError("missing or invalid persisted evidence") from None
    if type(value) is not dict:
        raise ConfirmationError("missing or invalid persisted evidence")
    return value


def _request_hash(command):
    if type(command) is not ConfirmationCommand:
        raise ConfirmationError("invalid confirmation command")
    if type(command.expected_revision) is not int or command.expected_revision < 0:
        raise ConfirmationError("expected_revision must be a nonnegative integer")
    for field in ("issue_id", "revised_model_version_id", "revised_run_id",
                  "revised_result_id", "idempotency_key"):
        if not _canonical(getattr(command, field)):
            raise ConfirmationError("invalid confirmation identifier")
    if type(command.note) is not str or len(command.note) > 4000:
        raise ConfirmationError("invalid confirmation note")
    try:
        data = json.dumps(asdict(command), sort_keys=True, separators=(",", ":"),
                          ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError):
        raise ConfirmationError("invalid confirmation text") from None
    return hashlib.sha256(data).hexdigest()


def _decision_expiry(decision, context):
    if (type(decision) is not ConfirmationDecision
            or type(decision.context) is not ConfirmationContext
            or decision.context != context
            or not all(_canonical(getattr(decision, field)) for field in
                       ("principal_ref", "authorization_ref", "correspondence_ref"))):
        raise ConfirmationUnauthorized("confirmation is not authorized")
    try:
        expiry = datetime.fromisoformat(decision.expires_at)
        if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
            raise ValueError()
    except (TypeError, ValueError, OverflowError):
        raise ConfirmationUnauthorized("confirmation authorization expired or invalid") from None
    return expiry


def _run_evidence(conn, run, guid, rule):
    if run["status"] != "succeeded":
        raise ConfirmationError("rule run must have succeeded")
    summary = _json_object(run["summary_json"])
    digest = summary.get("rule_content_digest")
    if type(digest) is not str or re.fullmatch(
            r"(dsl-json-v1|ids-xml-v1):sha256:[0-9a-f]{64}", digest) is None:
        raise ConfirmationError("verified rule content identity required")
    rows = [dict(row) for row in conn.execute(
        "SELECT id,ifc_guid,rule_code,status FROM rule_results WHERE rule_run_id=? ORDER BY id",
        (run["id"],))]
    counts = {"total": len(rows), "passed": 0, "failed": 0, "errored": 0}
    status_keys = {"pass": "passed", "fail": "failed", "error": "errored"}
    for row in rows:
        if row["status"] not in status_keys:
            raise ConfirmationError("unknown result outcome")
        counts[status_keys[row["status"]]] += 1
    if any(type(summary.get(key)) is not int or summary[key] != value
           for key, value in counts.items()):
        raise ConfirmationError("incomplete persisted result coverage")
    if any(row["rule_code"] == rule and not _canonical(row["ifc_guid"]) for row in rows):
        raise ConfirmationError("rule has missing component evidence")
    group = [row for row in rows if row["ifc_guid"] == guid and row["rule_code"] == rule]
    if not group:
        raise ConfirmationError("rule does not cover component")
    return {"run_id": run["id"], "model_version_id": run["model_version_id"],
            "ifc_guid": guid, "rule_code": rule, "rule_content_digest": digest,
            "members": group}


def run_source_binding(run):
    metadata = _json_object(run["source_metadata_json"])
    summary = _json_object(run["summary_json"])
    sha = summary.get("source_sha256")
    if (not _canonical(metadata.get("tenant_id")) or not _canonical(metadata.get("project_id"))
            or metadata.get("model_version_id") != run["model_version_id"]
            or type(sha) is not str or re.fullmatch(r"[0-9a-f]{64}", sha) is None):
        raise ConfirmationError("verified source binding required; rerun legacy evidence")
    return {"tenant_id": metadata["tenant_id"], "project_id": metadata["project_id"],
            "source": {"model_version_id": run["model_version_id"], "run_id": run["id"], "source_sha256": sha}}


def confirm_remediation(store, command: ConfirmationCommand, authorize=None) -> dict:
    request_hash = _request_hash(command)
    if authorize is None:
        raise ConfirmationUnauthorized("confirmation authorization unavailable")
    conn = store._conn()
    conn.isolation_level = None
    try:
        conn.execute("BEGIN IMMEDIATE")
        issue_row = conn.execute("SELECT * FROM issues WHERE id=?", (command.issue_id,)).fetchone()
        if issue_row is None:
            raise ConfirmationError("issue not found")
        issue = dict(issue_row)
        if issue["kind"] != "issue" or issue["source_type"] != "rule_result":
            raise ConfirmationError("formal rule-result issue required")
        original_anchor = conn.execute("SELECT * FROM rule_results WHERE id=?",
                                       (issue["source_ref"],)).fetchone()
        if original_anchor is None:
            raise ConfirmationError("original result unavailable")
        original = conn.execute("SELECT * FROM rule_runs WHERE id=?",
                                (original_anchor["rule_run_id"],)).fetchone()
        revised = conn.execute("SELECT * FROM rule_runs WHERE id=?",
                               (command.revised_run_id,)).fetchone()
        if original is None or revised is None:
            raise ConfirmationError("rule run unavailable")
        if (original["model_version_id"] != issue["model_version_id"]
                or original_anchor["ifc_guid"] != issue["ifc_guid"]
                or not _canonical(issue["ifc_guid"])
                or not _canonical(original_anchor["rule_code"])
                or revised["model_version_id"] != command.revised_model_version_id):
            raise ConfirmationError("source binding mismatch")
        original_meta = _json_object(original["source_metadata_json"])
        revised_meta = _json_object(revised["source_metadata_json"])
        project = original_meta.get("project_id")
        if (not _canonical(project) or revised_meta.get("project_id") != project
                or original_meta.get("model_version_id") != original["model_version_id"]
                or revised_meta.get("model_version_id") != revised["model_version_id"]):
            raise ConfirmationError("source metadata binding mismatch")
        old_binding, new_binding = run_source_binding(original), run_source_binding(revised)
        if old_binding["tenant_id"] != new_binding["tenant_id"]:
            raise ConfirmationError("tenant binding mismatch")
        context = ConfirmationContext(
            request_hash, command.issue_id, command.expected_revision, project,
            original["model_version_id"], original["id"], revised["model_version_id"],
            revised["id"], issue["ifc_guid"], original_anchor["rule_code"], old_binding["tenant_id"],
            old_binding["source"]["source_sha256"], new_binding["source"]["source_sha256"])
        # Trusted adapter only: must not perform network I/O or nested writes here.
        try:
            decision = authorize(context)
        except Exception:
            raise ConfirmationUnauthorized("confirmation authorization unavailable") from None
        expiry = _decision_expiry(decision, context)
        existing = conn.execute(
            "SELECT * FROM issue_remediation_confirmations WHERE issue_id=? AND idempotency_key=?",
            (command.issue_id, command.idempotency_key)).fetchone()
        if existing is not None:
            if existing["principal_ref"] != decision.principal_ref:
                raise ConfirmationUnauthorized("confirmation replay is not authorized")
            if existing["request_hash"] != request_hash:
                raise ConfirmationConflict("confirmation replay conflicts with original request")
            snapshot = _json_object(existing["snapshot_json"])
            if expiry <= datetime.now(timezone.utc):
                raise ConfirmationUnauthorized("confirmation authorization expired")
            conn.execute("COMMIT")
            return {"issue": issue, "confirmation": snapshot, "replayed": True}

        if issue["revision"] != command.expected_revision:
            raise ConfirmationConflict("stale issue revision")
        if "resolved" not in _ALLOWED.get(issue["status"], set()):
            raise ConfirmationConflict("illegal remediation transition")
        if original["id"] == revised["id"] or original["model_version_id"] == revised["model_version_id"]:
            raise ConfirmationError("revised model and rule run must be new")
        anchor = conn.execute("SELECT * FROM rule_results WHERE id=?",
                              (command.revised_result_id,)).fetchone()
        if (original_anchor["status"] != "fail" or anchor is None
                or anchor["rule_run_id"] != revised["id"] or anchor["status"] != "pass"
                or anchor["ifc_guid"] != issue["ifc_guid"]
                or anchor["rule_code"] != original_anchor["rule_code"]):
            raise ConfirmationError("explicit matching failure and PASS required")
        old = _run_evidence(conn, original, context.ifc_guid, context.rule_code)
        new = _run_evidence(conn, revised, context.ifc_guid, context.rule_code)
        if (old["rule_content_digest"] != new["rule_content_digest"]
                or len(old["members"]) != len(new["members"])
                or any(member["status"] != "pass" for member in new["members"])):
            raise ConfirmationError("complete matching rule group must PASS")
        if conn.execute(
                "SELECT 1 FROM issue_remediation_confirmations WHERE issue_id=? AND (correspondence_ref=? OR revised_run_id=?)",
                (command.issue_id, decision.correspondence_ref, command.revised_run_id)).fetchone():
            raise ConfirmationConflict("fresh correspondence evidence required")
        old["anchor_id"], new["anchor_id"] = issue["source_ref"], command.revised_result_id
        confirmation_id, now = _new_id("rc"), _now()
        snapshot = {
            "schema_version": "a1-remediation/v1", "id": confirmation_id,
            "issue_id": command.issue_id, "request_hash": request_hash,
            "principal_ref": decision.principal_ref, "authorization_ref": decision.authorization_ref,
            "actor_kind": decision.actor_kind, "source_identity": decision.source_identity,
            "correspondence_ref": decision.correspondence_ref, "created_at": now,
            "revision_before": issue["revision"], "revision_after": issue["revision"] + 1,
            "note": command.note, "original": old, "revised": new}
        conn.execute(
            "INSERT INTO issue_remediation_confirmations"
            "(id,issue_id,idempotency_key,request_hash,principal_ref,correspondence_ref,revised_run_id,snapshot_json,created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (confirmation_id, command.issue_id, command.idempotency_key, request_hash,
             decision.principal_ref, decision.correspondence_ref, command.revised_run_id, json.dumps(snapshot), now))
        cursor = conn.execute(
            "UPDATE issues SET status='resolved', revision=revision+1, updated_at=? WHERE id=? AND revision=?",
            (now, command.issue_id, command.expected_revision))
        if cursor.rowcount != 1:
            raise ConfirmationConflict("stale issue revision")
        conn.execute(
            "INSERT INTO issue_events(id,issue_id,event_type,from_status,to_status,note,created_at)"
            " VALUES(?,?,?,?,?,?,?)",
            (_new_id("ev"), command.issue_id, "remediation_confirmed",
             issue["status"], "resolved", confirmation_id, now))
        current = dict(conn.execute("SELECT * FROM issues WHERE id=?", (command.issue_id,)).fetchone())
        if expiry <= datetime.now(timezone.utc):
            raise ConfirmationUnauthorized("confirmation authorization expired")
        conn.execute("COMMIT")
        return {"issue": current, "confirmation": snapshot, "replayed": False}
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def reopen_remediation(store, issue_id, expected_revision, note, authority):
    """A fresh authorized CAS preserves all previous confirmation evidence."""
    if (not _canonical(issue_id) or type(expected_revision) is not int or expected_revision < 0
            or type(note) is not str or len(note) > 4000):
        raise ConfirmationError("invalid reopen command")
    conn = store._conn()
    conn.isolation_level = None
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone()
        if row is None or row["kind"] != "issue" or row["source_type"] != "rule_result":
            raise ConfirmationError("rule-result issue required")
        issue = dict(row)
        original = conn.execute("SELECT rule_run_id,rule_code,ifc_guid FROM rule_results WHERE id=?",
                                (issue["source_ref"],)).fetchone()
        if original is None or original["ifc_guid"] != issue["ifc_guid"]:
            raise ConfirmationError("original source unavailable")
        run = conn.execute("SELECT * FROM rule_runs WHERE id=?", (original["rule_run_id"],)).fetchone()
        if run is None:
            raise ConfirmationError("original run unavailable")
        binding = run_source_binding(run)
        actor = authority.reopen(issue, original["rule_run_id"], original["rule_code"], binding)
        if issue["revision"] != expected_revision or issue["status"] not in ("resolved", "rejected"):
            raise ConfirmationConflict("stale revision or illegal reopen")
        now = _now()
        conn.execute("UPDATE issues SET status='reopened',revision=revision+1,updated_at=? WHERE id=?",
                     (now, issue_id))
        conn.execute("INSERT INTO issue_events(id,issue_id,event_type,from_status,to_status,note,created_at)"
                     " VALUES(?,?,?,?,?,?,?)", (_new_id("ev"), issue_id, "remediation_reopened",
                     issue["status"], "reopened", json.dumps({**actor, "note": note}), now))
        authority.reopen(issue, original["rule_run_id"], original["rule_code"], binding)
        current = dict(conn.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone())
        conn.execute("COMMIT")
        return {"issue": current}
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
