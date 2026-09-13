"""Authorized, read-only projection of stored A1 confirmation evidence."""
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3


@dataclass(frozen=True)
class HistoryReadGrant:
    """Trusted adapter attests Issue-history and explicit source-version access."""
    issue_id: str
    model_version_ids: frozenset[str]
    expires_at: str
    source_cases: tuple[dict, ...] = ()


class HistoryDenied(PermissionError):
    pass


class HistoryNotFound(LookupError):
    pass


class HistoryUnavailable(ValueError):
    pass


def _canonical(value):
    return (isinstance(value, str) and 1 <= len(value) <= 512 and value == value.strip()
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError("timestamp")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timezone")
    return parsed


def _check_expiry(grant):
    try:
        if _timestamp(grant.expires_at) > datetime.now(timezone.utc):
            return
    except (ValueError, TypeError, OverflowError):
        pass
    raise HistoryDenied()


def _grant(issue_id, authorize):
    try:
        grant = authorize(issue_id)
    except Exception:
        raise HistoryDenied() from None
    if (type(grant) is not HistoryReadGrant or grant.issue_id != issue_id
            or type(grant.model_version_ids) is not frozenset or not grant.model_version_ids
            or not all(_canonical(version) for version in grant.model_version_ids)):
        raise HistoryDenied()
    _check_expiry(grant)
    return grant


def _project_group(group):
    fields = ("run_id", "model_version_id", "ifc_guid", "rule_code", "rule_content_digest", "anchor_id")
    if not isinstance(group, dict) or not all(_canonical(group.get(key)) for key in fields):
        raise HistoryUnavailable()
    members = group.get("members")
    if not isinstance(members, list) or not members:
        raise HistoryUnavailable()
    projected = []
    for member in members:
        if (not isinstance(member, dict)
                or not all(_canonical(member.get(key)) for key in ("id", "ifc_guid", "rule_code"))
                or member.get("status") not in ("pass", "fail", "error")
                or member["ifc_guid"] != group["ifc_guid"] or member["rule_code"] != group["rule_code"]):
            raise HistoryUnavailable()
        projected.append({key: member[key] for key in ("id", "ifc_guid", "rule_code", "status")})
    if group["anchor_id"] not in {member["id"] for member in projected}:
        raise HistoryUnavailable()
    return {**{key: group[key] for key in fields}, "members": projected}


def _project_record(row, issue, grant):
    snapshot = json.loads(row["snapshot_json"])
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != "a1-remediation/v1":
        raise HistoryUnavailable()
    for field in ("id", "issue_id", "principal_ref", "created_at"):
        if not _canonical(snapshot.get(field)) or snapshot[field] != row[field]:
            raise HistoryUnavailable()
    if snapshot["issue_id"] != issue["id"]:
        raise HistoryUnavailable()
    _timestamp(snapshot["created_at"])
    before, after = snapshot.get("revision_before"), snapshot.get("revision_after")
    if (type(before) is not int or type(after) is not int or before < 0 or after != before + 1
            or after > issue["revision"] or not isinstance(snapshot.get("note"), str)
            or len(snapshot["note"]) > 4000):
        raise HistoryUnavailable()
    original = _project_group(snapshot.get("original"))
    revised = _project_group(snapshot.get("revised"))
    if (original["model_version_id"] != issue["model_version_id"]
            or original["anchor_id"] != issue["source_ref"]
            or any(group["ifc_guid"] != issue["ifc_guid"] for group in (original, revised))):
        raise HistoryUnavailable()
    if any(group["model_version_id"] not in grant.model_version_ids for group in (original, revised)):
        raise HistoryDenied()
    if grant.source_cases and not any(snapshot.get("source_identity") == case for case in grant.source_cases):
        raise HistoryDenied()
    fields = ("schema_version", "id", "issue_id", "principal_ref", "created_at",
              "revision_before", "revision_after", "note")
    actor_kind = snapshot.get("actor_kind", "external_authority")
    if actor_kind not in ("external_authority", "local_validation"):
        raise HistoryUnavailable()
    return {**{key: snapshot[key] for key in fields}, "actor_kind": actor_kind,
            "original": original, "revised": revised}


def read_remediation_history(db_path, issue_id, authorize, limit=50, offset=0):
    """Return one coherent page, not a frozen snapshot across HTTP requests.

    No store initialization, migrations or DML. SQLite may still use WAL/SHM
    sidecars while reading an existing WAL database; logical data stays unchanged.
    """
    if (not _canonical(issue_id) or type(limit) is not int or not 1 <= limit <= 100
            or type(offset) is not int or not 0 <= offset <= 9223372036854775807):
        raise HistoryUnavailable()
    grant = _grant(issue_id, authorize)
    conn = None
    try:
        conn = sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        conn.execute("BEGIN")
        row = conn.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone()
        if row is None or row["kind"] != "issue" or row["source_type"] != "rule_result":
            raise HistoryNotFound()
        fields = ("id", "status", "revision", "model_version_id", "ifc_guid", "source_ref")
        issue = {key: row[key] for key in fields}
        if (not all(_canonical(issue[key]) for key in ("id", "model_version_id", "ifc_guid", "source_ref"))
                or type(issue["revision"]) is not int or issue["revision"] < 0
                or issue["status"] not in ("open", "assigned", "in_progress", "resolved", "rejected", "reopened")):
            raise HistoryUnavailable()
        if issue["model_version_id"] not in grant.model_version_ids:
            raise HistoryDenied()
        original_anchor = conn.execute("SELECT rule_run_id FROM rule_results WHERE id=?", (issue["source_ref"],)).fetchone()
        if original_anchor is None:
            raise HistoryUnavailable()
        if grant.source_cases:
            from .remediation import run_source_binding
            anchor = conn.execute("SELECT rule_run_id,rule_code,ifc_guid FROM rule_results WHERE id=?",
                                  (issue["source_ref"],)).fetchone()
            if anchor is None or anchor["ifc_guid"] != issue["ifc_guid"]:
                raise HistoryUnavailable()
            original_run = conn.execute("SELECT * FROM rule_runs WHERE id=?", (anchor["rule_run_id"],)).fetchone()
            if original_run is None:
                raise HistoryUnavailable()
            original_binding = run_source_binding(original_run)
            for case in grant.source_cases:
                if (case["issue_id"] != issue_id or case["tenant_id"] != original_binding["tenant_id"]
                        or case["project_id"] != original_binding["project_id"]
                        or case["original"] != original_binding["source"]
                        or case["ifc_guid"] != issue["ifc_guid"] or case["rule_code"] != anchor["rule_code"]):
                    raise HistoryDenied()
                revised_run = conn.execute("SELECT * FROM rule_runs WHERE id=?", (case["revised"]["run_id"],)).fetchone()
                if revised_run is None:
                    raise HistoryUnavailable()
                revised_binding = run_source_binding(revised_run)
                if (case["tenant_id"] != revised_binding["tenant_id"] or case["project_id"] != revised_binding["project_id"]
                        or case["revised"] != revised_binding["source"]):
                    raise HistoryDenied()
        total = conn.execute("SELECT COUNT(*) FROM issue_remediation_confirmations WHERE issue_id=?",
                             (issue_id,)).fetchone()[0]
        rows = conn.execute("SELECT id,issue_id,principal_ref,created_at,snapshot_json "
                            "FROM issue_remediation_confirmations WHERE issue_id=? "
                            "ORDER BY created_at ASC,id ASC LIMIT ? OFFSET ?", (issue_id, limit, offset))
        items = [_project_record(row, issue, grant) for row in rows]
        _check_expiry(grant)
        next_offset = offset + len(items)
        return {"issue": issue, "original_run_id": original_anchor["rule_run_id"], "items": items, "total": total, "limit": limit, "offset": offset,
                "next_offset": next_offset if next_offset < total else None}
    except (HistoryDenied, HistoryNotFound):
        raise
    except (sqlite3.Error, ValueError, TypeError, KeyError, IndexError, OverflowError, OSError):
        raise HistoryUnavailable() from None
    finally:
        if conn is not None:
            conn.close()
