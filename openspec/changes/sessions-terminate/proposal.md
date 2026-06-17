## Why

`#sessions`（`SessionManagementPage`）的「結束 session」目前讀側 real（`GET /api/runtime/status` 讀 live `SessionStore`）但寫側全 disabled——control-plane 面板四顆按鈕全為佔位。本提案為 IX-SS-04「結束 session」controlled action，把 `#sessions` 從唯讀翻成 per-row 真按鈕 + 真後端 release，沿用 IX 模式 3（intent→confirm→audited），補上 M2→M3 過渡的 #sessions 控制動作首張卡。

**刻意偏離 spec 原文 URL（使用者裁定 2026-06-17）**：IX-SS-04 互動卡原文指定 `POST /api/sessions/:id/terminate`；本實作**重用既有 `POST /api/review-sessions/:sessionId/close`**，不開新路由。理由：(a) 最小改動、零重複 release 邏輯；(b) cooperative `close`（drain→release binding + append 終結事件）在語意上是 operator `terminate` 的超集，行為等價；(c) 避免兩條語意重疊路由日後分裂。權威序：使用者最新明確指令 > docs/plans 行為合約，故此偏離合規。

## What Changes

- coordinator close 路由（`POST /api/review-sessions/:sessionId/close`）**additive** 補模式 3 audit：body 接受 optional `reason`（經 `.trim()`，空白/空字串視同無 reason、不污染 payload）；`resolveActor` best-effort（caller header 或 `local-operator`）；`reason`/`actor` 加進既有 `sessionClosing`/`sessionClosed` 事件 payload。**既有 cooperative close 行為零退化**（不帶 reason 時 payload 形狀不變、`releaseKitBindings`/`final_events` 照常、冪等/safe-id/404 零改動）；`reason` 不外溢回傳 body。
- **使用者裁定 A（2026-06-17）**：close 路由**刻意不加** `rejectIfIpNotAllowed` IP allowlist 守門（與 sibling controlled-action 路由 prioritize/retry/watch 不同）——因 close 同端點同時服務 browser-originated cooperative close 與 operator terminate，兩者無欄位可區分，加門控會讓既有 cooperative 呼叫端在 IP 不在 allowlist 時吃 403（違反「零退化」）。close 路由頂端加說明性註解記錄此刻意缺席，防未來誤補。
- 前端 `coordinatorClient` 補 `sessionClose(sessionId, reason?)` thin wrapper（重用既有 `jsonPost`；`jsonPost` 失敗路徑改萃取後端 `{detail}`，對齊 `jsonPut`、支撐 §5 誠實錯誤）。
- 前端 `#sessions` 表加 per-row「結束 session」鈕（僅 `status==="active"` 顯示；`closing`/`closed` 不給假按鈕）→ 開既有 `IntentDialog`（誠實成本文案：釋放 Kit 座位、不殺 GPU Kit 行程）→ 非樂觀（POST 後 `load()` 重抓真狀態）→ 成功後該列轉灰（`ec-row-muted`）60s 再移除（IX-SS-04「看見因果」UX，timer 有 `useEffect` cleanup 防 leak）。
- 誠實鐵律：無樂觀更新、非 active 不給假按鈕、錯誤（400/404/5xx）顯誠實訊息不假成功、audit「who」best-effort 非身分稽核（B 方案 LAN、無 RBAC）、不殺 GPU Kit 行程（lifecycle 屬 kit-manager-api）。

## Impact

- Affected specs: `review-session-request-lifecycle`（ADDED：operator terminate controlled action + 模式 3 audit on close route）。
- Affected code: `bim-review-coordinator`（close 路由 additive audit）、`web-viewer-sample`（client `sessionClose`/`jsonPost` detail + `#sessions` per-row UI + 灰列 UX）。
- 不做 IX-SS-03（強制釋放 stale endpoint，依賴未實作的 IX-SS-02 心跳遙測，維持 disabled）；不碰 `bim-streaming-server` / 不殺 GPU Kit 行程；不建全站 RBAC / audit 持久層；不引入新 production dependency。
- userFacing：true（`#sessions` 控制動作，須 browser E2E 驗收）。
- 風險：close 路由 audit 為純 append-only 事件 payload additive（低風險，回歸鎖既有 cooperative close 測試）；灰列 60s timer 以 `useEffect` cleanup 緩解 unmount leak。
