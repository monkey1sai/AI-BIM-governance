## Context

The workspace already has several archived verification passes, including review-session lifecycle, Socket.IO collaboration, worker real conversion evidence, same-Kit browser runtime evidence, and canonical storage batch blocker evidence. The current live demo state can still drift because Python packages, Node dependencies, Kit/GPU availability, worker storage roots, and active services are machine-local runtime facts.

This change creates a demo-focused observation pass. It is cross-cutting because the report must describe the minimum review loop across `_bim-control`, `_worker`, `bim-review-coordinator`, `bim-streaming-server`, and `web-viewer-sample`, but it does not move ownership between those services.

## Goals / Non-Goals

**Goals:**

- Produce a current, repo-local observation report for the demo runtime.
- Re-run or explicitly classify every current demo tier: service health, API smoke, focused tests/builds, worker conversion/artifact readiness, review session lifecycle, Socket.IO collaboration, browser E2E, Kit/WebRTC runtime, and dedicated multi-Kit capacity.
- Record replayable evidence: commands, timestamps, ports, service URLs, `review_request_id`, `session_id`, `conversion_job_id`, `artifact_group_id`, screenshots or machine-readable summaries when available.
- Keep `passed`, `failed`, `blocked`, `deferred`, and `not_observed` separate so readers can understand the actual current state.
- Update roadmap status only from current evidence or explicitly labeled historical references.

**Non-Goals:**

- No product feature implementation in this proposal.
- No API, event schema, storage layout, session lifecycle, Kit runtime, or browser UI contract changes unless a later apply phase identifies and scopes a separate fix.
- No revival of retired `_s3_storage`, `_conversion-service`, or `_conversion-server` as current demo dependencies.
- No dedicated multi-Kit runtime claim until two or more live GPU-backed Kit endpoints are available.
- No production observability, SLA, SSO, tenant billing, or deployment platform work.

## Decisions

1. **Observation before fixing.**
   - Rationale: the request is to validate and observe the current demo, not to expand the product surface.
   - Approach: the first implementation pass records current behavior and blockers. Any discovered defect that needs code changes remains a separate, explicitly scoped task or follow-up change.
   - Alternative rejected: opportunistically fixing every failed check in the same pass. That would mix observation evidence with feature work and make the report hard to audit.

2. **Use a stable status matrix.**
   - Rationale: previous evidence can be misread when API-only success, conversion success, browser readiness, and GPU render evidence are collapsed into one "E2E" label.
   - Approach: every tier gets exactly one current status: `passed`, `failed`, `blocked`, `deferred`, or `not_observed`. Historical evidence can be cited, but current status must say whether it was rerun.
   - Alternative rejected: a single checklist of pass/fail items. That hides hardware and capacity blockers.

3. **Keep ownership-specific checks.**
   - Rationale: each service has a clear source-of-truth boundary.
   - Approach: `_bim-control` checks metadata/review intent, `_worker` checks file/conversion/artifact readiness, coordinator checks session/collaboration, viewer checks browser interaction, and streaming server checks Kit/WebRTC runtime.
   - Alternative rejected: a single root smoke that claims the whole demo is healthy without explaining which service produced the evidence.

4. **Archive replayable evidence under docs.**
   - Rationale: demo observations are only useful if a future run can compare commands, IDs, screenshots, and blockers.
   - Approach: store the human report under `docs/verification/` and place screenshots or JSON summaries under a matching `docs/verification/evidence/<date>-demo-current-runtime-observation/` folder when generated.
   - Alternative rejected: keeping evidence only in terminal output or browser state.

5. **Treat GPU and Kit as environment-limited tiers.**
   - Rationale: Kit runtime and dedicated multi-Kit evidence depend on local GPU, Kit build, ports, and stream topology.
   - Approach: if the environment cannot run a tier, record the missing prerequisite and next runnable step. Do not convert a blocker into a pass.
   - Alternative rejected: marking GPU tiers failed when the required runtime was not available, or passed when only health ports were reachable.

## Risks / Trade-offs

- **Risk: Current environment is partially configured.** -> Mitigation: record dependency and service startup blockers precisely, including cwd, port, command, and missing prerequisite.
- **Risk: Historical evidence masks drift.** -> Mitigation: label older evidence as historical reference and require current rerun or explicit `not_observed` status.
- **Risk: Broad "all features" scope becomes unfocused.** -> Mitigation: constrain the pass to the current demo loop and the OpenSpec specs already present in `openspec/specs/`.
- **Risk: Observation finds a code defect.** -> Mitigation: capture the defect with evidence and keep fixes in a follow-up implementation task or separate OpenSpec change unless the fix is trivial and explicitly approved.
- **Risk: Long-running conversion or browser checks exceed local time budget.** -> Mitigation: record timeout, elapsed duration, last known phase, and whether the result is `blocked`, `failed`, or `not_observed`.
