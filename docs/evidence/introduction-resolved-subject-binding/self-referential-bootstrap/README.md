# introduction-resolved-subject-binding — self-referential bootstrap

- `stack_kind=self_referential_bootstrap`
- Originating PR: `#620`
- Ledger entry: `introduction-resolved-subject-binding`
- Verification contract: `introduction-resolved-subject-binding/v1`
- Contract SHA-256: `4846c3f1df6582d9836ce24a404d9862bcc8036cfaacddb7c82c000a5ea02027`

machine-truth comparator（sentinel subject 解析、reconcile ratchet、base-aware
真實 ledger required check）就是本 PR 變更的裁決機制本體：base-pinned 裁決只能
執行變更前的 comparator，無法在 merge 前對變更後的解析語義取證，故依
`docs/agents/self-referential-bootstrap.md` §2 於本分支以 bootstrap stack 取證。

本 evidence 不得被引用為 deploy-target evidence 或 isolated_branch_stack
evidence。merge 後依 §2 義務 3 由另一 ledger-only PR 以合併後 main 上的正規機制
重放凍結 contract 全部 command，寫入 `fixpoint` 關帳（change tasks 5.4）。

過程未讀取 credential、未做任何 live mutation；GitNexus index 於本 worktree
不存在（LadybugDB missing），記錄為 UNKNOWN，不作 pass。
