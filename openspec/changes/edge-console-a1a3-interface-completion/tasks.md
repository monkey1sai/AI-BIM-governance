# Tasks — edge-console-a1a3-interface-completion

## 1. 後端查證（誠實鐵律前置：以實際可達為準，不據 gap 報告臆測）

- [x] 1.1 確認 A1 Excel 匯出 live：coordinator proxy `GET /api/governance/rule-runs/:id/export?fmt=excel`（governanceProxy.ts 第 65 行二進位透傳）→ governance-service openpyxl；`governanceClient.exportUrl(runId)` 已存在 → asbuilt。
- [x] 1.2 確認 A1 [在 3D 中標示] 鏈未接：`highlightPrimsRequest` 需 viewer DataChannel（`Window._sendStreamMessage`）；`main.tsx` 對 `/console` 掛 `<EdgeConsole/>`、其餘掛 `<App/>`，兩者互斥 → console 無 DataChannel → 誠實 p1。
- [x] 1.3 確認 A2 apply-overlay 回應：governance-service `diff_engine/api.py` `apply_overlay`（第 87–91 行）`raise HTTPException(501, ...)` → 誠實 p15，不偽裝成功。
- [x] 1.4 確認 A3 visibility 能力邊界：`federation/api.py` `MemberRequest.visibility_default`（第 58 行）+ `build_set` 回 `hidden[]` 已落地；無「不重建即時切換」端點 → build 時帶入 + 誠實標「須重新 Build」。

## 2. P1-3 A1（IssuesRuleCenterPage）

- [x] 2.1 加 [匯出 Excel] 按鈕：`fetch(governanceClient.exportUrl(runId))` → blob 下載 `rule-run-<id>.xlsx`；非 2xx 誠實顯示狀態碼；成功 rule-run 前 `disabled`（`!runId || run?.status !== "succeeded"`）。
- [x] 2.2 加 [在 3D 中標示] 按鈕：`prov="p1"`、永遠 `disabled`，caption「需 viewer DataChannel（highlightPrimsRequest）— 後續整合」。
- [x] 2.3 補頁面誠實說明：console 與 viewer 互斥掛載、無 DataChannel；未對映 `usd_prim_path=null` 無法標示。

## 3. P1-1 A2（governanceClient + VersionDiffPage）

- [x] 3.1 `governanceClient.ts` 加 `applyDiffOverlay(diffId): Promise<DiffOverlayResult>`：POST apply-overlay，不吞錯，回 `{ ok, status, detail }`（解析後端 detail，含 501）。
- [x] 3.2 加 `DiffOverlayResult` 型別（`ok / status / detail`）。
- [x] 3.3 `VersionDiffPage` 加 `overlay` state；`run()` 重置 `overlay`。
- [x] 3.4 加 [套用 3D Overlay] 按鈕：`prov="p15"`、成功 diff 前 `disabled`；點擊呼叫 `applyDiffOverlay`，顯示 `apply-overlay → <status>：<detail>`，501 補「走 client highlightPrimsRequest，需 viewer DataChannel；後端不做 server-push」；**不偽裝成功**。
- [x] 3.5 既有「3D overlay 顏色」誠實標示更新：點出 apply-overlay 端點誠實回 501。

## 4. P1-2 A3（FederationPage）

- [x] 4.1 members state 加 `visible: true`；`setMember` 值型別加 `boolean`。
- [x] 4.2 member 表加 `visible` checkbox（title 提示「build 時帶入；改動需重新 Build」）。
- [x] 4.3 `prepare()` 的 `addFederatedMember` 帶入 `visibility_default: m.visible`。
- [x] 4.4 build 結果顯示 `hidden members（visibility=false）`（來自 `FederatedBuildResult.hidden`）。
- [x] 4.5 「範圍與誠實標示」補 `member visibility` 列：build 時帶入 `visibility_default`、無即時切換端點、改 visible 須重新 Build（`asbuilt`，不捏造即時）。

## 5. 測試與驗證

- [x] 5.1 `console.test.tsx` 加 case「A1 補匯出 Excel 與在 3D 中標示（誠實 p1）」：斷言 `匯出 Excel` / `在 3D 中標示` / `後端待建 · P1` / `DataChannel`。
- [x] 5.2 `console.test.tsx` 加 case「A2 補 apply-overlay：誠實標 p15，不假裝成功」：斷言 `套用 3D Overlay` / `後端待建 · P1.5` / `501`。
- [x] 5.3 `console.test.tsx` 加 case「A3 補 member visibility toggle」：斷言 `visible` / `重新 Build` / `visibility_default`。
- [x] 5.4 `npx tsc --noEmit` → 0 errors。
- [x] 5.5 `npm run test`（vitest）→ 40 passed / 0 fail（baseline 38 + 2）。
- [x] 5.6 `npm run build`（vite）→ 成功。
- [x] 5.7 `npx openspec validate edge-console-a1a3-interface-completion --strict` → 通過。
