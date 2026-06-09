# Tasks — unified-console-issues-tab（完整問題分頁重構）

> done = browser E2E（分頁切換 live 驗）+ harness 不空白回歸。誠實：無 GPU 時治理 rule-run/issue/BCF 可用、3D 高亮誠實降級。

## 1. 分頁重構

- [x] 1.1 `Window.tsx`：`viewerTab: "model"|"issues"` 狀態 + 頂部分頁列（lift CH-H1b section nav 至 viewer 層；gitnexus_impact RK5）
- [x] 1.2 `GovernanceOverlay.tsx` `variant?: "overlay"|"panel"` + `overlay.css` `.gov-overlay--panel`（全幅 relative，不改既有 overlay 行為/props/spectator）
- [x] 1.3 `MockViewport.tsx`：section nav 移至 Window（問題分頁隱 MockViewport 後仍可切回）；模型分頁顯 MockViewport、問題分頁隱
- [x] 1.4 問題分頁無 live 3D 幀亦可操作治理（rule-run 經 for-session / issue/BCF 經 proxy）；3D 高亮需 DataChannel → 誠實降級；spectator 三層權威保留

## 2. 驗證（真實資料 + live e2e）

- [x] 2.1 `web-viewer-sample` `npx tsc --noEmit` 0 + `npm test` 綠
- [x] 2.2 E2E `issues-tab.spec`：真實 session 開 viewer → 切「問題」分頁 → 全幅治理面板出現（rule-run 控制可見）→ 切回「模型」→ 語意檢視；`gov-viewer-layout` harness 不空白回歸
