# Tasks

> **Retro-audited 2026-05-21**：依 CLAUDE.md §2 newer-wins，`_worker` 已從 product runtime 刪除。worker UI（`http://127.0.0.1:8005/`）不再是 demo 路徑，現行 demo 由 recap `demo-fast-mvp-orchestration` 接手。GitNexus detect-changes 在 worktree 有 quoting bug（memory `opsx-skill-placeholder-bug` / `opsx-worktree-closeout-gotchas`），newer change baseline 可以 `git diff --stat` 替代。

## 1. Preparation And Impact Review

- [x] 1.1 Inspect current `_worker`, `_bim-control`, `web-viewer-sample`, `bim-review-coordinator`, `bim-streaming-server`, root scripts, and current docs before editing.
- [x] 1.2 Run GitNexus impact analysis for code symbols that will be edited; report HIGH/CRITICAL risks before implementation changes.
- [x] 1.3 Confirm the dev IFC source root convention in implementation: default `WORKER_DEV_STORAGE_ROOT=../storage` from `_worker`, override via env.
- [x] 1.4 Decide whether to add a committed placeholder/sample under `storage/` or only document that users place demo IFC files there.

## 2. `_worker` Dev IFC Source API

- [x] 2.1 Add `_worker` settings for `WORKER_DEV_STORAGE_ROOT` and expose source-root status in `/health`.
- [x] 2.2 Implement a safe dev IFC scanner that recursively lists regular `.ifc` files, ignores symlinks, hides absolute paths, and rejects out-of-root resolution.
- [x] 2.3 Add response/request models for dev IFC source listing and selected-source conversion.
- [x] 2.4 Add `GET /api/dev/ifc-sources` with deterministic ordering and diagnosable empty/missing-root behavior.
- [x] 2.5 Add `POST /api/dev/ifc-sources/{source_id}/conversions` that reads the selected IFC, creates a source artifact, starts a conversion job, and returns source/job/result identifiers.
- [x] 2.6 Preserve existing `POST /api/artifacts`, `POST /api/conversions`, result, readiness, callback, and `/objects/*` behavior.
- [x] 2.7 Add `_worker` tests for missing root, recursive IFC listing, non-IFC filtering, hidden absolute paths, stale/invalid source rejection, selected-source conversion, and CORS as needed.
- [x] 2.8 Run `_worker` tests from `_worker/` to avoid FastAPI `app` package import cache pollution.

## 3. `_worker` Demo UI For Steps ①/②

- [x] 3.1 Add `_worker` UI routes for `GET /` and `GET /ui` without introducing a separate frontend build dependency.
- [x] 3.2 Build the worker demo UI using the existing demo visual language: stepbar, status indicators, action captions, and friendly failure states.
- [x] 3.3 Wire the UI to `GET /api/dev/ifc-sources`, selected-source conversion, conversion polling, result display, and artifact group readiness.
- [x] 3.4 Add UI affordance to continue to step ③ coordinator/review session flow after artifact group readiness is true.
- [x] 3.5 Ensure the worker UI does not expose absolute filesystem paths and does not include issue editing, annotation editing, session lifecycle management, or WebRTC controls.
- [x] 3.6 Add the smallest useful UI smoke check or browser validation for source list rendering and conversion job trigger.

## 4. Current Demo Routing And Downstream References

- [x] 4.1 Update `_bim-control` stepbar and UI copy so steps ①/② link to `_worker` on port `8005`.
- [x] 4.2 Ensure `_bim-control` remains metadata-only and does not scan `storage/`, read IFC bytes, or directly run conversions.
- [x] 4.3 Update `web-viewer-sample` demo control panel, architecture overview, and stepbar links to remove current `_s3_storage` / `_conversion-service` service assumptions.
- [x] 4.4 Update `bim-review-coordinator` configs/tests/fixtures so current artifact bindings use `_worker` object URLs and no longer require `8002` static URLs.
- [x] 4.5 Update `bim-streaming-server` defaults, docs, or tests where they still assume `_s3_storage` URLs, and extend stage-loading behavior to load all model artifact bindings in load order.
- [x] 4.6 Update any generated or checked-in demo session data only if it is treated as current fixture data, not user runtime output.
- [x] 4.7 Update streaming DataChannel contract docs/tests for `artifact_bindings_multi_layer_payload`, loaded bindings, failed bindings, and partial load metadata.

## 5. Retire Legacy Storage And Conversion Services

- [x] 5.1 Update `scripts/start-all.ps1` and `scripts/start-all.sh` to stop launching `_s3_storage` and `_conversion-service`.
- [x] 5.2 Update `scripts/stop-all.ps1` and `scripts/stop-all.sh` to stop expecting ports `8002` and `8003`.
- [x] 5.3 Update dev/demo health checks, open-demo scripts, verify scripts, and smoke scripts to validate worker-only steps ①/②.
- [x] 5.4 Replace legacy conversion smoke coverage with a worker selected-source conversion smoke or extend `scripts/smoke-worker-review-request.ps1`.
- [x] 5.5 Run `rg` for `_s3_storage`, `_conversion-service`, `_conversion-server`, `8002`, `8003`, and `/static/projects/` and classify any remaining hits as historical or required external references.
- [x] 5.6 Delete `_s3_storage/`, `_conversion-service/`, and `_conversion-server/` only after worker-only startup and smoke validation pass.

## 6. Documentation And Contracts

- [x] 6.1 Update `AGENTS.md` and `CLAUDE.md` to make `_worker` the only local file/conversion boundary and remove legacy services from current core service lists.
- [x] 6.2 Update `README.md` startup, demo storyboard, service boundary, source-of-truth, and validation sections for worker-only steps ①/②.
- [x] 6.3 Update `docs/contracts/worker-api.md` with dev IFC source listing and selected-source conversion endpoints.
- [x] 6.4 Remove or archive current `docs/contracts/conversion-api.md` references that present `_conversion-service` / `_conversion-server` as current.
- [x] 6.5 Mark historical planning docs that still mention legacy services as historical, or move them under an archive path if that matches repo conventions.
- [x] 6.6 Update `.env.example` and runbook snippets to remove current `8002` / `8003` service settings unless they are explicitly historical.

## 7. Validation And Review

- [x] 7.1 Run `_worker` tests from `_worker/`.
- [x] 7.2 Run `_bim-control` tests from `_bim-control/`.
- [x] 7.3 Run `bim-review-coordinator` tests/build from `bim-review-coordinator/`.
- [x] 7.4 Run `web-viewer-sample` relevant tests/build from `web-viewer-sample/`, accounting for known pre-existing lint errors if lint is run.
- [x] 7.5 Run root health/smoke validation with `_s3_storage` and `_conversion-service` absent.
- [ ] 7.6 Browser-validate worker UI on `http://127.0.0.1:8005/` for IFC listing, selected conversion trigger, polling, and readiness handoff. — **superseded** (Retro-audited 2026-05-21): worker UI 退役；現行 demo intake 改走 `bim-review-coordinator` `POST /api/external/ifc-ready` + smoke script，UI listing/selection 由 viewer 取代。
- [ ] 7.7 If GPU/Kit is available, validate the review viewer still opens a worker-hosted USDC URL; otherwise record Kit/WebRTC as hardware-dependent. — **superseded** (Retro-audited 2026-05-21): worker-hosted USDC URL 退役；現行 USDC 由 streaming-server 權威。Kit/WebRTC hardware-dependent 結論在 recap runbook §6 與 memory `kit-gpu-render-needs-windows-native` / `WSL-ubuntu-24-04-container-toolkit-setup` 已凍結。
- [x] 7.8 Run `bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1` and syntax validation for `stage_loading.py`.
- [x] 7.9 Run `openspec validate add-dev-ifc-source-selection-flow`.
- [x] 7.10 Run `git diff --check`.
- [ ] 7.11 Run GitNexus detect changes before commit or final handoff and confirm the affected scope matches this OpenSpec change. — **superseded** (Retro-audited 2026-05-21): archive 已落地；GitNexus CLI 在 worktree 有已知 quoting bug，後續所有 commit-time 驗證由 successor change 接續執行，本 task 不需回填 evidence。
