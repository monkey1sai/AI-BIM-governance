# openspec-lifecycle-parser-alignment — fixpoint 重驗摘要

- Entry：`openspec-lifecycle-parser-alignment`（open 於 PR #634，2026-08-19T04:46:26Z）
- Mechanism commit：`348ad00974f13964b8505720416a1265277c8ed1`（#634 squash 落 main，subject `fix(governance): align adopted lifecycle parser state (#634)`；first-parent diff touch 全部兩個 declared `verification_mechanism_paths`：`scripts/lib/openspec-lifecycle.ps1`、`scripts/self-referential-bootstrap-ledger.json`）
- 重驗環境：`git worktree` checkout 恰為 mechanism commit `348ad00` 本身（重驗當下 `origin/main` tip 即此 commit），tracked 檔 0 dirty，置於非 Temp 路徑（machine-truth／lifecycle CLI 的 trusted-repository 檢查拒絕 Temp 根）；本機 pwsh 7.5.4 / node v22.22.0（Windows 11）
- 重驗時間：2026-08-19T07:03:03Z – 2026-08-19T07:08:50Z（UTC，實測；`reverified_at` 取重放結束時刻）
- Verification contract：`openspec-lifecycle-parser-alignment/v1`（sha256 `80ce60c30c2e4d071d3b22c33e352ec61047514822632c95d50aa9ad3eb570bd`），依凍結順序重放全部 5 個 command，全部 exit 0：

| # | Command id | 指令 | 結果 | 秒 | Exit |
|---:|---|---|---|---:|---:|
| 1 | `test-openspec-ledger-reconciliation` | `pwsh -NoProfile -NonInteractive -File scripts/tests/test-openspec-ledger-reconciliation.ps1` | all assertions passed | 279 | 0 |
| 2 | `verify-openspec-lifecycle` | `pwsh … scripts/tests/verify-openspec-lifecycle.ps1 -BaseRef 348ad00974f13964b8505720416a1265277c8ed1` | `openspec lifecycle OK: non_deferred=5; deferred=6` | 4 | 0 |
| 3 | `test-self-referential-bootstrap` | `pwsh … scripts/tests/test-self-referential-bootstrap.ps1` | all assertions passed | 28 | 0 |
| 4 | `test-pr-body-evidence` | `pwsh … scripts/tests/test-pr-body-evidence.ps1` | all assertions passed | 11 | 0 |
| 5 | `invoke-powershell-static` | `pwsh … scripts/tests/invoke-powershell-static.ps1` | passed | 5 | 0 |

指令對照取自 `scripts/tests/test-self-referential-bootstrap.ps1` 的 immutable command map，非自行拼寫；`verify-openspec-lifecycle` 的 `<origin-main-sha>` 佔位以重驗當下的 `origin/main` sha（即 mechanism commit）具現。

## 這次重驗回答的正是 opening reason 的循環

Entry 的 reason 指出：`scripts/lib/openspec-lifecycle.ps1` 這支 shared PowerShell lifecycle parser**自己就是被改的裁決機制**——新增 `'adopted' { $lifecycleStatus = 'completed' }` 這條正規化分支，並同步 reconciliation consumer（`scripts/tests/reconcile-openspec-ledger.ps1` 的 `lifecycle_unrepresented` 新判定、`active` 與 `completed` 的 disagreement 擴充）與 report schema 的 `proposal_status` enum（新增 `completed`）。base-pinned checker 固定執行**變更前**的 parser，在 base 樹上 `adopted` 仍落入 `default { $lifecycleStatus = 'invalid' }`，因此 merge 前無論如何都取不到「變更後 normalization 成立」的證據。

本次重放在 **merge 後的 first-parent mainline commit** 上以**變更後**的 parser、consumer 與 schema 執行凍結 contract。其中 `test-openspec-ledger-reconciliation` 以臨時 fixture 直接釘住新分支的語意，實測全部通過：

- `adopted marker preserves raw proposal status`（`RawStatus='adopted'`）
- `adopted marker normalizes to completed`（`LifecycleStatus='completed'`）
- `adopted marker is not deferred`
- `adopted marker normalizes in the report` ／ `report preserves the adopted marker`（report 的 `proposal_status='completed'`、`proposal_raw_status='adopted'`，通過新 enum）
- `adopted proposal, completed ledger, and complete CLI status agree`（exit 0）
- `adopted proposal cannot agree with an active machine row` → exit 2 並產出恰好一筆 `expected='completed'` 的 disagreement
- `lifecycle_unrepresented`：machine state 為 `completed` 但 OpenSpec CLI 非 `complete` 時的新 mismatch
- `adopted archive status remains compatible with lifecycle verification`（archive 側不回歸）

## 誠實界定（deliberately not claimed）

- 重驗當下 repo 內 **11 個非 archive change 目錄沒有任何一個帶 `adopted` marker**（實測 6 個 `deferred`、5 個無 marker 而預設 `active`，正對應 `non_deferred=5; deferred=6`）。因此新分支是由 reconciliation suite 的 fixture 驅動證明的，**不是**由現場 repository row 驅動；本 fixpoint 不宣稱已有 live `adopted` 資料列跑過這條路徑。
- 本重放為本機 pwsh 7.5.4 / node v22.22.0 執行。hosted runner（pinned node 20.20.2 / windows-latest）的對應綠燈由本 closure PR 自己的 required checks 提供，不由本檔主張。
- `verify-openspec-lifecycle` 的 `non_deferred=5; deferred=6` 是重驗當下的計數快照，非契約承諾值。

過程未讀取 credential、未做任何 live mutation、未觸碰部署區或生產狀態，未執行任何 approve／merge。
