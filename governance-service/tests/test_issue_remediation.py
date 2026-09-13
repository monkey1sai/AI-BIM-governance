"""A1 confirmation: real SQLite and rule engine outcomes, fixture-only authority."""
import json
import hashlib
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import ifcopenshell
import pytest

from issues.remediation import confirm_remediation
from ifctester import ids, facet

from db import Store
from issues.store import IssueStore, TransitionError
from rule_engine.engine import run_rules
from rule_engine.ids_runner import run_ids

GUID = "0abcdefghijklmnopqrstu"

def make_case(tmp_path, ids_mode=False, partial=False):
    from issues.remediation import ConfirmationCommand, ConfirmationDecision
    path = str(tmp_path / "governance.db")
    runs, issues = Store(path), IssueStore(path)
    definition = {"rule_set": "names", "version": "1", "rules": [{
        "rule_code": "NAME", "target_ifc_type": "IfcWall",
        "predicate": {"type": "naming_convention", "pattern": "^Wall$"}}]}
    document = ids.Ids(title="remediation")
    spec = ids.Specification(name="wall")
    spec.applicability.append(facet.Entity(name="IFCWALL"))
    spec.requirements.extend([facet.Attribute(name="Name", value="Wall"),
                              facet.Attribute(name="Description", value="ready")])
    document.specifications.append(spec)
    run_ids_created = []
    for version, name, description in (("v1", "Bad", "bad"), ("v2", "Wall", "bad" if partial else "ready")):
        model = ifcopenshell.file(schema="IFC4")
        model.create_entity("IfcWall", GlobalId=GUID, Name=name, Description=description)
        outcome = run_ids(model, document) if ids_mode else run_rules(model, definition)
        outcome.source_sha256 = hashlib.sha256(model.to_string().encode()).hexdigest()
        run_id = runs.create_run(version, "synthetic.ifc", outcome.rule_set,
            {"tenant_id": "fixture-tenant", "project_id": "fixture-project", "model_version_id": version})
        runs.complete_run(run_id, outcome)
        run_ids_created.append(run_id)
    original, revised = run_ids_created
    original_result = runs.get_results(original, "fail")[0]
    revised_result = runs.get_results(revised, "pass")[0]
    issue = issues.create_issue("test", ifc_guid=GUID, model_version_id="v1",
        source_type="rule_result", source_ref=original_result["id"])
    command = ConfirmationCommand(issue["id"], 0, "v2", revised, revised_result["id"], "confirm-1", "checked")
    def authorize(context):
        if (context.issue_id, context.project_id, context.original_model_version_id,
            context.original_run_id, context.revised_model_version_id,
            context.revised_run_id, context.ifc_guid, context.rule_code) != (
            issue["id"], "fixture-project", "v1", original, "v2", revised, GUID,
            original_result["rule_code"]):
            return None
        return ConfirmationDecision(context, "test-supervisor", "fixture-authorization",
            f"fixture-correspondence-{context.expected_revision}",
            (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat())
    return SimpleNamespace(issues=issues, runs=runs, path=path, command=command,
        authorize=authorize, original=original, revised=revised)


def reopen_case(case, revision=1):
    from issues.remediation import reopen_remediation
    from issues.remediation_authority import RequestAuthority
    binding = json.loads(case.runs.get_run(case.original)["summary_json"])
    authority = RequestAuthority({"expires_at_ms": int(datetime.now(timezone.utc).timestamp() * 1000) + 20000,
        "operation": "reopen", "principal_ref": "test-supervisor", "actor_kind": "external_authority",
        "authorization_ref": "fixture-reopen", "cases": [{"issue_id": case.command.issue_id,
            "tenant_id": "fixture-tenant", "project_id": "fixture-project", "ifc_guid": GUID,
            "rule_code": case.runs.get_results(case.original)[0]["rule_code"],
            "original": {"run_id": case.original, "model_version_id": "v1", "source_sha256": binding["source_sha256"]}}]})
    return reopen_remediation(case.issues, case.command.issue_id, revision, "fixture reopen", authority)


def fresh_confirmation(case):
    """A distinct real engine run/version for history pagination, not recycled evidence."""
    from issues.remediation import ConfirmationDecision
    model = ifcopenshell.file(schema="IFC4")
    model.create_entity("IfcWall", GlobalId=GUID, Name="Wall", Description="ready")
    outcome = run_rules(model, {"rule_set": "names", "version": "1", "rules": [{
        "rule_code": "NAME", "target_ifc_type": "IfcWall",
        "predicate": {"type": "naming_convention", "pattern": "^Wall$"}}]})
    outcome.source_sha256 = hashlib.sha256(model.to_string().encode()).hexdigest()
    run_id = case.runs.create_run("v3", "synthetic.ifc", outcome.rule_set,
        {"tenant_id": "fixture-tenant", "project_id": "fixture-project", "model_version_id": "v3"})
    case.runs.complete_run(run_id, outcome)
    command = replace(case.command, expected_revision=2, revised_model_version_id="v3", revised_run_id=run_id,
        revised_result_id=case.runs.get_results(run_id)[0]["id"], idempotency_key="confirm-2")
    def authorize(context):
        assert context.revised_run_id == run_id and context.revised_model_version_id == "v3"
        return ConfirmationDecision(context, "test-supervisor", "fixture-new-grant", "fixture-new-pair",
            (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat())
    return confirm_remediation(case.issues, command, authorize=authorize)

@pytest.fixture
def case(tmp_path):
    return lambda: make_case(tmp_path)

def state(case):
    with sqlite3.connect(case.path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM issue_remediation_confirmations").fetchone()[0]
    return case.issues.get_issue(case.command.issue_id), case.issues.get_events(case.command.issue_id), count

def test_atomic_success_preserves_origin(case):
    case = case()
    before = state(case)
    result = confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert result["replayed"] is False
    assert result["issue"]["status"] == "resolved"
    assert result["issue"]["revision"] == 1
    for key in ("model_version_id", "ifc_guid", "source_type", "source_ref"):
        assert result["issue"][key] == before[0][key]
    snapshot = result["confirmation"]
    assert snapshot["principal_ref"] == "test-supervisor"
    assert snapshot["original"]["anchor_id"] == before[0]["source_ref"]
    assert snapshot["revised"]["anchor_id"] == case.command.revised_result_id
    assert [r["status"] for r in snapshot["revised"]["members"]] == ["pass"]
    assert snapshot["note"] == "checked"
    assert datetime.fromisoformat(snapshot["created_at"]).tzinfo is not None
    assert state(case)[2] == 1 and len(state(case)[1]) == 2

@pytest.mark.parametrize("mode", ["missing", "denied", "scope", "expired", "naive", "principal", "reference"])
def test_authorization_rejection_has_no_writes(case, mode):
    case = case()
    from issues.remediation import ConfirmationUnauthorized
    before = state(case)
    def wrong(context):
        decision = case.authorize(context)
        return {
            "denied": None,
            "scope": replace(decision, context=replace(context, project_id="elsewhere")),
            "expired": replace(decision, expires_at="2000-01-01T00:00:00+00:00"),
            "naive": replace(decision, expires_at="2999-01-01T00:00:00"),
            "principal": replace(decision, principal_ref=""),
            "reference": replace(decision, correspondence_ref=""),
        }[mode]
    with pytest.raises(ConfirmationUnauthorized):
        confirm_remediation(case.issues, case.command, authorize=None if mode == "missing" else wrong)
    assert state(case) == before

@pytest.mark.parametrize("sql", [
    "UPDATE rule_results SET ifc_guid='wrong' WHERE rule_run_id=(SELECT id FROM rule_runs WHERE model_version_id='v2')",
    "UPDATE rule_results SET rule_code='wrong' WHERE rule_run_id=(SELECT id FROM rule_runs WHERE model_version_id='v2')",
    "UPDATE rule_results SET status='pass' WHERE rule_run_id=(SELECT id FROM rule_runs WHERE model_version_id='v1')",
    "UPDATE rule_runs SET status='running' WHERE model_version_id='v2'",
    "UPDATE rule_runs SET model_version_id='wrong' WHERE model_version_id='v2'",
])
def test_wrong_anchor_and_unfinished_run_cannot_confirm(case, sql):
    case = case()
    from issues.remediation import ConfirmationError
    with sqlite3.connect(case.path) as conn:
        conn.execute(sql)
    before = state(case)
    with pytest.raises(ConfirmationError):
        confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert state(case) == before

@pytest.mark.parametrize("field,value", [("project_id", "other"), ("model_version_id", "other")])
def test_metadata_scope_mismatch_is_not_authority(case, field, value):
    case = case()
    from issues.remediation import ConfirmationError
    metadata = {"project_id": "fixture-project", "model_version_id": "v2", field: value}
    with sqlite3.connect(case.path) as conn:
        conn.execute("UPDATE rule_runs SET source_metadata_json=? WHERE id=?", (json.dumps(metadata), case.revised))
    before = state(case)
    with pytest.raises(ConfirmationError):
        confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert state(case) == before

@pytest.mark.parametrize("mutation", ["null-guid", "error", "missing"])
def test_ids_group_integrity_rejects_nonpass_or_missing_member(tmp_path, mutation):
    case = make_case(tmp_path, ids_mode=True)
    from issues.remediation import ConfirmationError
    members = case.runs.get_results(case.revised)
    other = next(row for row in members if row["id"] != case.command.revised_result_id)
    summary = json.loads(case.runs.get_run(case.revised)["summary_json"])
    with sqlite3.connect(case.path) as conn:
        if mutation == "null-guid":
            conn.execute("UPDATE rule_results SET ifc_guid=NULL WHERE id=?", (other["id"],))
        elif mutation == "error":
            conn.execute("UPDATE rule_results SET status='error' WHERE id=?", (other["id"],))
            summary["passed"] -= 1
            summary["errored"] += 1
        else:
            conn.execute("DELETE FROM rule_results WHERE id=?", (other["id"],))
            summary["passed"] -= 1
            summary["total"] -= 1
        conn.execute("UPDATE rule_runs SET summary_json=? WHERE id=?", (json.dumps(summary), case.revised))
    before = state(case)
    with pytest.raises(ConfirmationError):
        confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert state(case) == before

def test_reopened_cannot_reuse_consumed_correspondence(case):
    case = case()
    from issues.remediation import ConfirmationConflict
    confirm_remediation(case.issues, case.command, authorize=case.authorize)
    reopen_case(case)
    before = state(case)
    def stale(context):
        return replace(case.authorize(context), correspondence_ref="fixture-correspondence-0")
    with pytest.raises(ConfirmationConflict):
        confirm_remediation(case.issues, replace(case.command, expected_revision=2, idempotency_key="new"),
                                        authorize=stale)
    assert state(case) == before

def test_expiry_between_validation_and_commit_rolls_back(case, monkeypatch):
    case = case()
    import issues.remediation as module
    actual = datetime.now(timezone.utc)
    class Clock(datetime):
        calls = 0
        @classmethod
        def now(cls, tz=None):
            cls.calls += 1
            return actual if cls.calls == 1 else actual + timedelta(hours=1)
    monkeypatch.setattr(module, "datetime", Clock)
    before = state(case)
    with pytest.raises(module.ConfirmationUnauthorized):
        confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert state(case) == before

def test_fresh_authorization_required_even_for_replay(case):
    case = case()
    from issues.remediation import ConfirmationUnauthorized
    confirm_remediation(case.issues, case.command, authorize=case.authorize)
    before = state(case)
    with pytest.raises(ConfirmationUnauthorized):
        confirm_remediation(case.issues, case.command, authorize=lambda context: None)
    assert state(case) == before


@pytest.mark.parametrize("field,value", [
    ("expected_revision", True), ("expected_revision", -1), ("expected_revision", "0"),
    ("issue_id", ""), ("idempotency_key", " "), ("note", None)])
def test_command_is_strict(case, field, value):
    case = case()
    from issues.remediation import ConfirmationError
    before = state(case)
    with pytest.raises(ConfirmationError):
        confirm_remediation(case.issues, replace(case.command, **{field: value}), authorize=case.authorize)
    assert state(case) == before

def test_browser_actor_and_pass_are_not_command_fields(case):
    case = case()
    from issues.remediation import ConfirmationCommand
    with pytest.raises(TypeError):
        ConfirmationCommand(**vars(case.command), actor="supervisor", passed=True)

@pytest.mark.parametrize("sql,args", [
    ("UPDATE issues SET source_ref='missing'", ()),
    ("UPDATE issues SET source_type='manual'", ()),
    ("UPDATE issues SET kind='annotation'", ()),
    ("UPDATE rule_runs SET status='failed' WHERE model_version_id='v2'", ()),
    ("UPDATE rule_runs SET source_metadata_json='{}' WHERE model_version_id='v2'", ()),
    ("UPDATE rule_runs SET summary_json='{}' WHERE model_version_id='v2'", ()),
    ("UPDATE rule_results SET status='fail' WHERE rule_run_id=(SELECT id FROM rule_runs WHERE model_version_id='v2')", ()),
    ("DELETE FROM rule_results WHERE rule_run_id=(SELECT id FROM rule_runs WHERE model_version_id='v2')", ()),
])
def test_invalid_persisted_evidence_is_rejected(case, sql, args):
    case = case()
    from issues.remediation import ConfirmationError, ConfirmationUnauthorized
    with sqlite3.connect(case.path) as conn:
        conn.execute(sql, args)
    before = state(case)
    with pytest.raises((ConfirmationError, ConfirmationUnauthorized)):
        confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert state(case) == before

@pytest.mark.parametrize("digest", [None, "unknown:sha256:" + "a"*64, "dsl-json-v1:sha256:" + "b"*64])
def test_absent_unknown_or_changed_rule_identity_rejected(case, digest):
    case = case()
    from issues.remediation import ConfirmationError
    summary = json.loads(case.runs.get_run(case.revised)["summary_json"])
    summary["rule_content_digest"] = digest
    with sqlite3.connect(case.path) as conn:
        conn.execute("UPDATE rule_runs SET summary_json=? WHERE id=?", (json.dumps(summary), case.revised))
    before = state(case)
    with pytest.raises(ConfirmationError):
        confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert state(case) == before

@pytest.mark.parametrize("partial", [False, True])
def test_ids_complete_group_not_one_selected_pass(tmp_path, partial):
    case = make_case(tmp_path, ids_mode=True, partial=partial)
    from issues.remediation import ConfirmationError
    if partial:
        before = state(case)
        with pytest.raises(ConfirmationError):
            confirm_remediation(case.issues, case.command, authorize=case.authorize)
        assert state(case) == before
    else:
        result = confirm_remediation(case.issues, case.command, authorize=case.authorize)
        assert len(result["confirmation"]["original"]["members"]) == 2
        assert [r["status"] for r in result["confirmation"]["revised"]["members"]] == ["pass", "pass"]

def test_replay_restart_and_reopened_history(case):
    case = case()
    first = confirm_remediation(case.issues, case.command, authorize=case.authorize)
    case.issues = IssueStore(case.path)
    before = state(case)
    assert confirm_remediation(case.issues, case.command, authorize=case.authorize)["confirmation"] == first["confirmation"]
    assert state(case) == before
    reopen_case(case)
    before = state(case)
    replay = confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert replay["replayed"] and replay["issue"]["status"] == "reopened"
    assert replay["confirmation"] == first["confirmation"] and state(case) == before
    from issues.remediation import ConfirmationConflict
    with pytest.raises(ConfirmationConflict):
        confirm_remediation(case.issues, replace(case.command, expected_revision=2, idempotency_key="new-ref-old-run"), authorize=case.authorize)
    assert fresh_confirmation(case)["issue"]["revision"] == 3
    assert state(case)[2] == 2

@pytest.mark.parametrize("change", ["note", "principal"])
def test_replay_cannot_change_payload_or_principal(case, change):
    case = case()
    from issues.remediation import ConfirmationError, ConfirmationUnauthorized
    confirm_remediation(case.issues, case.command, authorize=case.authorize)
    before = state(case)
    command = replace(case.command, note="different") if change == "note" else case.command
    def authorize(context):
        return replace(case.authorize(context), principal_ref="other")
    with pytest.raises((ConfirmationError, ConfirmationUnauthorized)):
        confirm_remediation(case.issues, command, authorize=authorize if change == "principal" else case.authorize)
    assert state(case) == before

@pytest.mark.parametrize("table", ["issue_events", "issue_remediation_confirmations"])
def test_storage_failure_rolls_back_every_write(case, table):
    case = case()
    with sqlite3.connect(case.path) as conn:
        conn.execute(f"CREATE TRIGGER reject_insert BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'test failure'); END")
    before = state(case)
    with pytest.raises(sqlite3.IntegrityError):
        confirm_remediation(case.issues, case.command, authorize=case.authorize)
    assert state(case) == before

@pytest.mark.parametrize("same_key", [True, False])
def test_concurrency_is_serialized(case, same_key):
    case = case()
    from issues.remediation import ConfirmationConflict
    barrier = Barrier(2)
    def attempt(index):
        barrier.wait(timeout=5)
        command = case.command if same_key else replace(case.command, idempotency_key=f"key-{index}")
        try:
            return "replay" if confirm_remediation(case.issues, command, authorize=case.authorize)["replayed"] else "accepted"
        except ConfirmationConflict:
            return "conflict"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [0, 1]))
    assert sorted(results) == (["accepted", "replay"] if same_key else ["accepted", "conflict"])
    assert state(case)[2] == 1 and len(state(case)[1]) == 2

def test_rejected_and_generic_resolution_still_denied(case):
    case = case()
    from issues.remediation import ConfirmationConflict
    with pytest.raises(TransitionError):
        case.issues.transition(case.command.issue_id, "resolved")
    case.issues.transition(case.command.issue_id, "rejected")
    before = state(case)
    with pytest.raises(ConfirmationConflict):
        confirm_remediation(case.issues, replace(case.command, expected_revision=1), authorize=case.authorize)
    assert state(case) == before
