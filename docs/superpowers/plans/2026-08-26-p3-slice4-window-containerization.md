# P3 Slice 4: Window.tsx 容器化收斂實施計畫 (Issue #610)

> **Implementation authorization:** 本計畫落實 P3 階段最終切片 Slice 4：將 Window.tsx (Issue #610) 容器化，將已抽離的 ViewportHost (Issue #607)、ViewerToolbar (Issue #605)、GovernancePanel (Issue #608) 與 useUsdStageTree (Issue #609) 正式裝配組裝，達成架構徹底解耦與 0 功能回歸。

**目標:**
1. 在 web-viewer-sample 中將 Window.tsx 重構為清晰的容器組件 (Orchestrator Container)。
2. 將 3D 視圖渲染區塊委派給 ViewportHost。
3. 將視角操作工具列委派給 ViewerToolbar。
4. 將 A1~A10 規則檢核與 BCF 議題介面串接至 GovernancePanel。
5. 通過 TypeScript 編譯與本地 Preflight 檢查，以 Superpowers 生命週期交付至 main。

## 執行進度清單
- [ ] Step 1: 建立 Dedicated Git Worktree (../AI-BIM-governance.worktrees/p3-slice4-window-containerization)
- [ ] Step 2: 在 web-viewer-sample 進行 Window.tsx 容器化組裝與重構
- [ ] Step 3: 本地 build 與 preflight 驗證
- [ ] Step 4: 提交 Commit 並 Push 分支
- [ ] Step 5: 開立 PR、Blip Approval、CI 通過與 Squash Merge
- [ ] Step 6: 收斂分支與清理 Worktree
