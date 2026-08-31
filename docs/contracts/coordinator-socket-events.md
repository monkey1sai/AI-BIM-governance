# Coordinator Socket Events

Namespace:

```txt
/review
```

## Client To Coordinator

```txt
joinSession
leaveSession
heartbeat
userActivity
```

`joinSession` payload:

```json
{
  "session_id": "review_session_xxx",
  "user_id": "dev_user_001",
  "display_name": "Dev User"
}
```

`heartbeat` proves Socket connectivity only and does not reset inactivity.
`userActivity` is accepted only after the socket joined the same session and
must carry that session's canonical `trace_id`:

```json
{
  "session_id": "review_session_xxx",
  "trace_id": "rev_review_session_xxx"
}
```

`highlightRequest` payload:

```json
{
  "session_id": "review_session_xxx",
  "user_id": "dev_user_001",
  "source": "issue_panel",
  "issue_id": "ISSUE-DEMO-001",
  "items": [
    {
      "usd_prim_path": "/World",
      "ifc_guid": "2VJ3sK9L000fake001",
      "color": [1, 0, 0, 1],
      "label": "測試：BIM issue highlight"
    }
  ]
}
```

`annotationCreate` also appends local coordinator shadow metadata and can be
forwarded to the external control-plane callback path:

```http
POST /api/review-sessions/{session_id}/annotations
```

## Coordinator To Clients

```txt
presenceUpdated
session:idle_countdown
session:idle_countdown_cancelled
session:closed
```

Events are broadcast to the same `session_id` room except the sender where appropriate.

Idle lifecycle events carry both `session_id` and the canonical `trace_id`.
`session:idle_countdown` also carries `remaining_seconds` and
`reason=inactivity`; cancellation is emitted only after positively recorded
user activity. `session:closed` is emitted after the existing close path writes
`reason=inactivity` to the session event ledger.

`highlightRequest`, `selectionUpdate`, and `annotationCreated` are room scoped: a second browser client joined to the same `session_id` receives the broadcast while other sessions do not. `annotationCreate` returns an ack error if local shadow persistence or the configured external callback path cannot save the annotation, but the namespace stays alive.

## Ack And Session Validation

All session-scoped client events validate `session_id` before mutating presence, appending the event log, broadcasting to a room, or writing coordinator shadow/callback state.

Successful ack:

```json
{ "ok": true }
```

Validation failures:

```json
{ "ok": false, "error": "Missing session_id" }
{ "ok": false, "error": "Invalid review session id." }
{ "ok": false, "error": "Review session not found." }
{ "ok": false, "error": "Review session is not active." }
```

`joinSession`, `heartbeat`, `userActivity`, and `leaveSession` must not mutate
presence or idle state when the session does not exist or is `closing`,
`closed`, or `failed`. A connectivity `heartbeat` must never count as user
activity.
