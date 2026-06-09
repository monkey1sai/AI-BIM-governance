## Why

目前 `web-viewer-sample` 已有多個已實作治理頁與 runtime 頁，但實際 `/ui` 操作入口仍偏局部 console，沒有完整承接 `ai-bim-governance-prototype.html` 中 A1-A10、3D Viewer、MinIO、Session、Kit/GPU 機隊與右側 Chat USD Agent 的產品級資訊架構。這讓已完成能力與重構後整合狀態分散，operator 無法用一個前端操作台完成可驗證流程。

## What Changes

- 將 `web-viewer-sample` 的 `/ui` / `/console` operator frontend 整合成完整 AI-BIM Governance 操作台。
- 保留並串接既有已實作功能：A1 rule-run、A2 version diff、A3 federation、semantic viewer、runtime/status、review viewer open handoff、ifc-ready job list。
- 補齊 prototype 描述的頁面骨架與操作語彙：A1-A10 用途、3D Viewer 呈現功能、IFC→USD 轉檔排程、Session 管理、Kit/GPU 機隊、MinIO 資料、Runtime/Admin/Reports。
- 每個功能區塊必須用 provenance 誠實標示 `已實作`、`實測 artifact`、`示範資料`、`後端待建` 或 `願景`，不得把未建後端當成可用功能。
- 重建 web frontend 與 Docker / host-native Nvidia Kit runtime 相關環境，產出可前端操作的 E2E 證據。
- 不新增 production dependency；沿用 React/Vite、既有 coordinator client、governance client、Playwright / Vitest 驗證。

## Capabilities

### New Capabilities
- 無。此 change 不新增新服務能力，而是把既有 console/frontend 能力整合成產品級操作台。

### Modified Capabilities
- `unified-governance-console`: 補充完整 AI-BIM Governance 操作台前端資訊架構、A1-A10 頁面呈現、3D Viewer 功能矩陣、Coordinator/MinIO/Session/Kit-GPU operator flows。
- `docker-web-plane-host-native-kit`: 補充本 change 的 rebuild 與 E2E 證據要求，確認 web bundle 與 Nvidia Kit runtime 可從前端操作驗證。

## Impact

- Repo/folder owner：`web-viewer-sample/src/console/*` 擁有 browser UI 與 user interaction。
- 可能觸及：`web-viewer-sample/src/main.tsx`、`console/routing.ts`、`console/EdgeConsole.tsx`、`console/pages.tsx`、`console/data.ts`、`console/edge-console.css`、console tests、E2E scripts/artifacts。
- 不改：`bim-review-coordinator` 的 session/lifecycle/lease/audit 權威、不把 coordinator 做成 GPU process manager。
- 不改：`bim-streaming-server` 的 IFC→USDC conversion、Kit/WebRTC/USD runtime 內部實作。
- 不改：`services/kit-manager-api` 的 Kit process / endpoint pool restart/release 執行權威；前端只能顯示狀態或未來送 audited intent。
- API 邊界：browser 只打 coordinator / existing proxy / browser-visible viewer URL；不直連 `:49100` / `:49101` / `:49102`。
