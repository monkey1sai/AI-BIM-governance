# Codex Loop Workflow Contract

> Loaded lazily by `AGENTS.md` / `CLAUDE.md`.
> Generic task routing source-of-truth: `C:\Users\IOT\.codex\docs\agents\task-routing.md`.

## Local routing

Default to one coordinator and Lane F/B. Use these local mappings only:

| Lane / situation | Role composition |
|---|---|
| F: small bug/docs/tests/timeout/logging | single coordinator; no worker or Superpowers |
| B: bounded single-service change | single coordinator; optional one debugger; maximum one read-only reviewer |
| G: cross-service/user-facing/runtime/security/deploy | risk-scoped `explorer`, `debugger`, `reviewer`, or `security_auditor` |
| G-shape: huge or foggy destination that cannot fit one session | explicit work-shaping map; research/prototype/grilling tickets only; no production implementation |
| S: explicit spec-to-done/full Superpowers | full P0–P7 composition |

The coordinator owns scope, source-of-truth loading, write-conflict control, evidence synthesis, and final verification. Workers are read-only unless a bounded, non-conflicting scope is explicitly granted. Do not pin model names or duplicate global tiers, effort lanes, output schemas, or generic workflow modes here.

For concurrent writers, load `docs/agents/parallel-delivery-fabric.md`. Session
count is not an admission gate: each writer must own an independent sibling
worktree, branch, and non-overlapping declared touch-set. Same branch/worktree
contention and unknown overlap remain queued. `WRITER_CAPACITY` is reserved for
separately attested physical Kit/WebRTC capacity, not the number of coding
sessions. The Fabric remains shadow-only and cannot activate merge or delivery.

The global apex-slot gate applies to every child dispatch in this repo. Reserve one apex planning/review/decision assignment, then route any remaining worker with the minimum sufficient model, effort, bounded prompt, and evidence responsibility; no apex means `HELD` rather than a downgraded swarm.

## Situational work shaping

Use G-shape only when the destination is too large or uncertain for one effective session: greenfield architecture, a major cross-service capability, unresolved product/runtime trade-offs, or a feature whose decisions cannot yet be expressed as agent-ready acceptance criteria. It is not the default entrypoint and does not replace Lane G execution.

The map is an index of unresolved decisions, not a second specification. Record:

```text
Destination:
Decisions already made:
Frontier tickets:
Not yet specified:
Out of scope:
```

Allowed ticket types are bounded research, throwaway prototype, human decision/grilling, and a manual task that unblocks a decision. Each ticket must declare HITL or AFK, blockers, expected evidence, and its exit decision. The shaping session must not modify production code or claim delivery.

Early exit: when breadth-first inspection finds no material fog, do not create a map. Route directly to the existing requirement source, a concise Lane G checklist, or explicit `spec-to-done` when the user requested it.

Graduation requires all material decisions to have one owning source and the implementation work to be expressible as vertical tickets. Never duplicate the same decision across a map, OpenSpec, `docs/plans`, and `docs/superpowers/specs`.

## Docs/plans vertical slice

For a requirement from `docs/plans/`, read `docs/plans/docs-plans-README.md`, then the design doc `AI-BIM 前後端設計文件.dc.html` owning sections (§03 route IA, §04 API contract, §07 phases/DoD, §08 delivery rules). Respect repo boundaries and GitNexus impact before changing code symbols. Implement the smallest slice:

```text
UI route -> main button -> default fixture -> coordinator API
-> runtime/backend result -> visible status/result -> E2E evidence
```

Each implementation ticket must be independently verifiable, declare native or textual `Blocked by` edges, and fit one fresh agent context. Start the next ticket from its requirement source, dependency outcomes, touched boundaries, and evidence contract; do not carry the full exploratory conversation forward. Wide mechanical refactors use expand-contract batches rather than pretending each call-site batch is a user-visible vertical slice.

User-facing completion requires a real route, button, fixture, loading/success/failure/retry state, runtime ID, and Playwright / gstack / supported browser engine screenshot or trace. Backend-only completion is insufficient; absent services must be marked `DEMO DATA`, `NOT BUILT`, or `not observed`.

## Evidence record

```text
Frontend route:
Main button(s) tested:
Fixture used:
Backend API called:
Runtime action / ID:
Visible success or failure state:
E2E command:
Screenshot / trace:
Known gaps:
```

Run targeted tests first. For Kit/WebRTC or deploy work, include runtime logs and ownership evidence. Lane F does not require GitNexus. Lane B runs one task-level impact and detect_changes only when code symbols/flows changed. Lane G/S retain full shared-symbol impact and pre-commit detect_changes. Final reports state lane, agents used/skipped, files, verification, evidence, risks, and next step.

## Scope guard

Do not broaden this local map; read the global contract for generic governance.

Keep this file local and intentionally small.
