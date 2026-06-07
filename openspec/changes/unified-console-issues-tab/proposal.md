## Why

`unified-console-semantic-viewer` 已交付範本 6 面板語意 viewer（CH-H1a/CH-H2）+ CH-H1b section nav，但 A1/A2/A3 治理操作仍只在固定右側 340px `GovernanceOverlay`，未如北極星 IA（`frontend-redesign-ia-and-phases.html`）把「模型(語意檢視)」與「問題(治理操作)」分頁。本 change 完成 CH-H1b 餘項：把 section nav 升級為真實分頁，「問題」分頁將既有 `GovernanceOverlay`（rule-run/失敗構件→3D 高亮/issue/BCF/BindingComposer）以全幅面板呈現，與「模型」分頁的語意檢視切換。

## What Changes

- **Window.tsx**：新增 `viewerTab: "model" | "issues"` 狀態 + 頂部分頁列（lift CH-H1b 的 section nav 至 viewer 層）。「模型」顯 MockViewport/live 3D（語意檢視）；「問題」隱 MockViewport、以全幅呈現 `GovernanceOverlay`。治理操作無需 live 3D 幀亦可用（rule-run 經 coordinator for-session、issue/BCF 經 governance proxy；3D 高亮仍需 DataChannel，誠實降級）。
- **GovernanceOverlay.tsx**：新增 `variant?: "overlay" | "panel"`，`panel` 時改用全幅 className（不改既有 overlay 行為、props、spectator 三層權威）。
- **overlay.css**：新增 `.gov-overlay--panel`（relative/全幅）。
- **MockViewport.tsx**：section nav 移至 Window 分頁列（避免「問題」隱藏 MockViewport 後 nav 消失無法切回）。
- E2E：分頁切換（模型↔問題）live 驗 + harness 不空白回歸。

## Capabilities

### New Capabilities

- None。

### Modified Capabilities

- `unified-governance-console`：新增可驗收 requirement（viewer 模型/問題 分頁；問題分頁全幅治理；無 GPU 亦可操作治理；spectator 權威保留）。

## Impact

- Owner：`web-viewer-sample/src/Window.tsx`（RK5 HIGH，先 gitnexus_impact，additive 分頁狀態 + 條件）、`console/GovernanceOverlay.tsx`（+variant）、`console/governance/overlay.css`、`console/viewer/MockViewport.tsx`（移 nav）、`e2e/`。
- API/boundary：無變更（前端只打 :8004；governance 經既有 proxy）。無新增 prod 依賴。
- 驗證：viewer tsc/vitest + Playwright（分頁切換 + harness 回歸）；以真實 session live e2e 佐證。
- Non-goals：不改 GovernanceOverlay 內部 A1–A10 邏輯；不動 streaming/coordinator data shape。
