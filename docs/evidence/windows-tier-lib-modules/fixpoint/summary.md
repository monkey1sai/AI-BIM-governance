# windows-tier-lib-modules fixpoint

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與結果，不是 contract、不是 working note；ledger entry 閉合後受閘門的證據不可變規則保護。

## Verified facts

- Stack kind: `self_referential_fixpoint`
- Entry: `windows-tier-lib-modules`
- Originating PR: `#570`
- Mechanism commit: `655f1f9687b12874a1cbf4434006916bd16a2893`
- Merge subject: `fix(governance): cover scripts/lib modules in the Windows deploy tier (#570)`
- Verification CWD: `C:\Repos\active\iot\ai-bim-fixpoint-655f1f9`（repo-sibling worktree，detached 於 mechanism commit）
- Before verification, `HEAD` resolved to the mechanism commit and `git status --porcelain` was empty.
- Immutable contract: `windows-tier-lib-modules/v1`
- Contract SHA-256: `5545d1f629a74c7062da9a7c0bac5e15dced6494982be658b962ad659146d5be`
- The immutable verification contract was replayed in its declared order. Every command exited `0` before the `2026-08-17T10:21:17Z` re-verification stamp.

| Command ID | Exact invocation | Result | Exit |
|---|---|---|---:|
| `test-windows-verification-scope` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-windows-verification-scope.ps1` | all assertions passed | `0` |
| `test-pr-body-evidence` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-pr-body-evidence.ps1` | all assertions passed | `0` |
| `invoke-powershell-static` | `pwsh -NoProfile -NonInteractive -File scripts/tests/invoke-powershell-static.ps1` | passed | `0` |

PSScriptAnalyzer 1.24.0；PowerShell 7.5.4。

## What this proves

Entry `windows-tier-lib-modules` froze the claim that a branch changing
`scripts/lib/windows-verification-scope.ps1`（決定其他每個 PR 欠多少 Windows 證據的 checker）
can only exercise the new classification with the changed checker itself. Replaying the entry's
immutable contract at the merged mechanism commit shows the widened tier（`.psm?1`）enforced from
`main` itself: the scope suite proves `scripts/lib/StructLog.psm1` now owes `deploy_dryrun` while
`platform/` modules, `.psd1` manifests, and nested paths stay in their prior tiers, and the PR-body
gate plus static analysis hold on the exact commit that landed the mechanism.

## Inferences

- The debt's fail-closed premise（branch cannot self-prove a verifier-classification change）is
  discharged by this mainline replay.

## Unverified risks

- 本 replay 在 Windows 主機執行；CI runner 上該 gate 由後續 PR 的 required checks 持有，不由本
  attestation 宣稱。
