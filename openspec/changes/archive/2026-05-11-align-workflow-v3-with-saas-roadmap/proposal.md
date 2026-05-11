## Why

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（PR #8 引入的 v3）與 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`（PR #22 同步至 commit `193850f`）是 repo 內兩份分別描述「開發流程」與「SaaS 技術規劃」的長文件，原本互不引用且使用不一致的 OpenSpec 候選命名（例如 `ifc-to-usdc-real-converter` vs `worker-real-conversion-quality`、`gpu-kit-pool-scheduler` vs `streaming-multi-instance-orchestration`）。這會讓讀者誤以為兩條獨立路線，並把 spec id 雙軌化。

本 change 並不修改任何 capability 規格；它把兩份文件的角色分工確定下來，並在 `main` 上補上 cross-reference，避免後續工作把它們當成競爭文件。實質實作工作中的 workflow v3 對齊由 PR #8 在 cursor 分支同步進行（commit `3e2eedc`），不在本 change 範圍。

## What Changes

- 在 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §1（現況基線）補上一段指向 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 的 cross-reference，把「開發流程入口」明確指給 workflow v3，roadmap 自身則保留為「技術決策／OpenSpec 候選權威」。
- 在 `README.md` 補上「兩份長文件分工說明」段落，讓新進讀者從 repo 入口就能對齊：workflow v3 = 流程入口；SaaS 路線圖 = 候選 / 採用決策 / 硬體權威。
- 不修改任何 `openspec/specs/<capability>/spec.md`。
- 不修改任何服務程式碼、contract 或 verification 報告。

## Capabilities

### New Capabilities

- `documentation-source-of-truth`：明確 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v3）與 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`（SaaS 路線圖）互補不替代的分工權威；後續分工調整必須走 OpenSpec change；雙向 cross-reference 必須持續成立。

### Modified Capabilities

- None.

## Impact

- 純 documentation / planning artifact 變動；不影響任何服務 runtime、API、storage、Socket.IO event。
- 不修改任何現有 `openspec/specs/<capability>/spec.md`；本 change 新增的 `documentation-source-of-truth` capability 只定義文件治理規則，不影響任何程式行為。
- 本 PR 順便修正 main `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §1.2 / §1.4 既有的 staleness：補上 `runtime-verification-task-status` capability row（PR #20 之後 main 上實際有 10 個 capability 但 §1.2 仍說 9 個）以及 `2026-05-08-fix-runtime-verification-task-status` archived change row（§1.4 只列 4 個但 main archived 實際 5 個）。
- 不新增 dependency、不影響 GitNexus 圖譜中的程式碼節點。
- **Merge order 為強依賴**：本 PR 引用 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md`，但該檔案目前只在 PR #8（`cursor/fix/date---feature/fix/issue/project-development-workflow-877a` 分支，head `3e2eedc`）上。**PR #8 必須先 merge 進 main，本 PR 才能 merge**；否則 main 上會立刻產生 dead link，並違反本 PR 自身新增的 `documentation-source-of-truth` capability「Requirement: workflow v3 與 roadmap 互相 cross-reference 持續成立」+「Scenario: cross-reference 被誤刪」。
- archive 後本 change 將進入 `openspec/changes/archive/<YYYY-MM-DD>-align-workflow-v3-with-saas-roadmap/`，未來 roadmap / workflow v3 任何分工調整都應以對應新 OpenSpec change 處理，不直接在 main 上覆蓋。
