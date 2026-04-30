# Streaming DataChannel Events

These events are exchanged between `web-viewer-sample` and `bim-streaming-server`.

## Open Stage

Request:

```json
{
  "event_type": "openStageRequest",
  "payload": {
    "url": "http://127.0.0.1:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc"
  }
}
```

Response:

```json
{
  "event_type": "openedStageResult",
  "payload": {
    "url": "http://127.0.0.1:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc",
    "result": "success",
    "error": ""
  }
}
```

## Highlight Prims

Request:

```json
{
  "event_type": "highlightPrimsRequest",
  "payload": {
    "mode": "replace",
    "items": [
      {
        "prim_path": "/World",
        "ifc_guid": "2VJ3sK9L000fake001",
        "color": [1, 0, 0, 1],
        "label": "Smoke Test",
        "source": "mock_compliance",
        "issue_id": "ISSUE-DEMO-001"
      }
    ],
    "focus_first": true
  }
}
```

Response:

```json
{
  "event_type": "highlightPrimsResult",
  "payload": {
    "result": "success",
    "applied_mode": "selection",
    "selected_paths": ["/World"],
    "missing_paths": [],
    "fallback_paths": []
  }
}
```

The first implementation may use selection as the visual fallback. It must return missing prims instead of crashing.
If a converted BIM stage uses another root prim such as `/model`, a `/World` request may resolve to the stage default prim and return:

```json
{
  "event_type": "highlightPrimsResult",
  "payload": {
    "result": "success",
    "applied_mode": "selection",
    "selected_paths": ["/model"],
    "missing_paths": [],
    "fallback_paths": [
      {
        "requested_path": "/World",
        "selected_path": "/model",
        "reason": "stage_root_fallback"
      }
    ]
  }
}
```
