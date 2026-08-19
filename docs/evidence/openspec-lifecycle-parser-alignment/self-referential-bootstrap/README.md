# openspec-lifecycle-parser-alignment — self-referential bootstrap

- `stack_kind=self_referential_bootstrap`
- Originating PR: `#634`
- Ledger entry: `openspec-lifecycle-parser-alignment`
- Opening base: `7e55de6492078b6cfd327435e5933ed7ade4f1de`
- Pre-opening branch head: `ea5f4977bf7a0677092ae3a9e1d8d1a8e6446dcb`
- Verification contract: `openspec-lifecycle-parser-alignment/v1`
- Contract SHA-256: `80ce60c30c2e4d071d3b22c33e352ec61047514822632c95d50aa9ad3eb570bd`
- Mechanism paths: `scripts/lib/openspec-lifecycle.ps1`, `scripts/self-referential-bootstrap-ledger.json`

本 PR 修改 shared PowerShell lifecycle parser，讓 proposal marker `adopted`
正規化為 machine lifecycle `completed`，並同步 reconciliation consumer 的
completed-state mismatch 判定。base-pinned checker 只能執行變更前的 parser，
因此無法在 merge 前證明變更後的 normalization；依
`docs/agents/self-referential-bootstrap.md`，以 open ledger debt 綁定 PR #634，
待合併後由獨立 ledger-only fixpoint PR 在 main 重放 frozen contract 後關帳。

本 evidence 只記錄 bootstrap opening，不是 canonical post-merge 或 fixpoint
evidence，也不得用來關閉 entry。GitNexus 的 symbol impact 找不到目標，且
exact-worktree `detect-changes` 雖定位到索引，內部 `git diff` 仍回報
`Not a git repository`；依 owner 本次明確授權記為 `UNKNOWN/unavailable`。
替代證據為 raw source、可執行 tests、精確 diff 與 Git history，不將
unavailable 冒充 pass。
