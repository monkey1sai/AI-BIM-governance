# Review Session API

Base URL:

```txt
http://127.0.0.1:8004
```

## Endpoints

```http
GET  /health
POST /api/review-sessions
GET  /api/review-sessions/{session_id}
POST /api/review-sessions/{session_id}/join
POST /api/review-sessions/{session_id}/leave
POST /api/review-sessions/{session_id}/close
GET  /api/review-sessions/{session_id}/stream-config
GET  /api/review-sessions/{session_id}/events
POST /api/review-sessions/{session_id}/events
GET  /api/model-versions/{model_version_id}/review-bootstrap
```

## Create Session

```json
{
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "review_request_id": "review_request_xxx",
  "tenant_id": "tenant_demo_001",
  "created_by": "dev_user_001",
  "mode": "single_kit_shared_state",
  "routing_policy": "same_instance",
  "artifact_bindings": [
    {
      "artifact_group_id": "ag_xxx",
      "model_version_id": "version_demo_001",
      "artifact_id": "artifact_usdc_xxx",
      "artifact_role": "derived",
      "url": "http://127.0.0.1:8005/objects/tenants/.../model.usdc",
      "mapping_url": "http://127.0.0.1:8005/objects/tenants/.../element_mapping.json",
      "load_order": 0,
      "ready_status": "ready"
    }
  ],
  "options": {
    "auto_allocate_kit": true
  }
}
```

The coordinator allocates the fixed local Kit endpoint:

```json
{
  "instance_id": "kit_local_001",
  "provider": "local_fixed",
  "status": "allocated",
  "stream_server": "127.0.0.1",
  "signaling_port": 49100,
  "media_server": "127.0.0.1"
}
```

## Stream Config

`GET /api/review-sessions/{session_id}/stream-config` returns:

```json
{
  "session_id": "review_session_xxx",
  "lifecycle_status": "active",
  "source": "local_fixed",
  "webrtc": {
    "signalingServer": "127.0.0.1",
    "signalingPort": 49100,
    "mediaServer": "127.0.0.1"
  },
  "model": {
    "status": "ready",
    "artifact_id": "artifact_usdc_demo_001",
    "url": "http://127.0.0.1:8005/objects/tenants/tenant_demo_001/projects/project_demo_001/versions/version_demo_001/artifact-groups/ag_xxx/derived/conv_xxx/usdc/model.usdc",
    "mapping_url": "http://127.0.0.1:8005/objects/tenants/tenant_demo_001/projects/project_demo_001/versions/version_demo_001/artifact-groups/ag_xxx/derived/conv_xxx/usdc/element_mapping.json"
  },
  "artifacts": [
    {
      "artifact_id": "artifact_usdc_demo_001",
      "status": "ready",
      "url": "http://127.0.0.1:8005/objects/tenants/.../model.usdc"
    }
  ],
  "artifact_bindings": [
    {
      "artifact_group_id": "ag_xxx",
      "artifact_id": "artifact_usdc_demo_001",
      "url": "http://127.0.0.1:8005/objects/tenants/.../model.usdc",
      "mapping_url": "http://127.0.0.1:8005/objects/tenants/.../element_mapping.json",
      "load_order": 0,
      "ready_status": "ready"
    }
  ],
  "kit_instance_bindings": []
}
```

If no ready USDC artifact exists, `model.status` is `missing` and `url` is `null`.

## Lifecycle And Release

Session lifecycle values:

```txt
created
active
closing
closed
failed
```

`POST /api/review-sessions/{session_id}/close` moves a session through `closing` to `closed`, appends final events, and then marks every `kit_instance_bindings[]` item as `released`. `closed` means collaboration is closed; Kit release completion is tracked separately in binding status.

If `kit_profile.capacity_slots=0`, `POST /api/review-sessions` returns:

```json
{
  "detail": "No Kit capacity available.",
  "status": "queued_for_instance",
  "artifact_bindings": []
}
```

## Session Events

`POST /api/review-sessions/{session_id}/events` requires a JSON body with a non-empty `type` string. Additional event fields are preserved.

```json
{
  "type": "highlightRequest",
  "issue_id": "ISSUE-DEMO-001"
}
```

Event reads and writes require an existing review session. Unknown safe-looking session ids return HTTP 404 instead of creating standalone event logs.

## Persistence Notes

Session ids must match `review_session_[A-Za-z0-9_-]+`; unsafe ids return HTTP 400 before any filesystem path is resolved.

Session state is stored under `bim-review-coordinator/data/sessions/{session_id}.json`.
Session events are appended under `bim-review-coordinator/data/events/{session_id}.jsonl` so concurrent review-room events are append-only and auditable.
