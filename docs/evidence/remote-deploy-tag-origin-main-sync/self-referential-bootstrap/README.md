# remote-deploy-tag-origin-main-sync — self-referential bootstrap

- `stack_kind=self_referential_bootstrap`
- Originating PR: `#647`
- Ledger entry: `remote-deploy-tag-origin-main-sync`
- Opening base: `85179d36bbc0c8421efd10b454d80a6891fffd80`
- Pre-opening branch head: `37d54dcefbbcf1c8d2f7f1450253ecb375814f35`
- Verification contract: `remote-deploy-tag-origin-main-sync/v1`
- Contract SHA-256: `79f59833ee9e310be43cca15dd1429a4e830e1dd7de0fddb0fba125ed51e2211`
- Mechanism paths: `scripts/lib/remote-deploy-transport.ps1`, `scripts/self-referential-bootstrap-ledger.json`

本 PR 讓 `New-RemoteDeployTag` 在 B13 deploy tag push 成功後，緊接著把同一顆
deployed commit 直接 push 到 origin 的 `refs/heads/main`（指定 sha,不依賴本地
checkout 到底checked out 哪個分支)，確保成功的 canonical 部署永遠留下
「origin/main 已確認到達該 commit」的紀錄。canonical deploy path 依契約只對
已 merge 的 `origin/main` 內容執行真實部署與驗證(見檔案頂端 contract 註解、
`docs/agents/self-referential-bootstrap.md` §5 已知實例)，因此無法在這支變更
merge 前,用一次真實的 canonical 部署去證明「新增的 origin/main 同步步驟」
真的會在實際部署流程中執行並成功——單元測試只能驗證 injected `$GitRunner`
收到正確的 git 呼叫序列,無法取代一次真實的 B13 tag-and-sync 部署週期。
依 `docs/agents/self-referential-bootstrap.md`,以 open ledger debt 綁定 PR
#647,待合併後由獨立 ledger-only fixpoint PR 對變更後機制重新執行本 contract
列出的四道命令後關帳。

本 evidence 只記錄 bootstrap opening,不是 canonical post-merge 或 fixpoint
evidence,也不得用來關閉 entry。GitNexus `impact New-RemoteDeployTag -d
upstream` 回報 `Target 'New-RemoteDeployTag' not found`(`impactedCount=0`,
`risk=UNKNOWN`);以已知有效的 TypeScript symbol(`CoordinatorApp`)複查同一條
impact 指令確認工具本身正常,並先 `analyze --force --index-only` 完整重建索引
(17,429 nodes / 36,560 edges,與 repo-level CLAUDE.md 記載的量級一致)後仍不
可解析,判定為 GitNexus 對 PowerShell 函式層級符號抽取的既有涵蓋缺口(`.ps1`
檔案目前僅以 File node 索引),不是索引過期。替代證據為 raw source、手動盤點的
呼叫點(`scripts/dev/rebuild-test-deploy.ps1`、
`scripts/tests/test-remote-deploy-transport.ps1`)、可執行 tests 與精確 diff,
不將 unavailable 冒充 pass。
