# 任務：實施 Phase 1 治理減法深化、環境修復與倉庫衛生健全化

## Objective (目標)
- 基於三層交叉對抗驗證分析報告，執行 Phase 1 快速落地改善：
  1. 修復 Python 虛擬環境與 governance-service 測試收集問題 (補齊 openpyxl 等依賴)。
  2. 清理過期 Worktree 註冊與無效殘留 (釋放磁碟空間)。
  3. 建立 Phase 1 實施計畫與文檔同步。
  4. 遵照 Superpowers 流程完整閉環：開案 -> 建立 Worktree 分支 -> 實作與本地驗證 -> 開立 PR -> Code Review -> Merge to main -> 收斂分支。

## Plan (執行計畫)
- [x] 1. 產出三層交叉對抗驗證分析報告與開案計畫 (docs/superpowers/plans/2026-08-26-phase1-lean-hygiene-and-env-repair.md)。
- [x] 2. 建立 Dedicated Git Worktree (../AI-BIM-governance.worktrees/phase1-lean-hygiene-and-env-repair) 與分支 chore/phase1-lean-hygiene-and-env-repair。
- [x] 3. 修復 Python 虛擬環境依賴 (安裝 openpyxl)，執行 governance-service 測試驗證全通 (301 passed)。
- [x] 4. 執行 git worktree prune 與過期資源清理。
- [x] 5. 本地 preflight 驗證與檢查。
- [ ] 6. 提交 Git Commit 並 Push 分支至遠端 GitHub。
- [ ] 7. 開立 Pull Request。
- [ ] 8. 執行 Code Review 與 Approval。
- [ ] 9. Merge PR 至 main 分支。
- [ ] 10. 收斂分支並清理 Worktree。

## Context & Thoughts (上下文與思考)
- 遵循 Single Active Writer 與單 PR 交付原則。
- 不引入過度繁瑣的元治理中斷點，以真實功能與環境測試通過為唯一驗收標竿。

## Handoff Note (交接說明)
- 已完成 Phase 1 本地改動與依賴測試全通驗證，正在進行 Commit、Push 與 Open PR。
