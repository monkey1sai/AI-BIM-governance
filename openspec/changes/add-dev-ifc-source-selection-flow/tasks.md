## 1. Preparation And Impact Review

- [ ] 1.1 Inspect current `_worker`, `_bim-control`, `web-viewer-sample`, `bim-review-coordinator`, `bim-streaming-server`, root scripts, and current docs before editing.
- [ ] 1.2 Run GitNexus impact analysis for code symbols that will be edited; report HIGH/CRITICAL risks before implementation changes.
- [ ] 1.3 Confirm the dev IFC source root convention in implementation: default `WORKER_DEV_STORAGE_ROOT=../storage` from `_worker`, override via env.
- [ ] 1.4 Decide whether to add a committed placeholder/sample under `storage/` or only document that users place demo IFC files there.

## 2. `_worker` Dev IFC Source API

- [ ] 2.1 Add `_worker` settings for `WORKER_DEV_STORAGE_ROOT` and expose source-root status in `/health`.
- [ ] 2.2 Implement a safe dev IFC scanner that recursively lists regular `.ifc` files, ignores symlinks, hides absolute paths, and rejects out-of-root resolution.
- [ ] 2.3 Add response/request models for dev IFC source listing and selected-source conversion.
- [ ] 2.4 Add `GET /api/dev/ifc-sources` with deterministic ordering and diagnosable empty/missing-root behavior.
- [ ] 2.5 Add `POST /api/dev/ifc-sources/{source_id}/conversions` that reads the selected IFC, creates a source artifact, starts a conversion job, and returns source/job/result identifiers.
- [ ] 2.6 Preserve existing `POST /api/artifacts`, `POST /api/conversions`, result, readiness, callback, and `/objects/*` behavior.
- [ ] 2.7 Add `_worker` tests for missing root, recursive IFC listing, non-IFC filtering, hidden absolute paths, stale/invalid source rejection, selected-source conversion, and CORS as needed.
- [ ] 2.8 Run `_worker` tests from `_worker/` to avoid FastAPI `app` package import cache pollution.

## 3. `_worker` Demo UI For Steps ①/②

- [ ] 3.1 Add `_worker` UI routes for `GET /` and `GET /ui` without introducing a separate frontend build dependency.
- [ ] 3.2 Build the worker demo UI using the existing demo visual language: stepbar, status indicators, action captions, and friendly failure states.
- [ ] 3.3 Wire the UI to `GET /api/dev/ifc-sources`, selected-source conversion, conversion polling, result display, and artifact group readiness.
- [ ] 3.4 Add UI affordance to continue to step ③ coordinator/review session flow after artifact group readiness is true.
- [ ] 3.5 Ensure the worker UI does not expose absolute filesystem paths and does not include issue editing, annotation editing, session lifecycle management, or WebRTC controls.
- [ ] 3.6 Add the smallest useful UI smoke check or browser validation for source list rendering and conversion job trigger.

## 4. Current Demo Routing And Downstream References

- [ ] 4.1 Update `_bim-control` stepbar and UI copy so steps ①/② link to `_worker` on port `8005`.
- [ ] 4.2 Ensure `_bim-control` remains metadata-only and does not scan `storage/`, read IFC bytes, or directly run conversions.
- [ ] 4.3 Update `web-viewer-sample` demo control panel, architecture overview, and stepbar links to remove current `_s3_storage` / `_conversion-service` service assumptions.
- [ ] 4.4 Update `bim-review-coordinator` configs/tests/fixtures so current artifact bindings use `_worker` object URLs and no longer require `8002` static URLs.
- [ ] 4.5 Update `bim-streaming-server` defaults, docs, or tests only where they still assume `_s3_storage` URLs; keep runtime stage-loading behavior unchanged.
- [ ] 4.6 Update any generated or checked-in demo session data only if it is treated as current fixture data, not user runtime output.

## 5. Retire Legacy Storage And Conversion Services

- [ ] 5.1 Update `scripts/start-all.ps1` and `scripts/start-all.sh` to stop launching `_s3_storage` and `_conversion-service`.
- [ ] 5.2 Update `scripts/stop-all.ps1` and `scripts/stop-all.sh` to stop expecting ports `8002` and `8003`.
- [ ] 5.3 Update dev/demo health checks, open-demo scripts, verify scripts, and smoke scripts to validate worker-only steps ①/②.
- [ ] 5.4 Replace legacy conversion smoke coverage with a worker selected-source conversion smoke or extend `scripts/smoke-worker-review-request.ps1`.
- [ ] 5.5 Run `rg` for `_s3_storage`, `_conversion-service`, `_conversion-server`, `8002`, `8003`, and `/static/projects/` and classify any remaining hits as historical or required external references.
- [ ] 5.6 Delete `_s3_storage/`, `_conversion-service/`, and `_conversion-server/` only after worker-only startup and smoke validation pass.

## 6. Documentation And Contracts

- [ ] 6.1 Update `AGENTS.md` and `CLAUDE.md` to make `_worker` the only local file/conversion boundary and remove legacy services from current core service lists.
- [ ] 6.2 Update `README.md` startup, demo storyboard, service boundary, source-of-truth, and validation sections for worker-only steps ①/②.
- [ ] 6.3 Update `docs/contracts/worker-api.md` with dev IFC source listing and selected-source conversion endpoints.
- [ ] 6.4 Remove or archive current `docs/contracts/conversion-api.md` references that present `_conversion-service` / `_conversion-server` as current.
- [ ] 6.5 Mark historical planning docs that still mention legacy services as historical, or move them under an archive path if that matches repo conventions.
- [ ] 6.6 Update `.env.example` and runbook snippets to remove current `8002` / `8003` service settings unless they are explicitly historical.

## 7. Validation And Review

- [ ] 7.1 Run `_worker` tests from `_worker/`.
- [ ] 7.2 Run `_bim-control` tests from `_bim-control/`.
- [ ] 7.3 Run `bim-review-coordinator` tests/build from `bim-review-coordinator/`.
- [ ] 7.4 Run `web-viewer-sample` relevant tests/build from `web-viewer-sample/`, accounting for known pre-existing lint errors if lint is run.
- [ ] 7.5 Run root health/smoke validation with `_s3_storage` and `_conversion-service` absent.
- [ ] 7.6 Browser-validate worker UI on `http://127.0.0.1:8005/` for IFC listing, selected conversion trigger, polling, and readiness handoff.
- [ ] 7.7 If GPU/Kit is available, validate the review viewer still opens a worker-hosted USDC URL; otherwise record Kit/WebRTC as hardware-dependent.
- [ ] 7.8 Run `openspec validate add-dev-ifc-source-selection-flow`.
- [ ] 7.9 Run `git diff --check`.
- [ ] 7.10 Run GitNexus detect changes before commit or final handoff and confirm the affected scope matches this OpenSpec change.
