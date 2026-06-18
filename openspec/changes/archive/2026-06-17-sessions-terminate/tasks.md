# Tasks — sessions-terminate（IX-SS-04）

對應 plan `docs/superpowers/plans/2026-06-17-sessions-terminate.md`（6 tasks）。狀態於 PR 收尾依實際實作勾選。

- [x] 1. coordinator close 路由（`POST /api/review-sessions/:sessionId/close`）additive 補模式 3 audit：optional `reason`（`.trim()`、空白/空字串視同無 reason）+ `resolveActor` best-effort + `reason`/`actor` 加進 `sessionClosing`/`sessionClosed` 事件 payload；`reason` 不外溢回傳 body。**使用者裁定 A：刻意不加 IP allowlist 守門**（close 同端點服務 cooperative close + operator terminate，無法分離門控），頂端加說明性註解。回歸鎖：既有 cooperative close（不帶 reason）payload 形狀/release/final_events/冪等/safe-id/404 零退化；補 `resolveActor` 的 `X-Actor` fallback / `local-operator` default 測試 + whitespace/空字串 reason 不污染測試。
- [x] 2. 前端 `coordinatorClient` 補 `sessionClose(sessionId, reason?)` thin wrapper（重用 `jsonPost`；`jsonPost` 失敗路徑萃取後端 `{detail}` 支撐 §5 誠實錯誤）+ 單元測試（含 `sessionClose("id","")` 空字串 reason wire 契約、conversionRetry detail 對稱測試鎖 jsonPost errorDetail 回歸）。
- [x] 3. 前端 `#sessions` per-row「結束 session」鈕（僅 `status==="active"` 顯示）+ `IntentDialog`（誠實成本文案）+ 非樂觀（POST 後 `load()` 重抓）+ 灰列（`ec-row-muted`）60s timer（`useEffect` cleanup 防 leak）；保留 690/691 disabled 的 IX-SS-03 佔位。
- [x] 4. 前端 vitest（`SessionManagementPage`）：結束鈕僅 active 顯示、confirm 呼叫 `sessionClose`、成功後 `load()` 重抓（非樂觀）、失敗顯 `actionErr` 不關 dialog、灰列 + 60s fake-timer 移除。
- [x] 5. GitNexus impact / detect_changes：改 close 路由前 impact（LOW，additive auditFields 0 upstream consumers）；commit 前 detect_changes scope 驗（只動 bim-review-coordinator + web-viewer-sample；linked-worktree 限制下走 git diff fallback 確認）。
- [x] 6. Browser E2E（Playwright，`e2e/sessions-terminate.spec.ts`，誠實可達框架）：種真 active session → 結束鈕 → IntentDialog → 真 POST `/close` 2xx → runtime/status `active→closed` + 灰列（path b 硬斷言）；conditional skip-guard 揭露 + render-surface 截圖落 `docs/evidence/sessions-terminate/`。
