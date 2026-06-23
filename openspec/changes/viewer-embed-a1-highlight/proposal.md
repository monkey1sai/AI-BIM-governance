## Why

A1 治理檢核「在 3D 高亮失敗構件」這條 user journey 斷成兩截：console 工作台（跑檢核 / 開 Issue / 匯出處）的「在 3D 高亮」按鈕全灰（`pages.tsx:347` 永久 disabled p1），viewer 內高亮引擎（`HighlightBridge` / `GovernanceOverlay`）其實齊全卻驅動不到——兩者**互斥掛載、console 無 WebRTC DataChannel**（`pages.tsx:1295`）。且 `first_frame_at` 後端零實作（grep `app.ts` 無），系統無法誠實宣稱「3D 真的載好了」，IX-A1-06 第二啟用條件（first_frame_at）無從滿足，`#viewer` / `#sessions` 一排證據卡在 p1。

## What Changes

- coordinator `first_frame_at` 後端化：新增 `POST /api/review-sessions/:sessionId/first-frame`（safe-id 400 / not-found 404 / isSessionMutable 409 / 冪等 / store.update null→500 防孤兒 event / endpoint_id 截斷）+ 型別鏈三處（`summarizeSessionForRuntime` emit、`RuntimeSessionSummary` 加欄、`runtimeGovernance` 改讀真值取代 hardcoded `"not_observed"`）。additive、回歸鎖。`eventLog` 把 `firstFrameObserved` 顯式登記為 operational milestone（合約 §9 同步，下游用 `data.eventlog_type` 區分，非 lifecycle transition）。
- console `<EmbeddedViewer>`：iframe 嵌入既有 viewer（重用串流堆疊、不自建 WebRTC、呼應「web 端不重做」）+ 版本化 `protocol:"vg01"` postMessage 橋（送出 `targetOrigin` 非 `"*"`、接收驗 origin 白名單 + `event.source` + 協定版本）。
- viewer `Window.tsx` parent listener（嚴格 additive）：M1 first_frame 單送（`_firstFramePosted` flag，接 `_completeStageLoad` 真完成點而非失敗/斷線路徑）、M2 canOperate 守衛（highlight/focus/clear 三個 mutating handler 全先判，spectator 靜默丟棄）、M5 `document.referrer` 交叉驗 + 白名單複用 `VITE_ALLOWED_COORDINATOR_ORIGINS`。
- A1 頁嵌入 `<EmbeddedViewer>`（gated render + `key={session}`）+「在 3D 高亮」翻真（IX-A1-06 四條件）+ `ViewerPresentationPage` 證據顯示由 p1 翻真。
- Browser E2E（Playwright，真 Kit 串流取證）+ `vg01-highlight-column.ids` E2E fixture。

## Impact

- Affected code: `bim-review-coordinator`（first-frame route + 型別鏈，additive、回歸鎖 coordinator 441 tests 綠）；`web-viewer-sample`（`EmbeddedViewer` + `Window` listener + `A1GovernanceWorkbenchPage` / `ViewerPresentationPage` + E2E，回歸鎖 349 tests 綠）；`governance-service`（E2E IDS fixture `vg01-highlight-column.ids`）。
- 非目標（各自獨立 spec / change）：A2 onion-skin 三色、A3 圖層+clash 發光球、A1 snapshot-to-BCF、heartbeat 遙測（IX-SS-02）；七區塊只交付第 6（A1 紅高亮）+ 第 7（反向 selected_guid）。
- userFacing: true（`#a1` / `#viewer`）。P4 真 Kit 串流取證：test 1 first frame 綠 + stage matched **PASS**（截圖入庫 `docs/evidence/`）；test 2 紅高亮**操作鏈 PASS**（rule-run model.ifc → 25 mapped IfcColumn failed → 高亮鈕 enable → highlight_result「已在 3D 標示」、viewer live、stage matched）——中央 3D 視覺紅色 column 因 270 georeferenced 模型相機框取未清楚捕捉（誠實揭露，非 pipeline 失敗）。
- 風險: cross-build-target（console `build:ui` + viewer `:5173`/`:5180` image 雙重建）；in-memory `first_frame_at`（coordinator 重啟清除，最小一筆非 exactly-once，完整持久化屬 IX-SS-02）。
- 流程誠實揭露: task#0-5 的 P3 自動 quality 迴圈各 2 輪未閉合（task#3/#4 quality-fix r2 被 API 529 中斷），由指揮官手動修 + ultracode 對抗驗證（兩輪：task#3-5 + 全 branch）閉合；regression fix 為 test-only（A1 頁 mount 真 runtimeStatus 在 fake-timer 不 settle）。
