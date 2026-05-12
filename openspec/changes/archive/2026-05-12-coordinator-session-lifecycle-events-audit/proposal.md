## Why

`review-session-request-lifecycle` 已要求 coordinator 與 `_bim-control` 能稽核 review intent 到 session lifecycle 的轉換，但目前 lifecycle events 仍分散在 coordinator session events 與 `_bim-control` review request events 中，缺少固定、可訂閱、append-only 的 audit event contract。

這個 change 讓 `bim-review-coordinator/` 成為 review session lifecycle audit 的主 owner，並讓 `_bim-control/` 維持 review request metadata authority；後續 webhook / observability spec 可訂閱同一套穩定 event schema，而不是各自猜 payload。

## What Changes

- 在 `bim-review-coordinator/` 收斂 lifecycle audit event schema，要求 event 至少包含 `event_id`、`session_id`、`type`、`sequence`、`created_at`、`payload`。
- 新增或收斂 `GET /api/review-sessions/{session_id}/lifecycle-events`，回傳 append-only、依 sequence 排序的 lifecycle audit 序列。
- 明確要求 coordinator lifecycle audit 至少記錄 `sessionCreated`、`sessionActive`、`sessionClosing`、`sessionClosed`、`kitInstanceReleased`，並能關聯 `_bim-control` 的 `reviewRequestCreated` / `sessionBound`。
- `_bim-control/` 只補足 review request lifecycle event 欄位與回寫語意；它仍是 fake BIM metadata / review request authority，不接管 coordinator session log。
- 保留既有 collaboration / user interaction event flow；highlight、selection、annotation 等非 lifecycle 事件不在本 change 內重定義。
- 非目標：不做 production-grade audit retention、法遵保存、Prometheus/Grafana observability、webhook delivery、billing event，也不新增外部資料庫或 production dependency。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `review-session-request-lifecycle`: 收緊「Session lifecycle is explicit」需求，將足以稽核的 lifecycle events 具體化為 append-only lifecycle audit log 與固定 event schema。

## Impact

- `bim-review-coordinator/`：主要修改範圍。可能調整 `src/services/eventLog.ts`、`src/app.ts`、session lifecycle tests 與 review session API contract。
- `_bim-control/`：次要修改範圍。若現有 review request lifecycle events 缺少關聯欄位，補足 request/session binding event schema 與 tests。
- API / event contract：新增或正式化 `GET /api/review-sessions/{session_id}/lifecycle-events`，並保留 `GET /api/review-sessions/{session_id}/events` 作為既有 generic session event feed。
- Storage：仍使用 coordinator 現有 local append-only JSONL event file，不新增 production database。
- Runtime / UI：不修改 `bim-streaming-server/`、`web-viewer-sample/` 的 WebRTC / DataChannel runtime ownership。
