# orphan-kit-liveness-preflight — self-referential bootstrap

- `stack_kind=self_referential_bootstrap`
- Originating PR: `#653`
- Ledger entry: `orphan-kit-liveness-preflight`
- Opening base: `d72f3a66e738a8f1654707185cc14d836dd26759`
- Pre-opening branch head: `449e6eb0f3ca99dd8bcaad219ec08e3b68e53ece`
- Verification contract: `orphan-kit-liveness-preflight/v1`
- Contract SHA-256: `aaf83a0022155d2b8858e98570bbf15ead369b298ce8360402982a6e0c149223`
- Mechanism paths: `scripts/deploy.ps1`, `scripts/lib/host-native-launcher.ps1`, `scripts/self-referential-bootstrap-ledger.json`

本 PR 改的是 canonical deploy path 上「已經有實例在跑嗎、可以啟動嗎」這個判定
本身(issue #640)。兩層變更各自只在真實部署當下才存在：

1. `Start-HostNativeService` 新寫的 `<Name>.ports` claim，只有一次真的
   `Start-Process` 啟動才會產生；`Remove-StalePidFile` 刻意不刪它，也只有在真實
   部署把 launcher 弄死、Kit 子行程存活時才看得出差別。
2. `Get-HostNativeOrphanListener` 的拒絕，只有在真的有一個孤兒 Kit 佔著真的
   LISTEN socket 時才會觸發；Phase 4c 的 exit 4 也只有在真實部署流程裡才會走到。

依 `docs/agents/self-referential-bootstrap.md` §2.1 第 2 類，部署契約只重建／驗證
已 merge 的 `origin/main` 內容(`scripts/deploy.ps1` 與
`scripts/lib/host-native-launcher.ps1` 皆列於 `Get-SelfReferentialMechanismPaths`)，
因此在本變更抵達 origin/main 之前，無法用正規機制對「變更後行為」取證——不是
「報告格式沒有前版可比」那種 §2.1 明確排除的情況，而是契約本身禁止在 merge 前
用 canonical deployment 驗證變更後的啟動決策。同一形狀的既有實例為 PR #647
(`remote-deploy-tag-origin-main-sync`)。

單元測試能證明什麼、不能證明什麼，寫清楚：能證明的是 detection 與 refusal 的
邏輯——port claim 的寫入／保留／釋放、union 探測、live-tree 歸屬、
owner-not-visible(-1) fail-closed、settle window、以及 deploy.ps1 Phase 4c 在
`Start-HostNativeKit` 之前就評估這道閘門且以 exit 4 收尾。不能證明的是真實
canonical-linux 上「launcher 死掉、Kit 子行程仍活著佔埠」這個狀態下的端到端行為；
fixture 造出來的孤兒不等於一次真實部署週期。這正是本 debt 存在的理由，關帳留給
merge 後、以變更後機制重跑本 contract 五道命令的 ledger-only fixpoint PR。

本 evidence 只記錄 bootstrap opening，不是 canonical post-merge evidence，也不是
fixpoint evidence，不得用來關閉本 entry。

GitNexus：`gitnexus impact Get-HostNativeOrphanListener -d upstream -r
AI-BIM-governance` 回報 `Target not found`(`impactedCount=0`, `risk=UNKNOWN`)。
與 PR #647 記載的成因相同——GitNexus 目前不抽取 PowerShell 函式層級符號(`.ps1`
只以 File node 索引)，屬工具涵蓋缺口而非索引過期，故記為 unavailable，不冒充
pass。替代證據為手動盤點的呼叫點：`Get-HostNativeOrphanListener` 只有兩個
consumer(`scripts/deploy.ps1` Phase 4c 與
`scripts/tests/test-host-native-launcher.ps1`)；`<Name>.ports` sidecar 的
reader/writer 全數列舉為 `Start-HostNativeService`、`Stop-HostNativeService`、
`Get-HostNativeServiceListenPorts`、`Remove-StalePidFile`(刻意不動)。
