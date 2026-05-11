## 1. Preparation And Impact Review

- [x] 1.1 Re-read `_worker/app/store.py`, `_worker/app/main.py`, `_worker/app/models.py`, `_worker/tests/*`, and `docs/verification/*` paths related to conversion result readiness.
- [x] 1.2 Run GitNexus impact analysis for `complete_conversion_job`, `create_conversion_job`, `_run_conversion_and_callback`, and affected readiness helpers before editing code.
- [x] 1.3 Inventory existing repo-local IFC fixtures under `storage/` and choose the smallest reliable fixture plus the 89 MB benchmark fixture.
- [x] 1.4 Inventory converter candidates and record license, external prerequisite, Windows support, expected output shape, and whether GPU / Kit SDK is required.

## 2. Converter Spike And Quality Thresholds

- [x] 2.1 Run a spike for the preferred converter against the repo-local IFC fixture and produce a real USDC outside production code first.
- [x] 2.2 Validate the generated USDC can be opened by a USD stage reader and record prim count.
- [x] 2.3 Measure IFC element count, USD prim count, mapped count, unmapped count, coverage ratio, duration, and observed memory / disk footprint when available.
- [x] 2.4 Keep P0 coverage as measure-first: require coverage report output, avoid failing CI on low coverage, and document the later baseline-lock criteria.

## 3. Spec And Contract Updates

- [x] 3.1 Keep `openspec/changes/worker-real-conversion-quality/specs/worker-artifact-pipeline/spec.md` aligned with final converter and quality-gate decisions.
- [x] 3.2 Keep `openspec/changes/worker-real-conversion-quality/specs/runtime-verification-evidence/spec.md` aligned with final evidence tiers.
- [x] 3.3 Update worker API contract docs for any additive result payload fields such as converter identity and quality metrics.
- [x] 3.4 Run `openspec validate worker-real-conversion-quality --strict`.

## 4. `_worker` Implementation

- [x] 4.1 Add an internal converter adapter boundary that accepts source IFC path and conversion job context and returns derived artifact paths plus quality metrics.
- [x] 4.2 Replace the production placeholder `model.usdc` write path with the real converter path for IFC `target_format=usdc`.
- [x] 4.3 Generate `ifc_index.json`, `usd_index.json`, and `element_mapping.json` from real source / stage data.
- [x] 4.4 Implement `element_mapping.json` entries with `primary_usd_prim_path` and `usd_prim_paths` so one IFC GUID can map to many USD prim paths.
- [x] 4.5 Add hard quality gate handling for USDC openability and non-blocking P0 coverage report generation.
- [x] 4.6 Ensure converter unavailable, converter failure, and non-openable USDC do not create ready artifact groups.
- [x] 4.7 Keep mock / placeholder fixtures isolated to tests or explicitly marked mock mode.

## 5. Tests

- [x] 5.1 Add unit tests for converter adapter success, converter unavailable, invalid output, coverage report output, and one-to-many mapping shape.
- [x] 5.2 Add `_worker` API tests proving successful real conversion result payload includes quality metrics and real artifact URLs.
- [x] 5.3 Add regression tests proving placeholder output is not accepted as ready production conversion evidence.
- [x] 5.4 Add opt-in real converter smoke test for repo-local IFC fixture and skip with a clear reason when external converter prerequisites are missing.
- [x] 5.5 Preserve existing `_worker` tests for source artifact intake, lineage, original filename, artifact group readiness, and callback payloads.

## 6. Runtime Evidence

- [x] 6.1 Update or create verification evidence that records real conversion metrics and coverage report for the selected fixture.
- [x] 6.2 Run API-only smoke first and record that it proves contract flow only.
- [ ] 6.3 Run single Kit/browser verification only after real USDC openability passes.
- [x] 6.4 If Kit/GPU/browser verification cannot run, record it as blocked with the missing prerequisite instead of marking the real conversion work failed.

Blocked this pass: `bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe` was absent in this worktree, so single Kit/browser verification was not runnable here.

## 7. Validation And Review

- [x] 7.1 Run `_worker` focused tests from the `_worker/` directory.
- [ ] 7.2 Run the affected root smoke script for worker review-session flow.
- [x] 7.3 Run GitNexus detect changes before commit and confirm affected scope stays within `_worker` and verification docs unless explicitly expanded.
- [ ] 7.4 PR description must call out external prerequisites, license status, measure-first coverage policy, validation evidence, and any blocked GPU/Kit evidence.

Pending this pass: root smoke requires the local services to be started with real worker converter prerequisites and a dev IFC source; PR description is pending until PR creation.
