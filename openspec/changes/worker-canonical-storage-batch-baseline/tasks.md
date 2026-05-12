## 1. Preparation And Impact Review

- [ ] 1.1 Re-read `openspec/specs/worker-artifact-pipeline/spec.md`, `openspec/specs/runtime-verification-evidence/spec.md`, this change's proposal/design/spec deltas, and `docs/verification/2026-05-12-worker-mapping-lineage-quality-baseline.md`.
- [ ] 1.2 Re-read `_worker/app/batch_verification.py`, `_worker/scripts/verify_storage_batch.py`, `_worker/app/converters.py`, `_worker/app/store.py`, and existing `_worker/tests/*` before implementation.
- [ ] 1.3 Run GitNexus impact analysis for `run_storage_batch_verification`, `IfcOpenShellUsdConverter.convert`, `WorkerStore.complete_conversion_job`, and any selected symbol before editing; report HIGH/CRITICAL risk before code changes.
- [ ] 1.4 Confirm canonical fixture root `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`, fixture count, filenames, sizes, and whether worktree-local `storage/` is absent or intentionally unused.

## 2. Batch Timing And Status Semantics

- [ ] 2.1 Add per-fixture phase timing support for batch verification without introducing production dependencies.
- [ ] 2.2 Add converter phase timing hooks or result fields for IFC open, source entity enumeration, geometry iteration, mesh authoring, non-renderable entity materialization, stage save, and stage reopen when those phases are available.
- [ ] 2.3 Add explicit batch and fixture statuses for `blocked`, `partial`, `timed_out`, `failed`, and `passed`.
- [ ] 2.4 Add configurable per-fixture timeout handling for canonical runs and record elapsed duration, timeout setting, and last known phase diagnostics.
- [ ] 2.5 Ensure dry-run and subset runs always keep `minimum_coverage_locked=false` and cannot return batch `status=passed`.

## 3. Timeout Root Cause And Fix

- [ ] 3.1 Reproduce the canonical `--limit 1` real conversion timeout using `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage`.
- [ ] 3.2 Record phase timing evidence for the first 89MB fixture and identify the bottleneck phase.
- [ ] 3.3 Fix the bottleneck within `_worker` if it is caused by conversion staging, all-entity enumeration/materialization, mapping generation, artifact publish, or lineage lookup.
- [ ] 3.4 If the bottleneck is an external converter limitation, record deterministic blocker diagnostics and keep the baseline unlocked instead of claiming pass.
- [ ] 3.5 Re-run `--limit 1` until it either completes with full evidence or records a deterministic unresolved blocker.

## 4. Canonical 13-File Batch Evidence

- [ ] 4.1 Run the full canonical 13-file real batch only after `--limit 1` succeeds or has a clearly documented blocker.
- [ ] 4.2 Record per-fixture source artifact ID, artifact group ID, conversion job ID, original filename, size, duration, phase timings, output size, converter identity, USDC openability, lineage API status, source IFC entity count, mapped/unmapped entity counts, coverage ratio, coverage status, warnings, and failures.
- [ ] 4.3 Set batch `status=passed` only if all 13 required fixtures complete real conversion and pass all required quality checks.
- [ ] 4.4 Set or claim `minimum_coverage_locked=true` only when the full canonical batch status is `passed`.
- [ ] 4.5 If any fixture is blocked, timed out, partial, or failed, record the exact fixture and reason, and leave production mapping baseline unlocked.

## 5. Tests And Regression Coverage

- [ ] 5.1 Add unit tests for blocked root, dry-run partial status, subset partial status, timeout status, failed fixture status, and full passed status.
- [ ] 5.2 Add tests proving `minimum_coverage_locked=true` is impossible for dry-run, subset, timeout, blocked, or failed batches.
- [ ] 5.3 Add tests for duplicate fixture bytes preserving independent filenames, source artifact IDs, conversion job IDs, and lineage while also recording timing fields.
- [ ] 5.4 Add converter/store tests for any bottleneck fix that changes all-entity materialization, stage writing, artifact publishing, or lineage lookup behavior.

## 6. Evidence And Roadmap

- [ ] 6.1 Update or create `docs/verification/2026-05-12-worker-canonical-storage-batch-baseline.md` with the canonical root, fixture matrix, commands, environment, result status, and phase timing summary.
- [ ] 6.2 Update `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` so worker canonical batch risk burn-down stays ahead of unrelated new feature candidates until resolved.
- [ ] 6.3 Regenerate `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html` from the Markdown roadmap.
- [ ] 6.4 If full batch passes, explicitly document why `minimum_coverage_locked=true` is now allowed; if not, document the remaining blocker and keep the baseline unlocked.

## 7. Validation And Archive Gate

- [ ] 7.1 Run `openspec validate worker-canonical-storage-batch-baseline --strict`.
- [ ] 7.2 Run focused `_worker` tests covering batch verification, converter changes, store changes, and lineage lookups.
- [ ] 7.3 Run clean venv `_worker` full tests from `_worker/` with `python -m pytest tests` or document the exact environment blocker.
- [ ] 7.4 Run `git diff --check`.
- [ ] 7.5 Run `gitnexus_detect_changes()` before commit and confirm affected scope stays within `_worker`, OpenSpec artifacts, and verification/roadmap docs unless explicitly expanded.
- [ ] 7.6 Do not archive this change unless the canonical batch evidence is either fully passed with baseline locked or explicitly accepted as blocked with roadmap/evidence updated to keep baseline unlocked.
