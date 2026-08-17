# agent-governance-policy-wiring fixpoint

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與結果，不是 contract、不是 working note；ledger entry 閉合後受閘門的證據不可變規則保護。

## Verified facts

- Stack kind: `self_referential_fixpoint`
- Entry: `agent-governance-policy-wiring`
- Originating PR: `#572`
- Mechanism commit: `8b647d3492d50f02b2bdaa8b20f3f0670dfd7998`
- Merge subject: `feat(governance): wire the Agent Governance Policy module as an adjudicator (#572)`
- Verification CWD: `C:\Repos\active\iot\ai-bim-fixpoint-8b647d3`（repo-sibling worktree，detached 於 mechanism commit）
- Before verification, `HEAD` resolved to the mechanism commit and `git status --porcelain` was empty.
- Immutable contract: `agent-governance-policy-wiring/v1`
- Contract SHA-256: `8dc3130cb48cd290527f915d63dbecd3b9c8306c89f940dc27a32f3a13177036`
- The immutable verification contract was replayed in its declared order. Every command exited `0` before the `2026-08-17T12:38:53Z` re-verification stamp.

| Command ID | Exact invocation | Result | Exit |
|---|---|---|---:|
| `verify-governance-policy` | `pwsh -NoProfile -NonInteractive -File scripts/tests/verify-governance-policy.ps1` | 37 rules, 0 error, 0 warning；passed | `0` |
| `test-agent-governance-policy` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-policy.ps1` | all 106 assertions passed | `0` |
| `test-agent-governance-check` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1` | all assertions passed（瘦身版 1117 行） | `0` |
| `test-self-referential-bootstrap` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-self-referential-bootstrap.ps1` | all assertions passed | `0` |
| `test-pr-body-evidence` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-pr-body-evidence.ps1` | all assertions passed | `0` |
| `invoke-powershell-static` | `pwsh -NoProfile -NonInteractive -File scripts/tests/invoke-powershell-static.ps1` | passed（PSScriptAnalyzer 1.24.0） | `0` |

PowerShell 7.5.4；pinned Node 20 toolchain。

## What this proves

Entry `agent-governance-policy-wiring` froze the claim that a branch rewiring the required
agent-governance adjudication suite is judged by the surface it edits, so no pre-merge run can
prove the post-merge wiring. Replaying the entry's immutable contract at the merged mechanism
commit shows the wired mechanism passing its own gates from `main` itself：新的裁決 gate
（`verify-governance-policy`）對真 repo 評出 37 規則零違規零警告、module 行為套件（含 PINNED
語彙與承重指紋）全綠、瘦身後的舊 gate 全綠、bootstrap／PR-body／static 三個相鄰裁決者亦全數
成立於 mechanism commit 本身。

## Inferences

- 兩步計畫（#565 report-only → #572 adjudicator）自此閉合：治理規則以資料表達、由 deep module
  裁決；新增規則不再觸及任何 mechanism path。

## Unverified risks

- 本 replay 在 Windows 主機執行；`windows-latest` CI runner 上的行為由 required checks 於後續
  PR 持有，不由本 attestation 宣稱。
