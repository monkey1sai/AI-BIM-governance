# Task 8 (M8) Acceptance and Retention Report

Timestamp: 2026-07-10 (Asia/Taipei)
Worktree: `C:\Repos\active\iot\AI-BIM-governance.worktrees\codex-governance-auto-update-design`

## Scope and safety

Read-only acceptance review. No scheduled task was registered, no live candidate was applied, and no credential, token, private key, or environment value is included. Inspected `CODEX_HOME`: `C:\Users\IOT\.codex`.

## Acceptance gates (evidence-qualified)

| Gate | Result | Evidence / exact expectation |
|---|---|---|
| Redacted report | VERIFIED | Paths, statuses, and hash contracts only; no secret values. |
| Maintenance unit harness | VERIFIED (pwsh 7.5.4 required) | All nine maintenance test scripts passed under PowerShell 7.5.4; aggregate reported `passed count 9; failed count 0`. Windows PowerShell 5 is rejected before product tests run; no aggregate pass is claimed from PS5. |
| Governance check | VERIFIED | `test-agent-governance-check.ps1` passed. |
| Scheduled task contract | VERIFIED (definition only) | Audit daily 02:30; Apply Sunday 03:30; `Taipei Standard Time`; absolute `pwsh.exe -NoProfile -NonInteractive`; Interactive/Limited; `StartWhenAvailable`; `IgnoreNew`; `PT1H`. Registration intentionally not invoked. |
| No live side effects | VERIFIED | No live task registration or update Apply was performed; unattended updater remains disabled. |
| `createdAtUtc` stale check | VERIFIED (direct exercise only) | The directly exercised stale-age guard rejects an expired candidate; this does not prove full orchestrator Apply wiring. |
| Applied state / journal | UNVERIFIED | No live applied manifest or journal was present. Exact identity and phase schemas remain requirements, not observed runtime evidence. |
| Archive/closure/tree hash through Apply | PARTIAL | Component tests cover hashing, but end-to-end orchestrator Apply wiring was not exercised. |
| Snapshot retention/pruning | UNVERIFIED | No configured retention/pruning run or live snapshot set was observed. |
| Stale candidate end-to-end rejection | PARTIAL | Direct age guard was exercised; full candidate loading and Apply rejection path was not. |
| Rollback failure disables Apply / preserves Audit | UNVERIFIED | Health failure injection exists, but the complete orchestrator state transition and subsequent Audit call were not run. |
| Post-restore hash verification | UNVERIFIED | No live restore/apply rollback drill was performed. |
| Live Apply/rollback drill | UNVERIFIED | No live or disposable end-to-end Apply/rollback acceptance drill was run. |

## Exact identity contract

Versions are exact strings; commit identities are full 40-character SHA-1;
archive, closure, staged-tree, and applied-file identities are full 64-character
SHA-256. Any mismatch, missing field, altered cohort, expired age, or changed
allowlist seal is fail-closed. Hash values are not reproduced because no live
applied state was observed and this report must remain redacted.

## Verification

- `pwsh 7.5.4 -NoProfile -NonInteractive -File scripts/dev/run-codex-maintenance-tests.ps1` -> PASS, `passed count 9; failed count 0`.
- `powershell.exe -NoProfile -NonInteractive -File scripts/dev/run-codex-maintenance-tests.ps1` -> FAIL as required (`PowerShell 7 or newer is required`), before product tests; no PS5 aggregate pass claimed.
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1` -> PASS (`all assertions passed`).
- `git diff --check` -> PASS.
- `pytest -q` -> collection failed on 17 pre-existing environment/template cases (`carb`, `omni`, kit-manager import path, and unrendered template syntax); this is unrelated to the maintenance harness.

## Remaining risk

No live candidate/journal/applied-state was present, so this is not a claim of a
real Apply or rollback drill. The unattended updater is not enabled and Plan C
is not fully production-ready. A future foreground acceptance must use a
disposable fake home, record redacted exact identities, exercise orchestrator
Apply and rollback failure, confirm Apply disabled while Audit succeeds, verify
one-instance/one-hour settings, and remove the fake home.
