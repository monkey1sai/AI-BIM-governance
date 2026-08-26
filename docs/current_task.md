# 任務：P4 核心業務能力爆發與 P1~P3 全面 Code Review & Fix

## Objective (目標)
- 啟動 P4：以三層交叉對抗驗證實作 3D 測量 (Issue #604)、剖切盒 (Issue #603)、構件著色與 BCF 議題連動。
- 執行 P1~P3 全面 Code Review 與強化修復（PR Queue 智能自動修復、組件健全度提升）。
- 嚴格遵守 Lean Governance 方針，在單一 PR 內同時交付並通過 CI 合入 main。

## Plan (執行計畫)
- [x] 1. 完成三層交叉對抗驗證分析並建立 P4 實施計畫 (docs/superpowers/plans/2026-08-26-p4-business-capabilities-and-p1-p3-review-fixes.md)。
- [ ] 2. 建立 Dedicated Git Worktree (../AI-BIM-governance.worktrees/p4-business-capabilities-and-review-fixes) 與分支 feat/p4-business-capabilities-and-review-fixes。
- [ ] 3. 實作 P4 業務能力：擴充 streamMessages (3D 測量、剖面、著色請求)、強化 useUsdStageTree 與 GovernancePanel 3D 連動。
- [ ] 4. 實作 P1~P3 Code Review 修復：強化 manage-pr-queue.mjs (自動修補 metadata)、補強 ViewportHost、ViewerToolbar 與 healthProbeRoutes。
- [ ] 5. 執行 sub-repo 測試套件（Coordinator 1573 筆、Governance 301 筆、Layer Contract 79 筆）與本地 preflight。
- [ ] 6. 提交 Git Commit 並 Push 分支至遠端 GitHub。
- [ ] 7. 開立 Pull Request (Single PR)。
- [ ] 8. 執行 Code Review 與 Blip Approval。
- [ ] 9. GitHub Actions 23 項 CI 全綠，Squash Merge 至 main。
- [ ] 10. 收斂分支並清理 Worktree。

## Context & Thoughts (上下文與思考)
- 採用三層交叉對抗驗證（實作邊界、串流狀態機、工程治理）指導開發。
- 保持 DataChannel、WebRTC 與 REST API 1:1 向後相容。

## Handoff Note (交接說明)
- 正在建立 Worktree 推進 P4 業務與 P1~P3 Review 修復。
