# agent-governance-policy-trust-boundary fixpoint

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與結果；ledger entry 閉合後受閘門的證據不可變規則保護。

## Verified facts

- Stack kind: `self_referential_fixpoint`
- Entry: `agent-governance-policy-trust-boundary`（`successor_of: agent-governance-policy-wiring`）
- Originating PR: `#579`
- Mechanism commit: `f07c8f198f1fd3dd6c86ef827d7300eaf901fd77`
- Immutable contract: `agent-governance-policy-trust-boundary/v1`
- Contract SHA-256: `b88a37af8d3800de0813d058b3349e25daebce0d39b6e212dc030243c0bcae2a`
- 9 個 command 依 contract 凍結順序重放，全部 exit `0`，於 `2026-08-18T04:11:25Z` 完成。

| Command ID | 對應 | Result | Exit |
|---|---|---|---:|
| `verify-governance-policy` | `scripts/tests/verify-governance-policy.ps1` | PASS | `0` |
| `test-agent-governance-policy` | `scripts/tests/test-agent-governance-policy.ps1` | PASS | `0` |
| `test-agent-governance-check` | `scripts/tests/test-agent-governance-check.ps1` | PASS | `0` |
| `test-self-referential-bootstrap` | `scripts/tests/test-self-referential-bootstrap.ps1` | PASS | `0` |
| `test-pr-body-evidence` | `scripts/tests/test-pr-body-evidence.ps1` | PASS | `0` |
| `invoke-powershell-static` | `scripts/tests/invoke-powershell-static.ps1` | PASS | `0` |
| `test-trusted-host-merge` | `node --test scripts/tests/test-trusted-host-merge.mjs` | PASS | `0` |
| `test-host-native-conversion-service` | `pytest bim-streaming-server/tests/test_host_native_conversion_service.py` | PASS | `0` |
| `test-verification-plan` | `node --test scripts/tests/test-verification-plan.mjs` | PASS | `0` |

## 本 entry 的核心命題已被直接驗證

本 entry 開立的理由是：hosted run `32036393744` 證明 streaming CI adjudicator 漏掉 repository-pinned 的 `usd-core`，因而無法 `import pxr`。本次 `test-host-native-conversion-service` 以 repo `.venv`（Python 3.12.7，`import pxr` 成功）重放並 exit `0`，該相依缺口在 mainline 上不復現。

## 與既有 fixpoint 慣例的兩點偏差（誠實揭露，未以格式掩蓋）

1. **重放不在主 checkout。** 主 checkout 於執行時被另一個並行 session 佔用在 feature branch 上，改在同 repo 的 linked worktree 執行。重放前該 worktree 的 `git rev-parse HEAD` 與 freshly fetched `origin/main` 同為 `8883f5844270cc0e17b29ddb3090ca141167af2e`，`git status --porcelain` 為空。
2. **`HEAD` 不等於 mechanism commit。** 重放時 `origin/main` 為 `8883f58`，mechanism commit `f07c8f1` 為其祖先。本次證明的是「該機制在**當時的 mainline HEAD** 上仍成立」，而非「在 mechanism commit 當下成立」。就 fixpoint 目的而言為同等或更強的證據，但兩者不是同一命題。

閘門只對 fixpoint 記錄做結構驗證，不比對 mechanism commit 與當下 `origin/main`；以上兩點不會被機器攔下，正因如此更需要逐字揭露。

## 未涵蓋

- `test-host-native-conversion-service` 的 **hosted CI** 重放不在本檔宣稱範圍；hosted 側證據由本 PR 的 required checks 產出。
