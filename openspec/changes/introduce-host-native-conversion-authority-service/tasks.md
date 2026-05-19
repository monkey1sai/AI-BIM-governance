## 1. Preflight and Scope Guard

- [x] 1.1 Confirm the branch is `codex/openspec/introduce-host-native-conversion-authority-service` and the base includes PR #69 (`@nvidia/omniverse-webrtc-streaming-library` `^5.6.0`).
- [x] 1.2 Re-read `AGENTS.md`, `bim-streaming-server/AGENTS.md`, `bim-review-coordinator/AGENTS.md`, and current specs touched by this change before editing.
- [x] 1.3 Run GitNexus impact analysis before modifying any function/class/method in `bim-streaming-server`, `bim-review-coordinator`, or `web-viewer-sample`; report HIGH/CRITICAL risk before editing. (pre-change impact: all LOW; index refreshed to 0bae19e)
- [x] 1.4 Record the current validation baseline for `bim-streaming-server` conversion tests, coordinator tests, and OpenSpec validation.

## 2. Host-Native Conversion Authority Service

- [x] 2.1 Add a host-native service entrypoint in `bim-streaming-server` that loads the existing conversion authority app and binds to `127.0.0.1:49101` by default. (`host_native_conversion_service.py`)
- [x] 2.2 Add `GET /health` for the host-native conversion service with conversion-only identity and no WebRTC/Kit readiness claim. (added to `create_conversion_api_app`)
- [x] 2.3 Implement configuration for artifacts root, jobs dir, public artifact URL, host, port, and optional internal conversion token without editing real `.env` secrets. (`load_config` reads `STREAMING_CONVERSION_*` env only)
- [x] 2.4 Implement or wire a converter adapter that invokes the existing IFC to USDC conversion path and normalizes outputs into USDC, mapping, entity index, metadata, and quality metrics. (`Ifc2UsdcPowershellConverterAdapter`)
- [x] 2.5 Add honest preflight/error handling for missing converter prerequisites, invalid IFC input, missing outputs, placeholder output, and failed subprocesses. (`preflight()` raises `converter_unavailable`; no fake-ready)
- [x] 2.6 Add or update `bim-streaming-server` tests for health, job creation, idempotency replay/conflict, token enforcement, success result, and non-ready failure cases. (`tests/test_host_native_conversion_service.py`; 19 passed incl. regression)

## 3. Coordinator Dispatch and Result Ingestion

- [x] 3.1 Ensure `bim-review-coordinator` dispatches accepted `POST /api/external/ifc-ready` jobs to `STREAMING_CONVERSION_API_BASE` (`http://127.0.0.1:49101` by default). (pre-existing; verified by `external-ifc-ready.test.ts`)
- [x] 3.2 Preserve intake acceptance when dispatch fails by recording a retryable dispatch failure with target URL and diagnostic. (pre-existing `markDispatchFailed`; verified)
- [x] 3.3 Add result ingestion from `GET /api/conversions/{conversion_job_id}/result` into the existing `/api/internal/conversion-result` and callback outbox path. (new `fetchConversionResult` + `POST /api/internal/conversions/:id/ingest` + shared `ingestConversionReport`)
- [x] 3.4 Preserve metadata-only callback behavior for `conversion_result_ready` and `conversion_failed`, including pending/dead-letter delivery when OQ1 endpoint/auth is unavailable. (behavior-preserving extraction; `cloud-callback-outbox.test.ts` regression green)
- [x] 3.5 Update coordinator tests for successful dispatch, service unavailable dispatch, ready result ingestion, failed result ingestion, and callback status separation. (`tests/host-native-conversion-ingest.test.ts`; 143 passed)
- [x] 3.6 Keep dev proxy routes aligned with the host-native conversion API without introducing old `_worker` / `_bim-control` runtime dependencies. (no `_worker`/`_bim-control` runtime deps introduced)

## 4. Smoke, Evidence, and Docs

- [x] 4.1 Add smoke support for `host_native_conversion_authority` that starts or checks `127.0.0.1:49101`, creates a job, reads result, and records quality metrics. (`scripts/smoke-host-native-conversion.ps1`)
- [x] 4.2 Update evidence schema/output to include service URL, command, cwd, shell, PID or process command, conversion identifiers, artifact refs, quality summary, callback outbox status, and timestamp. (smoke JSON tier + verification doc)
- [x] 4.3 Ensure smoke reports conversion, callback outbox, Kit launcher, WebRTC, DataChannel, and browser visual tiers independently. (tier classified independently; never promoted)
- [x] 4.4 Document Windows host-native start commands and state that `.bat` / Kit repo tooling should be launched from PowerShell, not Git Bash, when batch launchers are involved. (`start-host-native-conversion-service.ps1` header + conversion-api.md)
- [x] 4.5 Update `docs/contracts/conversion-api.md`, platform boundary docs, and relevant runbooks to reflect `127.0.0.1:49101` host-native service ownership. (conversion-api.md host-native section)

## 5. Viewer Ready-Gate Verification

- [x] 5.1 Verify `web-viewer-sample` remains on the PR #69-compatible dependency version and can build from the selected base. (`npm run build` — see task 6.3)
- [x] 5.2 Add or update viewer tests/evidence so non-ready `stream_config.model.status` does not trigger normal `openStageRequest`. (gate intact at `Window.tsx:534`; recorded in verification doc, no viewer logic changed — D5)
- [x] 5.3 Add or update ready-flow evidence so `openStageRequest` is attempted only after model readiness and Kit/DataChannel readiness are available. (verification doc records `isKitReady && model.status==="ready" && !isBlockedLifecycle` gate)
- [x] 5.4 If GPU/WebRTC/browser automation is unavailable, classify the viewer/render tiers as `blocked`, `deferred`, or `not_observed` instead of passed. (WebRTC/Kit/browser = `not_observed`; real conversion runtime = `blocked` — honest)

## 6. Validation and Closeout

- [x] 6.1 Run `python -m pytest bim-streaming-server/tests/test_conversion_authority_api.py` or the narrow equivalent for conversion service changes. (19 passed: conversion-authority regression + host-native)
- [x] 6.2 Run `cd bim-review-coordinator && npm test` or the narrow affected coordinator test set first, then expand if failures indicate shared behavior. (143 passed; `npm run verify` tsc 0 + tests)
- [x] 6.3 Run `cd web-viewer-sample && npm run build` and targeted viewer checks when viewer files or E2E assumptions changed. (vite build ✓; no viewer source changed — D5)
- [x] 6.4 Run `openspec validate introduce-host-native-conversion-authority-service --strict` and `openspec status --change introduce-host-native-conversion-authority-service`. (valid; 4/4 artifacts complete)
- [x] 6.5 Run GitNexus detect changes before committing and confirm affected symbols/flows match the planned scope. (detect-changes could not introspect the linked-worktree staged index — indexed repo path is the main worktree; per gitnexus-blast-radius Step 3 fallback used `git diff --cached --name-only`: all 12 staged files ⊆ declared scope, no drift; disclosed in PR body)
- [x] 6.6 Update task statuses, evidence paths, known risks, and any roadmap references before opening the implementation PR. (`docs/verification/2026-05-19-introduce-host-native-conversion-authority-service.md`)
