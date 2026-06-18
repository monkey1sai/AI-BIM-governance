# Tasks — conv-prioritize-retry（IX-CV-03）

對應 plan `docs/superpowers/plans/2026-06-16-conv-prioritize-retry.md`。全部已實作 + 回歸鎖（coordinator 401 tests、web-viewer 271 tests、E2E retry slice 真綠）。

- [x] 0. dispatcher delete-on-success 改造（先決）：`pendingDispatchEvents` 成功才刪、失敗保留供 retry；`dispose()` 冪等；`hasPendingDispatch` getter 不外洩 map。回歸鎖 `conversion-dispatch-queue.test.ts`。
- [x] 1. `ConversionDispatchQueue` additive `prioritize` / `requeue`（誠實 position、冪等不重複 append）。
- [x] 2. 協調器兩條控制路由（prioritize/retry）+ safe-id（`isSafeIfcReadyJobId`）+ IP 守門 + 結構化 audit（reason/actor）。新 `conversion-control-routes.test.ts`（14 passed：真狀態轉移、4xx 邊界、audit 落盤）。
- [x] 3. `queue_position` 上 wire：`summarizeIfcReadyJob` additive 加欄 + `IfcReadyListItem` non-optional 型別。回歸鎖 `external-ifc-ready.test.ts`。
- [x] 4. 前端 `coordinatorClient` 補 `jsonPost` + `conversionPrioritize` / `conversionRetry` + 回應型別。
- [x] 5. 前端 `IntentDialog`（首個 controlled-action 共用件，模式 3 ① ②，非樂觀）+ 單元測試。
- [x] 6. `#conv` 列控制按鈕接 `IntentDialog` 真 POST + 證據型刷新（POST 成功但重抓失敗保持 dialog 開啟 + 誠實錯誤）+ `ConversionSchedulingPage.test.tsx` 覆蓋。
- [x] 7. Browser E2E（Playwright，誠實可達框架）：retry 切片真綠（指揮官可控 stack 種 `dispatch_failed`）+ render-surface + `notObserved` 揭露；evidence 落 `docs/evidence/conv-prioritize-retry/`。
- [x] 8. 全量回歸（coordinator 401 / web-viewer 271 全綠、tsc/vite build 乾淨、lint 乾淨）+ scope 確認（git-diff fallback：只動 coordinator + web-viewer + docs，`bim-streaming-server` 零改）。
