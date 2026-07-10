# Codex Loop Workflow Contract

> Loaded lazily by `AGENTS.md` / `CLAUDE.md`.
> Generic task routing source-of-truth: `C:\Users\IOT\.codex\docs\agents\task-routing.md`.

## Local routing

Default to one coordinator. Use these local mappings only:

| Situation | Role composition |
|---|---|
| Cross-service/source discovery | `explorer` |
| Kit/WebRTC/runtime incident | `debugger` + `reviewer` |
| Auth/deploy/permissions/destructive scripts | `security_auditor` + `reviewer` |
| PR/E2E/user-facing done | `reviewer` |
| Small docs lookup | single coordinator |

The coordinator owns scope, source-of-truth loading, write-conflict control, evidence synthesis, and final verification. Workers are read-only unless a bounded, non-conflicting scope is explicitly granted. Do not pin model names or duplicate global tiers, effort lanes, output schemas, or generic workflow modes here.

## Docs/plans vertical slice

For a requirement from `docs/plans/`, read `docs/plans/docs-plans-README.md`, then the interaction spec, trajectory/DoD, design spec, and relevant plan. Respect repo boundaries and GitNexus impact before changing code symbols. Implement the smallest slice:

```text
UI route -> main button -> default fixture -> coordinator API
-> runtime/backend result -> visible status/result -> E2E evidence
```

User-facing completion requires a real route, button, fixture, loading/success/failure/retry state, runtime ID, and Playwright/Chrome screenshot or trace. Backend-only completion is insufficient; absent services must be marked `DEMO DATA`, `NOT BUILT`, or `not observed`.

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

Run targeted tests first. For Kit/WebRTC or deploy work, include runtime logs and ownership evidence. Run GitNexus `detect_changes` before commit when code symbols or flows changed. Final reports state mode, agents used/skipped, files, verification, evidence, risks, and next step.

## Scope guard

Do not broaden this local map; read the global contract for generic governance.

Keep this file local and intentionally small.
