# Streaming DataChannel Events

These events are exchanged between `web-viewer-sample` and `bim-streaming-server`.

## Open Stage

Request:

```json
{
  "event_type": "openStageRequest",
  "payload": {
    "url": "http://127.0.0.1:8005/objects/tenants/.../model.usdc",
    "artifact_bindings": [
      {
        "artifact_group_id": "ag_xxx",
        "artifact_id": "artifact_usdc_xxx",
        "artifact_role": "derived",
        "url": "http://127.0.0.1:8005/objects/tenants/.../model.usdc",
        "mapping_url": "http://127.0.0.1:8005/objects/tenants/.../element_mapping.json",
        "load_order": 0,
        "ready_status": "ready"
      }
    ]
  }
}
```

Response:

```json
{
  "event_type": "openedStageResult",
  "payload": {
    "url": "http://127.0.0.1:8005/objects/tenants/.../model.usdc",
    "result": "success",
    "error": "",
    "applied_mode": "artifact_bindings_multi_layer_payload",
    "primary_binding": {
      "artifact_id": "artifact_usdc_xxx",
      "load_order": 0,
      "url": "http://127.0.0.1:8005/objects/tenants/.../model.usdc"
    },
    "loaded_bindings": [
      {
        "artifact_id": "artifact_usdc_xxx",
        "load_order": 0,
        "composition_strategy": "primary_stage"
      },
      {
        "artifact_id": "artifact_overlay_xxx",
        "load_order": 10,
        "composition_strategy": "session_sublayer"
      }
    ],
    "failed_bindings": [],
    "partial_load": false,
    "missing_paths": [],
    "fallback_paths": []
  }
}
```

When `url` is provided, Kit loads that URL directly and reports
`applied_mode="single_url"` for backward compatibility. When `url` is omitted,
`bim-streaming-server` sorts `artifact_bindings[]` by `load_order`, opens the
first ready binding as the primary stage, and composes every additional ready
binding into the session layer as a sublayer/payload-style layer.

`applied_mode` values:

```txt
single_url
artifact_bindings_single
artifact_bindings_multi_layer_payload
```

Missing binding URLs are returned in `missing_paths`. Secondary binding load
failures are returned in `failed_bindings` and set `partial_load=true`; they do
not falsely report the whole multi-artifact session as fully loaded.

GPU / Kit manual validation when hardware is available:

1. Start local services with `.\scripts\start-all.ps1`, or start Kit manually with `.\bim-streaming-server\scripts\start-streaming-server.ps1 -SkipAutoLoad`.
2. Create worker artifacts and a review session with `.\scripts\smoke-worker-review-request.ps1`, then open `web-viewer-sample` with the returned `review_request_id` or `session_id`.
3. Confirm the viewer sends `openStageRequest` with `artifact_bindings[]`, Kit returns `openedStageResult.result="success"`, and `applied_mode` is `single_url`, `artifact_bindings_single`, or `artifact_bindings_multi_layer_payload`.
4. Send `highlightPrimsRequest` against a known mapped `usd_prim_path`; real validation requires `missing_paths=[]` and `fallback_paths=[]`.
5. Treat `/World` fallback as stream/DataChannel liveness only, not mapping correctness.

## Highlight Prims

Request:

```json
{
  "event_type": "highlightPrimsRequest",
  "payload": {
    "request_id": "mapping-highlight-001",
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
    "request_id": "mapping-highlight-001",
    "applied_mode": "selection",
    "selected_paths": ["/World"],
    "missing_paths": [],
    "fallback_paths": []
  }
}
```

The first implementation may use selection as the visual fallback. It must return missing prims instead of crashing.

Stage-root fallback rules:

- Fallback is triggered only when the requested `prim_path` equals `/World`. Any other unresolved path (for example `/World/Floor1/Wall_1`) is returned as-is in `missing_paths`, never silently rewritten to a different prim.
- When `/World` is missing, Kit resolves to the stage `defaultPrim` (or the first non-Render, non-`OmniverseKit_*` child of the pseudo-root) and reports the substitution under `fallback_paths`.

If a converted BIM stage uses another root prim such as `/model`, a `/World` request may resolve to the stage default prim and return:

```json
{
  "event_type": "highlightPrimsResult",
  "payload": {
    "result": "success",
    "request_id": "mapping-highlight-001",
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

## Focus Prim

Request:

```json
{
  "event_type": "focusPrimRequest",
  "payload": {
    "request_id": "mapping-focus-001",
    "prim_path": "/World/IFCWALL/tn__115cm551956_body"
  }
}
```

Response:

```json
{
  "event_type": "focusPrimResult",
  "payload": {
    "result": "success",
    "request_id": "mapping-focus-001",
    "prim_path": "/World/IFCWALL/tn__115cm551956_body",
    "requested_prim_path": "/World/IFCWALL/tn__115cm551956_body",
    "applied_mode": "selection"
  }
}
```

`request_id` is optional, but when present Kit must echo it in `highlightPrimsResult` / `focusPrimResult`.

## Web Viewer Demo Panel

`web-viewer-sample` exposes a local demo panel when `VITE_SHOW_DEMO_PANEL=true` (default for this MVP). The panel can manually send:

```txt
openStageRequest
loadingStateQuery
getChildrenRequest /World
highlightPrimsRequest /World (smoke-only; not mapping correctness)
focusPrimRequest /World (smoke-only; not mapping correctness)
clearHighlightRequest
```

Demo `highlightPrimsRequest` payload:

```json
{
  "event_type": "highlightPrimsRequest",
  "payload": {
    "request_id": "world-smoke-001",
    "mode": "replace",
    "items": [
      {
        "prim_path": "/World",
        "ifc_guid": "2VJ3sK9L000fake001",
        "color": [1, 0, 0, 1],
        "label": "Demo highlight from Web Viewer Demo Panel",
        "source": "web_viewer_demo_panel",
        "issue_id": "ISSUE-DEMO-001"
      }
    ],
    "focus_first": true
  }
}
```

Demo panel incoming/outgoing logs are UI diagnostics only. `/World` fallback proves only that the stream/DataChannel path is alive; it is not evidence that `element_mapping.json` is correct. Mapping correctness requires a real `element_mapping.json.items[*].usd_prim_path` response with `missing_paths=[]` and `fallback_paths=[]`. Persistent review data still belongs to `_bim-control`, while collaboration broadcast belongs to `bim-review-coordinator`.
