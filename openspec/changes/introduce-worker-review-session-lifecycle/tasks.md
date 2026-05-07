## 1. Contract And Boundary Preparation

- [x] 1.1 Inspect current `_s3_storage`, `_conversion-service`, `_conversion-server`, `_bim-control`, `bim-review-coordinator`, `bim-streaming-server`, and `web-viewer-sample` implementation paths before editing.
- [x] 1.2 Decide whether `_worker` lands as a new facade folder or as a documented adapter over existing `_s3_storage` + `_conversion-service`; record the chosen rollout path in docs.
- [x] 1.3 Update API contract docs to declare `_worker` as the external file + conversion boundary while marking old storage/conversion endpoints as compatibility paths.
- [x] 1.4 Define shared JSON examples for artifact metadata, artifact group metadata, review session request, artifact binding, Kit instance binding, and lifecycle event.

## 2. `_worker` Artifact Pipeline

- [x] 2.1 Add `_worker` service entrypoint or adapter route for `POST /api/artifacts` that stores source IFC/RVT/DWG bytes or signed upload references.
- [x] 2.2 Implement versioned object layout for source artifacts, derived artifacts, indexes, mapping files, and `metadata.json`.
- [x] 2.3 Add `POST /api/conversions` to create queued conversion jobs from `source_artifact_id`.
- [x] 2.4 Reuse or move existing `_conversion-service` converter runner behind `_worker` without breaking current demo conversion behavior.
- [x] 2.5 Add `GET /api/conversions/{id}` and `GET /api/conversions/{id}/result` with derived artifact IDs, object URLs, mapping URL, status, and lineage.
- [x] 2.6 Add `_worker` callback or publish step that updates `_bim-control` with artifact metadata and conversion result metadata only.
- [x] 2.7 Add `_worker` tests for upload validation, conversion job state transitions, derived result payload, object layout, and `_bim-control` callback failure handling.
- [x] 2.8 Run `_worker` or adapted service tests from the owning service directory.

## 3. `_bim-control` Review Intent And Metadata

- [x] 3.1 Add `ReviewSessionRequest` data model with `review_request_id`, requester, tenant, model version, artifact group selection, startup policy, Kit profile, status, and binding fields.
- [x] 3.2 Add artifact group metadata persistence with source, derived, mapping, parent artifact, source system, checksum, version, and conversion lineage fields.
- [x] 3.3 Implement `POST /api/review-session-requests` to save review intent with `status=created`.
- [x] 3.4 Implement `GET /api/review-session-requests/{id}` for request lookup by the viewer and coordinator flow.
- [x] 3.5 Implement request status / binding patch behavior for `blocked_conversion`, `queued_for_instance`, `active`, and `failed`.
- [x] 3.6 Add readiness check integration with `_worker` artifact group status before coordinator session creation.
- [x] 3.7 Add `_bim-control` tests for intent creation, missing field validation, artifact readiness blocking, session binding patch, and lifecycle event persistence.
- [x] 3.8 Run `python -m pytest tests` from `_bim-control`.

## 4. Coordinator Lifecycle And KitInstancePool

- [x] 4.1 Extend review session state to support `created`, `active`, `closing`, `closed`, and `failed`.
- [x] 4.2 Add `artifact_bindings[]` to coordinator session records with artifact role, URLs, mapping URL, load order, routing policy, and readiness.
- [x] 4.3 Add `kit_instance_bindings[]` with Kit instance ID, provider, tenant, assigned artifacts, status, stream config, heartbeat, release timestamp, and GPU capacity profile.
- [x] 4.4 Implement KitInstancePool allocation for `same_instance` and `dedicated_instance` policies.
- [x] 4.5 Update `POST /api/review-sessions` to accept review request context and artifact bindings instead of assuming one fixed local model.
- [x] 4.6 Add close flow endpoint or handler that moves sessions through `closing` and `closed` while saving final events.
- [x] 4.7 Add Kit release flow that marks instance bindings `draining` then `released` after session close.
- [x] 4.8 Add coordinator tests for lifecycle transitions, routing decisions, stream config shape, no-capacity behavior, close/release sequencing, and Socket.IO session validation.
- [x] 4.9 Run `npm test` and `npm run build` from `bim-review-coordinator`.

## 5. Streaming Runtime Contract

- [x] 5.1 Inspect existing DataChannel handlers for `openStageRequest`, `highlightPrimsRequest`, and `focusPrimRequest` before modifying runtime symbols.
- [x] 5.2 Add support for coordinator-provided artifact load order through `openStageRequest` extension or optional `loadArtifactGroupRequest`.
- [x] 5.3 Ensure runtime responses include honest `applied_mode`, `missing_paths`, and fallback details for multi-artifact or overlay operations.
- [x] 5.4 Keep persistent review metadata out of `bim-streaming-server`; only process current runtime state.
- [x] 5.5 Add or update runtime-level tests or scriptable smoke checks for missing prim paths and load-order payload validation.
- [x] 5.6 Document GPU / Kit manual validation steps for multi-artifact stream loading when local hardware is available.

## 6. Session-First Web Viewer

- [x] 6.1 Update review page bootstrap to accept `review_request_id` or `session_id` and fetch request/session state before connecting WebRTC.
- [x] 6.2 Replace hard-coded BIM model URL assumptions with coordinator stream config and artifact binding data.
- [x] 6.3 Add UI state handling for `blocked_conversion`, `queued_for_instance`, `created`, `active`, `closing`, `closed`, and `failed`.
- [x] 6.4 Add artifact panel behavior for base, derived, overlay, mapping readiness, and per-binding stream availability.
- [x] 6.5 Route runtime commands through DataChannel to the assigned Kit binding and collaboration events through coordinator Socket.IO / REST.
- [x] 6.6 Prevent new mutating runtime actions when the session is `closing`, `closed`, or `failed`.
- [x] 6.7 Add viewer tests for session bootstrap, blocked states, artifact panel data, lifecycle rendering, and command routing.
- [x] 6.8 Run `npm run build`; run `npm run lint` only after accounting for known pre-existing lint errors.

## 7. Documentation And End-To-End Validation

- [x] 7.1 Update `AGENTS.md` and `CLAUDE.md` only if the repo boundary source of truth must mention `_worker`; keep generated skill/tooling artifacts ignored.
- [x] 7.2 Update `README.md` and contract docs with the new staged startup and API flow.
- [x] 7.3 Add an API-only validation script or runbook for `_worker -> _bim-control -> coordinator` without requiring Kit GPU.
- [x] 7.4 Validate Python services from their own directories to avoid `app` package import cache pollution.
- [x] 7.5 Validate coordinator and viewer builds separately from their own repo folders.
- [x] 7.6 Validate browser review bootstrap against local services; mark WebRTC / Kit multi-artifact validation as hardware-dependent if GPU is unavailable.
  - 2026-05-07: `scripts/smoke-worker-review-request.ps1` produced `review_request_1778143731588` / `review_session_d815faa06728`; CDP browser validation confirmed `_bim-control` review request, coordinator stream-config, coordinator review-bootstrap, and `_worker` mapping object requests returned HTTP 200 with no network failures.
  - 2026-05-07: WebRTC / Kit remains hardware/browser-session dependent: one clean CDP load reached video `readyState=4`, `1920x1080`, `srcObject=true`, but later interaction validation could still fall back to `readyState=0`; treat multi-artifact DataChannel validation as manual evidence, not stable CI automation.
- [x] 7.7 Before committing implementation changes, run GitNexus change detection or equivalent scope review to confirm only expected symbols and flows changed.
