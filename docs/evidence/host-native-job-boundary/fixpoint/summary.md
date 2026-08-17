# host-native-job-boundary fixpoint

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與結果；ledger entry 閉合後受閘門的證據不可變規則保護。

## Verified facts

- Stack kind: `self_referential_fixpoint`
- Entry: `host-native-job-boundary`
- Originating PR: `#573`
- Mechanism commit: `ef7518037d41b3d11800ee841e353d315c085c2c`
- Merge subject: `feat(deploy): launch-time OS containment boundary for host-native children (issue #522) (#573)`
- Before verification, `HEAD` and freshly fetched `origin/main` both resolved to the mechanism commit and `git status --porcelain` was empty（主 checkout）。
- Immutable contract: `host-native-job-boundary/v1`
- Contract SHA-256: `fc5b3467646fc0953f88fceef16bf854dc18eb7f80d007b79d463b4bacb0b60a`
- 14 個本地命令由本 session 於主 checkout 在 mechanism commit 上依凍結順序重放，全部 exit `0`，於 `2026-08-17T11:17:02Z` 完成（部分命令因兩輪執行競態重放兩次，兩次皆 `0`）。
- 2 個 canonical 命令（`canonical-linux-rebuild`＝`scripts/dev/rebuild-test-deploy.ps1 -Build`、`canonical-linux-deployment-verify`＝`scripts/verify-all.ps1 -Profile Deployment`）由 **repository owner 以 owner-approved private inventory 經 governed transport 執行**（本 skill/session 不讀 inventory），owner 回報兩者 exit code `0`／`0`。Inventory 路徑與遠端輸出依 privacy 邊界不記錄。

| Command ID | 執行者 | Result | Exit |
|---|---|---|---:|
| `test-host-native-launcher` | session（本地） | ALL PASSED（含 J1–J4 真核心物件測試） | `0` |
| `test-host-native-child-launch` | session（本地） | PASS | `0` |
| `test-platform-adapter` | session（本地） | PASS | `0` |
| `test-deploy-governance-static` | session（本地） | PASS | `0` |
| `test-verify-all` | session（本地） | PASS | `0` |
| `test-preflight-ports` | session（本地） | PASS | `0` |
| `test-kit-log-probe` | session（本地） | PASS | `0` |
| `test-deploy-target-registry` | session（本地） | PASS | `0` |
| `test-rebuild-test-deploy` | session（本地） | PASS | `0` |
| `test-remote-deploy-transport` | session（本地） | PASS | `0` |
| `test-host-native-conversion-service` | session（本地） | 130 passed / 8 skipped | `0` |
| `test-self-referential-bootstrap` | session（本地） | all assertions passed | `0` |
| `test-agent-governance-check` | session（本地） | all assertions passed | `0` |
| `invoke-powershell-static` | session（本地） | passed | `0` |
| `canonical-linux-rebuild` | owner（owner-approved inventory） | owner 回報 exit 0 | `0` |
| `canonical-linux-deployment-verify` | owner（owner-approved inventory） | owner 回報 exit 0 | `0` |

## Inferences

- PR `#573` 落地的 launch-time containment boundary（named kill-on-close Job Object＋anchor 服務語意、bounded child 匿名 job、job-first stop、sweep fallback）在 landed mainline mechanism commit 上重放全綠，且 canonical Linux 測試部署以變更後的 launcher 自 freshly fetched `origin/main` 重建並通過 Deployment profile 驗證——達成 post-merge fixpoint，issue #522 的 Windows 側交付完成。

## Unverified risks

- canonical 兩命令的 exit code 由 owner 回報；本 session 未讀取 inventory 或遠端輸出（privacy 邊界，刻意）。
- POSIX 真邊界（cgroup）仍為 open follow-up（issue #517）；canonical Linux 目標上服務containment 由 setsid＋linger＋sweep fallback 承接，此為已揭露的既有限制而非回歸。
- Start-Process 後、assign 前的微小視窗（bootstrap README 已揭露）不因 fixpoint 消失。

## Next actions

- Submit this ledger-only closure PR with `Self-referential bootstrap = no`.
- Merge 後 freshly fetch `origin/main`，驗證 ledger 已無 `host-native-job-boundary` open debt；issue #522 可關閉（#517 留開追蹤 POSIX cgroup）。
