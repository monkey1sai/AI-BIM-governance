> Loaded lazily by AGENTS.md / CLAUDE.md. Source-of-truth: AGENTS.md.
>
> Read this file when a task is non-trivial, high-risk, asks for audit/review/E2E readiness, or may need worker/subagent decomposition.

# Advanced Agent Reasoning Contract

This file defines how agents should route reasoning effort, dispatch workers, label evidence, and finish work in this repo. It does not replace repo boundary, product, GitNexus, deploy, or verification contracts.

## 1. Operating Principle

Do not use vague instructions like "think harder" as the control mechanism. For advanced models, define the outcome, evidence standard, allowed side effects, stopping rules, and verification gates.

Optimize for:

- verified repo facts over stale memory or generated summaries
- smallest safe action over broad refactor
- evidence over plausible explanation
- correctness over speed when risk is high

## 2. Task Complexity Tiers

- Trivial: direct answer, single command, or simple explanation. No decomposition required.
- Simple: one source of truth plus one verification step. No model worker required.
- Non-trivial: touches architecture, multiple files/services, tests, deployment, user-facing behavior, ambiguous requirements, or external tools. Decompose before answering or editing.
- High-risk: touches auth, secrets, permissions, production deploy, CI, data deletion, security, shared contracts, model/runtime config, Kit/WebRTC runtime, or destructive commands. Use explicit reviewer perspectives and stronger evidence.

## 3. Reasoning Effort Routing

Use the lowest reasoning effort that satisfies the task.

- low: simple extraction, formatting, or single-file lookup
- medium: normal coding, repo navigation, small bugfixes
- high: complex debugging, cross-file design, architecture, data flow, test strategy
- xhigh: multi-service root cause, security review, migration planning, PR closeout, deploy/runtime incident, or tasks where evidence shows higher effort improves quality

Higher effort is not automatically better. If requirements conflict, success criteria are weak, or tool access is open-ended, first improve the task contract.

## 4. Worker / Reviewer Extraction Rule

For non-trivial tasks, the agent must either dispatch independent subquestions to workers/tools/reviewer lenses or state why dispatch is not useful. "Worker" is an umbrella term here:

- tool-based extraction: shell, MCP, GitNexus, tests, browser, or other objective tooling
- internal reviewer perspectives: the coordinator applies named reviewer lenses without spawning another agent
- actual Codex subagents: only when explicitly requested, supported by the current surface, and file scopes do not conflict

Worker/reviewer extraction is mandatory when:

- there are 2+ independent code areas that can be inspected in parallel
- bug/root-cause investigation has multiple plausible failure layers
- the task involves security, deployment, data-loss, migration, production risk, Kit/WebRTC runtime, or E2E readiness
- the user asks for audit, PR review, architecture review, or E2E readiness
- a long document/codebase can be split into bounded read-heavy sections

Actual Codex subagents remain optional when:

- the answer depends mainly on direct source-of-truth files
- shell/MCP/GitNexus output gives objective facts faster than model summarization
- the task is read-only orientation and no implementation decision is being made

When actual subagents are skipped for a non-trivial task, the final answer must include why, what tools/files replaced subagent extraction, and which reviewer perspectives were still applied.

## 5. Worker Output Contract

Each worker, actual subagent, or named reviewer perspective must return:

- Scope: what it inspected
- Evidence: files, commands, tool outputs, links, or tests
- Finding: concise conclusion
- Uncertainty: what was not verified
- Risk: what could break or mislead
- Next step: smallest useful follow-up

No worker may return only a generic summary.

## 6. Reviewer Perspectives

For non-trivial tasks, choose 2-5 reviewer perspectives based on risk:

- Correctness
- Architecture / repo boundary
- Security / permissions
- Runtime / deployment / Kit-WebRTC
- Test / regression
- UX / user-facing evidence
- Data quality
- Maintainability
- Cost / context complexity

Reviewers must challenge the first plausible answer. If reviewers disagree, state the disagreement and choose the safest qualified conclusion.

## 7. Evidence Labels

Final answers for non-trivial tasks must separate:

- Verified facts: directly observed from files, commands, tests, screenshots, or tool output
- Inferences: conclusions derived from verified facts
- Unverified risks: plausible issues not tested in this turn
- Next action: the smallest safe next step

Do not present docs claims, stale memory, generated wiki, GitNexus/graph summaries, or old evidence as runtime-verified facts.

## 8. Source-of-Truth Priority

Do not mix agent instruction priority with runtime/product behavior truth. The canonical definitions live in root `AGENTS.md` §3:

- Agent instruction priority: user's latest explicit instruction > root `AGENTS.md` (including loaded `docs/agents/*.md` lazy-load details) > `CLAUDE.md` > installed skills / generated artifacts.
- Runtime/product behavior truth: code implementation and executable tests/contracts describe current behavior; `docs/plans/` describes target requirements and acceptance semantics; old evidence and generated summaries are exploratory only.

If docs and runtime disagree, do not claim runtime completion from docs. Report the mismatch as an implementation or documentation gap and verify against code/tests before changing behavior.

## 9. Done Gate

A task is not done until the agent reports:

- changed files, or "no files changed"
- validation performed
- validation not performed and why
- known risks
- evidence path or command output summary when applicable
- whether worker dispatch was used or skipped

User-facing work still must satisfy the stricter frontend evidence contract in `docs/agents/product-operability-and-script-contract.md`.

### Codex loop workflow routing

When the user asks Codex to develop requirements from `docs/plans/`,
the agent MUST first load `docs/plans/docs-plans-README.md`, then load the
specific plan file required by the task.

When the user explicitly asks for `use agents`, `subagents`, `swarm`,
`parallel agents`, a named workflow mode, architecture review, PR review,
E2E readiness, or high-risk runtime work, load
`docs/agents/codex-loop-workflows.md` and select one workflow mode before
editing:

- `classify-and-act`
- `fan-out-and-synthesize`
- `adversarial verification`
- `generate-and-filter`
- `tournament`
- `loop-until-done`

Actual Codex subagents are used only when explicitly requested, or when the
current Codex surface supports explicit subagent spawning and the task risk/scope justifies it.
Otherwise, the coordinator applies the same reviewer perspectives internally
and states that subagents were skipped.

The main agent is always the coordinator. Subagents are bounded workers and
default to read-only unless the coordinator explicitly assigns a non-conflicting
write scope.

Final reports for such tasks MUST include:
- mode used
- agents used or skipped
- source-of-truth files read
- decision
- changes made
- verification
- evidence path
- risks / remaining unknowns
- recommended next step
