# ci-parallelization-agent-governance-shards — self-referential bootstrap

- `stack_kind=self_referential_bootstrap`
- Originating PR: `#637`
- Ledger entry: `ci-parallelization-agent-governance-shards`
- Verification contract: `ci-parallelization-agent-governance-shards/v1`
- Contract SHA-256: `29f1314ad2121ff365ebe239d7fbcfcb084a42d89bf3aedd301c943d19c79cbf`

required context `agent-governance` 由 `pull_request` 事件執行 PR 自己樹上的
`.github/workflows/agent-governance.yml`，因此本 PR 把 `jobs.suite` 改成四片
matrix 之後的綠燈是自證：它只能證明「四片各自宣告要跑的步驟都過了」，不能證明
四片的聯集仍等於分片前的 31 個步驟。base-owned 的裁決者 `pr-review-agent.yml`
固定 checkout base.sha，base 樹上既沒有 shard 結構也沒有本 PR 新增的 shard 覆蓋
斷言，無法執行也無法判定分片是否靜默漏跑任何一支測試。

依 `docs/agents/self-referential-bootstrap.md` §2，本分支以 bootstrap stack 取證：
於本地以變更後的 workflow 與變更後的覆蓋斷言重跑，並額外以獨立腳本對 base 版
逐字比對四片聯集（`shard-coverage.txt`）。義務 3 的 fixpoint 由 merge 後另一支
ledger-only closure PR 在 first-parent mainline 上重放凍結 contract 全部 command
後關帳。

本 evidence 不得被引用為 deploy-target evidence 或 isolated_branch_stack evidence。

過程未讀取 credential、未做任何 live mutation、未觸碰部署區或生產狀態。
GitNexus index 於本 worktree 不存在（LadybugDB missing），記錄為 UNKNOWN，不作 pass。
