## Why

A1–A10 應用需要一個落地端操作介面，讓操作員在落地端電腦上實際使用與驗證。A1（治理與模型檢核）的 rule-run authority 後端已實作（change `governance-rule-run-service`），但目前**沒有任何前端介面**可在瀏覽器觸發 / 檢視 A1 結果；A2 / A3 也缺入口。本 change 以設計原型「06 操作介面總覽」為骨架，在真實前端 `web-viewer-sample` 落地 **AI-BIM Governance Edge Console**：讓 A1 在新介面可驗證、A2/A3 有誠實骨架、A4–A10 有 ROADMAP 入口，並補上瀏覽器→coordinator→governance 的 proxy 接縫。

## What Changes

- 在 `web-viewer-sample` 新增 `src/console/`（Edge Console）：
  - 三欄殼（頂欄 / 兩段式導覽 GOVERNANCE PLATFORM·OMNIVERSE RUNTIME / 主區 / ChatUSD 欄可折疊 / 底欄），`--ec-*` 暗綠操作員視覺（移植自設計原型 03/06）。
  - **零新增依賴**：以 `window.location.pathname` 判斷 `/console` 掛載 Edge Console，其餘維持既有 `<App/>`（viewer）不變；console 內頁用 hash 路由（與原型一致），不引入 react-router。
  - **A1 Rule Center / Issues 語意驗收頁**：經 coordinator proxy 實時觸發 rule-run、顯示 score / failed 構件表 / Excel 匯出連結，並顯示真實 IFC 實測 artifact（7126 構件 / failed 71 / score 99.0）。
  - **Applications A1–A10 launcher**：A1 可點（已實作）、A2/A3 內部骨架頁、A4–A10 標 ROADMAP Phase 灰掉。
  - **A2 / A3 誠實骨架頁**（Diff Builder / Federation Builder）：列 schema / API / 風險，全標 p1 待建，不顯示捏造數字。
  - 其餘頁（Overview / Coordinator Console / Model Intake / Runtime / Review Room / Semantic Viewer）以 AS-BUILT 資料來源 + 待建項誠實標示。
- 在 `bim-review-coordinator` 新增 additive `/api/governance/rule-runs*` proxy（loopback 透傳至 governance-service `127.0.0.1:49102`），維持「瀏覽器只打 :8004」邊界；後端未啟動時回 502，不假裝成功。

## Capabilities

### New Capabilities

- `edge-console-operator-frontend`：落地端操作員前端，以兩段式導覽視覺化雲地邊界、強制 provenance 誠實標記、經 coordinator proxy 操作 A1 rule-run，並提供 A1–A10 導引與 A2/A3 骨架。

### Modified Capabilities

- None.（`web-viewer-sample` 既有 viewer 行為不變；coordinator 為 additive proxy route。）

## Impact

- Owner repo / folder:
  - `web-viewer-sample/src/console/`（新增 Edge Console；`main.tsx` 僅加 pathname 條件渲染，既有 App 不動）。
  - `bim-review-coordinator/src/routes/governanceProxy.ts`（新增 additive proxy）+ `app.ts` 一行註冊。
- API / data shape:
  - coordinator 新增 `/api/governance/rule-runs`、`/{id}`、`/{id}/results`、`/{id}/export`（透傳 governance-service）；既有契約不變。
- Runtime boundary:
  - 瀏覽器只打 coordinator `:8004`；governance-service `:49102` 為內部 loopback，不對瀏覽器暴露。
  - 不渲染 3D / 不開 USD stage / 不引入 Omniverse·pxr（守 `web-viewer-sample` 邊界）。
  - 3D highlight（A1 結果標示）走 client `highlightPrimsRequest`，不復活 2026-05-21 退役的 server→viewer push。
- Dependencies:
  - **無新增生產依賴**（不引入 react-router；用零依賴 pathname/hash 路由）。
- Non-goals:
  - 不實作 A2/A3 後端（change 3/4）、不實作 Issue 資料庫 / BCF 匯出 / IDS 匯入。
  - 不顯示任何願景假數字；未實作能力一律標 p1/p15 並灰掉。
  - 不改既有 viewer 的 WebRTC / session bootstrap 行為。
