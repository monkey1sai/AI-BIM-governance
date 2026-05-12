## 1. Preparation And Impact Review

- [x] 1.1 Re-read `openspec/specs/worker-artifact-pipeline/spec.md`, `openspec/specs/runtime-verification-evidence/spec.md`, `openspec/specs/worker-demo-upload-convert-ui/spec.md`, and this change's proposal/design/spec deltas.
- [x] 1.2 Re-read `_worker/app/main.py`, `_worker/app/store.py`, `_worker/app/settings.py`, `_worker/app/dev_sources.py`, `_worker/app/ui.py`, and `_worker/tests/*` before editing.
- [x] 1.3 Run GitNexus impact analysis for `WorkerStore`, `create_app`, `get_conversion_result`, `get_artifact_group_readiness`, `list_dev_ifc_sources`, and any symbol selected for edit; report HIGH/CRITICAL risk before code changes.
- [x] 1.4 Inventory `storage/*.ifc` from the worktree and `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`, recording fixture count, file names, and sizes for the implementation notes.

## 2. Lineage API

- [x] 2.1 Add a worker store helper that resolves an artifact ID from source artifact index, artifact group index, conversion job result `derived_artifact_ids`, and derived `metadata.json`; mapping/index artifact IDs MUST prefer existing stable `derived_artifact_ids` values.
- [x] 2.2 Add a normalized lineage graph builder that returns source, derived USDC, `ifc_index.json`, `usd_index.json`, `element_mapping.json`, metadata nodes, stable artifact IDs, parent/child edges, quality metrics summary, and diagnostics.
- [x] 2.3 Add `GET /api/artifacts/{artifact_id}/lineage` to `_worker/app/main.py` with 400 handling for invalid IDs and 404 handling for unknown artifact IDs.
- [x] 2.4 Preserve backward-compatible reads of legacy metadata by returning diagnostics for missing lineage fields instead of raising server errors.
- [x] 2.5 Add `_worker` API/store tests for source-only lineage, succeeded derived lineage, mapping/index node stable IDs, querying lineage by `derived_artifact_ids.ifc_index`, `derived_artifact_ids.usd_index`, and `derived_artifact_ids.element_mapping`, unknown artifact 404, and legacy metadata diagnostics.

## 3. Mapping Quality Baseline

- [x] 3.1 Extend conversion quality metrics schema to include `minimum_coverage_baseline_locked`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status`, policy diagnostics, and issue-to-real-prim readiness fields.
- [x] 3.2 Implement pass/warn/fail coverage policy while preserving measure-first behavior when no locked threshold is configured; locked pass requires every source IFC entity to map to at least one real USD prim path.
- [x] 3.3 Ensure `coverage_status=warn` keeps the artifact group reviewable with degraded mapping quality, while `coverage_status=fail` does not claim mapping readiness or issue-to-real-prim highlight readiness.
- [x] 3.4 Add regression tests for unlocked coverage, `minimum_coverage_ratio=1.0` pass, warn reviewability, fail blocking, all-entity denominator inclusion for non-renderable IFC metadata/relationship entities, and fallback/synthetic IDs not contributing to real mapped coverage.
- [x] 3.5 Add unit tests for all-entity USD prim materialization so `IfcProject`, `IfcSite`, `IfcBuilding`, property/type metadata, and relationship entities are included in the coverage denominator and represented by non-renderable USD prims.

## 4. Storage Fixture Batch Verification

- [x] 4.1 Add a repo-local batch verification helper that enumerates `_worker` dev IFC sources from repo-local `storage/*.ifc` and runs conversions through existing worker selected-source APIs or equivalent test helpers.
- [x] 4.2 Record per-fixture filename, relative path, size, source artifact ID, artifact group ID, conversion job ID, USDC openability, source IFC entity count, mapped/unmapped entity counts, coverage ratio, `minimum_coverage_ratio=1.0`, coverage status, lineage API status, duration, warnings, and failures.
- [x] 4.3 Make the helper report `blocked` when the fixture root is missing, unreadable, empty, or only a subset is run; it must not mark `minimum_coverage_locked=true` for blocked or partial runs.
- [x] 4.4 Add tests that prove duplicate IFC bytes with different filenames preserve independent `original_filename`, source artifact IDs, conversion job IDs, and lineage.

## 5. Worker UI

- [x] 5.1 Update the worker demo UI to expose a lineage / quality view for completed conversions using worker APIs rather than local file reads.
- [x] 5.2 Display source IFC, derived USDC, index artifacts, mapping artifact, metadata URL, conversion job ID, artifact group ID, coverage ratio, baseline lock status, coverage status, and diagnostics.
- [x] 5.3 Show incomplete lineage states without exposing absolute local filesystem paths.
- [x] 5.4 Keep review-session creation, issue editing, annotation editing, and WebRTC controls outside the worker UI.

## 6. Evidence And Documentation

- [x] 6.1 Create or update verification evidence documenting the `storage/*.ifc` batch run, applied threshold, fixture matrix, lineage API result, and pass/warn/fail summary.
- [x] 6.2 Record API-only, batch conversion baseline, and single Kit/browser issue highlight evidence as separate tiers.
- [x] 6.3 If GPU/Kit/browser issue highlight smoke cannot run, record it as `blocked` with the missing prerequisite and do not claim issue-to-real-prim baseline passed.
- [x] 6.4 Update roadmap references only after implementation evidence exists; do not mark coverage baseline or issue highlight as passed from spec text alone.

## 7. Validation And Review

- [x] 7.1 Run `openspec validate worker-mapping-lineage-quality-baseline --strict`.
- [ ] 7.2 Run `_worker` focused tests from `_worker/` with `python -m pytest tests`.
  - Blocked locally before API test execution by global dependency drift: `fastapi 0.111.0` + `starlette 1.0.0`; this change pins `_worker/requirements.txt` back to the repo baseline and records the blocker in evidence.
- [x] 7.3 Run the batch fixture helper against `storage/*.ifc` or record the exact blocker.
- [x] 7.4 Run single Kit/browser issue highlight smoke only when GPU/Kit prerequisites are available, otherwise record blocked evidence.
- [x] 7.5 Run `gitnexus_detect_changes()` before commit and confirm affected scope stays within `_worker`, OpenSpec artifacts, and verification docs unless explicitly expanded.
  - `gitnexus_detect_changes(repo="AI-BIM-governance", scope="all")` returned no changed symbols because the registered index points at the canonical repo rather than this worktree; fallback `git diff --name-only` confirmed the changed paths are `_worker`, OpenSpec artifacts, and verification/roadmap docs.
