# Tasks — edge-console-p2-p4-buildout

## 1. 端點查證（誠實鐵律前置：以 app.ts 實際 route 為準，不據設計參考臆測）

- [x] 1.1 查證真實 coordinator-owned 端點（`bim-review-coordinator/src/app.ts`）：`GET /health`（388）、`GET /api/runtime/status`（396）、`GET /api/external/ifc-ready[?limit]`（712）+ `/:jobId`（724）、`GET /api/review-sessions/:id/stream-config`（510）、`GET /ui/open?session=`（1587 server-side redirect）→ 皆 asbuilt。
- [x] 1.2 查證幻覺端點不存在：`/api/governance/uploads`、`/api/governance/runtime/{sessions|health|metrics}` 在 app.ts 無對應 route → 不使用、不 mock；改用 `/api/runtime/status` 取等價 runtime summary。
- [x] 1.3 查證 callback-outbox 直查邊界：`GET /api/internal/callback-outbox/:id`（1153）受 `/api/internal` token gate（781）→ 瀏覽器不可達 → 改由 ifc_ready job `callback_outbox_id` 觀察，不捏造投遞數。
- [x] 1.4 查證 mapping 隔離工具既存：`src/types/mapping.ts` `isFakeMappingDocument` / `isFakeMappingItem`（已有測試）覆蓋四個 fake 旗標 → 重用，不重造。

## 2. P2-1 OverviewPage 三 Panel（commit 1）

- [x] 2.1 `data.ts` 加 `SERVICES`（BoundaryDiagram 拓樸，governance :49102 更正為 asbuilt）/ `ENDPOINTS`（查證自 app.ts 的真實 route）/ `DEPENDENCIES`（LGPL copyleft 照實標，BCF 標純 stdlib）。
- [x] 2.2 `pages.tsx` 加 `BoundaryDiagram`（web→boundary→internal 三欄）；OverviewPage 補三 Panel（邊界圖 / ENDPOINTS / DEPENDENCIES）+ 可選接 `/health` 探活（未連線標未取得）。
- [x] 2.3 `edge-console.css` 加 BoundaryDiagram / ENDPOINTS list / risk 標籤樣式。

## 3. P2-2 SemanticViewerPage（commit 1）

- [x] 3.1 `pages.tsx` 加 `SemanticViewerPage`：載入 element_mapping.json（URL 來自真實 session 或貼入）；重用 `isFakeMappingDocument` / `mappingVerificationBlockReason`。
- [x] 3.2 fake mapping → 顯示 fake-banner + 整頁標 demo + 拒絕當正式 mapping；逐 item 標 fake；不覆蓋真 mapping。
- [x] 3.3 點構件 3D 標示 → 標 p1、disabled（需 viewer DataChannel），不做假按鈕。
- [x] 3.4 `EdgeConsole.tsx` semantic case 換成 `SemanticViewerPage`。

## 4. P2-3 Coordinator/Intake/Runtime（commit 1）

- [x] 4.1 新建 `coordinatorClient.ts`：只打 `:8004` 的真實 coordinator-owned 端點 + 型別（`RuntimeStatus` / `IfcReadyListItem` / `StreamConfigResponse` / `openInViewerUrl`）；幻覺端點不提供。
- [x] 4.2 `CoordinatorPage`（B）：`GET /api/runtime/status` → sessions / kit bindings / callback_outbox_id 觀察；GPU/首幀標未取得（port listening ≠ has frame）。
- [x] 4.3 `IntakePage`（C）：`GET /api/external/ifc-ready` → intake 佇列；mapping fidelity 不承諾精準 GUID；conversion 秒數/GPU 標未取得。
- [x] 4.4 `RuntimePage`（F）：`GET /api/runtime/status`（host_native_plane）+ `GET /api/review-sessions/:id/stream-config`；GPU 標未取得，不開串流、不捏造遙測。
- [x] 4.5 `EdgeConsole.tsx` coordinator/intake/runtime case 換成新 component。

## 5. P3-1 A4–A10 vision 詳頁（commit 2）

- [x] 5.1 `data.ts` `Prov` 加 `p3`/`p4` + `PROV_LABEL`/`PROV_CLASS`；`edge-console.css` 加 `.ec-p3`/`.ec-p4`。
- [x] 5.2 `data.ts` A4–A10 卡 prov 細分（A5=p3、其餘 p4）+ route=`app/<slug>`。
- [x] 5.3 `data.ts` 加 `A1A10_DETAIL`（轉述 RM_APPS：schema/api/ui/mvp/steps/risks；scenario 標「範例情境（願景敘事，非真實 run）」；api 標願景設計）。
- [x] 5.4 `pages.tsx` 加泛用 `AppVisionPage`：整頁標 vision、明確標「後端未建」、api 標「非已實作 route」；AppsPage roadmap 卡可點。
- [x] 5.5 `EdgeConsole.tsx` renderBody 處理 `app/<slug>` 路由。

## 6. P3-2 / P3-3 Agent + FlowBar + Tweaks（commit 2）

- [x] 6.1 `EdgeConsole.tsx` 右欄 Agent 補 suggested prompts（disabled）+ 寫入限制聲明 + disabled 輸入框（標 p4 ROADMAP）。
- [x] 6.2 `EdgeConsole.tsx` 加 `FlowBar`（Intake→Convert→Meeting→Mark→Record，Mark 標 p15，可點導航）。
- [x] 6.3 `EdgeConsole.tsx` 加 Tweaks（register 操作員/技術用語切換 nav 標籤；scenario clean/warn UI 偏好，不改真實資料）。
- [x] 6.4 `edge-console.css` 加 Agent prompts / FlowBar / Tweaks / mainhead 樣式。

## 7. P4 Review Room（G）v1（commit 3）

- [x] 7.1 `pages.tsx` 加 `ReviewRoomPage`：維持殼層狀態 + 「在既有 viewer 開啟」連結（coordinator `/ui/open?session=` + 本地 `/?session=`），session id 格式 gating（非假連結）。
- [x] 7.2 工具列誠實標 provenance（openStage/focusPrim/selectPrims/clearHighlight asbuilt；highlight/section/snapshot p15）；明確標「3D 在既有 viewer、不動 App.tsx/Window.tsx」。
- [x] 7.3 `EdgeConsole.tsx` review case 換成 `ReviewRoomPage`。

## 8. 測試與驗證（gate）

- [x] 8.1 `console.test.tsx` P2 斷言：DEPENDENCIES 含 copyleft 且無「零授權風險」+ BoundaryDiagram「瀏覽器永不直連」+ ENDPOINTS 真實 route；Semantic fake 隔離 + p1（無 DataChannel）；coordinatorClient 只打 `:8004` 且無幻覺端點；GPU 標未取得。
- [x] 8.2 `console.test.tsx` P3 斷言：每個 vision 頁含「後端未建」+「範例情境/非真實 run」+「非已實作 route」且無捏造數字；roadmap 卡可點且標 p3/p4；殼層含 Agent prompts + disabled 輸入 + FlowBar + Tweaks。
- [x] 8.3 `console.test.tsx` P4 斷言：Review Room 含「在既有 viewer 開啟」+ `/ui/open` + `?session=` + 不動 App.tsx/Window.tsx + section/snapshot p15。
- [x] 8.4 `npx tsc --noEmit` → 0 errors。
- [x] 8.5 `npx vitest run` → 50 passed / 0 fail（baseline 40 + 10 新斷言）。
- [x] 8.6 `npx vite build`（vite）→ 成功。
- [x] 8.7 `npx openspec validate edge-console-p2-p4-buildout --strict` + `--all --strict` → 0 failed。
- [ ] 8.8 （主對話補）browser E2E + 截圖：`http://127.0.0.1:8004/ui` → /console 各頁真實 IFC 驗證。**本 change 不做 E2E / 不偽造截圖**。
