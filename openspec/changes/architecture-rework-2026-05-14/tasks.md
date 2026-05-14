# Tasks: architecture-rework-2026-05-14

## 0. Branch / baseline

- [x] Create branch `codex/openspec/architecture-rework-2026-05-14` from latest `main`.
- [x] Confirm no nested `.git` directories are introduced.
- [ ] Record current `AGENTS.md`, `README.md`, workflow, roadmap, and `openspec/specs/` source-of-truth baseline.
- [x] Run `openspec validate architecture-rework-2026-05-14 --strict` before any implementation.

## 1. Source-of-truth alignment

- [ ] Update `AGENTS.md` draft to mark `_worker` as RVT→IFC bridge and `bim-streaming-server` as IFC→USDC conversion authority under B 方案.
- [ ] Update `README.md` service boundary table draft.
- [ ] Update `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` to reflect new B-scheme flow.
- [ ] Update `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` and regenerated HTML view after spec approval.
- [ ] Confirm `documentation-source-of-truth` still distinguishes workflow vs roadmap authority.

## 2. `_bim-control` fake Revit intake facade

- [ ] Define fake RVT upload / signed reference endpoint.
- [ ] Define `rvt_uploaded` event payload.
- [ ] Define source artifact metadata fields for `.rvt`.
- [ ] Define idempotency key and correlation id behavior.
- [ ] Add tests for duplicate `rvt_uploaded` event handling.
- [ ] Add blocked state when RVT bytes/reference are missing.

## 3. `_worker` RVT→IFC bridge

- [ ] Define Docker/runtime boundary for `_worker` bridge.
- [ ] Define queue states: `queued`, `exporting_rvt_to_ifc`, `ifc_ready`, `failed`, `cancelled`.
- [ ] Define fake export fixture mode for non-Revit local validation.
- [ ] Define real Revit export mode as external prerequisite.
- [ ] Define `ifc_ready` webhook to `bim-streaming-server`.
- [ ] Ensure `_worker` does not return `model.usdc` readiness in the new flow.
- [ ] Preserve source RVT → derived IFC lineage fields.

## 4. `bim-streaming-server` IFC→USDC conversion authority

- [ ] Define conversion API endpoints under `bim-streaming-server`.
- [ ] Define streaming conversion job store semantics.
- [ ] Define status/stage enums.
- [ ] Define hard fail when converter output is missing or not openable.
- [ ] Define no-placeholder-ready invariant.
- [ ] Move or wrap existing IFC→USDC adapter behavior under streaming-server authority.
- [ ] Preserve mapping quality metrics and sidecar carrier semantics.
- [ ] Produce `model.usdc`, `element_mapping.json`, `entity_index.json`, and `metadata.json` or equivalent result payload.
- [ ] Callback `_bim-control` with conversion result.
- [ ] Add focused tests for job creation, status, failure, result, and callback payload.

## 5. `bim-review-platform` deployment boundary

- [ ] Define deployment profile containing coordinator + streaming-server + web-viewer.
- [ ] Confirm no nested repo or submodule is created.
- [ ] Define ports, health checks, logs, and env var ownership.
- [ ] Define single-Kit single-viewer smoke.
- [ ] Define single-Kit multi-viewer viewport sharing smoke.
- [ ] Keep process boundaries explicit; do not merge services into one runtime process.

## 6. Coordinator session / artifact binding

- [ ] Update session creation to accept streaming-server conversion authority metadata.
- [ ] Add optional `conversion_job_id` and `conversion_authority="bim-streaming-server"` to stream config / model metadata.
- [ ] Define primary model selection rule.
- [ ] Define secondary model ordering rule.
- [ ] Define multi-viewer viewport sharing state.
- [ ] Ensure coordinator does not own conversion execution.

## 7. USD stage composition

- [ ] Define `openStageRequest` payload shape for primary + secondary artifacts.
- [ ] Define session layer semantics.
- [ ] Define subLayer ordering and conflict behavior.
- [ ] Define `openedStageResult` response with applied composition.
- [ ] Define failure response for missing secondary layer without failing primary load.
- [ ] Add non-GPU contract test for payload shape.

## 8. Viewer updates

- [ ] Display conversion authority and conversion job state when available.
- [ ] Keep dev-only fallback fetch read-only.
- [ ] Display stage composition summary.
- [ ] Do not recompute or persist quality metrics in viewer.
- [ ] Keep production fallback unreachable unless explicitly configured.

## 9. Demo readiness smoke update

- [ ] Add `rvt_intake` tier.
- [ ] Add `rvt_to_ifc_bridge` tier.
- [ ] Add `streaming_conversion_job` tier.
- [ ] Add `mapping_quality` tier under streaming-server authority.
- [ ] Add `single_kit_multi_viewer` tier.
- [ ] Add `usd_stage_composition` tier.
- [ ] Ensure historical worker conversion evidence is not promoted to new B-scheme pass.

## 10. Verification

- [ ] `openspec validate architecture-rework-2026-05-14 --strict`.
- [ ] `_bim-control` focused tests.
- [ ] `_worker` focused tests.
- [ ] `bim-streaming-server` non-GPU conversion API contract tests.
- [ ] `bim-review-coordinator` tests.
- [ ] `web-viewer-sample` build and session-first tests.
- [ ] Root smoke evidence script updated to emit tiered results.
- [ ] Manual runbook updated for B-scheme flow.

## 11. PR closeout

- [ ] PR summary states B 方案 explicitly.
- [ ] PR summary states no nested git repo was created.
- [ ] PR summary lists all source-of-truth files updated.
- [ ] PR summary lists unimplemented runtime items as blocked/deferred, not passed.
- [ ] After merge, archive change and sync roadmap + HTML view.
