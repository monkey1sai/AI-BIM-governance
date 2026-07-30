import json
import pathlib
import shutil
import subprocess

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
CLAUDE_VALIDATOR = ROOT / ".claude/skills/spec-to-done/validate-state.mjs"
CODEX_VALIDATOR = ROOT / ".codex/skills/spec-to-done/validate-state.mjs"
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


def _line(repo, head, prefix="DONE@P5", **overrides):
    fields = {
        "spec": (repo / "spec.md").as_posix(),
        "slug": "demo",
        "userFacing": "false",
        "dateStamp": "2026-07-29",
        "branch": "feat/demo",
        "worktree": repo.as_posix(),
        "head": head,
        "executionMode": "full",
        "closeoutTaskIds": "",
        "planPath": "",
        "taskIndex": "2",
        "prNumber": "",
        "runIds": "P5:wf_abc123",
        "agentCalls": "8/40",
        "p5Rounds": "1/2",
        "evidenceAttempts": "1/2",
        "evidenceHead": head,
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
            GIT,
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
        ],
        capture_output=True,
        text=True,
    )
    return proc.returncode, json.loads(proc.stdout)


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
    code, result = _run(tmp_path, repo, lines, expected_head=merge)
    assert code == 0 and result["ok"] is True

    dirty = repo / "src/dirty.txt"
    dirty.write_text("uncommitted product drift\n", encoding="utf-8")
    code, result = _run(tmp_path, repo, lines, expected_head=merge)
    assert code == 2 and result["held"] == "evidence_stale"
    dirty.unlink()

    illegal_jump = [lines[0].replace("DONE@P6", "DONE@P0"), lines[1]]
    code, result = _run(tmp_path, repo, illegal_jump, expected_head=merge)
    assert code == 2 and result["held"] == "resume_state_invalid"

    repo, lines, merge = _terminal_state(tmp_path, "different-tree", True)
    code, result = _run(tmp_path, repo, lines, expected_head=merge)
    assert code == 2 and result["held"] == "evidence_stale"
