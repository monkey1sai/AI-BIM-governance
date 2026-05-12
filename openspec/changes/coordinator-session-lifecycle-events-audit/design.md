## Context

`review-session-request-lifecycle` 已經定義 review intent、coordinator session lifecycle、close/release 語意，以及 `_bim-control` 需要保存足以稽核的 lifecycle events 或 binding updates。目前實作已有兩條事件來源：

- `_bim-control` 以 review request 為中心，記錄 `reviewRequestCreated` 與 patch 時帶入的 `sessionBound` lifecycle event。
- `bim-review-coordinator` 以 review session 為中心，在 session create / active / close / release 流程寫入 session events JSONL。

問題不在「完全沒有事件」，而是 lifecycle audit contract 還不夠固定：event payload 沒有 sequence、lifecycle endpoint 與 generic event feed 邊界不清楚，後續 webhook / observability spec 若直接訂閱既有 generic events，會把協作事件、annotation event 與 session lifecycle event 混在一起。

## Goals / Non-Goals

**Goals:**

- 讓 `bim-review-coordinator` 暴露穩定的 review session lifecycle audit endpoint。
- 讓 lifecycle audit events 有固定最小欄位：`event_id`、`session_id`、`type`、`sequence`、`created_at`、`payload`。
- 讓 lifecycle event type 至少涵蓋 `sessionCreated`、`sessionActive`、`sessionClosing`、`sessionClosed`、`kitInstanceReleased`。
- 讓 session audit event 可關聯 `_bim-control` review request event：`review_request_id`、`session_id`、必要時的 `correlation_id`。
- 保留既有 `GET /api/review-sessions/{session_id}/events` generic feed，避免破壞 dev console / collaboration event tests。

**Non-Goals:**

- 不建立 production audit database、retention policy、法遵保存、billing ledger 或 webhook delivery。
- 不把 `_bim-control` 改成 coordinator session log 的 owner。
- 不把 highlight / selection / annotation 等 collaboration events 改造成 lifecycle events。
- 不修改 Kit / WebRTC / DataChannel runtime。

## Decisions

### 1. Lifecycle audit 使用 coordinator 現有 append-only JSONL

`bim-review-coordinator` 已有 `EventLog`，且目前以 session id 分檔寫 JSONL。這符合本 change 的最小需求：本地 demo 可稽核、append-only、容易測試，不需要新增 DB 或 production dependency。

替代方案是新增 SQLite / Postgres audit table；但這會提前把 Phase 6 audit persistence 拉進來，和 roadmap 中「audit log persistence + 法遵保存等待業務接入」的凍結狀態衝突，因此不採用。

### 2. 新 endpoint 是 lifecycle view，不取代 generic events

`GET /api/review-sessions/{session_id}/events` 保持 generic event feed，可包含 annotation、highlight、selection 或 finalReviewEvent。新增或正式化的 `GET /api/review-sessions/{session_id}/lifecycle-events` 只回 lifecycle audit event type。

這讓 #6 mock webhook 或後續 observability 可以訂閱 lifecycle stream，不需要理解所有協作事件。

### 3. Event type 用單數 `kitInstanceReleased`

Roadmap KPI 使用 `kitInstanceReleased`。既有實作有 `kitInstancesReleased`，但固定 schema 應採單數 event type，payload 可包含一個或多個 released bindings。實作可在 migration 時支援 legacy type 讀取，但新的 lifecycle endpoint 應輸出 `kitInstanceReleased`。

### 4. `_bim-control` 只補 review request 關聯，不接管 session audit

`_bim-control` 的 source of truth 是 review request / fake BIM metadata。它可以保存 `reviewRequestCreated`、`sessionBound` 與 `session_id` / `review_request_id` 關聯，讓 audit chain 從 intent 接到 coordinator session；但 session transition 的 sequence 與 close/release audit 仍由 coordinator 管。

## Risks / Trade-offs

- [Schema drift] 既有 tests 或 dev console 可能還看 generic `events` feed。-> 保留舊 endpoint，只新增 lifecycle filtered endpoint。
- [Legacy event naming] 已有 `kitInstancesReleased` event。-> 新寫入使用 `kitInstanceReleased`，必要時讀取端可兼容 legacy type。
- [Local JSONL limits] JSONL 不等於 production-grade audit store。-> 明確列為 local/demo baseline；production persistence 留給 Phase 6 / observability change。
- [Cross-service correlation incomplete] `_bim-control` 與 coordinator 不是同一個 transaction。-> 以 `review_request_id` / `session_id` / `correlation_id` 做 best-effort audit chain，不宣稱強一致。

## Migration Plan

1. 以 backward-compatible 方式擴充 coordinator `EventLog` event shape，新增 `sequence`。
2. 新增 lifecycle event type filter 與 endpoint，不移除 existing generic events endpoint。
3. 將 close/release 新寫入 event type 對齊 `kitInstanceReleased`。
4. 補 coordinator tests 驗證 sequence、append-only order、lifecycle endpoint filtering 與 required event types。
5. 視現有 `_bim-control` payload 缺口，補 review request lifecycle event schema tests。

Rollback：revert implementation PR。既有 generic event feed 與 review request lifecycle event files 可維持原狀。

## Open Questions

- `correlation_id` 是否先沿用 `review_request_id`，或在 coordinator create session 時產生獨立 id？
- lifecycle endpoint 是否應回傳 `_bim-control` request-side events 的 merged view，或只回 coordinator session-side events 並透過 `review_request_id` 讓 client 自行查 request events？
