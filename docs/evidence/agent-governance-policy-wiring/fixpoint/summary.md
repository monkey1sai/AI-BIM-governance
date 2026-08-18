# agent-governance-policy-wiring fixpoint

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與結果；ledger entry 閉合後受閘門的證據不可變規則保護。

## Verified facts

- Stack kind: `self_referential_fixpoint`
- Entry: `agent-governance-policy-wiring`
- Originating PR: `#572`；repair PR: `#579`
- Mechanism commit: `8b647d3492d50f02b2bdaa8b20f3f0670dfd7998`（`feat(governance): wire the Agent Governance Policy module as an adjudicator (#572)`）
- Immutable contract: `agent-governance-policy-wiring/v1`
- Contract SHA-256: `8dc3130cb48cd290527f915d63dbecd3b9c8306c89f940dc27a32f3a13177036`
- 6 個 command 依 contract 凍結順序重放，全部 exit `0`，於 `2026-08-18T04:08:00Z` 完成。

| Command ID | 對應 | Result | Exit |
|---|---|---|---:|
| `verify-governance-policy` | `scripts/tests/verify-governance-policy.ps1` | PASS | `0` |
| `test-agent-governance-policy` | `scripts/tests/test-agent-governance-policy.ps1` | PASS | `0` |
| `test-agent-governance-check` | `scripts/tests/test-agent-governance-check.ps1` | PASS | `0` |
| `test-self-referential-bootstrap` | `scripts/tests/test-self-referential-bootstrap.ps1` | PASS | `0` |
| `test-pr-body-evidence` | `scripts/tests/test-pr-body-evidence.ps1` | PASS | `0` |
| `invoke-powershell-static` | `scripts/tests/invoke-powershell-static.ps1` | PASS | `0` |

## 與既有 fixpoint 慣例的兩點偏差（誠實揭露，未以格式掩蓋）

1. **重放位置不是主 checkout。** 主 checkout 於本次執行時被另一個並行 session 佔用在 feature branch 上，因此重放改在同 repo 的 linked worktree 執行。重放前該 worktree 的 `git rev-parse HEAD` 與 freshly fetched `origin/main` 同為 `8883f5844270cc0e17b29ddb3090ca141167af2e`，且 `git status --porcelain` 為空。
2. **`HEAD` 不等於 mechanism commit。** `origin/main` 已前進至 `8883f58`（`#578`、`#581` 已 merge），mechanism commit `8b647d3` 為其祖先。本次重放證明的是「該機制在**當前 mainline HEAD** 上仍然成立」，而非「在 mechanism commit 當下成立」。就 fixpoint 的目的（機制能對自己成立）而言此為同等或更強的證據，但兩者不是同一個命題，故據實記錄。

`scripts/lib/self-referential-bootstrap.ps1` 只對 fixpoint 記錄做結構驗證（必要欄位、型別、`reverified_at` 晚於 `opened_at`），不機器比對 mechanism commit 與當下 `origin/main`；以上兩點因此不會被閘門攔下，正因如此更需要在此逐字揭露。
