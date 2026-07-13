> Loaded lazily by `AGENTS.md` / `CLAUDE.md`. Generic routing source-of-truth: `C:\Users\IOT\.codex\docs\agents\task-routing.md`.

# AI-BIM Advanced Reasoning Overlay

This overlay adds only local composition rules. The global task-routing contract owns tiers, effort lanes, worker schemas, stopping rules, and evidence labels.

## When this overlay applies

Use the global routing contract to select Lane F/B/G/S. Default daily work to F or B; apply the local role map below when work crosses service boundaries, touches Kit/WebRTC runtime, changes auth/deploy/permissions, or makes a user-facing done claim.

## Local composition

- Lane F: single coordinator; no worker, plan document, spec, or mandatory GitNexus impact.
- Lane B: single coordinator; at most one debugger when root cause is unknown and one read-only reviewer at completion.
- Lane G: use `explorer`, `debugger`, `reviewer`, or `security_auditor` only for the independent risk surface that triggered governance.
- Lane S: full spec-to-done P0–P7 role composition after explicit invocation only.

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

Use the smallest affected-area checks first, then the repo contract commands. Report verified facts, inferences, unverified risks, and next actions separately. For runtime/deploy work, preserve ownership evidence for ports and PIDs before any stop/restart action. Lane B runs one task/entry impact and detect_changes only for code-symbol/flow changes. Lane G/S retain shared-symbol impact and pre-commit detect_changes; Lane F relies on direct source, targeted tests, and diff unless scope expands.
