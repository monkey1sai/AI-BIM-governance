# Task 8 (M8) Acceptance and Retention Report

Timestamp: 2026-07-10 (Asia/Taipei)
Worktree: `C:\Repos\active\iot\AI-BIM-governance.worktrees\codex-governance-auto-update-design`

## Scope and safety

Read-only acceptance review. No scheduled task was registered, no live candidate was applied, and no credential, token, private key, or environment value is included. Inspected `CODEX_HOME`: `C:\Users\IOT\.codex`.

## Acceptance gates

| Gate | Result | Evidence / exact expectation |
|---|---|---|
| Redacted reports | PASS | Paths, statuses, and hash contracts only; no secret values. |
| Applied state | NOT OBSERVED | No live applied manifest was present. Each applied item MUST contain exact version, full 40-hex source SHA where applicable, archive/closure/tree SHA-256 (64 hex), cohort, and committed journal run ID. |
| Journal completeness | NOT OBSERVED | No live journal was present. A complete journal MUST be monotonic through `discovered -> pinned -> staged -> validated -> snapshotted -> applying -> verifying -> committed`, or terminal rollback/failure with reason and snapshot result. |
| Candidate freshness | CONTRACT VERIFIED | Apply rejects candidates older than 24 hours or whose source SHA, archive hash, tree hash, cohort, or allowlist seal differs from current trust inputs. |
| Snapshot retention | CONTRACT VERIFIED | Keep current snapshot plus configured rollback set; prune only after committed transaction, never the snapshot referenced by an incomplete journal. |
| Stale candidate rejection | TESTED | Health test includes stale-candidate failure injection; maintenance harness passed. |
| Rollback failure | TESTED | Incomplete rollback is a health failure; Apply is disabled while Audit remains available. |
| Audit availability | CONTRACT VERIFIED | Apply-disabled state is scoped to Apply; Audit/Verify/Recover remain callable. |
| Scheduled task state | PASS (definition only) | Audit daily 02:30; Apply Sunday 03:30; `Taipei Standard Time`; absolute `pwsh.exe -NoProfile -NonInteractive`; Interactive/Limited; `StartWhenAvailable`; `IgnoreNew`; `PT1H`. Registration intentionally not invoked. |

## Exact identity contract

Versions are exact strings; commit identities are full 40-character SHA-1;
archive, closure, staged-tree, and applied-file identities are full 64-character
SHA-256. Any mismatch, missing field, altered cohort, expired age, or changed
allowlist seal is fail-closed. Hash values are not reproduced because no live
applied state was observed and this report must remain redacted.

## Verification

- `pwsh -NoProfile -NonInteractive -File scripts/dev/run-codex-maintenance-tests.ps1` -> PASS, `failed count 0`.
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1` -> PASS (`all assertions passed`).
- `git diff --check` -> PASS.
- `pytest -q` -> collection failed on 17 pre-existing environment/template cases (`carb`, `omni`, kit-manager import path, and unrendered template syntax); no maintenance test failed.

## Remaining risk

No live candidate/journal/applied-state was present, so this is not a claim of a
real Apply or rollback drill. Final foreground acceptance must use a disposable
fake home, record redacted exact identities, induce rollback failure, confirm
Apply disabled while Audit succeeds, verify one-instance/one-hour settings, and
remove the fake home.
