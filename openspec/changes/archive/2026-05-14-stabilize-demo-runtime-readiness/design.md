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
- Wire a single-Kit happy-path so that the worker's optimized `model.usdc` +
  `entity_index.json` can be rendered in `web-viewer-sample` through a Kit
  instance launched with `-SkipAutoLoad`, and capture viewport proof for that
  run.
- Surface a viewer conversion summary card that consumes existing
  coordinator/worker endpoints only (no new authority, no shadow cache, no
  shadow recomputation; any direct-worker fallback is dev-only).

**Non-Goals:**

- Optimizing `_worker` large IFC conversion performance or modifying the
  converter logic landed by the completed
  `optimize-worker-non-renderable-materialization` change.
- Making dedicated multi-Kit runtime pass before two GPU-backed Kit endpoints
  exist; this change stays single-Kit only.
- Changing production REST APIs, Socket.IO event schemas, DataChannel command
  contracts, storage layout, or Kit runtime behavior.
- Fixing existing `web-viewer-sample` lint debt unrelated to the additive
  summary card, or replacing the Browser plugin policy.
- Fetching, caching, recomputing, or persisting conversion quality metrics in
  any boundary outside `_worker`; the viewer card MUST read from existing
  endpoints only, and any direct-worker fallback MUST be dev-only.

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

### Decision 5: Kit loads `model.usdc` via viewer-driven `openStageRequest`

Kit is launched with `-SkipAutoLoad`; the viewer issues
`buildOpenStageRequest(url=stream_config.model.url, artifact_bindings=[…])`
through DataChannel after WebRTC + Kit ready. This keeps Kit ignorant of
worker URLs, matches `CLAUDE.md` §5.2's documented streaming flow, and reuses
the existing `Window.tsx` auto-trigger when `isKitReady && model.status ==
"ready" && lifecycle not blocked`.

Alternative considered: pass `-UsdPath` pointing at the worker's
`model.usdc` for Kit auto-load. Rejected because it leaks worker URLs into
the Kit launch command and violates the boundary that USD/USDC file body
belongs to `_worker` while runtime operation belongs to
`bim-streaming-server`.

### Decision 6: Happy-path is partially automated, partially manual

A new `scripts/run-single-kit-demo.ps1` orchestrates the steps that can be
automated headlessly: worker / `_bim-control` / coordinator preflight,
`WORKER_DEV_STORAGE_ROOT` resolution (defaulting to
`C:\Repos\active\iot\AI-BIM-governance\storage` when unset), conversion-job
lookup or trigger for the canonical 89MB fixture, review session creation,
and printing the viewer URL plus a Kit preflight summary obtained from
`start-streaming-server.ps1 -PreflightOnly`. When the storage root has no
`.ifc` fixture, the orchestration classifies the run as `blocked` with the
resolved root and an explicit setup instruction rather than fabricating
input. The user then manually runs `start-streaming-server.ps1
-SkipAutoLoad`, opens the printed viewer URL, and captures a screenshot once
the viewport renders. Manual evidence lands under
`docs/verification/2026-05-14-stabilize-demo-runtime-readiness/`.

Alternative considered: full automation through headless browser. Rejected
for now because Kit launch needs an interactive desktop session for NVIDIA
GPU initialization, and browser automation in this workspace is policy-
blocked per existing spec. Manual capture is acceptable evidence as long as
the structured fields (URL, `session_id`, Kit endpoint, video dimensions,
screenshot path) are recorded.

### Decision 7: Viewer conversion summary card is additive and read-only; fallback is dev-only

The viewer adds one summary card surface (for example inside
`DemoControlPanel` or a sibling component) bound to
`quality_metrics_summary` plumbed through `stream_config`. Exploration grep
confirmed that `bim-review-coordinator/src` does not currently forward
`quality_metrics_summary`, so this change adds an additive pass-through
field without changing existing stream_config schema semantics. The card
displays `fixture_name`, `source_ifc_entity_count`,
`sidecar_carrier_count`, `materialization_strategy`, `coverage_ratio`,
`coverage_status`, and `conversion_duration_seconds`. The viewer MUST NOT
compute, cache, or persist any quality metric.

A degraded fallback fetch (`GET /api/conversions/{job}/result` against
`_worker`) is permitted only when `import.meta.env.DEV` (or an equivalent
`VITE_` flag) is true, and only for read-only display. Production builds
MUST NOT reach the fallback; instead they render the degraded card state
sourced from smoke evidence.

Alternative considered: have the viewer call `_worker`'s
`/api/conversions/{job}/result` directly as the default path. Rejected
because it adds a viewer→worker dependency that bypasses coordinator and
risks cross-origin leakage in production. The default path is coordinator-
forwarded `quality_metrics_summary`; direct worker fetch is dev-only.

### Decision 8: Single-Kit viewport proof is required; multi-Kit invariant stays explicit

Within the boundary "single Kit instance + worker's optimized `model.usdc`",
the smoke MUST upgrade the existing "Browser visual pass requires viewport
proof" scenario from a passed-condition definition to an actually-achieved
tier (`single_kit_render`). Evidence MUST record viewer URL, `session_id`
(or `review_request_id`), Kit endpoint, video width/height, stage-load
result, and a screenshot path.

Within the same evidence record, a `dedicated_multi_kit_routing` tier MUST
appear with `status="deferred"`, and the invariant
`stream_config.kit_instance_bindings.length <= 1` MUST be encoded as a
testable assertion. A `single_kit_render=passed` record MUST NOT promote
`dedicated_multi_kit_routing` to `passed`. Closed signaling port, missing
launcher, GPU preflight failure, or absent worker `model.usdc` still
classify as `blocked` and MUST NOT be promoted to
`single_kit_render=passed`.

Alternative considered: treat single-Kit visual proof as still optional, or
omit the explicit multi-Kit invariant. Rejected because the user goal is
precisely to render the optimized USDC through the existing single-Kit
path; leaving it optional defeats the purpose of this change, and the
multi-Kit deferral is the load-bearing invariant that keeps the single-Kit
pass from leaking into dedicated-routing claims.

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
