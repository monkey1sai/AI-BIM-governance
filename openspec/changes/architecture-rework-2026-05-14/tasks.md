# Tasks: architecture-rework-2026-05-14

## 0. Branch / baseline

- [x] Create branch `codex/openspec/architecture-rework-2026-05-14` from latest `main`.
- [x] Confirm no nested `.git` directories are introduced.
- [x] Record current `AGENTS.md`, `README.md`, workflow, roadmap, and `openspec/specs/` source-of-truth baseline.
- [x] Run `openspec validate architecture-rework-2026-05-14 --strict` before any implementation.

## 1. Source-of-truth alignment

- [x] Update `AGENTS.md` draft to mark `_worker` as RVT→IFC bridge and `bim-streaming-server` as IFC→USDC conversion authority under B 方案.
- [x] Update `README.md` service boundary table draft.
- [x] Update `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` to reflect new B-scheme flow.
- [x] Update `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` and regenerated HTML view after spec approval.
- [x] Confirm `documentation-source-of-truth` still distinguishes workflow vs roadmap authority.

## 2. `_bim-control` fake Revit intake facade

- [x] Define fake RVT upload / signed reference endpoint.
- [x] Define `rvt_uploaded` event payload.
- [x] Define source artifact metadata fields for `.rvt`.
- [x] Define idempotency key and correlation id behavior.
- [x] Add tests for duplicate `rvt_uploaded` event handling.
- [x] Add blocked state when RVT bytes/reference are missing.

## 3. `_worker` RVT→IFC bridge

- [x] Define Docker/runtime boundary for `_worker` bridge.
- [x] Define queue states: `queued`, `exporting_rvt_to_ifc`, `ifc_ready`, `failed`, `cancelled`.
- [x] Define fake export fixture mode for non-Revit local validation.
- [x] Define real Revit export mode as external prerequisite.
- [x] Define `ifc_ready` webhook to `bim-streaming-server`.
- [x] Ensure `_worker` does not return `model.usdc` readiness in the new flow.
- [x] Preserve source RVT → derived IFC lineage fields.

## 4. `bim-streaming-server` IFC→USDC conversion authority

- [x] Define conversion API endpoints under `bim-streaming-server`.
- [x] Define streaming conversion job store semantics.
- [x] Define status/stage enums.
- [x] Define hard fail when converter output is missing or not openable.
- [x] Define no-placeholder-ready invariant.
- [x] Move or wrap existing IFC→USDC adapter behavior under streaming-server authority.
- [x] Preserve mapping quality metrics and sidecar carrier semantics.
- [x] Produce `model.usdc`, `element_mapping.json`, `entity_index.json`, and `metadata.json` or equivalent result payload.
- [x] Callback `_bim-control` with conversion result.
- [x] Add focused tests for job creation, status, failure, result, and callback payload.

## 5. `bim-review-platform` deployment boundary

- [x] Define deployment profile containing coordinator + streaming-server + web-viewer.
- [x] Confirm no nested repo or submodule is created.
- [x] Define ports, health checks, logs, and env var ownership.
- [x] Define single-Kit single-viewer smoke.
- [x] Define single-Kit multi-viewer viewport sharing smoke.
- [x] Keep process boundaries explicit; do not merge services into one runtime process.

## 6. Coordinator session / artifact binding

- [x] Update session creation to accept streaming-server conversion authority metadata.
- [x] Add optional `conversion_job_id` and `conversion_authority="bim-streaming-server"` to stream config / model metadata.
- [x] Define primary model selection rule.
- [x] Define secondary model ordering rule.
- [x] Define multi-viewer viewport sharing state.
- [x] Ensure coordinator does not own conversion execution.

## 7. USD stage composition

- [x] Define `openStageRequest` payload shape for primary + secondary artifacts.
- [x] Define session layer semantics.
- [x] Define subLayer ordering and conflict behavior.
- [x] Define `openedStageResult` response with applied composition.
- [x] Define failure response for missing secondary layer without failing primary load.
- [x] Add non-GPU contract test for payload shape.

## 8. Viewer updates

- [x] Display conversion authority and conversion job state when available.
- [x] Keep dev-only fallback fetch read-only.
- [x] Display stage composition summary.
- [x] Do not recompute or persist quality metrics in viewer.
- [x] Keep production fallback unreachable unless explicitly configured.

## 9. Demo readiness smoke update

- [x] Add `rvt_intake` tier.
- [x] Add `rvt_to_ifc_bridge` tier.
- [x] Add `streaming_conversion_job` tier.
- [x] Add `mapping_quality` tier under streaming-server authority.
- [x] Add `single_kit_multi_viewer` tier.
- [x] Add `usd_stage_composition` tier.
- [x] Ensure historical worker conversion evidence is not promoted to new B-scheme pass.

## 10. Verification

- [x] `openspec validate architecture-rework-2026-05-14 --strict`.
- [x] `_bim-control` focused tests.
- [x] `_worker` focused tests.
- [x] `bim-streaming-server` non-GPU conversion API contract tests.
- [x] `bim-review-coordinator` tests.
- [x] `web-viewer-sample` build and session-first tests.
- [x] Root smoke evidence script updated to emit tiered results.
- [x] Manual runbook updated for B-scheme flow.

## 11. PR closeout

- [x] PR summary states B 方案 explicitly.
- [x] PR summary states no nested git repo was created.
- [x] PR summary lists all source-of-truth files updated.
- [x] PR summary lists unimplemented runtime items as blocked/deferred, not passed.
- [ ] After merge, archive change and sync roadmap + HTML view.
