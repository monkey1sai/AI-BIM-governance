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
- [ ] 6.5 Report which tiers are `passed`, `failed`, `blocked`, `deferred`, or `not_observed`, plus any remaining prerequisites.
