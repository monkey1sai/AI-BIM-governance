## Why

「06 操作介面總覽」骨架的 frontend gap 報告（`docs/evidence/2026-06-03-ultracode-rebuild-verify/frontend-06-gap-report.md`）P1 主線指出：A1/A2/A3 後端已 merged 並經 coordinator proxy live，但 Edge Console 介面仍缺三個「真實可驗證」缺口。本 change 在**只動 `web-viewer-sample/src/console/`** 的前提下補齊，並嚴守誠實鐵律——真的接 live 的才標 `asbuilt` 並接；後端誠實回 501 / 此鏈未接的，標誠實 `p1` / `p15` 並顯示後端誠實訊息，不做「點了沒反應」的假按鈕、不顯示假數字、不偽裝成功。

三個缺口（皆對齊 `RM_APPS` mvp 驗收條款 + gap 報告 §4 誠實鐵律檢查點）：

1. **P1-3 A1（Rule Center）**：缺 [匯出 Excel] 與 [在 3D 中標示]。
   - [匯出 Excel]：`governanceClient.exportUrl(runId)` 已存在，coordinator proxy `GET /api/governance/rule-runs/:id/export?fmt=excel`（governanceProxy.ts 第 65 行）透傳至 governance-service openpyxl 匯出 —— **真實可下載 → asbuilt**，只缺前端按鈕。
   - [在 3D 中標示]：`highlightPrimsRequest` 需 viewer 的 WebRTC DataChannel（`Window` 類別內 `_sendStreamMessage`）。但 `main.tsx` 對 `/console` 掛 `<EdgeConsole/>`、其餘路徑才掛 `<App/>`（viewer），**兩者互斥掛載**；Edge Console 為獨立殼層，目前**無 DataChannel** —— 此鏈未接 → **誠實標 p1**（需 viewer DataChannel，後續整合），不做假按鈕。

2. **P1-1 A2（VersionDiffPage）**：缺 apply-overlay 接線。coordinator proxy `POST /api/governance/diffs/:id/apply-overlay`（governanceProxy.ts 第 89 行）已透傳，但 governance-service `diff_engine/api.py` `apply_overlay`（第 87–91 行）**誠實回 501**（「3D overlay 為 p15：走 client highlightPrimsRequest，非後端 server-push」）。故前端接上真實端點但 **標誠實 p15 並顯示後端 501 訊息，不偽裝成功**。

3. **P1-2 A3（FederationPage）**：缺 member visibility toggle（`RM_APPS` A3 mvp 第 5 條）。governance-service `federation/api.py` `MemberRequest.visibility_default`（第 58 行）+ `build` 回 `hidden[]` 已落地，但**無「不重建即時切換」端點**。故第一版以 build 時帶入 `visibility_default` 達成，**誠實標示「改 visible 須重新 Build 才生效」，不捏造即時能力**（asbuilt：build 時 visibility）。

`tsc` 是 CI / build 硬閘門；provenance 標錯違反 Edge Console「畫面與真實落地一致、無假數字」契約（gap 報告 §4-2）。

## What Changes

- **P1-3 A1**（`pages.tsx` `IssuesRuleCenterPage`）：
  - 加 [匯出 Excel] 按鈕（呼叫 `governanceClient.exportUrl(runId)` 真實下載 `.xlsx`，標 `asbuilt`）；成功 rule-run 前 disabled（真實 gating）。
  - 加 [在 3D 中標示] 按鈕，**永遠 disabled** 並標 `p1`，caption 誠實說明「需 viewer DataChannel（highlightPrimsRequest）— 後續整合」；補頁面誠實說明（console 與 viewer 互斥掛載、無 DataChannel；未對映 `usd_prim_path=null` 本就無法標示）。
- **P1-1 A2**（`governanceClient.ts` + `pages.tsx` `VersionDiffPage`）：
  - `governanceClient` 加 `applyDiffOverlay(diffId)`，呼叫 `POST /api/governance/diffs/:id/apply-overlay`，**不吞錯**，回傳 `{ ok, status, detail }`（含後端 501 detail）。
  - `VersionDiffPage` 加 [套用 3D Overlay] 按鈕（標 `p15`），顯示後端誠實回應（含 `501` 與「走 client highlightPrimsRequest，非 server-push」），**SHALL NOT 假裝成功**；成功 diff 前 disabled。既有「3D overlay 顏色」誠實標示更新為點出 apply-overlay 回 501。
- **P1-2 A3**（`pages.tsx` `FederationPage`）：
  - member 表加 `visible` checkbox，於 build 前以 `visibility_default` 帶入 `addFederatedMember`。
  - build 結果顯示 `hidden members（visibility=false）`（來自後端 `FederatedBuildResult.hidden`）。
  - 「範圍與誠實標示」補一列 `member visibility`：誠實說明「build 時帶入 `visibility_default`；無不重建即時切換端點，改 visible 須重新 Build 才生效（不捏造即時能力）」（標 `asbuilt`）。
- **測試**（`console.test.tsx`）：新增 3 個 case 斷言 —— A1 [匯出 Excel] 存在 + [在 3D 中標示] 誠實 `p1` + DataChannel 說明；A2 [套用 3D Overlay] + `p15` + `501`（不偽裝成功）；A3 `visible` checkbox + `重新 Build` + `visibility_default`（不捏造即時）。

純前端接線 / 標示；**無新增生產依賴**、不改後端、不改 API / data shape、不改既有 viewer 行為、不動 `App.tsx` / `Window.tsx`。

## Capabilities

### Modified Capabilities

- `edge-console-operator-frontend`：新增三項可驗收要求——「A1 SHALL 提供真實 Excel 匯出與誠實標示之 3D 標示入口」「A2 SHALL 經 apply-overlay 端點誠實呈現後端狀態（501/p15）SHALL NOT 偽裝成功」「A3 SHALL 提供 member visibility（build 時帶入）並誠實標示須重新 Build」。皆為 ADDED，不修改既有要求文字。

### New Capabilities

- None.

## Impact

- Owner repo / folder（皆 `web-viewer-sample/`）：
  - `src/console/pages.tsx`（A1 兩按鈕 + A2 overlay 按鈕/狀態 + A3 visibility checkbox/hidden 顯示/誠實標示）。
  - `src/console/governanceClient.ts`（新增 `applyDiffOverlay` 方法 + `DiffOverlayResult` 型別）。
  - `src/console/console.test.tsx`（3 個新斷言）。
- API / data shape：無變更（沿用既有 coordinator proxy 端點與 governance-service 契約；apply-overlay 維持後端既有 501 行為）。
- Runtime boundary：不變（瀏覽器只打 coordinator `:8004`；不直連 `:49102`；不渲染 3D；不復活退役的 server-push highlight）。
- Dependencies：**無新增生產依賴**。
- 驗收：`npx tsc --noEmit` → 0 errors；`npm run test`（vitest）→ 40 passed（baseline 38 + 2 新 test）；`npm run build`（vite）→ 成功。
- Non-goals：不接 console→viewer DataChannel（屬 P4 viewer 整合，跨 console 邊界）；不新增 apply-overlay 後端實作（維持誠實 501）；不新增「不重建即時切換 visibility」後端端點；不動 P0（spec 已 post-archive 對齊 A2/A3 asbuilt）/ P2 / P3 / P4 範圍。
