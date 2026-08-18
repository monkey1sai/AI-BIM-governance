# rebuild-test-deploy-pwsh7-child fixpoint

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與結果；ledger entry 閉合後受閘門的證據不可變規則保護。

## Verified facts

- Stack kind: `self_referential_fixpoint`
- Entry: `rebuild-test-deploy-pwsh7-child`
- Originating PR: `#586`
- Mechanism commit: `fca2efa9ed9fa7034a9cb5e71513b1d4da73baaa`
- Merge subject: `fix(deploy): run deploy.ps1 under PowerShell 7 so the system-python probe survives quoting (#586)`
- 重放環境：乾淨 worktree checkout 於 mechanism commit 本身（`git rev-parse HEAD` = mechanism commit；tracked 檔 0 dirty，僅 gitignored 產物），非主 checkout（主 checkout 當時有並行 session 未提交變更，刻意避開）。
- Immutable contract: `rebuild-test-deploy-pwsh7-child/v1`
- Contract SHA-256: `b425887e7bd4ea8801ec645bbbf6511f542a1207c267e35230136b8bb435aa85`
- 9 個契約命令依凍結順序於 2026-08-18T08:42Z 前重放完成，全部 exit `0`。

| Command ID | Result | Exit |
|---|---|---:|
| `test-rebuild-test-deploy` | PASS | `0` |
| `test-platform-adapter` | PASS | `0` |
| `test-host-native-launcher` | PASS | `0` |
| `test-host-native-child-launch` | PASS | `0` |
| `test-deploy-target-registry` | PASS | `0` |
| `test-deploy-governance-static` | PASS | `0` |
| `test-self-referential-bootstrap` | PASS | `0` |
| `test-agent-governance-check` | PASS | `0` |
| `invoke-powershell-static` | PASS | `0` |

## Inferences

- PR `#586` 落地的 PowerShell 7 child launcher（修復 PS5.1 對 Resolve-PlatformSystemPython 內嵌雙引號的斷詞）在 landed mainline mechanism commit 上以其自身的迴歸契約重放全綠——達成 post-merge fixpoint。

## Unverified risks

- 本 closure 由收斂 session 代 originating session 執行（contract 全為本地命令，無 owner-inventory 依賴；battery log 於 session scratchpad `fixpoint-586.log`）。
- `deploy.ps1` 於部署區的 Phase 4d（docker compose up 前置 design-assets hash）在本修復前曾因 PSModulePath 污染失敗；#586 是否連帶消解該症狀未在本 closure 驗證（非本 entry contract 範圍）。

## Next actions

- Submit this ledger-only closure PR with `Self-referential bootstrap = no`.
- Merge 後 open debt 清空，被擋的 mechanism PR（#594 等）即解鎖。
