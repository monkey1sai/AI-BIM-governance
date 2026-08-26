# 任務：P3 Slice 4 — Window.tsx 容器化與全面組裝收斂 (Issue #610)

## Objective (目標)
- 完成 P3 最終階段 Slice 4：將 web-viewer-sample/src/Window.tsx (Issue #610) 容器化。
- 正式裝配 ViewportHost (Issue #607)、ViewerToolbar (Issue #605)、GovernancePanel (Issue #608) 與 useUsdStageTree (Issue #609)。
- 達成 0 回歸與 Clean Architecture，並以 Superpowers 完整生命週期交付合入 main。

## Plan (執行計畫)
- [x] 1. 建立 P3 Slice 4 實施計畫 (docs/superpowers/plans/2026-08-26-p3-slice4-window-containerization.md)。
- [ ] 2. 建立 Dedicated Git Worktree (../AI-BIM-governance.worktrees/p3-slice4-window-containerization) 與分支 feat/p3-slice4-window-containerization。
- [ ] 3. 於 web-viewer-sample 進行 Window.tsx 容器化重構與組裝。
- [ ] 4. 驗證 TypeScript 編譯與本地 Preflight 檢查。
- [ ] 5. 提交 Git Commit 並 Push 分支至遠端 GitHub。
- [ ] 6. 開立 Pull Request。
- [ ] 7. 執行 Code Review 與 Blip Approval。
- [ ] 8. Merge PR 至 main 分支。
- [ ] 9. 收斂分支並清理 Worktree。

## Context & Thoughts (上下文與思考)
- 遵循 Single Active Writer 與單 PR 交付原則。
- 採用絞殺者模式進行容器化裝配，保持既有 WebRTC、Socket.IO 與 DataChannel 介面相容。

## Handoff Note (交接說明)
- 正在建立專屬 Worktree 進行 Window.tsx 容器化重構。
