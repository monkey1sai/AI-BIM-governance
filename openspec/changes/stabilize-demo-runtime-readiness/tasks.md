## 1. Scope And Baseline

- [ ] 1.1 Re-read `proposal.md`, `design.md`, and `specs/demo-runtime-readiness-smoke/spec.md`.
- [ ] 1.2 Inspect root smoke scripts, at minimum `scripts/smoke-review-session.ps1`, `scripts/smoke-worker-review-request.ps1`, `scripts/smoke-review-socket.ps1`, `scripts/dev-health-check.ps1`, and any shared script helpers.
- [ ] 1.3 Inspect `_worker` dev source root resolution and selected-source conversion contracts without changing `_worker` API ownership.
- [ ] 1.4 Inspect `bim-streaming-server/scripts/start-streaming-server.ps1` and current launcher path checks used for Kit preflight.
- [ ] 1.5 Record baseline behavior for missing fixtures, invalid smoke IFC input, missing Kit launcher, and browser automation blocker before editing.

## 2. Fixture And Worker Readiness Classification

- [ ] 2.1 Add or update smoke preflight logic to resolve `WORKER_DEV_STORAGE_ROOT`, count `.ifc` / `.IFC` fixtures, and emit `blocked` with root and next action when no fixture exists.
- [ ] 2.2 Replace the invalid inline IFC success path in `scripts/smoke-review-session.ps1` with either a parseable fixture selection path or an explicit blocked classification before conversion starts.
- [ ] 2.3 Ensure worker conversion evidence records `source_artifact_id`, `artifact_group_id`, `conversion_job_id`, derived model URL or artifact ID, mapping URL or artifact ID, and readiness status only when that tier actually runs.
- [ ] 2.4 Preserve `_worker` as the file/conversion facade and avoid adding project, issue, annotation, session, or browser responsibilities to `_worker`.

## 3. Tiered Review Session And Collaboration Evidence

- [ ] 3.1 Update smoke output so worker conversion, `_bim-control` review request state, coordinator session lifecycle, and Socket.IO collaboration are distinct evidence tiers.
- [ ] 3.2 Ensure coordinator lifecycle can pass independently when `model.status=missing`, while worker artifact readiness and Kit/browser tiers remain non-passed.
- [ ] 3.3 Ensure Socket.IO collaboration success does not imply WebRTC video, DataChannel stage load, or browser visual success.
- [ ] 3.4 Add or update focused tests / script-level assertions for tier separation and blocker classification.

## 4. Kit And Browser Readiness Evidence

- [ ] 4.1 Update Kit preflight evidence to classify missing streaming launcher path as `blocked` and include the exact path plus rerunnable build/preflight command.
- [ ] 4.2 Update WebRTC readiness evidence to classify closed signaling ports such as `127.0.0.1:49100` as `blocked` without claiming browser visual success.
- [ ] 4.3 Add browser visual evidence fields for URL, `session_id` or `review_request_id`, Kit endpoint, video readiness, non-zero dimensions, DataChannel stage-load result when available, and screenshot path.
- [ ] 4.4 When browser automation is unavailable, emit `blocked` or `not_observed` with the blocked URL, tool/policy diagnostic, and manual evidence fields needed for rerun.

## 5. Evidence Artifacts And Documentation

- [ ] 5.1 Emit a structured command summary JSON for smoke runs, including command, cwd, status, owner, important IDs, blocker, next command, and evidence paths per tier.
- [ ] 5.2 Update or create a verification report for this change, keeping current live observations separate from historical evidence.
- [ ] 5.3 Update `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` only if the implementation changes current runtime readiness status or follow-up planning.
- [ ] 5.4 If the roadmap Markdown is updated, regenerate the same-name HTML view from the Markdown.

## 6. Validation And Closeout

- [ ] 6.1 Run `openspec validate stabilize-demo-runtime-readiness --strict`.
- [ ] 6.2 Run the smallest useful focused script or tests for changed smoke/readiness behavior.
- [ ] 6.3 Run `git diff --check`.
- [ ] 6.4 Run GitNexus `detect_changes` before committing the implementation change.
- [ ] 6.5 Report which tiers are `passed`, `failed`, `blocked`, `deferred`, or `not_observed` (including the new `single_kit_render` tier from §9), plus any remaining prerequisites.

## 7. Single-Kit Demo Runtime Happy-Path Orchestration

- [ ] 7.1 Add `scripts/run-single-kit-demo.ps1` that performs worker / `_bim-control` / coordinator preflight, resolves `WORKER_DEV_STORAGE_ROOT` (defaulting to `C:\Repos\active\iot\AI-BIM-governance\storage` when unset), looks up or triggers the canonical 89MB fixture conversion, polls until `conversion_job` succeeds, creates a review session, and prints the resulting viewer URL plus a Kit preflight summary obtained by invoking `bim-streaming-server/scripts/start-streaming-server.ps1 -PreflightOnly`. If no `.ifc` fixture is present, classify the run as `blocked` with the resolved storage root and an explicit setup instruction (consistent with §2.1).
- [ ] 7.2 Ensure `bim-review-coordinator` `stream_config.model.url` correctly points at the worker-derived `model.usdc` URL for the active conversion job, and that `stream_config.artifact_bindings` (or equivalent) carries the matching `entity_index.json` URL when the sidecar carrier is in use; this MUST stay additive against the existing stream_config schema.
- [ ] 7.3 Document the manual portion of the happy-path — user-run `start-streaming-server.ps1 -SkipAutoLoad`, viewer URL opened in browser, screenshot captured once the viewport renders — in a runbook at `docs/verification/2026-05-14-stabilize-demo-runtime-readiness/runbook.md` and link it from the change-level verification report (`docs/verification/2026-05-14-stabilize-demo-runtime-readiness.md`). Screenshots and structured evidence JSON land in the same directory.
- [ ] 7.4 Add a focused script-level assertion or unit test confirming that the orchestration helper writes its evidence JSON with the expected fields when the canonical fixture is already converted (no re-trigger required).

## 8. Web Viewer Conversion Summary Card

- [ ] 8.1 Confirm by grep that `bim-review-coordinator` does not currently forward `quality_metrics_summary` inside `stream_config` (verified during exploration: no matches in `bim-review-coordinator/src`); add an additive pass-through field so the viewer can read the summary without calling `_worker` directly. The schema change MUST be additive; no renames or breaking changes.
- [ ] 8.2 Add a conversion summary card surface inside `web-viewer-sample` (for example inside `DemoControlPanel` or a sibling component) that renders `fixture_name`, `source_ifc_entity_count`, `sidecar_carrier_count`, `materialization_strategy`, `coverage_ratio`, `coverage_status`, and `conversion_duration_seconds` from `stream_config.quality_metrics_summary`.
- [ ] 8.3 Implement a dev-only fallback fetch path gated by `import.meta.env.DEV` (or an equivalent `VITE_` flag): when `stream_config` does not carry `quality_metrics_summary`, the card MAY fetch `GET /api/conversions/{conversion_job_id}/result` from `_worker` for read-only display. The fallback MUST be unreachable in production builds; the viewer MUST NOT cache or rebroadcast these values.
- [ ] 8.4 Implement the degraded card state when `stream_config.model.status` is not `"ready"`: surface the current `model.status`, the smoke blocker classification (when available), and the next rerunnable command instead of fabricated metrics.
- [ ] 8.5 Add focused tests for the card: ready-state render, degraded-state render, dev-only fallback-fetch path, and the assertion that no quality value is recomputed inside the viewer.

## 9. Single-Kit Viewport Proof Capture

- [ ] 9.1 Extend the smoke evidence JSON to record a `single_kit_render` tier with fields `viewer_url`, `session_id` (or `review_request_id`), `kit_endpoint`, `video.width`, `video.height`, `stage_load_result`, `screenshot_path`, and `manual_or_automated`.
- [ ] 9.2 Define the acceptable manual evidence path: a screenshot file under `docs/verification/2026-05-14-stabilize-demo-runtime-readiness/` (matching §7.3) plus the structured `single_kit_render` JSON record alongside it. Manual capture is acceptable as long as all structured fields are filled.
- [ ] 9.3 Ensure that closed signaling port, missing Kit launcher, GPU preflight failure, or absent worker `model.usdc` keep `single_kit_render` classified as `blocked` with the missing prerequisite and resolved next command, and MUST NOT be promoted to `passed`.
- [ ] 9.4 Add an assertion or focused test encoding the multi-Kit invariant: `stream_config.kit_instance_bindings.length <= 1` AND a `dedicated_multi_kit_routing` tier with `status="deferred"` MUST appear in the same evidence record. A `single_kit_render=passed` record MUST NOT be writable without all required fields, and MUST NOT promote `dedicated_multi_kit_routing` to `passed`.
