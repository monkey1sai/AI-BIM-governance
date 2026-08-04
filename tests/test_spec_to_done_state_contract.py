import json
import os
import pathlib
import shlex
import shutil
import subprocess

import pytest
from jsonschema import Draft7Validator


ROOT = pathlib.Path(__file__).resolve().parents[1]
CLAUDE_VALIDATOR = ROOT / ".claude/skills/spec-to-done/validate-state.mjs"
CODEX_VALIDATOR = ROOT / ".codex/skills/spec-to-done/validate-state.mjs"
CLAUDE_SKILL = ROOT / ".claude/skills/spec-to-done/SKILL.md"
CODEX_SKILL = ROOT / ".codex/skills/spec-to-done/SKILL.md"
MACHINE_CONTRACT = ROOT / "agent-contracts/spec-to-done.contract.json"
MACHINE_CONTRACT_SCHEMA = ROOT / "agent-contracts/spec-to-done.contract.schema.json"
GIT = shutil.which("git")
EXCLUSIONS = (
    "secrets,credentials,billing,production-data,destructive-delete,"
    "unproven-process-stop"
)


def _git(repo, *args):
    if GIT is None:
        pytest.skip("git is required")
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
):
    if GIT is None:
        pytest.skip("git is required")
    state = tmp_path / "state.md"
    if isinstance(state_lines, str):
        state_lines = [state_lines]
    state.write_text("\n".join(state_lines) + "\n", encoding="utf-8")
    proc = subprocess.run(
        [
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
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, **(env_overrides or {})},
    )
    return proc.returncode, json.loads(proc.stdout)


def _make_git_proxy(tmp_path, name, repo, ls_remote_output, *, status=0):
    if os.name == "nt":
        pytest.skip("terminal P7 git proxy integration is POSIX-only")
    if GIT is None:
        pytest.skip("git is required")
    proxy_dir = tmp_path / name
    proxy_dir.mkdir()
    proxy = proxy_dir / "git"
    fixed_remote = "https://github.com/monkey1sai/AI-BIM-governance.git"
    script = f"""#!/bin/sh
is_ls_remote=0
for arg in "$@"; do
  if [ "$arg" = "ls-remote" ]; then
    is_ls_remote=1
  fi
done
if [ "$is_ls_remote" -eq 1 ]; then
  if [ "${{GIT_CONFIG_COUNT+x}}" = x ] || [ "${{GIT_CONFIG_KEY_0+x}}" = x ] || [ "${{GIT_CONFIG_VALUE_0+x}}" = x ] || [ "${{GIT_EXEC_PATH+x}}" = x ]; then
    exit 91
  fi
  if [ "${{GIT_SSL_NO_VERIFY+x}}" = x ] || [ "${{CURL_CA_BUNDLE+x}}" = x ] || [ "${{SSL_CERT_FILE+x}}" = x ]; then
    exit 92
  fi
  if [ "$GIT_CONFIG_GLOBAL" != /dev/null ] || [ "$GIT_CONFIG_SYSTEM" != /dev/null ] || [ "$GIT_CONFIG_NOSYSTEM" != 1 ]; then
    exit 93
  fi
  case " $* " in
    *" {fixed_remote} refs/heads/main "*) ;;
    *) exit 94 ;;
  esac
  case "$PWD/" in
    {shlex.quote(repo.as_posix() + '/')}*) exit 95 ;;
  esac
  printf '%s' {shlex.quote(ls_remote_output)}
  exit {status}
fi
exec {shlex.quote(GIT)} "$@"
"""
    proxy.write_text(script, encoding="utf-8")
    proxy.chmod(0o755)
    return proxy.as_posix()


def test_machine_contract_is_schema_valid_closed_and_deterministic():
    schema = json.loads(MACHINE_CONTRACT_SCHEMA.read_text(encoding="utf-8"))
    contract = json.loads(MACHINE_CONTRACT.read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    Draft7Validator(schema).validate(contract)
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


def test_valid_claude_and_codex_states_and_single_canonical_validator(tmp_path):
    repo, head = _new_repo(tmp_path)
    # 單一正本政策（pr-review-agent generated_tooling_path 規則）：validate-state.mjs 只存在
    # .claude 側；.codex 鏡像不得放副本（SKILL.md 指向 .claude 路徑）。兩平台 state 都用同一正本驗。
    assert CLAUDE_VALIDATOR.exists()
    assert not CODEX_VALIDATOR.exists()
    code, result = _run(tmp_path, repo, _line(repo, head))
    assert code == 0 and result["ok"] is True
    code, result = _run(
        tmp_path,
        repo,
        _line(repo, head, runIds="P5:codex:019f9324-65d8-7223-9d3e-efabb2eeb08c"),
        platform="codex",
    )
    assert code == 0 and result["ok"] is True


def test_non_terminal_validation_does_not_resolve_the_remote(tmp_path):
    repo, head = _new_repo(tmp_path)
    proxy = _make_git_proxy(
        tmp_path,
        "non-terminal-git",
        repo,
        "remote resolution must not run for P5\n",
        status=97,
    )

    code, result = _run(tmp_path, repo, _line(repo, head), git_exe=proxy)

    assert code == 0 and result["ok"] is True


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


def test_terminal_p7_requires_evidenced_pr_tree_equivalence(tmp_path):
    repo, lines, merge = _terminal_state(tmp_path, "same-tree", False)
    proxy = _make_git_proxy(
        tmp_path,
        "same-tree-git",
        repo,
        f"{merge}\trefs/heads/main\n",
    )
    code, result = _run(tmp_path, repo, lines, expected_head=merge, git_exe=proxy)
    assert code == 0 and result["ok"] is True

    dirty = repo / "src/dirty.txt"
    dirty.write_text("uncommitted product drift\n", encoding="utf-8")
    code, result = _run(tmp_path, repo, lines, expected_head=merge, git_exe=proxy)
    assert code == 2 and result["held"] == "evidence_stale"
    dirty.unlink()

    illegal_jump = [lines[0].replace("DONE@P6", "DONE@P0"), lines[1]]
    code, result = _run(tmp_path, repo, illegal_jump, expected_head=merge, git_exe=proxy)
    assert code == 2 and result["held"] == "resume_state_invalid"

    repo, lines, merge = _terminal_state(tmp_path, "different-tree", True)
    proxy = _make_git_proxy(
        tmp_path,
        "different-tree-git",
        repo,
        f"{merge}\trefs/heads/main\n",
    )
    code, result = _run(tmp_path, repo, lines, expected_head=merge, git_exe=proxy)
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

    proxy = _make_git_proxy(
        tmp_path,
        "unrelated-history-git",
        repo,
        f"{unrelated}\trefs/heads/main\n",
    )
    code, result = _run(
        tmp_path,
        repo,
        [previous, terminal],
        expected_head=unrelated,
        git_exe=proxy,
    )

    assert code == 2 and result["held"] == "evidence_stale"


def test_terminal_p7_ignores_local_tracking_ref_and_obeys_live_remote(tmp_path):
    repo, lines, merge = _terminal_state(tmp_path, "remote-trust", False)
    pr_head = lines[-1].split("prHead=", 1)[1].split(" |", 1)[0]
    _git(repo, "update-ref", "refs/remotes/origin/main", pr_head)
    trusted_proxy = _make_git_proxy(
        tmp_path,
        "trusted-remote-git",
        repo,
        f"{merge}\trefs/heads/main\n",
    )

    code, result = _run(
        tmp_path,
        repo,
        lines,
        expected_head=merge,
        git_exe=trusted_proxy,
        env_overrides={
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.sslVerify",
            "GIT_CONFIG_VALUE_0": "false",
            "GIT_EXEC_PATH": "/untrusted/git-core",
            "GIT_SSL_NO_VERIFY": "1",
            "CURL_CA_BUNDLE": "/untrusted/ca-bundle",
            "SSL_CERT_FILE": "/untrusted/certificate",
        },
    )

    assert code == 0 and result["ok"] is True

    _git(repo, "update-ref", "refs/remotes/origin/main", merge)
    stale_remote_proxy = _make_git_proxy(
        tmp_path,
        "stale-remote-git",
        repo,
        f"{pr_head}\trefs/heads/main\n",
    )

    code, result = _run(
        tmp_path,
        repo,
        lines,
        expected_head=merge,
        git_exe=stale_remote_proxy,
    )

    assert code == 2 and result["held"] == "evidence_stale"


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
    tmp_path, remote_output, status
):
    repo, lines, merge = _terminal_state(tmp_path, "malformed-remote", False)
    proxy = _make_git_proxy(
        tmp_path,
        "malformed-remote-git",
        repo,
        remote_output,
        status=status,
    )

    code, result = _run(
        tmp_path,
        repo,
        lines,
        expected_head=merge,
        git_exe=proxy,
    )

    assert code == 2 and result["held"] == "evidence_stale"
