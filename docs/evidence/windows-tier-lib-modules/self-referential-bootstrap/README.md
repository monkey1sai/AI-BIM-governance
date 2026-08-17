# windows-tier-lib-modules — self-referential bootstrap evidence

## What changed

`scripts/lib/windows-verification-scope.ps1` tier-2 (`deploy_dryrun`) pattern:

```diff
-'^scripts/lib/(?!platform/)[^/]+\.ps1$',
+'^scripts/lib/(?!platform/)[^/]+\.psm?1$',
```

A PowerShell **module** directly under `scripts/lib/` now owes the same Windows evidence as a
script there.

## Why it is bootstrap debt

This file decides how much Windows verification evidence **every other PR** owes. A branch that
changes it verifies the new classification with the changed checker itself, so the pre-merge run
cannot prove that what merges is what gets enforced. The obligation closes with a post-merge
fixpoint run from `main`.

Mechanism paths changed by this PR (both declared in the ledger entry):

- `scripts/lib/windows-verification-scope.ps1`
- `scripts/self-referential-bootstrap-ledger.json`

`scripts/tests/test-windows-verification-scope.ps1` is also changed but is **not** a classified
mechanism path (`Get-SelfReferentialMechanismPaths` returns only the two above for this PR's
changed-path set), so it is deliberately not declared.

## The gap, in one line

`scripts/lib/rebuild-test-deploy.ps1` is tier 2 and imports `scripts/lib/StructLog.psm1`, which was
tier 0 — a deploy library's own dependency owed no Windows evidence.

Full before/after classification, the evidence that this was oversight rather than design, and the
contract command runs are in [`verification.txt`](verification.txt).

## Verification contract

| Field | Value |
|---|---|
| id | `windows-tier-lib-modules/v1` |
| command_ids | `test-windows-verification-scope`, `test-pr-body-evidence`, `invoke-powershell-static` |
| contract_sha256 | `5545d1f629a74c7062da9a7c0bac5e15dced6494982be658b962ad659146d5be` |

All three passed on this branch pre-merge; the same ordered set must pass from `main` to close the
entry.
