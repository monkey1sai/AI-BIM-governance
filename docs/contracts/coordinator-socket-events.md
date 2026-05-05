# Coordinator Socket Events

Namespace:

```txt
/review
```

## Client To Coordinator

```txt
joinSession
leaveSession
highlightRequest
selectionUpdate
annotationCreate
heartbeat
```

`joinSession` payload:

```json
{
  "session_id": "review_session_xxx",
  "user_id": "dev_user_001",
  "display_name": "Dev User"
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

`annotationCreate` also writes through to `_bim-control`:

```http
POST /api/review-sessions/{session_id}/annotations
```

## Coordinator To Clients

```txt
presenceUpdated
highlightRequest
selectionUpdate
annotationCreated
```

Events are broadcast to the same `session_id` room except the sender where appropriate.

`highlightRequest`, `selectionUpdate`, and `annotationCreated` are room scoped: a second browser client joined to the same `session_id` receives the broadcast while other sessions do not. `annotationCreate` returns an ack error if `_bim-control` cannot save the annotation, but the namespace stays alive.

## Ack And Session Validation

All session-scoped client events validate `session_id` before mutating presence, appending the event log, broadcasting to a room, or calling `_bim-control`.

Successful ack:

```json
{ "ok": true }
```

Validation failures:

```json
{ "ok": false, "error": "Missing session_id" }
{ "ok": false, "error": "Invalid review session id." }
{ "ok": false, "error": "Review session not found." }
```

`joinSession`, `leaveSession`, `highlightRequest`, `selectionUpdate`, and `annotationCreate` must not join a Socket.IO room, write event log entries, or persist annotations when the session does not exist.
