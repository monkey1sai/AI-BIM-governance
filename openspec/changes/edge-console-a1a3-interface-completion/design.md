# Design — edge-console-a1a3-interface-completion

## 脈絡

frontend gap 報告 P1 主線：A1/A2/A3 後端已 merged + coordinator proxy live，補齊 Edge Console「真實可驗證」缺口。本 change 只動 `web-viewer-sample/src/console/`（守 viewer repo 邊界），不改後端、不改既有 viewer `<App/>` / `Window`。

## 誠實鐵律：以「實際可達」決定 provenance，不據報告臆測

gap 報告由「只讀分析」產出，對 A2 apply-overlay 描述為「後端已存在（前端零呼叫＝確認 gap）」，對 A1 Highlight 描述為「視 viewer 整合標 asbuilt / p15」。實作前**逐一查證後端原始碼**，結果與報告措辭不同，採實際可達者：

| P1 項 | 報告措辭 | 後端 / 架構實況（查證） | 採用 provenance |
|---|---|---|---|
| A1 [匯出 Excel] | client 有 `exportUrl`，只缺按鈕 | `governanceProxy.ts:65` 二進位透傳 → governance-service openpyxl 匯出，真實可下載 | **asbuilt**，接上真實下載 |
| A1 [在 3D 中標示] | 視 viewer 整合標 asbuilt / p15 | `main.tsx` 對 `/console` 掛 `<EdgeConsole/>`、其餘掛 `<App/>`，**互斥**；`highlightPrimsRequest` 需 `Window` 內 WebRTC DataChannel；console 殼層無 DataChannel | **p1**（鏈未接，永遠 disabled，非假按鈕） |
| A2 apply-overlay | 後端已存在 | `diff_engine/api.py:87-91` `raise HTTPException(501, "3D overlay 為 p15…走 client highlightPrimsRequest，非後端 server-push")` | **p15**，接真實端點但顯示 501，不偽裝成功 |
| A3 visibility | 後端 member 有 `visibility_default` | `federation/api.py:58` `visibility_default: bool=True` + `build_set` 回 `hidden[]`；**無**不重建即時切換端點 | **asbuilt**（build 時 visibility），誠實標「須重新 Build」 |

關鍵原則：**真的接 live 的才接並標 asbuilt；後端誠實回 501 / 此鏈未接的，標誠實 p1/p15 並顯示後端誠實訊息，不做點了沒反應的假按鈕、不偽裝成功、不顯示假數字。**

## 設計決策

### D1：兩個「3D 著色」入口都不復活 server-push

A1 [在 3D 中標示] 與 A2 [套用 3D Overlay] 的真正 3D 著色都應走 client `highlightPrimsRequest`（既有 builder，2026-05-21 已退役 server-push）。但 Edge Console 殼層當前無 DataChannel：

- A1：直接以 disabled p1 按鈕表態（需 viewer DataChannel，後續整合）。
- A2：仍呼叫後端 apply-overlay 端點（report 指出此為 gap），讓使用者**看到後端誠實回 501** —— 這比「不放按鈕」更誠實地揭露後端契約，且符合報告「前端零呼叫＝確認 gap」的修補意圖。回應以 `{ ok, status, detail }` 直陳，501 時附說明，不轉成假成功訊息。

### D2：按鈕「永遠可見、未就緒時 disabled」而非「就緒才出現」

[匯出 Excel] / [套用 3D Overlay] 在成功 run/diff 前 `disabled`（真實 gating：無 `runId` / `diffId` 不可動作），而非條件式不渲染。理由：(1) 操作員可看見能力存在；(2) disabled 即誠實表態「需先跑」；(3) 可被靜態 `renderToString` 測試斷言（守門意圖可測）。[在 3D 中標示] 因鏈未接而**永遠 disabled**。

### D3：A3 visibility 不捏造「即時切換」

`RM_APPS` A3 mvp 第 5 條原文是「即時切換 visibility 不重建」。後端唯一真實能力是 build 時 `visibility_default`（隱藏 member 寫成 invisible、回 `hidden[]`）。沒有不重建端點 → **不捏造即時能力**：checkbox 改的是「下次 build 的 visibility」，誠實標「改 visible 須重新 Build 才生效」，並把後端回的 `hidden[]` 顯示出來作為真實證據。此即報告 P1-2 風險條款的指定誠實作法。

### D4：`applyDiffOverlay` 不吞錯

proxy 後端離線回 502、apply-overlay 回 501，都需誠實顯示。故 client 不用 `jsonFetch`（會在非 2xx throw 成不透明 Error），改自行 `fetch` 並解析 body `detail`，回 `{ ok, status, detail }`，由 UI 決定呈現（501 補脈絡說明）。

## 邊界與不變式

- 瀏覽器只打 coordinator `:8004` 的 `/api/governance/*`；不直連 governance-service `:49102`（沿用既有 `governanceClient` base 規約）。
- 不渲染 3D、不開 USD stage、不碰 GPU。
- 不改後端 apply-overlay（維持誠實 501）、不新增即時 visibility 端點、不改 API / data shape。
- 不動 `App.tsx` / `Window.tsx` / `main.tsx`（console↔viewer DataChannel 整合屬 P4，跨 console 邊界）。

## 驗收

- `npx tsc --noEmit` → 0 errors。
- `npm run test`（vitest）→ 40 passed（baseline 38 + 3 新斷言併入既有 + 新 case，淨 +2 test 數）。
- `npm run build`（vite）→ 成功。
- `npx openspec validate edge-console-a1a3-interface-completion --strict` → 通過。

## Open Questions

- 無。console↔viewer DataChannel 整合與 apply-overlay 後端著色管線屬後續（P4 / 後端範圍），不在本 change scope；已於 proposal Non-goals 與本檔 D1/D3 明確界定。
