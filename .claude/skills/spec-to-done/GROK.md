---
name: spec-to-done
description: Use when the user explicitly invokes spec-to-done, /spec-to-done, or the full Superpowers lifecycle on Grok Build, or asks to resume a held spec-to-done run. Do not trigger from "實作 spec", "完成需求", or "使用 agents" alone.
---

# spec-to-done — Grok adapter

Grok host mapping for the same spec-to-done run as Claude and Codex. **Gates, phases, held reasons, resume, evidence, and ship semantics are not redefined here.**

**REQUIRED:** Before any phase, Read the canonical commander SOP `.claude/skills/spec-to-done/SKILL.md` and the machine contract `agent-contracts/spec-to-done.contract.json`. Follow those files for P0/P1/P3/P4/P5/P6/P7, hold blocks, validator, and P7 terminal evidence.

This adapter only answers: how a Grok session produces the **same StructuredOutput and durable state** without Claude's `Workflow({name:'std-*.js'})` runtime.

## Source of truth

| Fact | Owner |
|---|---|
| Phases, held enum, durable path, P7 remote evidence | `agent-contracts/spec-to-done.contract.json` |
| Commander SOP / gate text | `.claude/skills/spec-to-done/SKILL.md` |
| StructuredOutput field names | `.claude/workflows/std-plan.js`, `std-implement.js`, `std-evidence.js`, `std-evidence-closeout.js`, `fu-adversarial-verify-generic.js` / `spec-to-done-adversarial-verify.js`, `ship-item.js` |
| State validator (single copy) | `.claude/skills/spec-to-done/validate-state.mjs` |
| Owner-only new-run status/writer | `.claude/skills/spec-to-done/append-new-run.mjs` |
| Isolation location when AGENTS.md isolation contract applies | repo sibling `AI-BIM-governance.worktrees\<slug>` from freshly fetched `origin/main` |

Do not copy the canonical SOP into this file. Drift is a blocker.

## Host facts (do not paper over)

- Grok **cannot** execute `.claude/workflows/*.js`. Mapping `Workflow({name})` to `spawn_subagent` / Grok `workflow` is a host adapter, **not** Claude dynamic workflow, Agent Team, or `/effort ultracode` equivalence.
- Subagent nesting depth = 1. The commander spawns workers. Workers **must not** spawn children.
- `capability_mode`: reviewers/security use `execute` (read + shell, no writes). Implementers use `all` / `read-write`. Debugger writes need explicit authorization.
- Parallel writers are forbidden. P3 implementer is serial. P1 axis review and P5 verifier batches: at most 2 live children.
- P6 `ship-item` remains validation-only `host_env_blocked` / `ship_workflow_shell_unavailable` until the trusted-host executor attests. Do not hand-fill `merged=true`.

If a phase cannot produce the same StructuredOutput fields as the JS workflow, **HELD** (`host_env_blocked` or the workflow's own held). Do not parent-only hand-run and call it a pass.

## `Workflow({name})` → Grok spawn

Keep the canonical args object. Do not stringify args. Count every spawn / workflow agent against `agentCalls` (max 40). Record actual IDs only.

| `name` | Grok host | Output that must exist |
|---|---|---|
| `std-plan` | serial: plan author (`all`) → up to 2 axis reviewers (`execute`) in waves → one fixer if needed → GitNexus impact (`execute`) | `{ok, held?, planPath, taskCount, tasks[{index,title,files,symbols,mechanical,userFacingTouch}], planReview, impact{overallRisk,perSymbol,blockers,staleHandled}, agentCallsUsed}` |
| `std-implement` | serial per task: impact → TDD implementer → spec review → quality review → `task#N:` commit. `mode:'fix'` only consumes `fixFindings` | `{ok, held?, finalReviewOk, completedThrough, perTask, highRiskNotes, minorNotes, finalReview, detectFallbackTasks, detectFailTasks, fixDetectVerdicts, agentCallsUsed}` |
| `std-evidence` | Playwright (default) / gstack / chrome fallback per canonical P4 | `{ok, held?, engine, evidence, evidenceAttemptsUsed}` |
| `std-evidence-closeout` | evidence/docs/ledger only; production files non-empty → fail closed | same closeout fields as JS |
| `fu-adversarial-verify-generic` | coordinator collects git snapshot; ≤2 verifier batches then serial critic; reviewers pinned to `git show` content | P5 fields in the canonical skill (verdicts length, SHAs, `fix_now` / `unverified` / `external_blockers`) |
| `ship-item` | do not invent a merge sink | `{heldReason:'host_env_blocked', heldDetail:'ship_workflow_shell_unavailable'}` unless trusted-host executor already attested live |

`runIds` MUST use `grok:<actual-subagent-or-workflow-id>` (example `grok:01a01998-c3f4-77b2-8825-0706ec8e57c6`). Never `native-*`. Keep prior `wf_*` / `codex:*` IDs on cross-CLI resume (`RESUMED@P<n> | decision=cross-cli-handoff`).

## Validator

Same binary as Claude/Codex. Grok current line uses `--platform grok`. P0 may still use `runIds=none`.

```powershell
node .claude/skills/spec-to-done/validate-state.mjs --state <temp> --platform grok --git-exe <approved system Git absolute path> --expected-head <SHA> --expected-worktree <worktreeRoot> --expected-agent-limit 40 --expected-p5-limit 2 --expected-evidence-limit 2 --trusted-main-ref refs/heads/main
```

Use only owner-installed system Git: Windows
`C:\Program Files\Git\{cmd,bin,mingw64\bin}\git.exe`, or POSIX `/usr/bin/git`/`/usr/local/bin/git`.
Do not use PATH discovery, a repository-local tool, or a caller-writable proxy. The validator strips ambient
`GIT_*`/config injection and binds executable path/hash/size/trust class plus git-dir/common-dir. If no approved
read-only system Git exists, return `host_env_blocked`; do not substitute another executable.

## Isolation (P0)

Follow canonical P0 detection (already in a linked worktree → do not nest). When creating isolation, **AGENTS.md sibling-path contract wins** over the canonical skill's `.worktrees/<slug>/` example:

```powershell
git fetch origin --prune
git worktree add -b feat/<slug> <repo-sibling>\AI-BIM-governance.worktrees\<slug> origin/main
```

Prove `git rev-parse HEAD` equals `git rev-parse origin/main` and `git status --porcelain` is empty before work.

## Allowed vs forbidden differences

Allowed: this host-mapping file; `spawn_subagent` instead of Claude `Workflow`; Grok model/effort routing; sibling worktree path; `--platform grok` / `grok:*` IDs; stating that JS workflows are not executable here.

Forbidden: changing phase order; skipping P4 when `userFacing=true`; letting codebase-memory flip GitNexus risk; new held reasons; claiming runtime equivalence with Claude/Codex workflows; lowering P5/P6/P7; implementing inside a reviewer. **禁止**宣稱與 Claude dynamic workflow / Codex JS runtime 等價。

## Current-run resume

Durable state path is unchanged: `artifacts/spec-to-done/{slug}-state.md` inside the governed worktree. After this adapter exists, later checkpoints on a Grok session validate with `--platform grok` and must not drop earlier IDs.

Before any resume, run the canonical appender's read-only `status --json`. A terminal
`run_budget_exhausted` never permits Grok to reset counters or hand-write `NEW_RUN@P0`; only an exact owner
message followed by the canonical `append` action may create the new-run boundary in a fresh descendant
worktree. Its SHA-256 owner tuple is provenance binding, not a digital signature or identity proof. After the
boundary, start at P0 and rerun every applicable gate; no prior P0-P7 pass carries forward automatically.
