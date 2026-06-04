## Why

「06 操作介面總覽」骨架的 frontend gap 報告（`docs/evidence/2026-06-03-ultracode-rebuild-verify/frontend-06-gap-report.md`）在 P1 主線（A1/A2/A3 真實可驗證缺口，已於 #174 完成）之後，仍列出 **P2 / P3 / P4** 三組共用頁面缺口：B/C/F/H 仍是殼頁、Overview 缺三個誠實 Panel、A4–A10 只有啟動器卡無 vision 詳頁、右欄 Agent / FlowBar / Tweaks 未移植、Review Room 未連既有 viewer。

本 change 在**只動 `web-viewer-sample/src/console/`**（守 viewer repo 邊界）的前提下補齊 P2/P3/P4，並嚴守誠實鐵律：

- **端點查證為第一步**：實作任何打後端的頁面前，逐一查證 `bim-review-coordinator/src/app.ts` 真實 route。查到的真實 coordinator-owned 端點才接（`GET /health`、`GET /api/runtime/status`、`GET /api/external/ifc-ready[?limit]`、`GET /api/review-sessions/:id/stream-config`、`GET /ui/open?session=`）；設計參考內的幻覺端點（`/api/governance/uploads`、`/api/governance/runtime/{sessions|health|metrics}`）**查證不存在 → 不使用、不 mock 假端點**，改用真實 `/api/runtime/status` 取等價資訊。
- **前端只打 coordinator `:8004`**，永不直連 `:49100` / `:49101` / `:49102`。
- **無真實遙測的數值**（GPU / 首幀 / conversion 秒數）一律標「未取得」（idle，非 fail），禁畫 fail、禁捏造。
- **mapping fake-vs-real 隔離**：`mock` / `allow_fake_mapping` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test` 一律當 fake 標 demo，禁覆蓋 / 禁冒充真 mapping（重用既有 `src/types/mapping.ts` 工具）。
- **A4–A10 後端不存在**：整段標 vision（A5=p3、其餘 p4）；RM_APPS scenario 內具體數字為原型情境敘事（範例情境），非真實 run，禁當實測；其 api 為「願景 API 設計」（非已實作 route）。

## What Changes

- **P2-1 OverviewPage**（`pages.tsx`）補三 Panel + `data.ts` 加 `SERVICES` / `ENDPOINTS` / `DEPENDENCIES`：
  - BoundaryDiagram（web-plane → boundary → internal 三欄，視覺化「瀏覽器只打 :8004」）。
  - DEPENDENCIES 授權風險表（LGPL / copyleft 照實標，**禁寫「零授權風險」**）。
  - ENDPOINTS coordinator 已實作路由清單（逐一查證自 `app.ts`）。
  - 可選接 coordinator `/health` 探活（未連線誠實標未取得，不假裝 healthy）。
- **P2-2 SemanticViewerPage**（`pages.tsx` 取代 semantic StubPage；`EdgeConsole.tsx` 換 case）：
  - 載入真實 `element_mapping.json`（URL 來自真實 session 或操作員貼入）；重用 `isFakeMappingDocument` 嚴守 fake-vs-real 隔離；fake mapping 標 demo 且拒絕當正式 mapping。
  - 點構件 3D 標示需 viewer DataChannel（console 殼層無此鏈）→ 標 `p1`，不做假按鈕。
- **P2-3 CoordinatorPage / IntakePage / RuntimePage**（`pages.tsx` 取代 B/C/F StubPage）+ 新建 `coordinatorClient.ts`（只打 `:8004` 的真實 coordinator-owned REST）：
  - B = `GET /api/runtime/status`（sessions / kit bindings / callback_outbox_id 觀察）；C = `GET /api/external/ifc-ready`；F = `GET /api/runtime/status` + `GET /api/review-sessions/:id/stream-config`。
  - GPU / 首幀 / conversion 秒數無遙測 → 標未取得（非 fail）；callback-outbox 直查需 internal token（瀏覽器不可達）→ 改由 `callback_outbox_id` 觀察，不捏造投遞數。
- **P3-1 A4–A10 vision 詳頁**（`pages.tsx` 泛用 `AppVisionPage`；`data.ts` 加 `A1A10_DETAIL` 移植 `RM_APPS`）：
  - AppsPage roadmap 卡可點 → `app/<slug>` vision 詳頁（schema / api / ui / mvp / sprint steps / risks）。
  - 整頁標 vision，明確標「後端未建」；scenario 標「範例情境（願景敘事，非真實 run）」；api 標「願景 API 設計（非已實作 route）」。
  - `Prov` 型別加 `p3` / `p4`（A5=p3、其餘 p4），同步 `PROV_LABEL` / `PROV_CLASS` + `edge-console.css` `.ec-p3` / `.ec-p4`。
- **P3-2 右欄 Agent**（`EdgeConsole.tsx`）：補 suggested prompts（disabled 示意）+ 寫入限制聲明（AI 僅改 review/session layer）+ disabled 輸入框（A9 ROADMAP）。
- **P3-3 FlowBar + Tweaks**（`EdgeConsole.tsx` + `edge-console.css`）：FlowBar（Intake→Convert→Meeting→Mark→Record，Mark 標 p15）+ Tweaks（操作員/技術用語切換、scenario clean/warn UI 偏好；真實頁一律以 live API 為準）。
- **P4 Review Room（G）v1**（`pages.tsx` `ReviewRoomPage`；`EdgeConsole.tsx` 換 case）：維持殼層狀態 + 加「在既有 viewer 開啟」連結（coordinator `/ui/open?session=` redirect + 本地 `/?session=`）；**不動 `App.tsx` / `Window.tsx`**；工具列誠實標 provenance（section/snapshot 待建）。
- **測試**（`console.test.tsx`）：新增斷言 —— BoundaryDiagram/DEPENDENCIES 含「copyleft」且無「零授權風險」；Semantic fake 隔離 + p1（無 DataChannel）；coordinatorClient 只打 `:8004` 且無幻覺端點；GPU 標未取得；每個 vision 頁含「後端未建」+「範例情境/非真實 run」+「非已實作 route」且無捏造數字；roadmap 卡可點且標 p3/p4；殼層含 Agent prompts + disabled 輸入 + FlowBar + Tweaks；Review Room 連既有 viewer 且不動 App/Window。

純前端接線 / 標示；**無新增生產依賴**、不改後端、不改 API / data shape、不改既有 viewer 行為、不動 `App.tsx` / `Window.tsx`。

## Capabilities

### Modified Capabilities

- `edge-console-operator-frontend`：新增 P2/P3/P4 共五項可驗收要求（皆含誠實條款，皆為 ADDED，不修改既有要求文字）。

### New Capabilities

- None.

## Impact

- Owner repo / folder（皆 `web-viewer-sample/src/console/`）：
  - `pages.tsx`（OverviewPage 三 Panel + BoundaryDiagram；SemanticViewerPage；CoordinatorPage / IntakePage / RuntimePage；AppVisionPage + AppsPage 卡可點；ReviewRoomPage）。
  - `coordinatorClient.ts`（**新檔**：只打 `:8004` 的真實 coordinator-owned REST + 型別）。
  - `data.ts`（`SERVICES` / `ENDPOINTS` / `DEPENDENCIES` / `A1A10_DETAIL` 常量；`Prov` 加 `p3`/`p4` + `PROV_LABEL`/`PROV_CLASS`；A4–A10 卡 prov 細分 + route）。
  - `EdgeConsole.tsx`（renderBody 接 B/C/F/H/G + `app/<slug>`；FlowBar；Tweaks；Agent prompts）。
  - `edge-console.css`（BoundaryDiagram / ENDPOINTS / risk / fake-banner / Agent prompts / FlowBar / Tweaks / `.ec-p3` `.ec-p4` 樣式）。
  - `console.test.tsx`（P2/P3/P4 誠實靜態斷言）。
- API / data shape：無變更（沿用既有 coordinator REST + governance proxy；不新增 / 不改後端端點）。
- Runtime boundary：不變（瀏覽器只打 coordinator `:8004`；不直連 `:49100`/`:49101`/`:49102`；不渲染 3D；不復活退役 server-push highlight；不動 `App.tsx`/`Window.tsx`）。
- Dependencies：**無新增生產依賴**。
- 驗收：`npx tsc --noEmit` → 0 errors；`npx vitest run` → 50 passed（baseline 40 + 10 新斷言）；`npx vite build` → 成功；`npx openspec validate edge-console-p2-p4-buildout --strict` → 通過。
- Non-goals：不接 console→viewer DataChannel（屬 viewer 整合，跨 console 邊界）；不新增任何後端端點 / 不實作 A4–A10 後端；不做 browser E2E / 截圖（由主對話跑真實 IFC E2E 補）；不改 P0（spec 已 post-archive 對齊）/ P1（#174 已完成）範圍。
