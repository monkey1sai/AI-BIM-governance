# 任務：實施 P2 技能庫整理與 PR 佇列全自動化管理機制 (Auto-PR Manager)

## Objective (目標)
- 建立全自動化 PR 佇列管理引擎 (scripts/dev/manage-pr-queue.mjs) 與 Agent 專用技能 (pr-queue-manager)。
- 實現四大核心自動化能力：
  1. **Auto-Update Branch**：自動偵測落後於 origin/main 的 PR 並自動 rebase/update。
  2. **Auto-Resolve Conflict**：自動識別非業務語意檔案（如 docs/current_task.md、manifest 等）並安全解衝突。
  3. **Auto-Fix**：自動修復 PR Metadata 表格缺失、格式錯誤與本地 Preflight 檢查。
  4. **Auto-Merge**：自動進行 counted blip 審批、輪詢 CI 檢查，綠燈後自動執行 Squash Merge 與 Worktree 收斂。
- 遵照 Superpowers 完整生命週期：開案 -> Dedicated Worktree -> 實作與驗證 -> PR -> Code Review -> Merge to main。

## Plan (執行計畫)
- [x] 1. 建立 P2 實施計畫 (docs/superpowers/plans/2026-08-26-p2-pr-queue-automation.md)。
- [x] 2. 建立 Dedicated Git Worktree (../AI-BIM-governance.worktrees/pr-queue-automation-and-p2-skills) 與分支 feat/pr-queue-automation-and-p2-skills。
- [x] 3. 實作 scripts/dev/manage-pr-queue.mjs (status, update-branch, auto-resolve-conflict, auto-fix, approve, merge, process-queue)。
- [x] 4. 建立 pr-queue-manager 技能並註冊至 agent-skills-manifest.json，通過 sync-agent-skills check (valid: true)。
- [x] 5. 本地 preflight 驗證與檢查。
- [ ] 6. 提交 Git Commit 並 Push 分支至遠端 GitHub。
- [ ] 7. 開立 Pull Request。
- [ ] 8. 執行 Code Review 與 Approval。
- [ ] 9. Merge PR 至 main 分支。
- [ ] 10. 收斂分支並清理 Worktree。

## Context & Thoughts (上下文與思考)
- 遵循 Single Active Writer 與單 PR 交付原則。
- 透過 manage-pr-queue.mjs，賦予所有 Agent 對 PR 佇列的全自動化管理能力（auto-update, auto-fix, auto-approve, auto-merge）。

## Handoff Note (交接說明)
- 本地實作與技能庫完整性檢查皆已綠燈通過，準備進行 Commit、Push 與 Open PR。
