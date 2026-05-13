## Why

`demo-current-runtime-observation` confirmed that the current demo runtime pass
is mostly an evidence and readiness problem, not a proven runtime behavior
change. The workspace needs a deterministic smoke/readiness contract so missing
IFC fixtures, invalid smoke inputs, missing Kit launchers, and blocked browser
automation are reported as actionable prerequisites instead of ambiguous demo
failures.

## What Changes

- Introduce a demo runtime readiness smoke capability that standardizes
  prerequisite checks and evidence output across root scripts, `_worker`,
  `bim-review-coordinator`, `bim-streaming-server`, and `web-viewer-sample`.
- Require smoke scripts to use parseable IFC inputs or explicitly classify the
  run as `blocked` with the resolved fixture root, missing prerequisite, and
  next rerunnable command.
- Require review-session smoke evidence to separate worker conversion
  readiness from coordinator lifecycle success, Socket.IO collaboration, Kit
  WebRTC readiness, and browser visual evidence.
- Require Kit and browser blockers to be captured as evidence artifacts without
  claiming WebRTC, screenshot, or render success.
- No breaking API change is intended. This change may add script output fields,
  evidence JSON fields, or diagnostics, but it must preserve existing service
  API contracts.

## Capabilities

### New Capabilities

- `demo-runtime-readiness-smoke`: defines deterministic local demo runtime
  smoke prerequisites, blocked/pass/fail/deferred classification, and evidence
  artifacts for the review-session demo path.

### Modified Capabilities

- None.

## Impact

- Owner: root `scripts/` for cross-service smoke orchestration and evidence
  collation.
- Participating boundaries:
  - `_worker` remains the artifact and conversion facade; it does not become
    project/review metadata authority.
  - `bim-review-coordinator` remains the session/collaboration control plane;
    it does not render USD or own file bytes.
  - `bim-streaming-server` remains the Kit/WebRTC runtime; it does not own
    review-session lifecycle or artifact metadata.
  - `web-viewer-sample` remains the browser UI and visual evidence surface; it
    does not start Kit or perform conversion.
- Likely implementation areas: root smoke scripts, verification evidence JSON,
  runbook/docs updates, and focused tests for smoke classification.
- API/data/event/storage/runtime boundaries: no required production API,
  storage layout, event schema, or runtime contract changes. Any added fields
  must be additive diagnostics for scripts or evidence artifacts.
- Non-goals: optimizing large IFC conversion performance, unlocking
  `minimum_coverage_locked`, implementing OVAS/multi-GPU orchestration, fixing
  existing viewer lint debt, or replacing Browser plugin policy.
