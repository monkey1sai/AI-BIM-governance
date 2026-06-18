## ADDED Requirements

### Requirement: Operator 結束 session controlled action（重用 close 路由 + 模式 3 audit）

協調器 SHALL 對 review session 提供 operator 可在 `#sessions` 觸發的「結束 session」controlled action，沿用 IX 模式 3（intent→confirm→audited）。本動作**重用既有 `POST /api/review-sessions/:sessionId/close`**（不開新 `/terminate` 路由）：operator terminate 在語意上是 cooperative close 的超集（drain→`releaseKitBindings` + append 終結事件）。close 路由 additive 接受 optional `reason`（經 `.trim()`，空白/空字串視同無 reason）並把 `reason`/`actor`（caller header best-effort 或 `local-operator`）寫進既有 `sessionClosing`/`sessionClosed` 事件 payload 作 audit；`reason` 不外溢回傳 body。既有 cooperative close 呼叫端（帶 `final_events`、不帶 `reason`）行為零退化。audit「who」為 best-effort（B 方案 LAN、無 RBAC），不偽造身分。本動作只釋放 coordinator 端 session/binding，**不殺 GPU 上的 Kit 行程**（Kit lifecycle 屬 kit-manager-api）。

#### Scenario: operator 結束 active session（帶 reason）

- **WHEN** operator 對 `status==="active"` 的 session 點 per-row「結束 session」鈕、於 `IntentDialog` 確認（可選填 reason）→ `POST /api/review-sessions/:id/close {reason}`
- **THEN** session 經 `closing`→`closed` 狀態機釋放 Kit binding（`releaseKitBindings`），`sessionClosing`/`sessionClosed` 事件 payload 含 `reason`/`actor`，回 200 並回傳 `closed` session 物件（`reason` 不在 body）

#### Scenario: 既有 cooperative close 零退化（不帶 reason）

- **WHEN** 既有 viewer 呼叫端帶 `final_events`、不帶 `reason` 觸發 close
- **THEN** 行為與本變更前一致：`reason`/`actor` 不入 payload（形狀不變）、`final_events` 照常 append、`releaseKitBindings` 照常、冪等（已 closed 回傳）/safe-id 400/不存在 404 零改動

#### Scenario: reason 經 trim、空白不污染 audit

- **WHEN** close 帶 `reason:"   "`（純空白）或 `reason:""`（空字串）
- **THEN** 後端 `.trim()||undefined` 視同無 reason，`sessionClosing`/`sessionClosed` payload 不含 `reason`/`actor`，cooperative payload 形狀不退化

#### Scenario: close 路由刻意不加 IP allowlist 守門（使用者裁定 A）

- **WHEN** 評估是否對 close 路由比照 sibling controlled-action（prioritize/retry/watch）補 `rejectIfIpNotAllowed`
- **THEN** close 路由刻意**不加** IP 守門——因同端點同時服務 browser-originated cooperative close 與 operator terminate，兩者無 header/body 欄位可區分，加門控會讓既有 cooperative 呼叫端在 IP 不在 allowlist 時吃 403（違反零退化）；路由頂端以註解記錄此刻意缺席避免日後誤補

#### Scenario: 前端 #sessions per-row 結束鈕與灰列因果

- **WHEN** `#sessions` 表渲染 sessions（`active` / `closing` / `closed` 混合）
- **THEN** 僅 `status==="active"` 的列顯示「結束 session」鈕（`closing`/`closed` 顯狀態文字、不給假按鈕）；點按為非樂觀（POST 成功後 `load()` 重抓真 `runtime/status`），成功後該列轉灰（`ec-row-muted`）60s 再從可見列移除（timer 以 `useEffect` cleanup 清除防 leak）；失敗（400/404/5xx）顯誠實錯誤、不改狀態、不關 dialog
