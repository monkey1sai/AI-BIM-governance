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
