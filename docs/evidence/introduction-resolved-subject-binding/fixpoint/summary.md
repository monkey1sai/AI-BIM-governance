# introduction-resolved-subject-binding — fixpoint 重驗摘要

- Entry：`introduction-resolved-subject-binding`（open 於 PR #620，2026-08-19）
- Mechanism commit：`ab6787778d98094f6d34992ab3024aacd841e6bf`（#620 squash-merge 落 main，touch 全部四個 declared `verification_mechanism_paths`）
- 重驗環境：`git clone --no-local` **object-clean clone**（無任何 pre-squash 分支 object，等價 CI fresh checkout），checkout 恰為 mechanism commit、tracked 檔 0 dirty、置於非 Temp 路徑（machine-truth CLI 的 trusted-repository 檢查拒絕 Temp 根）
- 重驗時間：2026-08-19（本 closure PR 提交當日）
- Verification contract：`introduction-resolved-subject-binding/v1`（sha256 `4846c3f1df6582d9836ce24a404d9862bcc8036cfaacddb7c82c000a5ea02027`），依凍結順序重放：

| Command | 結果 | Exit |
|---|---|---:|
| `node --test scripts/tests/test-openspec-machine-truth.mjs scripts/tests/test-openspec-machine-truth-cli.mjs` | 51 pass / 0 fail | 0 |
| `node --test scripts/tests/test-openspec-repository-lifecycle.mjs` | 46 pass / 0 fail | 0 |
| `pwsh … scripts/tests/test-openspec-ledger-reconciliation.ps1` | all assertions passed | 0 |
| `pwsh … scripts/tests/verify-openspec-lifecycle.ps1 -BaseRef ab678777…` | openspec lifecycle OK | 0 |

## 附帶實證（#589 驗收條件 4 的首個現場證據）

fixpoint 重放當下，merged main 的 lifecycle ledger 帶著**兩個** squash 後懸空的 legacy subject（wave-1 自身 row `51adda76…`、`isolated-branch-stack-browser-e2e` row `96b6206e…`）。在 object-clean clone 中，變更後的 base-aware 真實 ledger 檢查（`current ledger keeps reconciled source snapshots clean`）對兩者均經 introduction-recovery 解析為各自的 landed squash commit 並回綠——**squash 後零 follow-up rebind PR、required check 自癒**，post-squash rebind treadmill 的 CI 強制點就此消失。

已知殘留（規格明載）：在留有 pre-squash object 的開發機 clone 上，legacy row 的 exists-but-not-ancestor 仍依規格硬失敗（`subject_not_ancestor`，legacy 行為零變更）；此差異將於第二波 sentinel 化後消失。

過程未讀取 credential、未做任何 live mutation。
