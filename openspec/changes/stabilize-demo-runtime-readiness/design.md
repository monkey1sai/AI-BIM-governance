## Context

The 2026-05-13 runtime observation separated current facts from historical
evidence. Non-Kit service health, focused tests, coordinator lifecycle, and
Socket.IO collaboration were observable, but the demo runtime path still had
four deterministic gaps:

- the current worktree dev source root had no `.ifc` fixture;
- `scripts/smoke-review-session.ps1` used a minimal IFC payload that
  IfcOpenShell could not parse;
- `bim-streaming-server` preflight could not find the built Kit launcher;
- browser visual evidence was blocked by the in-app browser policy and no live
  Kit endpoint was listening.

This design turns those observations into a reusable smoke/readiness contract.
It does not change the ownership model: `_worker` owns file bytes and
conversion readiness, `_bim-control` owns fake BIM metadata, coordinator owns
sessions/collaboration, streaming server owns Kit/WebRTC runtime, and viewer
owns browser interaction and screenshots.

## Goals / Non-Goals

**Goals:**

- Make root smoke scripts classify prerequisites as `passed`, `failed`,
  `blocked`, `deferred`, or `not_observed` with rerunnable evidence.
- Ensure smoke conversion inputs are parseable IFC fixtures or are reported as
  missing/blocked before conversion starts.
- Separate worker conversion readiness, review request state, coordinator
  lifecycle, Socket.IO collaboration, Kit WebRTC readiness, and browser visual
  evidence in outputs.
- Produce evidence artifacts that can be attached to verification reports and
  roadmap updates without manual reconstruction.

**Non-Goals:**

- Optimizing `_worker` large IFC conversion performance or the active
  `optimize-worker-non-renderable-materialization` work.
- Making dedicated multi-Kit runtime pass before two GPU-backed Kit endpoints
  exist.
- Changing production REST APIs, Socket.IO event schemas, DataChannel command
  contracts, storage layout, or Kit runtime behavior.
- Fixing existing `web-viewer-sample` lint debt or browser plugin policy.

## Decisions

### Decision 1: Root scripts own cross-service evidence collation

Root `scripts/` is the right boundary for a multi-repo smoke because it can
coordinate `_worker`, `_bim-control`, coordinator, viewer, and streaming
preflight without making any one service own another service's responsibility.

Alternative considered: place the readiness smoke in `_worker`. Rejected
because `_worker` cannot truthfully validate coordinator lifecycle, Socket.IO,
browser readiness, or Kit WebRTC state.

### Decision 2: Fixture readiness is a preflight, not a conversion failure

Smoke scripts must resolve `WORKER_DEV_STORAGE_ROOT`, record the effective root,
count `.ifc` fixtures, and block before conversion when no parseable fixture is
available. This preserves the difference between "no input exists" and
"conversion failed on a valid input".

Alternative considered: keep generating an inline minimal IFC. Rejected because
the current payload produced a parse failure and taught the wrong lesson: the
demo path looked broken even though the smoke input was invalid.

### Decision 3: Evidence uses additive JSON diagnostics

The implementation should add or normalize evidence JSON fields such as
`tier`, `status`, `owner`, `command`, `ids`, `blocker`, `next_command`, and
`evidence_paths`. These fields are script/report contracts only and must not be
required production API fields.

Alternative considered: add service-level API fields for every readiness state.
Rejected because the immediate problem is smoke/report determinism, not a
runtime API gap.

### Decision 4: Kit/browser blockers remain explicit blockers

If the streaming launcher is missing, port 49100 is not listening, or browser
automation cannot open the route, the smoke records a blocker and skips any
WebRTC/screenshot pass claim. Manual observation can be referenced only when it
records URL, session identity, Kit endpoint, video readiness, and screenshot
path.

Alternative considered: use HTTP 200 from the viewer route as browser E2E
success. Rejected because route availability does not prove WebRTC video,
DataChannel stage load, or visual readiness.

## Risks / Trade-offs

- Fixture availability drift -> Record resolved fixture root, fixture count,
  and selected fixture identity in every run.
- Smoke output grows noisy -> Keep evidence JSON structured and keep human
  reports summarized by tier.
- Browser automation remains blocked -> Preserve a manual evidence path but
  require the same screenshot/video/session fields before marking passed.
- Kit launcher is missing until a build runs -> Keep this as `blocked` with the
  exact launcher path and build command, not as a runtime failure.
- Overlap with worker conversion optimization -> This change only validates
  smoke/readiness classification; conversion performance stays in the worker
  optimization change.
