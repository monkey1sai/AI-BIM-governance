import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import time

import pytest
from jsonschema import Draft7Validator


ROOT = pathlib.Path(__file__).resolve().parents[1]
CLAUDE_VALIDATOR = ROOT / ".claude/skills/spec-to-done/validate-state.mjs"
NEW_RUN_APPENDER = ROOT / ".claude/skills/spec-to-done/append-new-run.mjs"
TRUSTED_GIT_MODULE = ROOT / ".claude/skills/spec-to-done/trusted-git.mjs"
CODEX_VALIDATOR = ROOT / ".codex/skills/spec-to-done/validate-state.mjs"
CLAUDE_SKILL = ROOT / ".claude/skills/spec-to-done/SKILL.md"
CODEX_SKILL = ROOT / ".codex/skills/spec-to-done/SKILL.md"
GROK_SKILL = ROOT / ".claude/skills/spec-to-done/GROK.md"
MACHINE_CONTRACT = ROOT / "agent-contracts/spec-to-done.contract.json"
MACHINE_CONTRACT_SCHEMA = ROOT / "agent-contracts/spec-to-done.contract.schema.json"
FABRIC_BINDING_MODULE = ROOT / "scripts/lib/spec-to-done-fabric-binding.mjs"
FABRIC_OPERATOR_DOC = ROOT / "docs/agents/parallel-delivery-fabric.md"
GIT = shutil.which("git")
EXCLUSIONS = (
    "secrets,credentials,billing,production-data,destructive-delete,"
    "unproven-process-stop"
)


def _require_git():
    if GIT is not None:
        return
    if os.environ.get("SPEC_TO_DONE_REQUIRE_TRUSTED_GIT_TESTS") == "1":
        pytest.fail("required trusted-Git coverage cannot run because git is unavailable")
    pytest.skip("git is required")


def _handle_host_env_blocked(result, *, expected=False):
    if result.get("held") != "host_env_blocked" or expected:
        return
    detail = result.get("detail", "trusted Git unavailable")
    if os.environ.get("SPEC_TO_DONE_REQUIRE_TRUSTED_GIT_TESTS") == "1":
        pytest.fail(f"required trusted-Git coverage was blocked: {detail}")
    pytest.skip(f"expected host capability boundary: {detail}")


def _git(repo, *args):
    _require_git()
    return subprocess.run(
        [GIT, *args], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()


def _new_repo(tmp_path, name="repo"):
    repo = tmp_path / name
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "test@example.invalid")
    _git(repo, "config", "user.name", "Contract Test")
    source = repo / "src/app.txt"
    source.parent.mkdir()
    source.write_text("v1\n", encoding="utf-8")
    _git(repo, "add", "src/app.txt")
    _git(repo, "commit", "-m", "base product")
    return repo, _git(repo, "rev-parse", "HEAD")


def _line(repo, commit_head, prefix="DONE@P5", **overrides):
    fields = {
        "spec": (repo / "spec.md").as_posix(),
        "slug": "demo",
        "userFacing": "false",
        "dateStamp": "2026-07-29",
        "branch": "feat/demo",
        "worktree": repo.as_posix(),
        "head": commit_head,
        "executionMode": "full",
        "closeoutTaskIds": "",
        "planPath": "",
        "taskIndex": "2",
        "prNumber": "",
        "runIds": "P5:wf_abc123",
        "agentCalls": "8/40",
        "p5Rounds": "1/2",
        "evidenceAttempts": "1/2",
        "evidenceHead": commit_head,
        "診斷": "none",
        "需要使用者決定": "none",
    }
    fields.update(overrides)
    return prefix + " | " + " | ".join(
        f"{key}={value}" for key, value in fields.items()
    )


def _run(
    tmp_path,
    repo,
    state_lines,
    *,
    platform="claude",
    expected_head=None,
    limits=("40", "2", "2"),
    git_exe=None,
    env_overrides=None,
    trusted_main_ref="refs/heads/main",
    extra_args=(),
    state_path=None,
    expect_host_env_blocked=False,
):
    _require_git()
    state = pathlib.Path(state_path) if state_path else tmp_path / "state.md"
    state.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(state_lines, str):
        state_lines = [state_lines]
    state.write_text("\n".join(state_lines) + "\n", encoding="utf-8")
    args = [
            "node",
            str(CLAUDE_VALIDATOR),
            "--state",
            str(state),
            "--platform",
            platform,
            "--git-exe",
            git_exe or GIT,
            "--expected-head",
            expected_head or _git(repo, "rev-parse", "HEAD"),
            "--expected-worktree",
            repo.as_posix(),
            "--expected-agent-limit",
            limits[0],
            "--expected-p5-limit",
            limits[1],
            "--expected-evidence-limit",
            limits[2],
            "--trusted-main-ref",
            trusted_main_ref,
    ]
    args.extend(extra_args)
    proc = subprocess.run(
        args,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, **(env_overrides or {})},
    )
    result = json.loads(proc.stdout)
    _handle_host_env_blocked(result, expected=expect_host_env_blocked)
    return proc.returncode, result


def _canonical_digest(value):
    canonical = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _stamp(value):
    return {**value, "canonical_digest": _canonical_digest(value)}


def _fabric_binding_fixture(tmp_path, repo, *, committed_changes=None):
    ignore = repo / ".gitignore"
    ignore.write_text("artifacts/\n", encoding="utf-8")
    _git(repo, "add", ".gitignore")
    _git(repo, "commit", "-m", "ignore local state artifacts")
    baseline = _git(repo, "rev-parse", "HEAD")
    for relative, contents in (committed_changes or {}).items():
        target = repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(contents, encoding="utf-8")
        _git(repo, "add", "--", relative)
    if committed_changes:
        _git(repo, "commit", "-m", "committed scope fixture")
    head = _git(repo, "rev-parse", "HEAD")
    branch = _git(repo, "branch", "--show-current")
    now = "2026-08-31T01:00:00.000Z"
    sha256_a = "a" * 64
    sha256_b = "b" * 64
    scope_resources = [{"kind": "path", "path": "src"}]
    scope_digest = _canonical_digest(scope_resources)
    plan = {
        "schema_version": "parallel-delivery-fabric/v1",
        "plan_id": "plan:managed-state",
        "generation": 1,
        "repo_identity": {
            "full_name": "acme/ai-bim-governance",
            "repository_id": 42,
            "common_dir_digest": sha256_a,
        },
        "created_at": now,
        "coordinator_session": "session:coordinator",
        "baseline_ref": "origin/main",
        "resolved_baseline_sha": baseline,
        "tasks": [{
            "task_id": "task:managed-state",
            "outcome": "validate-managed-state",
            "provider_preference": "codex",
            "owner_session": "session:managed-writer",
            "scope": {
                "owning_service": "agent-governance",
                "public_entrypoint": ".claude/skills/spec-to-done/SKILL.md",
                "resources": scope_resources,
                "expected_tests": ["test:managed-state"],
                "e2e_required": False,
            },
            "dependencies": [],
            "risk": "bounded",
            "e2e_required": False,
        }],
        "requested_capacity": {"writers": 2, "runtime_leases": 0},
        "branch_profile": "trunk",
        "acceptance_criteria": ["criterion:managed-state-valid"],
        "promotion_mode": "single_pr",
        "requested_execution_level": "implement_local",
        "authority_reference": "authority:managed-state",
        "governance_source_refs": [
            "openspec:spec-to-done-parallel-delivery-binding"
        ],
    }
    lease = _stamp({
        "schema_version": "session-lease/v1",
        "generation": 1,
        "nonce": "n" * 32,
        "created_at": now,
        "updated_at": now,
        "lease_id": "lease:managed-state",
        "lease_kind": "writer_seat",
        "plan_id": "plan:managed-state",
        "task_id": "task:managed-state",
        "provider": "codex",
        "owner_session": "session:managed-writer",
        "provider_session_id": "provider-session:managed-state",
        "execution_context_id": "execution-context:managed-state",
        "context_attestation_ref": "attestation:managed-state",
        "common_dir_digest": sha256_a,
        "worktree_id": "worktree:managed-state",
        "worktree_path_digest": sha256_b,
        "branch": branch,
        "scope_digest": scope_digest,
        "head_sha": head,
        "resource_keys": ["path:src"],
        "state": "ACTIVE",
        "heartbeat_seq": 1,
        "heartbeat_at": now,
        "release_evidence_ref": None,
        "retention_state": "ACTIVE",
        "revocation_epoch": 0,
    })
    provider = {
        "schema_version": "provider-session-envelope/v1",
        "plan_id": "plan:managed-state",
        "generation": 1,
        "task_id": "task:managed-state",
        "provider": "codex",
        "owner_session": "session:managed-writer",
        "provider_session_id": "provider-session:managed-state",
        "execution_context_id": "execution-context:managed-state",
        "repo_identity_digest": sha256_a,
        "common_dir_digest": sha256_a,
        "worktree_id": "worktree:managed-state",
        "worktree_path_digest": sha256_b,
        "branch": branch,
        "baseline_sha": baseline,
        "scope_digest": scope_digest,
        "resource_keys": ["path:src"],
        "lease_id": "lease:managed-state",
        "heartbeat_seq": 1,
        "heartbeat_state": "ACTIVE",
        "heartbeat_at": now,
        "context_attestation_ref": "attestation:managed-state",
        "context_attestation_digest": sha256_b,
        "evidence_head_sha": head,
        "evidence_refs": ["evidence:managed-state"],
        "handoff_id": None,
        "adapter_version": "fabric-adapter/v1",
    }
    builder_input = {
        "slug": "demo",
        "allowed_paths": ["src/app.txt"],
        "plan": plan,
        "lease": lease,
        "provider_session": provider,
    }
    source = f"""
import fs from 'node:fs'
import {{ buildSpecToDoneFabricBinding }} from {json.dumps(FABRIC_BINDING_MODULE.as_uri())}
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
process.stdout.write(JSON.stringify(buildSpecToDoneFabricBinding(input)))
"""
    built = subprocess.run(
        ["node", "--input-type=module", "--eval", source],
        input=json.dumps(builder_input),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    binding = json.loads(built.stdout)
    source_root = tmp_path / "fabric-sources"
    source_root.mkdir()
    plan_path = source_root / "plan.json"
    lease_path = source_root / "lease.json"
    provider_path = source_root / "provider-session.json"
    for target, value in (
        (plan_path, plan),
        (lease_path, lease),
        (provider_path, provider),
    ):
        target.write_text(json.dumps(value), encoding="utf-8")
    binding_path = repo / binding["binding_relative_path"]
    binding_path.parent.mkdir(parents=True)
    binding_path.write_text(json.dumps(binding), encoding="utf-8")
    expected_state_path = repo / binding["state_relative_path"]
    candidate_state_path = expected_state_path.with_name(
        expected_state_path.name + ".candidate"
    )
    extra_args = (
        "--fabric-binding", str(binding_path),
        "--fabric-plan", str(plan_path),
        "--fabric-lease", str(lease_path),
        "--fabric-provider-session", str(provider_path),
        "--expected-state-path", str(expected_state_path),
    )
    return {
        "binding": binding,
        "binding_path": binding_path,
        "plan_path": plan_path,
        "lease_path": lease_path,
        "provider_path": provider_path,
        "expected_state_path": expected_state_path,
        "candidate_state_path": candidate_state_path,
        "extra_args": extra_args,
        "head": head,
        "baseline": baseline,
        "branch": branch,
    }


def _set_fabric_sources_suspect(fabric):
    later = "2026-08-31T01:05:00.000Z"
    lease = json.loads(fabric["lease_path"].read_text(encoding="utf-8"))
    lease.pop("canonical_digest")
    lease.update({
        "state": "SUSPECT",
        "suspect_at": later,
        "updated_at": later,
        "heartbeat_seq": 2,
        "heartbeat_at": later,
    })
    fabric["lease_path"].write_text(
        json.dumps(_stamp(lease)), encoding="utf-8"
    )
    provider = json.loads(fabric["provider_path"].read_text(encoding="utf-8"))
    provider.update({
        "heartbeat_state": "SUSPECT",
        "heartbeat_seq": 2,
        "heartbeat_at": later,
    })
    fabric["provider_path"].write_text(json.dumps(provider), encoding="utf-8")


def _run_new_run(*args, env_overrides=None):
    proc = subprocess.run(
        ["node", str(NEW_RUN_APPENDER), *map(str, args)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, **(env_overrides or {})},
    )
    return proc.returncode, json.loads(proc.stdout)


def _validate_state_path(state, repo, expected_head, *, platform="codex"):
    _require_git()
    proc = subprocess.run(
        [
            "node",
            str(CLAUDE_VALIDATOR),
            "--state",
            str(state),
            "--platform",
            platform,
            "--git-exe",
            GIT,
            "--expected-head",
            expected_head,
            "--expected-worktree",
            repo.as_posix(),
            "--expected-agent-limit",
            "40",
            "--expected-p5-limit",
            "2",
            "--expected-evidence-limit",
            "2",
            "--trusted-main-ref",
            "refs/heads/main",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return proc.returncode, json.loads(proc.stdout)


def _new_run_fixture(tmp_path, *, held_reason="run_budget_exhausted", exhausted=True):
    source_repo, _ = _new_repo(tmp_path, "new-run-source-repo")
    change = source_repo / "openspec/changes/demo"
    change.mkdir(parents=True)
    (change / "proposal.md").write_text("# demo\n", encoding="utf-8")
    (source_repo / ".gitignore").write_text("artifacts/\n", encoding="utf-8")
    _git(source_repo, "add", "openspec/changes/demo/proposal.md", ".gitignore")
    _git(source_repo, "commit", "-m", "add demo change")
    previous_head = _git(source_repo, "rev-parse", "HEAD")
    branch = _git(source_repo, "branch", "--show-current")
    source_line = _line(
        source_repo,
        previous_head,
        "HELD@P1",
        spec=change.as_posix(),
        reason=held_reason,
        branch=branch,
        agentCalls="40/40" if exhausted else "39/40",
        p5Rounds="0/2",
        evidenceAttempts="0/2",
        evidenceHead="",
    )
    source = source_repo / "artifacts/spec-to-done/demo-state.md"
    source.parent.mkdir(parents=True)
    source_bytes = (source_line + "\r\n").encode("utf-8")
    source.write_bytes(source_bytes)
    _git(source_repo, "commit", "--allow-empty", "-m", "fresh new-run base")
    current_head = _git(source_repo, "rev-parse", "HEAD")
    repo = tmp_path / "new-run-target-repo"
    subprocess.run(
        [GIT, "clone", "--no-hardlinks", source_repo.as_posix(), repo.as_posix()],
        capture_output=True,
        text=True,
        check=True,
    )
    expected = {
        "sha256": hashlib.sha256(source_bytes).hexdigest(),
        "bytes": len(source_bytes),
        "checkpoints": 1,
    }
    return repo, branch, previous_head, current_head, source, source_bytes, expected


def _append_new_run(
    repo,
    branch,
    current_head,
    source,
    expected,
    *,
    expected_overrides=None,
    owner_sha256="09" * 32,
    owner_bytes="479",
    date_stamp="2026-08-26",
    env_overrides=None,
    git_exe=None,
    expect_host_env_blocked=False,
):
    expected = {**expected, **(expected_overrides or {})}
    code, result = _run_new_run(
        "append",
        "--source-state",
        source,
        "--target-worktree",
        repo,
        "--git-exe",
        git_exe or GIT,
        "--expected-branch",
        branch,
        "--expected-head",
        current_head,
        "--expected-source-sha256",
        expected["sha256"],
        "--expected-source-bytes",
        expected["bytes"],
        "--expected-source-checkpoints",
        expected["checkpoints"],
        "--owner-message-sha256",
        owner_sha256,
        "--owner-message-bytes",
        owner_bytes,
        "--date-stamp",
        date_stamp,
        "--json",
        env_overrides=env_overrides,
    )
    _handle_host_env_blocked(result, expected=expect_host_env_blocked)
    return code, result


def _run_trusted_git_pure(export_name, payload):
    allowed_exports = {
        "assertTerminalP7Facts",
        "isSystemGitPath",
        "parseTrustedRemoteMainResult",
    }
    assert export_name in allowed_exports
    source = f"""
import {{ {export_name} as subject }} from {json.dumps(TRUSTED_GIT_MODULE.as_uri())}
const input = {json.dumps(payload)}
try {{
  const value = subject(input)
  process.stdout.write(JSON.stringify({{ ok: true, value: value ?? null }}))
}} catch (error) {{
  process.stdout.write(JSON.stringify({{ ok: false, detail: String(error?.message || error) }}))
  process.exitCode = 2
}}
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "--eval", source],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return proc.returncode, json.loads(proc.stdout)


def _run_sanitized_git_environment(git_exe):
    poison = {
        "LD_PRELOAD": "/self-referential-loader-sentinel/ld-preload.invalid",
        "LD_LIBRARY_PATH": "/self-referential-loader-sentinel/ld-library.invalid",
        "LD_AUDIT": "/self-referential-loader-sentinel/ld-audit.invalid",
        "DYLD_INSERT_LIBRARIES": "/self-referential-loader-sentinel/dyld.invalid",
        "DYLD_LIBRARY_PATH": "/self-referential-loader-sentinel/dyld-library.invalid",
        "NODE_OPTIONS": "--no-warnings",
        "HTTP_PROXY": "http://self-referential-loader-sentinel.invalid",
        "HTTPS_PROXY": "http://self-referential-loader-sentinel.invalid",
        "ProgramFiles": "C:\\self-referential-loader-sentinel",
        "SystemRoot": "C:\\self-referential-loader-sentinel",
        "PATH": "C:\\self-referential-loader-sentinel",
    }
    source = f"""
import {{ sanitizedGitEnvironment }} from {json.dumps(TRUSTED_GIT_MODULE.as_uri())}
const poison = {json.dumps(poison)}
for (const [key, value] of Object.entries(poison)) process.env[key] = value
try {{
  const env = sanitizedGitEnvironment({json.dumps(str(git_exe))})
  const inherited = Object.fromEntries(
    Object.keys(poison).filter((key) => env[key] === poison[key]).map((key) => [key, env[key]])
  )
  process.stdout.write(JSON.stringify({{ ok: true, keys: Object.keys(env).sort(), inherited }}))
}} catch (error) {{
  process.stdout.write(JSON.stringify({{ ok: false, detail: String(error?.message || error) }}))
  process.exitCode = 2
}}
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "--eval", source],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return proc.returncode, json.loads(proc.stdout)


def test_machine_contract_is_schema_valid_closed_and_deterministic():
    schema = json.loads(MACHINE_CONTRACT_SCHEMA.read_text(encoding="utf-8"))
    contract = json.loads(MACHINE_CONTRACT.read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    Draft7Validator(schema).validate(contract)
    assert contract["schema_version"] == "spec-to-done-contract/v2"
    assert contract["phases"] == ["P0", "P1", "P3", "P4", "P5", "P6", "P7"]
    reasons = contract["durable_state"]["held_reasons"]
    assert reasons == sorted(set(reasons))
    assert contract["ship"]["unavailable_reason"] in reasons
    assert contract["terminal_evidence"] == {
        "owner_phase": "P7",
        "trusted_remote_url": "https://github.com/monkey1sai/AI-BIM-governance.git",
        "remote_main_ref": "refs/heads/main",
        "live_remote_resolution": "required",
        "pr_head_ancestor_of_merge_commit": "required",
        "merge_commit_equals_remote_main": "required",
        "pr_head_and_merge_commit_same_tree": "required",
    }
    assert contract["durable_state"]["canonical_relative_path"] == (
        "artifacts/spec-to-done/{slug}-state.md"
    )
    assert contract["durable_state"]["fabric_managed_relative_path"] == (
        "artifacts/spec-to-done/{slug}--{binding_id}-state.md"
    )
    assert contract["durable_state"]["fabric_binding_relative_path"] == (
        "artifacts/spec-to-done/bindings/{binding_id}.json"
    )
    assert contract["parallel_delivery_binding"] == {
        "schema_version": "spec-to-done-fabric-binding/v1",
        "schema_path": "agent-contracts/spec-to-done-fabric-binding.schema.json",
        "state_mode": "fabric-managed",
        "mode_field": "fabricMode",
        "binding_id_field": "fabricBindingId",
        "session_admission_limit": "unbounded",
        "run_writer_cardinality": 1,
        "held_lease_action": "retain_as_suspect",
        "local_new_run_allowed": False,
        "local_resume_allowed": False,
        "resume_authority": "fabric_verified_resume_intent_required",
        "delivery_authority": "non_authorizing",
    }


def test_fabric_managed_state_requires_exact_binding_and_unique_state_path(tmp_path):
    repo, _ = _new_repo(tmp_path)
    fabric = _fabric_binding_fixture(tmp_path, repo)
    line = _line(
        repo,
        fabric["head"],
        "DONE@P3",
        branch=fabric["branch"],
        runIds="P3:codex:managed-state-session",
        fabricMode="fabric-managed",
        fabricBindingId=fabric["binding"]["binding_id"],
    )

    code, result = _run(
        tmp_path,
        repo,
        line,
        platform="codex",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 0 and result["ok"] is True, result
    assert result["fabric"] == {
        "mode": "fabric-managed",
        "bindingId": fabric["binding"]["binding_id"],
        "currentLeaseState": "ACTIVE",
        "heldLeaseAction": "retain_as_suspect",
        "statePath": fabric["expected_state_path"].as_posix(),
    }

    wrong_state_path = fabric["expected_state_path"].with_name("demo-wrong-state.md")
    wrong_args = list(fabric["extra_args"])
    wrong_args[-1] = str(wrong_state_path)
    code, result = _run(
        tmp_path,
        repo,
        line,
        platform="codex",
        expected_head=fabric["head"],
        extra_args=wrong_args,
        state_path=fabric["candidate_state_path"],
    )
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_fabric_managed_state_rejects_committed_paths_outside_allowed_paths(tmp_path):
    repo, _ = _new_repo(tmp_path)
    fabric = _fabric_binding_fixture(
        tmp_path,
        repo,
        committed_changes={"docs/outside.md": "outside declared scope\n"},
    )
    line = _line(
        repo,
        fabric["head"],
        "DONE@P3",
        branch=fabric["branch"],
        runIds="P3:codex:managed-state-session",
        fabricMode="fabric-managed",
        fabricBindingId=fabric["binding"]["binding_id"],
    )

    code, result = _run(
        tmp_path,
        repo,
        line,
        platform="codex",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )

    assert code == 2 and result["held"] == "scope_drift", result
    assert "committed changes exceed Fabric allowed_paths (1 path(s))" in result["detail"]


def test_fabric_managed_state_rejects_partial_fields_binding_drift_and_legacy_misrouting(tmp_path):
    repo, _ = _new_repo(tmp_path)
    fabric = _fabric_binding_fixture(tmp_path, repo)
    binding_id = fabric["binding"]["binding_id"]

    partial = _line(
        repo,
        fabric["head"],
        "DONE@P3",
        branch=fabric["branch"],
        runIds="P3:codex:managed-state-session",
        fabricMode="fabric-managed",
    )
    code, result = _run(
        tmp_path,
        repo,
        partial,
        platform="codex",
        expected_head=fabric["head"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 2 and result["held"] == "resume_state_invalid"

    drifted = _line(
        repo,
        fabric["head"],
        "DONE@P3",
        branch=fabric["branch"],
        runIds="P3:codex:managed-state-session",
        fabricMode="fabric-managed",
        fabricBindingId="f" * 64,
    )
    code, result = _run(
        tmp_path,
        repo,
        drifted,
        platform="codex",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 2 and result["held"] == "resume_state_invalid"

    legacy = _line(
        repo,
        fabric["head"],
        "DONE@P3",
        branch=fabric["branch"],
        runIds="P3:codex:managed-state-session",
    )
    code, result = _run(
        tmp_path,
        repo,
        legacy,
        platform="codex",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 2 and result["held"] == "resume_state_invalid"
    assert binding_id != "f" * 64

    wrong_provider = _line(
        repo,
        fabric["head"],
        "DONE@P3",
        branch=fabric["branch"],
        runIds="P3:wf_managed123",
        fabricMode="fabric-managed",
        fabricBindingId=binding_id,
    )
    code, result = _run(
        tmp_path,
        repo,
        wrong_provider,
        platform="claude",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_fabric_binding_identity_is_immutable_across_the_audit_chain(tmp_path):
    repo, _ = _new_repo(tmp_path)
    fabric = _fabric_binding_fixture(tmp_path, repo)
    first = _line(
        repo,
        fabric["head"],
        "DONE@P1",
        branch=fabric["branch"],
        runIds="P1:codex:managed-state-session",
        fabricMode="fabric-managed",
        fabricBindingId=fabric["binding"]["binding_id"],
    )
    second = _line(
        repo,
        fabric["head"],
        "DONE@P3",
        branch=fabric["branch"],
        runIds="P3:codex:managed-state-session",
        fabricMode="fabric-managed",
        fabricBindingId="f" * 64,
    )
    code, result = _run(
        tmp_path,
        repo,
        [first, second],
        platform="codex",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_fabric_managed_held_retains_active_or_suspect_lease(tmp_path):
    repo, _ = _new_repo(tmp_path)
    fabric = _fabric_binding_fixture(tmp_path, repo)
    held = _line(
        repo,
        fabric["head"],
        "HELD@P3",
        branch=fabric["branch"],
        runIds="P3:codex:managed-state-session",
        reason="scope_drift",
        fabricMode="fabric-managed",
        fabricBindingId=fabric["binding"]["binding_id"],
    )

    code, result = _run(
        tmp_path,
        repo,
        held,
        platform="codex",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 0 and result["kind"] == "HELD", result
    assert result["fabric"]["currentLeaseState"] == "ACTIVE"
    assert result["fabric"]["heldLeaseAction"] == "retain_as_suspect"

    _set_fabric_sources_suspect(fabric)
    code, result = _run(
        tmp_path,
        repo,
        held,
        platform="codex",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 0 and result["kind"] == "HELD", result
    assert result["fabric"]["currentLeaseState"] == "SUSPECT"
    assert result["fabric"]["heldLeaseAction"] == "retain_as_suspect"


def test_fabric_managed_resumed_requires_unavailable_outer_authority(tmp_path):
    repo, _ = _new_repo(tmp_path)
    fabric = _fabric_binding_fixture(tmp_path, repo)
    common = {
        "branch": fabric["branch"],
        "runIds": "P3:codex:managed-state-session",
        "fabricMode": "fabric-managed",
        "fabricBindingId": fabric["binding"]["binding_id"],
    }
    held = _line(
        repo,
        fabric["head"],
        "HELD@P3",
        reason="scope_drift",
        **common,
    )
    resumed = _line(
        repo,
        fabric["head"],
        "RESUMED@P3",
        decision="fabric-resume-intent",
        **common,
    )

    code, result = _run(
        tmp_path,
        repo,
        [held, resumed],
        platform="codex",
        expected_head=fabric["head"],
        extra_args=fabric["extra_args"],
        state_path=fabric["candidate_state_path"],
    )
    assert code == 2
    assert result["held"] == "fabric_resume_authority_unavailable"


def test_fabric_managed_new_run_status_and_append_fail_closed(tmp_path):
    repo, _ = _new_repo(tmp_path)
    fabric = _fabric_binding_fixture(tmp_path, repo)
    held = _line(
        repo,
        fabric["head"],
        "HELD@P3",
        branch=fabric["branch"],
        runIds="P3:codex:managed-state-session",
        reason="run_budget_exhausted",
        agentCalls="40/40",
        fabricMode="fabric-managed",
        fabricBindingId=fabric["binding"]["binding_id"],
    )
    source = fabric["expected_state_path"]
    source.parent.mkdir(parents=True, exist_ok=True)
    source_bytes = (held + "\n").encode("utf-8")
    source.write_bytes(source_bytes)

    code, status = _run_new_run("status", "--state", source, "--json")
    assert code == 0 and status["ok"] is True
    assert status["fabricManaged"] is True
    assert status["canStartNewRun"] is False
    assert status["ownerAuthorizationRequired"] is False
    assert status["nextAction"] == "return-control-to-parallel-delivery-fabric"
    assert status["blockReason"] == "fabric-managed-local-new-run-forbidden"

    code, result = _run_new_run(
        "append",
        "--source-state", source,
        "--target-worktree", repo,
        "--git-exe", GIT,
        "--expected-branch", fabric["branch"],
        "--expected-head", fabric["head"],
        "--expected-source-sha256", hashlib.sha256(source_bytes).hexdigest(),
        "--expected-source-bytes", str(len(source_bytes)),
        "--expected-source-checkpoints", "1",
        "--owner-message-sha256", "a" * 64,
        "--owner-message-bytes", "1",
        "--date-stamp", "2026-08-31",
        "--json",
    )
    assert code == 2 and result["held"] == "resume_state_invalid"
    assert "Fabric-managed" in result["detail"]


def test_machine_contract_pins_the_owner_only_new_run_boundary():
    contract = json.loads(MACHINE_CONTRACT.read_text(encoding="utf-8"))
    boundary = contract["durable_state"]["new_run_boundary"]
    assert boundary == {
        "schema_version": "spec-to-done-new-run/v1",
        "token": "NEW_RUN@P0",
        "required_previous_reason": "run_budget_exhausted",
        "owner_provenance": "sha256-tuple-binding-not-digital-signature",
        "git_identity": {
            "executable_policy": "system-owned-read-only",
            "executable_path": "required",
            "executable_sha256": "required",
            "executable_bytes": "required",
            "git_directory": "required",
            "git_common_directory": "required",
        },
        "counter_resets": {
            "agentCalls": "0/40",
            "p5Rounds": "0/2",
            "evidenceAttempts": "0/2",
        },
        "field_resets": {
            "planPath": "",
            "taskIndex": "0",
            "prNumber": "",
            "runIds": "none",
            "evidenceHead": "",
        },
    }


def test_claude_procedure_authority_documents_the_fabric_managed_profile():
    skill = CLAUDE_SKILL.read_text(encoding="utf-8")
    for required in (
        "session_admission_limit=unbounded",
        "run_writer_cardinality=1",
        "fabricBindingPath",
        "fabricPlanPath",
        "fabricLeasePath",
        "fabricProviderSessionPath",
        "expectedStatePath",
        "--fabric-binding <fabricBindingPath>",
        "fabricMode=fabric-managed",
        "fabricBindingId=<64-hex>",
        "fabric_resume_authority_unavailable",
        "return-control-to-parallel-delivery-fabric",
        "不同 Fabric binding 可在各自 branch/worktree 併行",
    ):
        assert required in skill
    assert "不得讀 occupied writer count 作 admission blocker" in skill
    assert "binding packet 是 non-authorizing metadata" in skill


def test_codex_adapter_and_fabric_operator_doc_preserve_the_same_binding_contract():
    codex_skill = CODEX_SKILL.read_text(encoding="utf-8")
    operator_doc = FABRIC_OPERATOR_DOC.read_text(encoding="utf-8")

    for required in (
        "session_admission_limit=unbounded",
        "run_writer_cardinality=1",
        "fabricBindingPath",
        "fabricPlanPath",
        "fabricLeasePath",
        "fabricProviderSessionPath",
        "expectedStatePath",
        "--fabric-binding <fabricBindingPath>",
        "fabricMode=fabric-managed",
        "fabricBindingId=<64-hex>",
        "fabric_resume_authority_unavailable",
        "return-control-to-parallel-delivery-fabric",
        "不同 Fabric binding 可在各自 branch/worktree 併行",
    ):
        assert required in codex_skill

    assert "不得讀 occupied writer count 作 admission blocker" in codex_skill
    assert "binding packet 是 non-authorizing metadata" in codex_skill
    assert "不建立第二套引擎" in codex_skill
    assert "Repo session admission has no writer-count cap" in operator_doc
    assert "one writer" in operator_doc
    assert "does not create a second scheduler" in operator_doc


def test_claude_and_codex_skills_define_a_bounded_anti_loop_delivery_contract():
    for skill_path in (CLAUDE_SKILL, CODEX_SKILL):
        skill = skill_path.read_text(encoding="utf-8")
        for required in (
            "evidenceFingerprint=head/base/diffDigest/gate/blocker/authorityState",
            "blockerFingerprint=gate/errorCode/affectedScope/rootCause",
            "NO_RETRY",
            "SKIP_ALREADY_SATISFIED",
            "CIRCUIT_BREAKER_OPEN",
            "REUSE_AUTHORIZATION",
            "one_conclusive_p5_review_per_exact_head",
            "one_approval_request_per_exact_head",
            "incremental gate evaluation",
            "BLOCKING / CONFIRMED_CORRECTNESS / OPTIONAL / OUT_OF_SCOPE",
            "同一 fingerprint",
            "evidence delta",
            "既有 PASS",
            "收斂為 HELD",
        ):
            assert required in skill


def test_new_run_appender_preserves_prefix_and_emits_valid_p0(tmp_path):
    repo, branch, old_head, new_head, source, source_bytes, expected = (
        _new_run_fixture(tmp_path)
    )
    code, status = _run_new_run("status", "--state", source, "--json")
    assert code == 0 and status["canStartNewRun"] is True
    assert status["ownerAuthorizationRequired"] is True
    assert status["nextAction"] == "obtain-exact-owner-authorization-then-run-append"
    assert "owner-message-sha256" in status["appendRequiredArguments"]
    code, result = _append_new_run(repo, branch, new_head, source, expected)
    assert code == 0 and result["ok"] is True, result
    target = repo / "artifacts/spec-to-done/demo-state.md"
    target_bytes = target.read_bytes()
    assert target_bytes.startswith(source_bytes)
    assert result["sourceSha256"] == expected["sha256"]
    assert result["previousHead"] == old_head
    assert result["head"] == new_head
    assert result["runSequence"] == 2
    assert result["ownerProvenance"] == "sha256-tuple-binding-not-digital-signature"

    code, validated = _validate_state_path(target, repo, new_head)
    assert code == 0 and validated["ok"] is True
    assert validated["kind"] == "NEW_RUN"
    assert validated["phase"] == "P0"
    assert validated["counters"]["agentCalls"]["used"] == 0
    assert pathlib.Path(validated["fields"]["gitExecutablePath"]).is_absolute()
    assert re.fullmatch(r"[0-9a-f]{64}", validated["fields"]["gitExecutableSha256"])
    assert int(validated["fields"]["gitExecutableBytes"]) > 0
    assert validated["fields"]["gitTrustClass"] == "system-owned-read-only"
    assert pathlib.Path(validated["fields"]["gitDirectory"]).is_absolute()
    assert pathlib.Path(validated["fields"]["gitCommonDirectory"]).is_absolute()
    actual_git_dir = pathlib.Path(_git(repo, "rev-parse", "--absolute-git-dir")).resolve()
    raw_common_dir = pathlib.Path(_git(repo, "rev-parse", "--git-common-dir"))
    actual_common_dir = (
        raw_common_dir if raw_common_dir.is_absolute() else repo / raw_common_dir
    ).resolve()
    assert pathlib.Path(validated["fields"]["gitDirectory"]).resolve() == actual_git_dir
    assert (
        pathlib.Path(validated["fields"]["gitCommonDirectory"]).resolve()
        == actual_common_dir
    )

    code, status = _run_new_run("status", "--state", target, "--json")
    assert code == 0 and status["ok"] is True
    assert status["canStartNewRun"] is False
    assert status["runSequence"] == 2
    assert status["nextAction"] == "continue-or-hold-current-run-without-counter-reset"
    assert status["appendRequiredArguments"] == []


@pytest.mark.parametrize(
    ("held_reason", "exhausted"),
    [("external_blocked", True), ("run_budget_exhausted", False)],
)
def test_new_run_rejects_nonbudget_or_unexhausted_history(
    tmp_path, held_reason, exhausted
):
    fixture = _new_run_fixture(
        tmp_path, held_reason=held_reason, exhausted=exhausted
    )
    repo, branch, _, head, source, _, expected = fixture
    code, result = _append_new_run(repo, branch, head, source, expected)
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_validator_rejects_a_fabricated_new_run_line(tmp_path):
    repo, head = _new_repo(tmp_path)
    fabricated = _line(
        repo,
        head,
        "NEW_RUN@P0",
        runIds="none",
        taskIndex="0",
        evidenceHead="",
        agentCalls="0/40",
        p5Rounds="0/2",
        evidenceAttempts="0/2",
    )
    code, result = _run(tmp_path, repo, fabricated, platform="codex")
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_new_run_rejects_stale_source_tuple(tmp_path):
    repo, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    code, result = _append_new_run(
        repo,
        branch,
        head,
        source,
        expected,
        expected_overrides={"sha256": "00" * 32},
    )
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_new_run_rejects_dirty_target_worktree(tmp_path):
    repo, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    dirty = repo / "src/dirty.txt"
    dirty.write_text("not committed\n", encoding="utf-8")
    code, result = _append_new_run(repo, branch, head, source, expected)
    assert code == 2 and result["held"] == "resume_state_invalid"
    assert "clean" in result["detail"]


def test_new_run_rejects_reusing_the_prior_worktree(tmp_path):
    _, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    prior_worktree = source.parents[2]

    code, result = _append_new_run(
        prior_worktree, branch, head, source, expected
    )

    assert code == 2 and result["held"] == "resume_state_invalid"
    assert "fresh sibling worktree" in result["detail"]


def test_new_run_ignores_ambient_git_directory_injection(tmp_path):
    repo, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    code, result = _append_new_run(
        repo,
        branch,
        head,
        source,
        expected,
        env_overrides={"GIT_DIR": str(tmp_path / "attacker")},
    )
    assert code == 0 and result["ok"] is True, result


def test_validator_ignores_ambient_git_repository_object_and_config_injection(tmp_path):
    repo, head = _new_repo(tmp_path, "trusted-repo")
    attacker, _ = _new_repo(tmp_path, "attacker-repo")
    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head),
        env_overrides={
            "GIT_DIR": str(attacker / ".git"),
            "GIT_WORK_TREE": str(attacker),
            "GIT_COMMON_DIR": str(attacker / ".git"),
            "GIT_OBJECT_DIRECTORY": str(attacker / ".git/objects"),
            "GIT_ALTERNATE_OBJECT_DIRECTORIES": str(attacker / ".git/objects"),
            "GIT_REPLACE_REF_BASE": "refs/replace-attacker/",
            "GIT_CEILING_DIRECTORIES": str(attacker),
            "GIT_DISCOVERY_ACROSS_FILESYSTEM": "1",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.hooksPath",
            "GIT_CONFIG_VALUE_0": str(attacker),
            "GIT_EXEC_PATH": str(attacker),
        },
    )
    assert code == 0 and result["ok"] is True, result


def test_trusted_git_child_environment_is_a_fixed_allowlist():
    code, result = _run_sanitized_git_environment(GIT)

    assert code == 0 and result["ok"] is True, result
    assert result["inherited"] == {}
    expected_keys = {
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_TERMINAL_PROMPT",
        "GIT_OPTIONAL_LOCKS",
        "GIT_NO_REPLACE_OBJECTS",
        "GIT_LITERAL_PATHSPECS",
        "PATH",
    }
    if os.name == "nt":
        expected_keys.update({"SystemRoot", "WINDIR"})
    assert set(result["keys"]) == expected_keys


@pytest.mark.skipif(os.name != "nt", reason="Windows runtime-volume binding")
def test_windows_system_git_rejects_an_arbitrary_program_files_drive():
    actual_drive = pathlib.PureWindowsPath(GIT).drive.lower()
    fake_drive = "Z:" if actual_drive != "z:" else "Y:"
    fake_git = str(pathlib.PureWindowsPath(fake_drive, "/Program Files/Git/cmd/git.exe"))

    code, result = _run_trusted_git_pure("isSystemGitPath", fake_git)
    assert code == 0 and result == {"ok": True, "value": False}

    code, result = _run_trusted_git_pure("isSystemGitPath", GIT)
    assert code == 0 and result == {"ok": True, "value": True}


def test_new_run_rejects_caller_controlled_git_even_when_named_git(tmp_path):
    repo, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    suffix = ".exe" if os.name == "nt" else ""
    fake_git = tmp_path / f"git{suffix}"
    shutil.copyfile(GIT, fake_git)
    fake_git.chmod(0o755)

    code, result = _append_new_run(
        repo,
        branch,
        head,
        source,
        expected,
        git_exe=str(fake_git),
        expect_host_env_blocked=True,
    )

    assert code == 2 and result["held"] == "host_env_blocked"
    assert not (repo / "artifacts/spec-to-done/demo-state.md").exists()


def test_new_run_rejects_bad_owner_tuple_or_worktree_identity(tmp_path):
    repo, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    code, result = _append_new_run(
        repo, branch, head, source, expected, owner_sha256="bad"
    )
    assert code == 2 and result["held"] == "bad_args"
    code, result = _append_new_run(repo, "wrong/branch", head, source, expected)
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_new_run_rejects_lock_and_repeat(tmp_path):
    repo, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    target = repo / "artifacts/spec-to-done/demo-state.md"
    target.parent.mkdir(parents=True)
    lock = pathlib.Path(f"{target}.new-run.lock")
    lock.write_text("occupied\n", encoding="utf-8")
    code, result = _append_new_run(repo, branch, head, source, expected)
    assert code == 2 and result["held"] == "resume_state_invalid"
    lock.unlink()

    code, result = _append_new_run(repo, branch, head, source, expected)
    assert code == 0 and result["ok"] is True, result
    code, result = _append_new_run(repo, branch, head, source, expected)
    assert code == 2 and result["held"] == "resume_state_invalid"


@pytest.mark.skipif(
    os.name == "nt",
    reason="trusted-Git positive atomicity coverage runs on canonical Linux",
)
def test_new_run_lock_snapshot_preserves_first_completed_boundary(tmp_path):
    repo, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    ready = tmp_path / "before-lock.ready"
    release = tmp_path / "before-lock.release"
    driver = tmp_path / "append-driver.mjs"
    driver.write_text(
        f"""
import fs from 'node:fs'
import {{ appendCommand }} from {json.dumps(NEW_RUN_APPENDER.as_uri())}
const cli = JSON.parse(process.argv[2])
try {{
  const result = appendCommand(cli, {{
    beforeLock() {{
      fs.writeFileSync(process.argv[3], 'ready')
      const waiter = new Int32Array(new SharedArrayBuffer(4))
      while (!fs.existsSync(process.argv[4])) Atomics.wait(waiter, 0, 0, 10)
    }},
  }})
  process.stdout.write(JSON.stringify(result))
}} catch (error) {{
  process.stdout.write(JSON.stringify({{
    ok: false,
    held: error.held || 'resume_state_invalid',
    detail: error.message,
  }}))
  process.exitCode = 2
}}
""",
        encoding="utf-8",
    )
    cli = {
        "command": "append",
        "source-state": str(source),
        "target-worktree": str(repo),
        "git-exe": GIT,
        "expected-branch": branch,
        "expected-head": head,
        "expected-source-sha256": expected["sha256"],
        "expected-source-bytes": str(expected["bytes"]),
        "expected-source-checkpoints": str(expected["checkpoints"]),
        "owner-message-sha256": "10" * 32,
        "owner-message-bytes": "480",
        "date-stamp": "2026-08-27",
        "json": True,
    }
    blocked = subprocess.Popen(
        ["node", str(driver), json.dumps(cli), str(ready), str(release)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        env=os.environ.copy(),
    )
    deadline = time.monotonic() + 10
    while not ready.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert ready.exists(), "blocked appender did not reach its pre-lock barrier"

    first_code, first = _append_new_run(repo, branch, head, source, expected)
    assert first_code == 0 and first["ok"] is True, first
    target = repo / "artifacts/spec-to-done/demo-state.md"
    first_bytes = target.read_bytes()
    release.write_text("release\n", encoding="utf-8")
    stdout, stderr = blocked.communicate(timeout=10)
    second = json.loads(stdout)

    assert blocked.returncode == 2, stderr
    assert second["held"] == "resume_state_invalid"
    assert "overwrite refused" in second["detail"]
    assert target.read_bytes() == first_bytes
    assert first_bytes.count(b"NEW_RUN@P0 |") == 1
    assert not pathlib.Path(f"{target}.new-run.lock").exists()


@pytest.mark.skipif(
    os.name == "nt",
    reason="trusted-Git positive rollback coverage runs on canonical Linux",
)
def test_new_run_post_write_failure_restores_locked_target_bytes(tmp_path):
    repo, branch, _, head, source, source_bytes, expected = _new_run_fixture(tmp_path)
    target = repo / "artifacts/spec-to-done/demo-state.md"
    target.parent.mkdir(parents=True)
    target.write_bytes(source_bytes)
    driver = tmp_path / "rollback-driver.mjs"
    driver.write_text(
        f"""
import {{ appendCommand }} from {json.dumps(NEW_RUN_APPENDER.as_uri())}
const cli = JSON.parse(process.argv[2])
try {{
  appendCommand(cli, {{ afterWrite() {{ throw new Error('forced post-write failure') }} }})
}} catch (error) {{
  process.stdout.write(JSON.stringify({{
    ok: false,
    held: error.held || 'resume_state_invalid',
    detail: error.message,
  }}))
  process.exitCode = 2
}}
""",
        encoding="utf-8",
    )
    cli = {
        "command": "append",
        "source-state": str(source),
        "target-worktree": str(repo),
        "git-exe": GIT,
        "expected-branch": branch,
        "expected-head": head,
        "expected-source-sha256": expected["sha256"],
        "expected-source-bytes": str(expected["bytes"]),
        "expected-source-checkpoints": str(expected["checkpoints"]),
        "owner-message-sha256": "09" * 32,
        "owner-message-bytes": "479",
        "date-stamp": "2026-08-26",
        "json": True,
    }
    proc = subprocess.run(
        ["node", str(driver), json.dumps(cli)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=os.environ.copy(),
    )
    result = json.loads(proc.stdout)

    assert proc.returncode == 2 and "forced post-write failure" in result["detail"]
    assert target.read_bytes() == source_bytes
    assert not pathlib.Path(f"{target}.new-run.lock").exists()


def test_validator_rejects_tampered_new_run_boundary(tmp_path):
    repo, branch, _, head, source, _, expected = _new_run_fixture(tmp_path)
    code, result = _append_new_run(repo, branch, head, source, expected)
    assert code == 0 and result["ok"] is True, result
    target = repo / "artifacts/spec-to-done/demo-state.md"
    target.write_bytes(target.read_bytes().replace(b"ownerMessageBytes=479", b"ownerMessageBytes=480"))
    code, result = _validate_state_path(target, repo, head)
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_valid_claude_and_codex_states_and_single_canonical_validator(tmp_path):
    repo, head = _new_repo(tmp_path)
    # 單一正本政策（pr-review-agent generated_tooling_path 規則）：validate-state.mjs 只存在
    # .claude 側；.codex 鏡像不得放副本（SKILL.md 指向 .claude 路徑）。兩平台 state 都用同一正本驗。
    assert CLAUDE_VALIDATOR.exists()
    assert not CODEX_VALIDATOR.exists()
    claude_skill = CLAUDE_SKILL.read_text(encoding="utf-8")
    codex_skill = CODEX_SKILL.read_text(encoding="utf-8")
    assert "validate-state.mjs --state <temp> --platform claude" in claude_skill
    assert "validate-state.mjs --state <temp>\n  --platform codex" in codex_skill
    assert "validate-state.mjs（" not in codex_skill
    code, result = _run(tmp_path, repo, _line(repo, head))
    assert code == 0 and result["ok"] is True
    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head, runIds="P5:codex:019f9324-65d8-7223-9d3e-efabb2eeb08c"),
        platform="codex",
    )
    assert code == 0 and result["ok"] is True
    grok_id = "P5:grok:01a01998-c3f4-77b2-8825-0706ec8e57c6"
    code, result = _run(tmp_path, repo, _line(repo, head, runIds=grok_id), platform="grok")
    assert code == 0 and result["ok"] is True


def test_grok_adapter_is_thin_and_points_at_canonical_gates():
    grok_skill = GROK_SKILL.read_text(encoding="utf-8")
    assert GROK_SKILL.is_file()
    assert "--platform grok" in grok_skill
    assert "grok:<actual-subagent-or-workflow-id>" in grok_skill
    assert ".claude/skills/spec-to-done/SKILL.md" in grok_skill
    assert "agent-contracts/spec-to-done.contract.json" in grok_skill
    assert "validate-state.mjs" in grok_skill
    assert "禁止" in grok_skill and "等價" in grok_skill
    assert "P0/P1/P3/P4/P5/P6/P7" in grok_skill
    assert "host_env_blocked" in grok_skill
    assert "std-plan.js" in grok_skill


def test_grok_platform_requires_grok_run_ids_except_p0_none(tmp_path):
    repo, head = _new_repo(tmp_path)
    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head, runIds="P5:wf_abc123"),
        platform="grok",
    )
    assert code == 2 and result["held"] == "resume_state_invalid"
    code, result = _run(
        tmp_path,
        repo,
        _line(
            repo,
            head,
            "DONE@P0",
            runIds="none",
            taskIndex="0",
            evidenceHead="",
            agentCalls="0/40",
            p5Rounds="0/2",
            evidenceAttempts="0/2",
        ),
        platform="grok",
    )
    assert code == 0 and result["ok"] is True


def test_non_terminal_validation_does_not_resolve_the_remote(tmp_path):
    repo, head = _new_repo(tmp_path)
    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head),
        env_overrides={
            "HTTP_PROXY": "http://127.0.0.1:9",
            "HTTPS_PROXY": "http://127.0.0.1:9",
            "NO_PROXY": "",
        },
    )

    assert code == 0 and result["ok"] is True


def test_validator_rejects_removed_test_git_fixture_flag(tmp_path):
    repo, head = _new_repo(tmp_path, "removed-fixture-seam-repo")
    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head),
        extra_args=("--test-git-fixture", "spec-to-done-test-fixture-v1"),
    )

    assert code == 2 and result["held"] == "resume_state_invalid"
    assert "unknown validator arguments" in result["detail"]


def test_validator_rejects_caller_controlled_git_without_escape(tmp_path):
    repo, head = _new_repo(tmp_path, "caller-controlled-validator-git")
    suffix = ".exe" if os.name == "nt" else ""
    fake_git = tmp_path / f"git{suffix}"
    shutil.copyfile(GIT, fake_git)
    fake_git.chmod(0o755)

    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head),
        git_exe=str(fake_git),
        env_overrides={
            "PYTEST_CURRENT_TEST": "caller-controlled fixture",
            "SPEC_TO_DONE_TEST_GIT_FIXTURE": "spec-to-done-test-fixture-v1",
        },
        expect_host_env_blocked=True,
    )

    assert code == 2 and result["held"] == "host_env_blocked"


def test_cli_rejects_a_local_tracking_ref_as_the_trust_marker(tmp_path):
    repo, head = _new_repo(tmp_path)

    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head),
        trusted_main_ref="refs/remotes/origin/main",
    )

    assert code == 2 and result["held"] == "resume_state_invalid"


def test_machine_held_reasons_are_durable_and_unknown_reasons_fail_closed(tmp_path):
    repo, head = _new_repo(tmp_path)
    claude_contract = CLAUDE_SKILL.read_text(encoding="utf-8")
    codex_contract = CODEX_SKILL.read_text(encoding="utf-8")

    def section(contract, start_marker, end_marker):
        start = contract.index(start_marker)
        end = contract.index(end_marker, start)
        return contract[start:end]

    p6_sections = (
        section(claude_contract, "P6 = Workflow", "P7 ="),
        section(codex_contract, "P6 = Workflow", "P7 ="),
    )
    held_tables = (
        section(claude_contract, "## held 對照表", "## 強制停下點"),
        section(codex_contract, "## held 對照表", "## 強制停下點"),
    )
    p6_scoped_reasons = {
        "branch_requires_separate_authorization",
        "branch_protection_changed_during_buffer",
        "branch_protection_changed_after_verdict",
        "human_approval_changed_after_verdict",
    }
    machine_contract = json.loads(MACHINE_CONTRACT.read_text(encoding="utf-8"))
    documented_reasons = tuple(machine_contract["durable_state"]["held_reasons"])
    for reason in documented_reasons:
        code, result = _run(
            tmp_path,
            repo,
            _line(repo, head, "HELD@P6", reason=reason),
        )
        assert code == 0 and result["kind"] == "HELD"
        assert result["fields"]["reason"] == reason
        if reason in p6_scoped_reasons:
            assert all(reason in p6_section for p6_section in p6_sections)
            assert all(reason in held_table for held_table in held_tables)

    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head, "HELD@P6", reason="caller_invented_hold"),
    )
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_external_blocked_is_a_durable_p5_hold(tmp_path):
    # P5 confirmed external blocker must be checkpointable, or the taxonomy is non-resumable.
    repo, head = _new_repo(tmp_path)
    code, result = _run(tmp_path, repo, _line(repo, head, "HELD@P5", reason="external_blocked"))
    assert code == 0 and result["kind"] == "HELD"
    assert result["fields"]["reason"] == "external_blocked"


def test_historical_unknown_held_reason_cannot_be_hidden_by_later_checkpoints(tmp_path):
    repo, head = _new_repo(tmp_path)
    unknown_hold = _line(
        repo,
        head,
        "HELD@P6",
        reason="caller_invented_hold",
    )
    resumed = _line(
        repo,
        head,
        "RESUMED@P6",
        decision="operator-resume",
    )

    code, result = _run(tmp_path, repo, [unknown_hold, resumed])
    assert code == 2 and result["held"] == "resume_state_invalid"

    code, result = _run(
        tmp_path,
        repo,
        [unknown_hold, resumed, _line(repo, head, "DONE@P6")],
    )
    assert code == 2 and result["held"] == "resume_state_invalid"

    authorization = _line(
        repo,
        head,
        "AUTHORIZATION@P6",
        decision="delegate-repo-workflow-signoff",
        scope="repo-workflow-signoff",
        exclusions=(
            "secrets,credentials,billing,production-data,destructive-delete,"
            "unproven-process-stop"
        ),
    )
    for terminal_reason in (
        "trusted_elevated_authorization_unavailable",
        "branch_requires_separate_authorization",
    ):
        terminal_hold = _line(
            repo,
            head,
            "HELD@P6",
            reason=terminal_reason,
        )
        for followup in (resumed, authorization):
            code, result = _run(tmp_path, repo, [terminal_hold, followup])
            assert code == 2 and result["held"] == "resume_state_invalid"

    max_budget_recovery = _line(
        repo,
        head,
        "HELD@P6",
        reason="resume_state_invalid",
        agentCalls="40/40",
        p5Rounds="2/2",
        evidenceAttempts="2/2",
    )
    code, result = _run(tmp_path, repo, [unknown_hold, max_budget_recovery])
    assert code == 0 and result["kind"] == "HELD"
    assert result["fields"]["reason"] == "resume_state_invalid"


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("head", "not-a-sha"),
        ("runIds", "fake"),
        ("slug", "../other"),
    ),
)
def test_historical_checkpoints_reject_malformed_provenance(tmp_path, field, value):
    repo, head = _new_repo(tmp_path)
    historical = _line(repo, head, "DONE@P5", **{field: value})
    current = _line(repo, head, "DONE@P5")

    code, result = _run(tmp_path, repo, [historical, current])
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_max_budget_recovery_seals_prior_transition_errors_without_enabling_progress(tmp_path):
    repo, head = _new_repo(tmp_path)
    p1 = _line(repo, head, "DONE@P1")
    p5 = _line(repo, head, "DONE@P5")
    recovery = _line(
        repo,
        head,
        "HELD@P5",
        reason="resume_state_invalid",
        agentCalls="40/40",
        p5Rounds="2/2",
        evidenceAttempts="2/2",
    )

    code, result = _run(tmp_path, repo, [p1, p5, recovery])
    assert code == 0 and result["kind"] == "HELD"
    assert result["fields"]["reason"] == "resume_state_invalid"

    resumed = _line(
        repo,
        head,
        "RESUMED@P5",
        decision="operator-resume",
        agentCalls="40/40",
        p5Rounds="2/2",
        evidenceAttempts="2/2",
    )
    code, result = _run(tmp_path, repo, [p1, p5, recovery, resumed])
    assert code == 2 and result["held"] == "resume_state_invalid"

    illegal_candidate = recovery.replace("HELD@P5", "HELD@P6", 1)
    code, result = _run(tmp_path, repo, [p1, illegal_candidate])
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_max_budget_recovery_is_terminal_after_valid_history(tmp_path):
    repo, head = _new_repo(tmp_path)
    valid = _line(repo, head, "DONE@P5")
    recovery = _line(
        repo,
        head,
        "HELD@P5",
        reason="resume_state_invalid",
        agentCalls="40/40",
        p5Rounds="2/2",
        evidenceAttempts="2/2",
    )
    resumed = _line(
        repo,
        head,
        "RESUMED@P5",
        decision="operator-resume",
        agentCalls="40/40",
        p5Rounds="2/2",
        evidenceAttempts="2/2",
    )

    code, result = _run(tmp_path, repo, [valid, recovery])
    assert code == 0 and result["kind"] == "HELD"
    assert result["fields"]["reason"] == "resume_state_invalid"

    code, result = _run(tmp_path, repo, [valid, recovery, resumed])
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_fixed_limits_and_counter_overflow_fail_closed(tmp_path):
    repo, head = _new_repo(tmp_path)
    code, result = _run(
        tmp_path, repo, _line(repo, head, agentCalls="8/41"), limits=("41", "2", "2")
    )
    assert code == 2 and result["held"] == "resume_state_invalid"
    code, result = _run(tmp_path, repo, _line(repo, head, agentCalls="41/40"))
    assert code == 2 and result["held"] == "run_budget_exhausted"


def test_dirty_product_files_and_staged_rename_fail_closed(tmp_path):
    repo, head = _new_repo(tmp_path, "dirty")
    untracked = repo / "src/new.txt"
    untracked.write_text("new\n", encoding="utf-8")
    code, result = _run(tmp_path, repo, _line(repo, head))
    assert code == 2 and result["held"] == "evidence_stale"
    assert "src/new.txt" in result["productionFiles"]
    untracked.unlink()
    (repo / "src/app.txt").write_text("v2\n", encoding="utf-8")
    code, result = _run(tmp_path, repo, _line(repo, head))
    assert code == 2 and "src/app.txt" in result["productionFiles"]

    renamed, rename_head = _new_repo(tmp_path, "staged-rename")
    (renamed / "docs/evidence").mkdir(parents=True)
    _git(renamed, "mv", "src/app.txt", "docs/evidence/app.txt")
    code, result = _run(tmp_path, renamed, _line(renamed, rename_head))
    assert code == 2 and result["held"] == "evidence_stale"
    assert "src/app.txt" in result["productionFiles"]


def test_evidence_only_commit_passes_but_committed_rename_is_stale(tmp_path):
    repo, evidence_head = _new_repo(tmp_path)
    evidence = repo / "docs/evidence/demo.md"
    evidence.parent.mkdir(parents=True)
    evidence.write_text("evidence\n", encoding="utf-8")
    _git(repo, "add", "docs/evidence/demo.md")
    _git(repo, "commit", "-m", "evidence")
    head = _git(repo, "rev-parse", "HEAD")
    code, result = _run(
        tmp_path, repo, _line(repo, head, evidenceHead=evidence_head)
    )
    assert code == 0 and result["ok"] is True

    _git(repo, "mv", "src/app.txt", "docs/evidence/app.txt")
    _git(repo, "commit", "-m", "hide product rename")
    renamed_head = _git(repo, "rev-parse", "HEAD")
    code, result = _run(
        tmp_path, repo, _line(repo, renamed_head, evidenceHead=evidence_head)
    )
    assert code == 2 and result["held"] == "evidence_stale"
    assert "src/app.txt" in result["productionFiles"]


def test_closeout_rejects_other_change_ledger(tmp_path):
    repo, _ = _new_repo(tmp_path)
    named = repo / "openspec/changes/demo/tasks.md"
    named.parent.mkdir(parents=True)
    named.write_text("- [ ] 10.1 evidence\n", encoding="utf-8")
    _git(repo, "add", "openspec/changes/demo/tasks.md")
    _git(repo, "commit", "-m", "named ledger")
    evidence_head = _git(repo, "rev-parse", "HEAD")
    other = repo / "openspec/changes/other/tasks.md"
    other.parent.mkdir(parents=True)
    other.write_text("- [x] unrelated\n", encoding="utf-8")
    _git(repo, "add", "openspec/changes/other/tasks.md")
    _git(repo, "commit", "-m", "other ledger")
    head = _git(repo, "rev-parse", "HEAD")
    line = _line(
        repo,
        head,
        spec=named.parent.as_posix(),
        executionMode="evidence-closeout",
        closeoutTaskIds="10.1",
        evidenceHead=evidence_head,
    )
    code, result = _run(tmp_path, repo, line)
    assert code == 2 and result["held"] == "evidence_stale"
    assert result["productionFiles"] == ["openspec/changes/other/tasks.md"]


def test_full_mode_rejects_an_unrelated_openspec_tasks_file(tmp_path):
    repo, _ = _new_repo(tmp_path)
    named = repo / "openspec/changes/demo/tasks.md"
    named.parent.mkdir(parents=True)
    named.write_text("- [ ] 10.1 evidence\n", encoding="utf-8")
    _git(repo, "add", "openspec/changes/demo/tasks.md")
    _git(repo, "commit", "-m", "named ledger")
    evidence_head = _git(repo, "rev-parse", "HEAD")
    other = repo / "openspec/changes/other/tasks.md"
    other.parent.mkdir(parents=True)
    other.write_text("- [x] unrelated\n", encoding="utf-8")
    _git(repo, "add", "openspec/changes/other/tasks.md")
    _git(repo, "commit", "-m", "other ledger")
    head = _git(repo, "rev-parse", "HEAD")

    code, result = _run(
        tmp_path,
        repo,
        _line(
            repo,
            head,
            spec=named.parent.as_posix(),
            executionMode="full",
            evidenceHead=evidence_head,
        ),
    )

    assert code == 2 and result["held"] == "evidence_stale"
    assert result["productionFiles"] == ["openspec/changes/other/tasks.md"]


def test_full_mode_allows_only_the_current_slug_openspec_tasks_file(tmp_path):
    repo, evidence_head = _new_repo(tmp_path)
    current = repo / "openspec/changes/demo/tasks.md"
    current.parent.mkdir(parents=True)
    current.write_text("- [x] current run\n", encoding="utf-8")
    _git(repo, "add", "openspec/changes/demo/tasks.md")
    _git(repo, "commit", "-m", "current run ledger")
    head = _git(repo, "rev-parse", "HEAD")

    code, result = _run(
        tmp_path,
        repo,
        _line(
            repo,
            head,
            spec=(repo / "docs/superpowers/specs/demo-design.md").as_posix(),
            executionMode="full",
            evidenceHead=evidence_head,
        ),
    )

    assert code == 0 and result["ok"] is True


def test_transition_is_append_only_and_monotonic(tmp_path):
    repo, head = _new_repo(tmp_path)
    previous = _line(
        repo, head, "DONE@P4", runIds="P4:wf_old123", agentCalls="8/40"
    )
    resumed = _line(
        repo,
        head,
        "RESUMED@P5",
        runIds="P4:wf_old123 P5:wf_new123",
        agentCalls="9/40",
        decision="continue",
    )
    code, result = _run(tmp_path, repo, [previous, resumed])
    assert code == 0 and result["ok"] is True

    rollback = _line(
        repo,
        head,
        "RESUMED@P5",
        runIds="P4:wf_old123 P5:wf_new123",
        agentCalls="7/40",
        decision="continue",
    )
    code, result = _run(tmp_path, repo, [previous, rollback])
    assert code == 2 and result["held"] == "resume_state_invalid"

    dropped = _line(
        repo, head, "RESUMED@P5", runIds="P5:wf_new123", agentCalls="9/40", decision="continue"
    )
    code, result = _run(tmp_path, repo, [previous, dropped])
    assert code == 2 and result["held"] == "resume_state_invalid"


@pytest.mark.parametrize(
    ("platform", "old_ids", "new_ids"),
    [
        ("codex", "P5:wf_old123", "P5:wf_old123 codex:019f9324-65d8-7223-9d3e-efabb2eeb08c"),
        ("claude", "P5:codex:019f9324-65d8-7223-9d3e-efabb2eeb08c", "P5:codex:019f9324-65d8-7223-9d3e-efabb2eeb08c wf_new123"),
        ("grok", "P5:wf_old123", "P5:wf_old123 grok:01a01998-c3f4-77b2-8825-0706ec8e57c6"),
        (
            "claude",
            "P5:grok:01a01998-c3f4-77b2-8825-0706ec8e57c6",
            "P5:grok:01a01998-c3f4-77b2-8825-0706ec8e57c6 wf_new123",
        ),
    ],
)
def test_cross_cli_handoff_preserves_both_actual_ids(tmp_path, platform, old_ids, new_ids):
    repo, head = _new_repo(tmp_path)
    previous = _line(repo, head, runIds=old_ids)
    current = _line(
        repo,
        head,
        "RESUMED@P5",
        runIds=new_ids,
        agentCalls="9/40",
        decision="cross-cli-handoff",
    )
    code, result = _run(tmp_path, repo, [previous, current], platform=platform)
    assert code == 0 and result["ok"] is True


def test_grok_ids_require_handoff_when_switching_from_claude_and_are_preserved(tmp_path):
    repo, head = _new_repo(tmp_path)
    previous = _line(repo, head, "DONE@P4", runIds="P4:wf_old123", agentCalls="8/40")
    without_handoff = _line(
        repo,
        head,
        "DONE@P5",
        runIds="P4:wf_old123 grok:01a01998-c3f4-77b2-8825-0706ec8e57c6",
        agentCalls="9/40",
    )
    code, result = _run(tmp_path, repo, [previous, without_handoff], platform="grok")
    assert code == 2 and result["held"] == "resume_state_invalid"

    p0 = _line(
        repo,
        head,
        "DONE@P0",
        runIds="none",
        taskIndex="0",
        evidenceHead="",
        agentCalls="0/40",
        p5Rounds="0/2",
        evidenceAttempts="0/2",
    )
    p1 = _line(
        repo,
        head,
        "DONE@P1",
        runIds="P1:grok:01a01998-c3f4-77b2-8825-0706ec8e57c6",
        taskIndex="0",
        evidenceHead="",
        agentCalls="1/40",
        p5Rounds="0/2",
        evidenceAttempts="0/2",
    )
    code, result = _run(tmp_path, repo, [p0, p1], platform="grok")
    assert code == 0 and result["ok"] is True

    dropped = _line(
        repo,
        head,
        "DONE@P3",
        runIds="P3:wf_new123",
        agentCalls="2/40",
        p5Rounds="0/2",
        evidenceAttempts="0/2",
        evidenceHead="",
    )
    code, result = _run(tmp_path, repo, [p0, p1, dropped], platform="claude")
    assert code == 2 and result["held"] == "resume_state_invalid"


def test_authorization_values_are_allowlisted(tmp_path):
    repo, head = _new_repo(tmp_path)
    valid = _line(
        repo,
        head,
        "AUTHORIZATION@P5",
        decision="delegate-repo-workflow-signoff",
        scope="impact-signoff,review-signoff",
        exclusions=EXCLUSIONS,
    )
    code, result = _run(tmp_path, repo, valid)
    assert code == 0 and result["kind"] == "AUTHORIZATION"
    code, result = _run(tmp_path, repo, valid.replace("impact-signoff", "secrets-signoff"))
    assert code == 2 and result["held"] == "resume_state_invalid"


def _terminal_state(tmp_path, name, change_merge_tree):
    repo, evidence_head = _new_repo(tmp_path, name)
    evidence = repo / "docs/evidence/demo.md"
    evidence.parent.mkdir(parents=True)
    evidence.write_text("evidence\n", encoding="utf-8")
    _git(repo, "add", "docs/evidence/demo.md")
    _git(repo, "commit", "-m", "PR evidence")
    pr_head = _git(repo, "rev-parse", "HEAD")
    previous = _line(repo, pr_head, "DONE@P6", evidenceHead=evidence_head)
    if change_merge_tree:
        (repo / "src/app.txt").write_text("merged drift\n", encoding="utf-8")
        _git(repo, "add", "src/app.txt")
        _git(repo, "commit", "-m", "different merge tree")
    else:
        _git(repo, "commit", "--allow-empty", "-m", "different SHA same tree")
    merge = _git(repo, "rev-parse", "HEAD")
    _git(repo, "update-ref", "refs/remotes/origin/main", merge)
    terminal = _line(
        repo,
        merge,
        "DONE@P7",
        evidenceHead=evidence_head,
        prHead=pr_head,
        mergeCommit=merge,
    )
    return repo, [previous, terminal], merge


def test_terminal_p7_fact_adjudication_accepts_only_all_true_facts():
    merge = "a" * 40
    code, result = _run_trusted_git_pure(
        "assertTerminalP7Facts",
        {
            "mergeDescendsFromPrHead": True,
            "liveRemoteMain": merge,
            "mergeCommit": merge,
            "prHeadAndMergeSameTree": True,
        },
    )

    assert code == 0 and result == {"ok": True, "value": None}


@pytest.mark.parametrize(
    ("override", "detail"),
    [
        (
            {"mergeDescendsFromPrHead": False},
            "not a proven descendant",
        ),
        (
            {"liveRemoteMain": "b" * 40},
            "does not equal live remote refs/heads/main",
        ),
        (
            {"prHeadAndMergeSameTree": False},
            "tree differs",
        ),
    ],
)
def test_terminal_p7_fact_adjudication_fails_closed(override, detail):
    merge = "a" * 40
    facts = {
        "mergeDescendsFromPrHead": True,
        "liveRemoteMain": merge,
        "mergeCommit": merge,
        "prHeadAndMergeSameTree": True,
    }
    facts.update(override)

    code, result = _run_trusted_git_pure("assertTerminalP7Facts", facts)

    assert code == 2 and result["ok"] is False
    assert detail in result["detail"]


def test_terminal_p7_rejects_dirty_worktree_before_live_remote(tmp_path):
    repo, lines, merge = _terminal_state(tmp_path, "dirty-before-remote", False)
    dirty = repo / "src/dirty.txt"
    dirty.write_text("uncommitted product drift\n", encoding="utf-8")

    code, result = _run(tmp_path, repo, lines, expected_head=merge)

    assert code == 2 and result["held"] == "evidence_stale"


def test_terminal_p7_rejects_same_tree_from_unrelated_history(tmp_path):
    repo, evidence_head = _new_repo(tmp_path, "unrelated-history")
    evidence = repo / "docs/evidence/demo.md"
    evidence.parent.mkdir(parents=True)
    evidence.write_text("evidence\n", encoding="utf-8")
    _git(repo, "add", "docs/evidence/demo.md")
    _git(repo, "commit", "-m", "PR evidence")
    pr_head = _git(repo, "rev-parse", "HEAD")
    tree = _git(repo, "rev-parse", f"{pr_head}^{{tree}}")
    unrelated = _git(repo, "commit-tree", tree, "-m", "unrelated same tree")
    _git(repo, "reset", "--hard", unrelated)
    _git(repo, "update-ref", "refs/remotes/origin/main", unrelated)
    previous = _line(repo, pr_head, "DONE@P6", evidenceHead=evidence_head)
    terminal = _line(
        repo,
        unrelated,
        "DONE@P7",
        evidenceHead=evidence_head,
        prHead=pr_head,
        mergeCommit=unrelated,
    )

    code, result = _run(
        tmp_path,
        repo,
        [previous, terminal],
        expected_head=unrelated,
    )

    assert code == 2 and result["held"] == "evidence_stale"


def test_terminal_p7_remote_parser_accepts_exact_single_main_ref():
    merge = "a" * 40
    code, result = _run_trusted_git_pure(
        "parseTrustedRemoteMainResult",
        {
            "status": 0,
            "stdout": f"{merge}\trefs/heads/main\n",
            "expectedRef": "refs/heads/main",
        },
    )

    assert code == 0 and result == {"ok": True, "value": merge}


@pytest.mark.parametrize(
    ("remote_output", "status"),
    [
        ("", 0),
        ("not-a-sha\trefs/heads/main\n", 0),
        ("0" * 40 + "\trefs/heads/other\n", 0),
        ("0" * 40 + "\trefs/heads/main\n" + "1" * 40 + "\trefs/heads/main\n", 0),
        ("", 3),
    ],
)
def test_terminal_p7_fails_closed_on_invalid_live_remote_resolution(
    remote_output, status
):
    code, result = _run_trusted_git_pure(
        "parseTrustedRemoteMainResult",
        {
            "status": status,
            "stdout": remote_output,
            "expectedRef": "refs/heads/main",
        },
    )

    assert code == 2 and result["ok"] is False
