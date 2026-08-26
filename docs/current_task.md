# 任務：P3 巨石單檔領域架構重構 (Slice 1 to Slice 3)

## Objective (目標)
- 推進 P3 巨石單檔領域架構重構（Coordinator app.ts 4.6k行與 Viewer Window.tsx 5.8k行）。
- 涵蓋 Slice 1 (Coordinator 路由解耦)、Slice 2 (Viewer useUsdStageTree Hook & ViewportHost)、Slice 3 (ViewerToolbar & GovernancePanel)。
- 嚴格遵守 Lean Governance 與 0 回歸保證（Coordinator 1,573 筆測試 100% 通過）。

## Plan (執行計畫)
- [x] 1. 建立 P3 實施計畫 (docs/superpowers/plans/2026-08-26-p3-architectural-refactoring-slice1-to-slice3.md)。
- [x] 2. 建立 Dedicated Git Worktree (../AI-BIM-governance.worktrees/p3-architectural-refactoring) 與分支 feat/p3-architectural-refactoring。
- [x] 3. 實作 Slice 1 (Coordinator 模組化子路由抽離：streamConfigRoutes, healthProbeRoutes 並掛載至 app.ts)。
- [x] 4. 驗證 Coordinator 1573 筆測試 100% 全綠與 TypeScript 編譯。
- [x] 5. 實作 Slice 2 (Viewer useUsdStageTree Hook & ViewportHost 組件 - Issue #609, #607)。
- [x] 6. 實作 Slice 3 (ViewerToolbar & GovernancePanel 組件 - Issue #605, #608)。
- [x] 7. 本地 preflight 驗證與檢查。
- [ ] 8. 提交 Git Commit 並 Push 分支至遠端 GitHub。
- [ ] 9. 開立 Pull Request。
- [ ] 10. 執行 Code Review 與 Approval。
- [ ] 11. Merge PR 至 main 分支。
- [ ] 12. 收斂分支並清理 Worktree。

## Context & Thoughts (上下文與思考)
- 採用三層交叉對抗驗證分析與絞殺者模式進行漸進式重構。
- 保持外部契約（REST API :8004、DataChannel、WebRTC）1:1 相容。
- 後端 100 個測試檔、1,573 筆測試全數通過，無任何功能回歸。

## Handoff Note (交接說明)
- Slice 1、Slice 2 與 Slice 3 重構代碼已就緒，準備開立 PR 並審批合入。
