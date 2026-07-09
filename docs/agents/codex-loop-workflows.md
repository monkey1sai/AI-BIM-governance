# Codex Loop Workflow Contract

> Loaded lazily by AGENTS.md / CLAUDE.md.
> Read this file when the user asks for `use agents`, `subagents`, `swarm`,
> `parallel agents`, a named workflow mode, architecture review, PR review,
> E2E readiness, high-risk runtime work, or implementation of docs/plans requirements.

## 1. Purpose

This file defines how Codex SHALL choose and execute agent workflow modes
when developing requirements from `docs/plans/` in this repo.

It extends:

- `AGENTS.md`
- `docs/agents/advanced-agent-reasoning-contract.md`
- `docs/agents/product-operability-and-script-contract.md`
- `docs/agents/github-workflow.md`

It does not replace repo boundary, product specs, GitNexus, gstack,
verification, deploy, or PR evidence contracts.

## 2. Default rule

Default to a single coordinator agent.

Only use actual Codex subagents when the user explicitly asks for:

- `use agents`
- `subagents`
- `swarm`
- `parallel agents`
- one of the workflow modes below
- or “choose the best multi-agent workflow”

If the task is non-trivial but actual subagents were not requested,
the coordinator SHALL still apply reviewer perspectives internally and state
that actual subagent spawning was skipped.

## 3. Coordinator rule

The main Codex agent is always the coordinator.

The coordinator owns:

- objective clarification
- source-of-truth loading
- workflow mode selection
- file-scope partitioning
- write-conflict control
- evidence synthesis
- final patch integration
- verification and final report

Subagents are bounded workers. Unless explicitly authorized, subagents are
read-only and MUST NOT modify tracked files.

## 4. Workflow modes

### classify-and-act

Use when task type is unclear.

Classify first:

- bug
- feature
- refactor
- test
- docs
- security
- performance
- infra
- runtime / Kit-WebRTC
- product-spec alignment

Then activate only the needed specialist lens.

### fan-out-and-synthesize

Use when the task naturally splits into independent areas.

Typical repo split:

- product/spec reader
- repo-boundary reviewer
- frontend operability reviewer
- backend/API contract reviewer
- runtime/Kit-WebRTC reviewer
- test/E2E reviewer

Coordinator synthesizes consensus, disagreement, and evidence strength.

### adversarial verification

Mandatory for:

- auth
- secrets
- permissions
- CI/deploy
- destructive scripts
- data migration
- shared contracts
- runtime/Kit/WebRTC
- GPU/session lifecycle
- user-facing done claims

Use at least:

- builder
- verifier

Verifier MUST search for regressions, missing tests, edge cases,
boundary violations, fake evidence, and overclaimed completion.

### generate-and-filter

Use when the solution space is open.

Examples:

- new architecture
- API shape
- data model
- UI flow
- test strategy
- scheduler/orchestrator design

Generate 2–4 candidates and filter by:

- correctness
- repo-boundary safety
- frontend operability
- testability
- maintainability
- runtime risk
- cost / scope

### tournament

Use when multiple viable candidates remain.

Rank with explicit criteria:

- correctness
- simplicity
- maintainability
- testability
- security
- runtime safety
- user-facing evidence
- delivery cost

Winner must be evidence-backed, not preference-backed.

### loop-until-done

Use for:

- debugging
- failing tests
- flaky E2E
- migration repair
- build failure
- runtime readiness
- deploy smoke failure

Each loop:

1. state hypothesis
2. make one small change
3. run targeted verification
4. inspect result
5. update hypothesis
6. stop when done or blocked

Default max loop count: 3.
If not done, final report MUST say `未完成` and list blockers.

## 5. Codex Model / Effort Lane Routing

This section is the canonical Codex-side lane map. Do not use Claude model
names from historical Superpowers specs to choose Codex lanes.

| Task tier | Coordinator effort | Actual subagents | Notes |
|---|---|---|---|
| Trivial | low | no | Direct answer or single command. |
| Simple | medium | no | One source-of-truth file plus one verification step. |
| Non-trivial docs/code audit | high | optional `explorer` | Use fan-out only when areas are independent. |
| PR / architecture / E2E readiness review | high | `reviewer` when supported | Reviewer is read-only and must look for regressions and missing evidence. |
| Security / deploy / secrets / destructive scripts | xhigh | `security_auditor` when supported | Use adversarial verification; confirm before irreversible or host-affecting action. |
| Debug / failing test / runtime incident | high or xhigh | `debugger` when supported | Use loop-until-done, one hypothesis per loop, default max 3. |

Subagents must not write tracked files unless the coordinator gives a bounded,
non-conflicting file scope. If the task can be answered faster and more
objectively by shell/MCP/GitNexus/tests, tool-based extraction is sufficient.

## 6. docs/plans implementation protocol

When implementing a requirement from `docs/plans/`, Codex SHALL:

1. Read `docs/plans/docs-plans-README.md` first.
2. Apply source-of-truth order:
   - latest user instruction
   - interaction spec
   - development trajectory / DoD
   - design spec
   - prototype HTML as behavior/visual reference only
3. Read the relevant plan file for the selected A1–A10 capability.
4. Check repo-boundary constraints in AGENTS / docs/agents.
5. Choose a workflow mode.
6. Define a vertical slice:
   UI route → button → fixture → real API → runtime/backend result
   → visible status/result → E2E evidence.
7. Run GitNexus impact before editing code symbols.
8. Implement the smallest safe slice.
9. Run targeted tests.
10. For user-facing work, produce gstack/Playwright evidence.
11. Run GitNexus detect_changes before commit/PR.
12. Final report MUST include workflow mode, agents used/skipped,
    files changed, verification, evidence, risks, and next step.

## 7. Evidence priority

When agents disagree, trust in this order:

1. reproducible tests / typecheck / lint / build / benchmark
2. browser E2E screenshot / trace / console / network evidence
3. runtime logs and error messages
4. concrete code path / data-flow analysis
5. contracts / specs / docs
6. agent judgment

No evidence means hypothesis, not verified fact.

## 8. Subagent Output Schema

Every subagent result MUST include:

```txt
Scope:
Evidence:
Finding:
Uncertainty:
Risk:
Next step:
Recommendation: accept | reject | needs-follow-up
```

## 9. Coordinator Final Report Schema

Final report MUST include:

```txt
mode used:
agents used or skipped:
source-of-truth files read:
decision:
changes made:
verification:
frontend evidence, if user-facing:
runtime evidence, if Kit/WebRTC:
risks / remaining unknowns:
recommended next step:
```

If done condition is not met, the final report MUST say:

```txt
未完成

and list:
- hypotheses eliminated
- remaining blocker
- smallest next step
```
