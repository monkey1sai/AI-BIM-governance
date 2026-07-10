> Loaded lazily by `AGENTS.md` / `CLAUDE.md`. Generic routing source-of-truth: `C:\Users\IOT\.codex\docs\agents\task-routing.md`.

# AI-BIM Advanced Reasoning Overlay

This overlay adds only local composition rules. The global task-routing contract owns tiers, effort lanes, worker schemas, stopping rules, and evidence labels.

## When this overlay applies

Use the global routing contract for non-trivial work. Apply the local role map below whenever work crosses service boundaries, touches Kit/WebRTC runtime, changes auth/deploy/permissions, or makes a user-facing done claim.

## Local composition

- Cross-service or source-of-truth discovery: `explorer`.
- Kit/WebRTC/runtime incident: `debugger` plus `reviewer`.
- Auth, deploy, permissions, or destructive scripts: `security_auditor` plus `reviewer`.
- PR, E2E, or user-facing done review: `reviewer`.
- Small docs lookup: single coordinator; no worker.

Workers are read-only unless the coordinator grants a bounded, non-conflicting file scope. The coordinator owns source-of-truth loading, scope, writes, evidence synthesis, and final verification.

## AI-BIM evidence contract

For user-facing capability, verify a real frontend route and explicit main button, use the default fixture, call the coordinator API, observe the runtime action/result, and capture visible loading/success/failure/retry state with the runtime ID. Record:

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

Backend-only tests do not establish frontend completion. Full-system E2E requires both governance CPU semantic evidence and Kit WebRTC visual/runtime evidence. If an external service is absent, label the UI `DEMO DATA`, `NOT BUILT`, or `not observed`.

## Verification and reporting

Use the smallest affected-area checks first, then the repo contract commands. Report verified facts, inferences, unverified risks, and next actions separately. For runtime/deploy work, preserve ownership evidence for ports and PIDs before any stop/restart action. Before commit, run the repository's GitNexus `detect_changes` gate when code symbols or flows are involved.
