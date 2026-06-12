---
name: spec-to-done
description: "Use when an approved implementation spec exists under docs/superpowers/specs and the user asks to run spec-to-done, continue spec-to-done, drive a spec to PR, or run an autonomous spec-to-done workflow in Codex."
---

# spec-to-done for Codex

Drive an already approved implementation spec from `docs/superpowers/specs/` toward a verified PR using Codex-native orchestration.

This is a Codex port of the local Claude `spec-to-done` commander workflow. It is a skill, not a hidden runtime. Do not call Claude `Workflow({name: ...})`, do not shell-launch fake agents, and do not claim this is an official Codex feature. The parent Codex session owns orchestration, gates, integration, and final reporting.

## Contract

- Treat the spec as the product source of truth. If the spec has placeholders, contradictions, or ambiguous scope, stop with `HELD`.
- Follow the current host and repo rules first. User instructions, repo `AGENTS.md`, and Codex system rules override this skill.
- Do not commit, push, create PRs, merge, deploy, or publish unless the user's current request explicitly includes that action or explicitly asks to run spec-to-done through that stage.
- Use Codex-native tools only: parent-session work, workflow artifacts, `spawn_agent` when explicitly permitted and useful, GitNexus MCP/CLI when the repo requires impact checks, and Browser/Playwright/GStack only when available and appropriate.
- Preserve the original hard gates: spec contradiction, unacknowledged critical impact, missing browser evidence for user-facing work, non-closing P1/P2 issues, shipping consent carve-outs, repeated tool failure.
- Preserve durable resume: every phase completion or hold appends a state line under `artifacts/spec-to-done/`.
- Use the smallest workflow that can prove the result. Do not create ceremony for trivial docs-only or inspection-only asks.

## Host Mapping

The Claude source used named workflows:

- `std-plan`
- `std-implement`
- `std-evidence`
- `fu-adversarial-verify-generic`
- `ship-item`

In Codex, map them to explicit parent-owned phases instead of calling a workflow runtime:

| Claude workflow | Codex-native replacement |
| --- | --- |
| `std-plan` | Parent creates a phase plan under `artifacts/spec-to-done/<slug>/plan.md`; use planning/review subagents only as bounded read-only reviewers. |
| `std-implement` | Parent executes tasks sequentially. Use worker agents only for disjoint file ownership and only when delegation is explicitly allowed. |
| `std-evidence` | Parent runs Browser/Playwright/GStack evidence collection and records screenshots, traces, route, buttons, fixture, runtime IDs, and limitations. |
| `fu-adversarial-verify-generic` | Parent runs an independent verification pass. Prefer explorer agents for read-only adversarial review when allowed. |
| `ship-item` | Parent performs GitHub/PR/merge work only when explicitly requested; otherwise stop with a clear next action. |

Never replace the table above with a shell wrapper or generated runner. Dynamic workflow resilience comes from persisted artifacts, bounded packets, explicit gates, and restartable state.

## Trigger And Args

Typical user input:

```text
用 spec-to-done 跑 docs/superpowers/specs/<file>.md, user-facing
繼續 spec-to-done
```

The parent session must derive and record:

```text
specPath      absolute spec path; required
slug          spec filename without date prefix and design suffix
dateStamp     YYYY-MM-DD from the parent session
branch        feat/<slug>, fix/<slug>, or chore/<slug>
userFacing    true when the spec touches user-operable UI or if unsure
worktreeRoot  absolute repo or linked-worktree root
statePath     artifacts/spec-to-done/<slug>-state.md
runDir        artifacts/spec-to-done/<slug>/
```

If any required arg cannot be derived safely, stop with `HELD@P0`.

## P0 Commander Opening

1. Read the repo `AGENTS.md`, relevant lazy-loaded agent docs, the spec, and current git status.
2. Check the spec for placeholders, contradictions, missing acceptance criteria, and scope ambiguity.
3. Decide whether a linked worktree is needed. Do not create nested worktrees. If an existing `.worktrees/<slug>/` exists, inspect it before reusing it.
4. Create or update:

```text
artifacts/spec-to-done/<slug>/
  plan.md
  tasks.md
  evidence/
  reviews/
artifacts/spec-to-done/<slug>-state.md
```

5. Record P0 state before delegating or editing.

## Phase Gates

### P1 Plan

Goal: turn the approved spec into a task plan that can be implemented and verified.

Required checks:

- Completeness: tasks cover the spec.
- Spec alignment: no invented requirements.
- Task decomposition: tasks are sequential and reviewable.
- Buildability: commands, services, fixtures, and evidence paths are plausible.
- Impact pre-scan: if the repo requires GitNexus impact, run it before edits to important symbols.

Gate:

- `P1.ok === true` before implementation.
- `HIGH` impact is not a hard stop, but report blast radius and write mitigation into the PR body or final report.
- `CRITICAL` impact is `HELD` unless the user explicitly acknowledges the named symbols/processes.

### P3 Implement

Goal: implement one task at a time with focused verification.

Rules:

- Do not parallelize implementation tasks that touch overlapping files.
- Before editing a function, class, method, route, or shared contract in a GitNexus-indexed repo, run the required impact analysis.
- Add or update focused tests when behavior changes.
- Keep commits only when the user explicitly asked for a commit/PR/merge flow.
- Before any commit or PR handoff in a GitNexus-indexed repo, run `detect_changes` or the repo's documented fallback and record the result.

Review loop:

- First pass: spec alignment.
- Second pass: quality and regression risk.
- If a real P1/P2 issue does not close after reasonable fix rounds, stop with `HELD`.

### P4 Evidence

Goal: prove user-facing behavior through observable UI evidence.

For user-facing work, do not declare done from backend/API/tests alone. Evidence must include:

- route or URL
- exact buttons or controls tested
- default fixture or test data used
- real backend/API/runtime connection, or explicit `DEMO DATA` / `NOT BUILT` / `not observed`
- loading, success, failure, and retry states when applicable
- runtime ID or session ID when the system exposes one
- screenshot and trace or an equivalent browser evidence artifact

Browser engine order:

1. Use the repo-required browser QA tool when installed and working.
2. Use Codex Browser or Playwright when that is the available real browser path.
3. If no browser engine is available, stop with `HELD@P4`; do not fake evidence.

### P4 Backend Stack Preflight

Before running `.\scripts\deploy.ps1`, `.\scripts\dev\rebuild-test-deploy.ps1 -Build`, or an equivalent backend-stack rebuild in `AI-BIM-governance`, clear host-native runtime port blockers.

Default to a non-mutating detection pass first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1 -DetectOnly
```

Fallback to the global Codex skill helper when the repo-local copy is missing:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\IOT\.codex\skills\spec-to-done\ensure-host-native-ports-free.ps1 -DetectOnly
```

Exit code `0` means the required host-native ports are free. Exit code `1` means report the blocking PID/port. Only run the helper without `-DetectOnly` when current repo instructions or the current user request explicitly authorize stopping host-native runtime blockers such as Kit, conversion Python, or spectator processes. If authorization is absent or the owner process is not clearly an allowed runtime blocker, stop with `HELD`; do not proceed into a known `Read-Host` hang.

### P5 Adversarial Verification

Goal: independently challenge the diff, the evidence, and the claim of completion.

When the user requested multi-agent or the host policy permits it:

- Spawn explorer agents for read-only adversarial review.
- Give each agent a bounded question and expected evidence.
- Do not let agents edit the same files unless ownership is explicit and disjoint.
- Parent integrates findings and rejects unsupported claims.

If native subagents are unavailable, run the adversarial pass locally and record that delegation was unavailable.

Gate:

- All real blockers are closed or explicitly held.
- Reviewer failures, null results, or missing evidence are not passes.

### P6 PR / Ship

Only run this phase when the user explicitly asked for PR/merge/shipping.

Before PR creation:

- Ensure branch state is understood.
- Ensure required tests, lint, build, and evidence checks are run or explicitly skipped with reason.
- Include user-facing evidence in the PR body when relevant.
- Include impact and fallback disclosures when relevant.

During shipping:

- Do not force push unless the user explicitly confirms.
- Do not merge around true P1/P2 findings.
- Do not merge when a consent carve-out applies: destructive external change, production data, release/hotfix policy, credentials, billing, or user-account changes.

If PR/merge is not explicitly authorized, stop after verification and report the next safe action.

### P7 Final Report

Report:

- tracked files changed
- untracked artifacts created
- validation run
- skipped checks and why
- evidence paths
- remaining risks
- any `HELD` state and exact resume command/context

## HELD Format

When stopped by a hard gate, append this line to `statePath` and show it to the user:

```text
HELD@P<n> | reason=<held value> | spec=<specPath> | slug=<slug> | userFacing=<bool> | dateStamp=<YYYY-MM-DD> | branch=<branch> | worktree=<absolute path> | planPath=<path> | taskIndex=<n/a or index> | prNumber=<n/a or number> | runIds=<agent ids or n/a> | diagnosis=<short evidence> | need=<specific user decision>
```

Common held reasons:

| held | Meaning | Parent action |
| --- | --- | --- |
| `bad_args` | required args cannot be derived | fix args or ask user for missing value |
| `spec_conflict` | spec contradicts itself or has placeholders | stop and ask for spec decision |
| `critical_impact` | GitNexus/repo impact is critical | ask user to split scope or acknowledge named risk |
| `impact_unavailable` | required code-intelligence check cannot run | restore tool/index or ask for sign-off |
| `plan_not_aligned` | plan cannot satisfy spec | stop with concrete mismatch |
| `implementation_not_closing` | real P1/P2 issue persists | stop with findings and attempted fixes |
| `no_browser_engine` | no real browser/evidence path exists | stop; do not fake evidence |
| `no_browser_evidence` | UI behavior was not observed | start stack safely or stop |
| `ship_blocked` | PR/CI/merge gate blocks shipping | stop with exact blocker |

## Resume

When the user says `繼續 spec-to-done`:

1. Find the latest `artifacts/spec-to-done/<slug>-state.md`, or ask for the slug/spec path if multiple candidates exist.
2. Read the last `HELD` or phase-complete line.
3. Restore `specPath`, `slug`, `dateStamp`, `branch`, `userFacing`, `worktreeRoot`, `planPath`, and any PR number.
4. Re-run only the blocked or next phase.
5. Do not redo completed plan, implementation, commits, or evidence unless source files changed or the previous artifact is missing.

Transcript memory is not durable. The state file is the durable coordinate.

## Dynamic Workflow Rules For Codex

- Parent session keeps the critical path local.
- Use `spawn_agent` only when the user explicitly asked for subagents, multi-agent work, delegation, or this spec-to-done run clearly benefits from independent verification under current host policy.
- Use explorer agents for source discovery, impact review, test discovery, and adversarial verification.
- Use worker agents only for disjoint implementation slices with explicit file ownership.
- Every worker prompt must say: `You are not alone in the codebase. Do not revert edits made by others. Adapt to nearby changes.`
- If `spawn_agent` is unavailable or not permitted, continue in parent workflow mode and record the fallback.
- Do not wait on agents unless their result blocks the next parent decision.
- Integrate all agent outputs before final verification.

## AI-BIM-governance Specific Notes

When running inside `C:\Repos\active\iot\AI-BIM-governance`:

- Read repo `AGENTS.md` first.
- User-facing done requires browser evidence, not only API/test completion.
- Real IFC semantic viewer E2E uses local `storage/` artifacts; do not commit IFC or large `model.usdc` files.
- If deployment/rebuild can hit host-native Kit/conversion port blockers, run the helper before starting the stack.
- Preserve the repo's GitNexus impact and detect-changes requirements.

## What Not To Port

- Do not call Claude named workflows from Codex.
- Do not depend on Claude model names, Claude-only memory, or Claude-specific `Run ID: wf_...` semantics.
- Do not copy `.claude/workflows/*.js` as if Codex will execute them.
- Do not lower gates to compensate for missing runtime. Missing runtime means local parent execution or `HELD`, not fake success.
