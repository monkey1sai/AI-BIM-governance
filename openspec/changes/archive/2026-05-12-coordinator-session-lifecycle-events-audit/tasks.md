## 1. 準備與影響檢查

- [x] 1.1 重新閱讀本 change 的 proposal、design、spec delta，以及 `openspec/specs/review-session-request-lifecycle/spec.md`。
- [x] 1.2 重新閱讀 `bim-review-coordinator/src/services/eventLog.ts`、`bim-review-coordinator/src/app.ts`、`bim-review-coordinator/tests/sessions.test.ts`、`_bim-control/app/main.py`、`_bim-control/tests/test_review_session_requests_api.py`、`docs/contracts/review-session-api.md` 與 `docs/contracts/bim-control-fake-api.md`。
- [x] 1.3 對 `EventLog.append`、`EventLog.list`、coordinator lifecycle endpoint、`_append_lifecycle_event` 與任何準備修改的 symbol 執行 GitNexus impact analysis；若出現 HIGH/CRITICAL risk，先回報再改 code。

## 2. Coordinator Lifecycle Audit Log

- [x] 2.1 擴充 coordinator `EventLog` event shape，讓新寫入事件包含 append-only `sequence`，並保持 legacy event 讀取相容。
- [x] 2.2 定義 lifecycle event type filter，至少涵蓋 `sessionCreated`、`sessionActive`、`sessionClosing`、`sessionClosed`、`kitInstanceReleased`。
- [x] 2.3 新增 `GET /api/review-sessions/:sessionId/lifecycle-events`，回傳只含 lifecycle audit events 的 `{ items: [...] }`。
- [x] 2.4 將 close/release 寫入的 release lifecycle event 對齊 `kitInstanceReleased`，payload 保留 released `kit_instance_bindings`。
- [x] 2.5 保留 `GET /api/review-sessions/:sessionId/events` generic event feed 行為，避免 collaboration / annotation event flow 被重定義。

## 3. `_bim-control` Review Request Correlation

- [x] 3.1 確認 `_bim-control` review request lifecycle events 保存 `review_request_id`，並在 `sessionBound` payload 保留 `session_id`。
- [x] 3.2 若缺少 correlation 欄位，補足 `review_request_id` / `session_id` / `type` / `created_at` 的最小 event schema。
- [x] 3.3 補 tests 證明 request-side `reviewRequestCreated` 與 `sessionBound` 可被查詢，且未知 request 仍維持既有 not-found / empty behavior。

## 4. Tests 與文件

- [x] 4.1 補 coordinator tests：lifecycle endpoint 回傳 `sequence` 遞增、必要 event types、排除 generic collaboration events。
- [x] 4.2 補 coordinator tests：close session 後產生 `sessionClosing`、`sessionClosed`、`kitInstanceReleased`。
- [x] 4.3 更新 `docs/contracts/review-session-api.md`，記錄 `GET /api/review-sessions/{session_id}/lifecycle-events` 與 lifecycle event schema。
- [x] 4.4 若 `_bim-control` contract 有 schema 調整，更新 `docs/contracts/bim-control-fake-api.md`。
- [x] 4.5 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 與同名 HTML，標示 #4 已成為 active OpenSpec change；不把 Phase 6 audit persistence 解凍。

## 5. Validation

- [x] 5.1 執行 `openspec validate coordinator-session-lifecycle-events-audit --strict`。
- [x] 5.2 執行 `cd bim-review-coordinator && npm test`。
- [x] 5.3 若有修改 `_bim-control`，從 `_bim-control/` 執行 `python -m pytest tests` 或 focused review session request tests。
- [x] 5.4 執行 `git diff --check`。
- [x] 5.5 Commit 前執行 `gitnexus_detect_changes()` 或等效 GitNexus change detection，確認 affected scope 限於 coordinator lifecycle audit、`_bim-control` review request lifecycle correlation、OpenSpec artifacts 與對應文件。
