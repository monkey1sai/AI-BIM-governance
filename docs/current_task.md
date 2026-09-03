# 任務：Stage 1.3 — 3D 工作區 ViewportHost 後續收尾（協定演進與真值打通）

## Objective (目標)
- 接續 PR #763 (S3a+S3b) ViewportHost 落地成果，推進 3D 工作區的三大協定缺口：
  1. **Stage 樹真實資料讀取 (Issue #609)**：演進 `vg01` postMessage 協定，打通 Kit DataChannel `getChildrenRequest` / `getChildrenResponse` 到 Console 端的通道，解鎖左欄 Stage 樹。
  2. **Kit 多色 Prim 高亮 (Issue #603)**：推動多色 Prim 高亮協定，打通 `highlightPrimsRequest` 中的 RGBA color 欄位至 Kit messaging 著色邏輯。
  3. **工具列指令 Bridge (Issue #605)**：解除視角（⬒）、全螢幕（✥）、重置（⟲）的結構性封鎖，建立 Console ➔ Viewer ➔ Kit 的控制命令通道。

## Plan (執行計畫)
- [x] **Step 1：協定契約盤點與設計 (vg01 + kit-datachannel)**
  - 檢視 `tests/contracts/vg01-postmessage-v1.schema.json` 與 `tests/contracts/kit-datachannel-v1.schema.json`
  - 設計 `stage_tree_query` / `stage_tree` 在 `vg01` 的事件模型，擴充 `request_stage_tree`, `stage_tree`, `select_prim`, `toolbar_action`
  - 擴充 `bridgeHighlightItem` 支援 `color: [number, number, number, number]` 多色高亮 RGBA
  - 在 `tests/test_runtime_command_contracts.py` 新增契約驗證並通過 (25/25 passed)
- [x] **Step 2：Viewer 與 Console 端橋接實作**
  - 在 `web-viewer-sample/src/Window.tsx` 實作 vg01 `request_stage_tree`, `select_prim`, `toolbar_action` 接收，並在 `getChildrenResponse` 時向 parent post `stage_tree`
  - 在 `web-viewer-sample/src/console/EmbeddedViewer.tsx` 擴充 handle 與 callback
  - 在 `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx` 與 `WorkspaceViewportHost.tsx` 穿透轉發
  - 在 `web-viewer-sample/src/console/unified/viewportSlot.ts` 與 `ViewportSlotProvider.tsx` 暴露 `stageTree` 狀態與 host actions
  - 在 `web-viewer-sample/src/console/unified/WorkspacePage.tsx` 連接 `useUsdStageTree`，有真樹資料時轉為 active 展示真實 Prim 樹（支援搜尋、展開、選取 focus），並新增工具列控制按鈕（⬒ 視角、✥ 全螢幕、◫ 投影、⟲ 重置）
  - 在 `web-viewer-sample/src/console/governance/highlightBridge.ts` 支援自訂 RGBA color 高亮
- [x] **Step 3：單元測試與契約測試驗證**
  - Python 契約測試：`.venv\Scripts\python.exe -m pytest tests/test_runtime_command_contracts.py` 25/25 通過
  - 前端型別檢查：`npm run typecheck` 通過
  - 前端建置驗證：`npm run build` 通過
  - 前端單元測試：`npm test -- src/console/unified/` 15/15 測試套件全數通過 (76 passed)
  - 前端契約測試：`npm test -- src/console/windowParentMessage.dom.test.tsx` 182/182 通過
  - 新增整合測試：`src/console/unified/workspaceStageTree.test.tsx` 2/2 通過
- [x] **Step 4：收尾總結與交接準備**
  - 驗證改動隔離、無破壞性變更、向後相容性 100% 保持
  - 更新並行看板與交接文檔

## Context & Thoughts (跨 CLI 治理與架構上下文)
1. **獨立 Worktree 隔離**：本任務在 `AI-BIM-governance.worktrees/stage-tree-protocol-evolution` 獨立進行，主工作區維持乾淨。
2. **三方並行分工**：
   - Codex：階段 1.1 (PR #733 綁定 spec-to-done 與 Fabric)
   - Claude：階段 1.2 (Unified Console Runtime Truth 數據真值)
   - AGY：階段 1.3 (3D 工作區 Stage 樹、多色高亮與工具列協定演進)
3. **安全與相容性約束**：
   - 擴充 `vg01` postMessage 時必須保證與既有事件（`highlight`, `focus`, `viewer_ready`, `first_frame` 等）向後相容。
   - 嚴格遵守 `AGENTS.md` 後端凍結面與 R1–R4 鐵律。
