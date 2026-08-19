# ci-parallelization-agent-governance-shards — fixpoint 重驗摘要

- Entry：`ci-parallelization-agent-governance-shards`（open 於 PR #637，2026-08-19）
- Mechanism commit：`cc372e4d1e5b3a9fa0dac42f2e654df615318dec`（#637 merge commit 落 main，first-parent diff touch 全部五個 declared `verification_mechanism_paths`）
- 重驗環境：`git worktree` checkout 恰為 mechanism commit `cc372e4` 本身、tracked 檔 0 dirty、置於非 Temp 路徑（machine-truth CLI 的 trusted-repository 檢查拒絕 Temp 根）；本機 pwsh 7.5.4 / node v22.22.0（CI 的 suite 另以 pinned node 20.20.2 於 hosted windows-latest 執行，見下方附帶實證）
- 重驗時間：2026-08-19T05:47Z – 2026-08-19T06:00:39Z（UTC，實測；`reverified_at` 取重放結束時刻）
- Verification contract：`ci-parallelization-agent-governance-shards/v1`（sha256 `29f1314ad2121ff365ebe239d7fbcfcb084a42d89bf3aedd301c943d19c79cbf`），依凍結順序重放全部 10 個 command，全部 exit 0：

| # | Command id | 指令 | 結果 | 秒 | Exit |
|---:|---|---|---|---:|---:|
| 1 | `test-agent-governance-check` | `pwsh … scripts/tests/test-agent-governance-check.ps1` | all assertions passed（含 11 個內嵌 node --test 子測試 pass / 0 fail） | 163 | 0 |
| 2 | `verify-governance-policy` | `pwsh … scripts/tests/verify-governance-policy.ps1` | policy: 37 rules, 0 error, 0 warning | 3 | 0 |
| 3 | `test-agent-governance-policy` | `pwsh … scripts/tests/test-agent-governance-policy.ps1` | all 106 assertions passed | 2 | 0 |
| 4 | `test-self-referential-bootstrap` | `pwsh … scripts/tests/test-self-referential-bootstrap.ps1` | all assertions passed | 28 | 0 |
| 5 | `test-base-gate-capability` | `pwsh … scripts/tests/test-base-gate-capability.ps1` | all assertions passed | 151 | 0 |
| 6 | `test-openspec-ledger-reconciliation` | `pwsh … scripts/tests/test-openspec-ledger-reconciliation.ps1` | all assertions passed | 255 | 0 |
| 7 | `test-openspec-machine-truth` | `node --test scripts/tests/test-openspec-machine-truth.mjs scripts/tests/test-openspec-machine-truth-cli.mjs` | 51 pass / 0 fail | 38 | 0 |
| 8 | `test-pr-body-evidence` | `pwsh … scripts/tests/test-pr-body-evidence.ps1` | all assertions passed | 11 | 0 |
| 9 | `invoke-powershell-static` | `pwsh … scripts/tests/invoke-powershell-static.ps1` | passed | 5 | 0 |
| 10 | `agent-governance-shard-coverage` | `pwsh … scripts/tests/test-agent-governance-check.ps1`（承載 shard 覆蓋斷言，依 contract 單獨記一條 exit code） | all assertions passed | 133 | 0 |

指令對照取自 `scripts/tests/test-self-referential-bootstrap.ps1` 的 immutable command map，非自行拼寫。

## 這次重驗回答的正是 opening reason 的循環

Entry 的 reason 指出：required context `agent-governance` 由 `pull_request` 事件執行 PR 自己樹上的 workflow，因此 #637 自己的綠燈是自證；base-owned 的 `pr-review-agent.yml` 固定 checkout `base.sha`，base 樹上既沒有 shard 結構也沒有 shard 覆蓋斷言。本次重放在 **merge 後的 first-parent mainline commit** 上執行**變更後**的 `test-agent-governance-check.ps1`（承載 §2.4 新增的 `agent-governance-shard-coverage` 斷言），逐項通過：`jobs.suite` 宣告 shard matrix 且 `fail-fast: false`、shard 名稱唯一；**每個帶 `run` 的 step 都必須帶 `if: matrix.shard == '<已宣告 shard>'`**（缺 `if`／打錯 shard 名即 throw，這正是分片唯一新增的「四片都 skip 而全綠」靜默漏跑失效模式）；step name 唯一以維持可計數；兩個 setup step（Checkout／Setup pinned Node.js）**不得**綁定單一 shard；run step 數 **ratchet ≥ 31**；每個宣告的 shard 至少跑一步；五個重步驟（governance static check→`core`、OpenSpec ledger reconciliation／machine-truth→`openspec`、base-gate capability→`capability`、self-referential bootstrap→`evidence`）釘在預期 shard。

於 mechanism commit 實測解析結果：run steps **31**，分佈 `core` 13／`evidence` 13／`openspec` 4／`capability` 1，setup steps 恰為 `Checkout` 與 `Setup pinned Node.js for governance tests` 且皆未綁 shard。

誠實界定：此斷言證明的是「沒有 run step 落在無法到達的 shard、也沒有 run step 少於 31 個」，**不是**對分片前 workflow 逐字做集合比對——後者是 #637 branch 上的一次性 V1 腳本（`self-referential-bootstrap/shard-coverage.txt`）所做，本 fixpoint 不重複主張其結論。

## 附帶實證（hosted 分片 wall-clock，首次真實觀測）

opening 時只有本機推估；#637 的 required check 現已提供 hosted windows-latest 實測，四片並行且 `fail-fast: false`：

| leg | 實測 |
|---|---:|
| `agent-governance suite (core)` | 1m40s |
| `agent-governance suite (evidence)` | 2m6s |
| `agent-governance suite (openspec)` | 2m51s |
| `agent-governance suite (capability)` | 3m7s |

決定 wall-clock 的是 `capability` 的 **187s**，對照分片前實測的 471s → **−284s（−60%）**。publisher `agent-governance` 仍在四片全綠後 5s 內出票，needs 圖與 fail-closed 語意未變。

已知未主張（deliberately not claimed）：pip／npm／Playwright cache 的 hit rate 與 Windows runner 計費秒差額屬 hosted 觀測，本地重放不產生該數據，本 fixpoint 不宣稱。

過程未讀取 credential、未做任何 live mutation、未觸碰部署區或生產狀態。
