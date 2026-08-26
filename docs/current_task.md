# 任務：實施「元治理減法」（Lean Governance & Subtraction）

## Objective (目標)
- 針對專案中過度繁重、阻礙開發效率的「元治理 (Meta-Governance)」機制進行減法改動。
- 廢除 3-PR Demote/Reapprove 繁瑣流程，改為單 PR 交付。
- 凍結元治理工具的自我修復無限循環（禁止 Agent 自動開立 fixpoint/classifier/ledger 純治理 PR）。
- 放寬開發期前端 Design Gate 的過度嚴苛限制（從 1% pixel diff 轉為以 Functional & Semantic E2E 為主）。
- 確立 Single Active Writer 原則，根除多 Agent 搶 main 導致的 stale base 與 lock 衝突。
- 透過 git worktree + new branch 進行變更，完成 commit、push、open PR 並 merge to main。

## Plan (執行計畫)
- [x] 1. 建立 Dedicated Git Worktree (`C:\Repos\active\iot\AI-BIM-governance.worktrees\lean-governance-subtraction`) 與分支 `chore/lean-governance-subtraction`。
- [x] 2. 修改 `AGENTS.md`：引入 Lean Governance & Subtraction 指令。
- [x] 3. 修改 `CLAUDE.md`：同步更新精簡治理規範。
- [x] 4. 修改 `docs/agents/github-workflow.md` 與 `docs/agents/agent-governance-policy.md`：更新單 PR 交付與治理減法方針。
- [x] 5. 執行本地驗證檢查，確保無語法或格式錯誤。
- [x] 6. 提交 Git Commit。
- [x] 7. Push 分支至遠端 GitHub。
- [x] 8. 建立 Pull Request（PR #706）。
- [x] 9. 執行 blip-approve 並完成 Merge PR 至 main 分支。
- [x] 10. 收斂並更新任務狀態與清理 Worktree。

## Context & Thoughts (上下文與思考)
- 專案分析顯示：專案開發緩慢的主要瓶頸不是業務邏輯複雜，而是治理系統本身過於龐大脆弱（scripts 目錄 180MB、openspec 近 800 檔），近 7 成 PR 全在修治理工具（fixpoint/classifier/ledger/watermark）。
- 透過本次減法改動，建立明確的 Lean Mode，讓所有 AI Agent（Codex、Claude、CLI、Gemini）將焦點徹底轉移回 BIM 核心業務價值（IFC 轉檔、A1~A10 規則檢核、WebRTC 3D 串流）。

## Handoff Note (交接說明)
- 任務已全部圓滿完成！PR #706 已獲 `monkey1sai-blip` 批准並成功 squash merge 至 `main` 分支（commit `2a759f4`）。
- 本地 `main` 分支已完全對齊最新主線，臨時 worktree 與分支已收斂清理完畢。
