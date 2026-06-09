## Context

本 change 的輸入是 Claude outputs 內的 `ai-bim-governance-prototype.html` 與 `ai-bim-governance-設計規格.md`。prototype 已定義完整產品 shell：top runtime bar、left grouped navigation、center workspace、right Chat USD Agent，以及 A1-A10、3D Viewer、Coordinator、MinIO、Session、Kit/GPU、Runtime/Admin/Reports 的互動語彙。

目前 repo 內已有兩個 console 方向：

- `EdgeConsole.tsx`：較接近完整產品操作台，已具備三欄 shell、FlowBar、Chat USD Agent placeholder、A1-A10 application cards、A4-A10 vision details、A1/A2/A3/semantic/runtime/review 頁。
- `OperatorConsole.tsx`：目前 `/ui` 實際掛載的舊 operator shell，偏六頁 console，未完整呈現 prototype 產品資訊架構。

此 change 採取「保留既有功能，整合到完整產品 shell」策略，而不是把 prototype HTML 逐字照搬成靜態頁。

## Goals / Non-Goals

**Goals:**

- `/ui` 與 `/console` 掛完整 `EdgeConsole`，讓 operator 看到完整 AI-BIM Governance 操作台。
- 左側導覽符合 prototype 分群：工作台、核心治理、Omniverse Runtime、落地端控制台、System。
- A1-A10 均有頁面：A1-A3 優先串接既有已實作能力，A4-A10 誠實標願景 / 後端未建。
- 3D Viewer 頁明確說明 live viewport 在既有 viewer，列出 openStage、focusPrim、selectPrims、clearHighlight、highlightPrimsRequest、DataChannel evidence 與尚未建能力。
- Coordinator 落地端頁面包含 conversion scheduling、session management、Kit/GPU fleet、MinIO data，並以 existing `/api/runtime/status` 與 `/api/external/ifc-ready` 優先供資料，缺口誠實標示。
- 完成 Vitest、Vite build、browser E2E，保存 screenshots / logs。
- 執行 Docker web + Nvidia Kit / OS runtime rebuild 或啟動驗證；若環境缺依賴或 GPU/Kit 不可用，保留具體命令與失敗證據，不宣稱完成。

**Non-Goals:**

- 不實作新的 IFC→USDC heavy conversion。
- 不在 coordinator 直接操作 Kit process、GPU endpoint pool restart/release。
- 不在 console 內重新渲染 WebRTC viewport；viewer 仍由既有 `<App/>` / `Window.tsx` 負責。
- 不實作真正 A4-A10 backend、MCP/NeMo tool execution、Isaac Sim、Replicator、Reality Capture pipeline。
- 不把 MinIO browser 做成真實 S3 client；第一版顯示資料模型、job relationship、待建狀態與已知 bucket layout。

## Decisions

1. `/ui` 使用 `EdgeConsole`，保留 `OperatorConsole` 元件但不再作為主入口。
   - 原因：`EdgeConsole` 已承接完整產品 shell 與 A1-A10資料；`OperatorConsole` 是舊六頁殼層。
   - 替代方案：重寫新 shell。拒絕，因為會丟失已存在功能與測試。

2. 新頁面以 React component 實作，資料放在 `data.ts`。
   - 原因：現有 console 已用 `data.ts` 作 source-of-truth，`pages.tsx` 作頁面組合。
   - 替代方案：直接嵌入 prototype HTML。拒絕，因為會失去既有 API 串接與 provenance 系統。

3. 頁面中的未建能力一律顯示 disabled / roadmap / 後端待建。
   - 原因：AGENTS 要求 user-facing capability 不得以 demo 假裝完成。
   - 替代方案：用前端 state 模擬可用。只允許在明確標示示範資料時使用，不作為完成證據。

4. E2E 驗證分層。
   - Unit/render：Vitest 檢查頁面與 provenance。
   - Build：`npm run build:ui` 產生 `/ui/` bundle。
   - Browser：Playwright 打開 `/ui` 與主要 route，檢查 DOM、console、screenshot。
   - Runtime：Docker / Kit 啟動或 rebuild，用前端操作證據驗證；若 host GPU/Kit 不可用，保存 error card。

## Risks / Trade-offs

- [Risk] prototype scope 很大，A1-A10 全部真後端不可一次完成 → Mitigation：前端整合完整，但 provenance 明確區分已實作 / 願景。
- [Risk] `/ui` 切換到 `EdgeConsole` 可能破壞舊六頁 operator route → Mitigation：保留 hash route alias，新增 routing tests，並讓重要舊頁對應到新 IA。
- [Risk] Docker / Kit rebuild 可能受本機 GPU、NVIDIA driver、Docker daemon、Kit license / cache 影響 → Mitigation：先跑 build/health，保存命令、log、screenshot；不可用時不宣稱 full-system E2E complete。
- [Risk] 前端頁面過多導致單檔膨脹 → Mitigation：本 change 先跟隨既有 `pages.tsx` pattern，後續可再拆 component，避免本輪引入大重構。
