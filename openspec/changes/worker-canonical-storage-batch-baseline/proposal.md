## Why

`worker-mapping-lineage-quality-baseline` 已歸檔並把 all-IFC-entity coverage policy 併入現行 specs，但 canonical `storage/*.ifc` real batch evidence 仍未完成。`C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` dry-run 可找到 13 個 IFC fixtures，然而 real `--limit 1` 曾在 600s 後 timeout，因此 production mapping baseline 仍不能宣稱 locked。

這個 follow-up change 用來收斂已歸檔 change 留下的 readiness gap：找出並修掉 canonical fixture timeout，完成 13-file real batch evidence，且只有 full batch passed 時才允許宣稱 `minimum_coverage_locked=true`。

## What Changes

- Add deterministic phase timing and timeout diagnostics for canonical storage batch conversion runs.
- Require `--limit 1` canonical 89MB fixture to complete before expanding to the full 13-file batch.
- Require the batch evidence report to distinguish `blocked`, `partial`, `timed_out`, `failed`, and `passed` states without locking the baseline for any non-passed state.
- Require every canonical fixture result to record conversion duration, phase timings, USDC openability, lineage API status, source IFC entity count, mapped/unmapped entity counts, coverage ratio, coverage status, warnings, and failure details.
- Permit `minimum_coverage_locked=true` only when all 13 canonical fixtures complete real conversion and satisfy the locked all-IFC-entity coverage criteria.
- Keep this work scoped to `_worker`, OpenSpec specs, and verification/roadmap evidence; do not add coordinator, viewer, Kit runtime, or production batch-job ownership.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `worker-artifact-pipeline`: tighten storage batch verification behavior so timeout diagnostics, phase timing, and complete real-batch success are part of the worker batch verification contract.
- `runtime-verification-evidence`: tighten canonical storage batch evidence acceptance so production mapping baseline cannot be locked from dry-run, partial, timed-out, or subset evidence.

## Impact

- `_worker/app/batch_verification.py`, `_worker/scripts/verify_storage_batch.py`, and related tests may change to add phase timing, timeout classification, and stricter summary semantics.
- `_worker/app/converters.py` may change if profiling shows all-entity materialization, stage save/reopen, or mapping generation is the timeout bottleneck.
- Verification docs under `docs/verification/` will record the canonical batch matrix and whether baseline lock is still blocked or passed.
- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` and `.html` will be updated after evidence changes so roadmap does not imply production readiness before full batch success.
- No new production dependency is expected. If profiling requires optional tooling, it must remain dev-only and be justified before implementation.
