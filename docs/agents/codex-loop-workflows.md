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
| S: explicit spec-to-done/full Superpowers | full P0–P7 composition |

The coordinator owns scope, source-of-truth loading, write-conflict control, evidence synthesis, and final verification. Workers are read-only unless a bounded, non-conflicting scope is explicitly granted. Do not pin model names or duplicate global tiers, effort lanes, output schemas, or generic workflow modes here.

## Docs/plans vertical slice

For a requirement from `docs/plans/`, read `docs/plans/docs-plans-README.md`, then the interaction spec, trajectory/DoD, design spec, and relevant plan. Respect repo boundaries and GitNexus impact before changing code symbols. Implement the smallest slice:

```text
UI route -> main button -> default fixture -> coordinator API
-> runtime/backend result -> visible status/result -> E2E evidence
```

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
