# review-session-request-lifecycle — Spec Delta (remove-conflict-review-from-fast-mvp)

> Delta against `openspec/specs/review-session-request-lifecycle/spec.md`(本檔僅含本 change 的差異)。
> 既有 spec 內**沒有專屬於 conflict review / issue handoff 的 requirement**;`highlightRequest` / `selectionUpdate` / `annotationCreated` / `finalReviewEvent` 等 collaboration event 名詞只出現在 lifecycle audit endpoint 的「排除清單」中。因此本 change 採 MODIFIED 方式,在「Coordinator exposes lifecycle event audit log」requirement 內加入 implementation status note,記錄 collaboration events 已不再由 coordinator 產生;排除清單文字保留,以維持 archive / historical compatibility(舊 event log 可能仍含這些 type)。

## MODIFIED Requirements

### Requirement: Coordinator exposes lifecycle event audit log

The coordinator SHALL expose `GET /api/review-sessions/{session_id}/lifecycle-events` for review session lifecycle audit events. The response MUST contain an `items` array sorted by append order and `sequence`. This endpoint MUST return lifecycle audit events only and MUST NOT include generic collaboration events such as `highlightRequest`, `selectionUpdate`, `annotationCreated`, or `finalReviewEvent`.

The lifecycle event audit log MUST include at least these lifecycle event types when the corresponding transition occurs: `sessionCreated`, `sessionActive`, `sessionClosing`, `sessionClosed`, and `kitInstanceReleased`.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `remove-conflict-review-from-fast-mvp` removed the coordinator `highlightRequest` / `selectionUpdate` / `annotationCreate` Socket.IO event handlers (in `bim-review-coordinator/src/socket/reviewNamespace.ts`) and the viewer `IssuePanel` / `EventLogPanel` / `bimControlClient.getReviewIssues` / `coordinatorClient.getReviewBootstrap` paths. New generic collaboration events of those types are no longer produced. The exclusion wording covering `highlightRequest`, `selectionUpdate`, `annotationCreated`, and `finalReviewEvent` from lifecycle audit is preserved for archive / historical compatibility — existing event logs may still contain those event types from earlier runs, and the lifecycle endpoint MUST still exclude them. The companion `compose.host-kit.yml` change pinned `viewer.ports` to `127.0.0.1:5173:5173` so the viewer is no longer addressable from LAN, aligning with the Kit-1:1 boundary that excludes broadcast collaboration. If conflict review is re-introduced under a future OpenSpec change, that change SHALL add back the corresponding collaboration ADD requirements and viewer slots.

#### Scenario: Lifecycle audit events are returned in append order

- **WHEN** a client requests `GET /api/review-sessions/{session_id}/lifecycle-events` for an existing review session
- **THEN** the coordinator returns lifecycle audit events sorted by increasing `sequence`
- **AND** every item includes `event_id`, `session_id`, `type`, `sequence`, `created_at`, and `payload`

#### Scenario: Closing a session records lifecycle events

- **WHEN** a close request is accepted for an active review session
- **THEN** the coordinator appends `sessionClosing`, `sessionClosed`, and `kitInstanceReleased` lifecycle audit events
- **AND** the `kitInstanceReleased` payload identifies released `kit_instance_bindings`

#### Scenario: Collaboration events are excluded from lifecycle audit

- **WHEN** a session record still contains historical generic events such as highlight, selection, annotation, or final review events (from earlier runs before this change, or from re-introduction under a future ADD)
- **THEN** `GET /api/review-sessions/{session_id}/events` MAY continue to return those generic events
- **AND** `GET /api/review-sessions/{session_id}/lifecycle-events` excludes those generic events

#### Scenario: Unknown session lifecycle events are not returned

- **WHEN** a client requests lifecycle events for an unknown or invalid review session id
- **THEN** the coordinator returns the same not-found or validation behavior used by the review session event APIs
