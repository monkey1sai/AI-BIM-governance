# Fake BIM Control API

Base URL:

```txt
http://127.0.0.1:8001
```

`_bim-control` is the fake BIM data authority for local development. It stores metadata, not model file bytes.

## Endpoints

```http
GET  /health
GET  /api/projects
GET  /api/projects/{project_id}
GET  /api/projects/{project_id}/versions
GET  /api/model-versions/{model_version_id}
GET  /api/model-versions/{model_version_id}/artifacts
GET  /api/model-versions/{model_version_id}/artifact-groups
POST /api/artifact-groups
GET  /api/artifact-groups/{artifact_group_id}
POST /api/model-versions/{model_version_id}/conversion-result
GET  /api/model-versions/{model_version_id}/conversion-result
POST /api/review-session-requests
GET  /api/review-session-requests/{review_request_id}
PATCH /api/review-session-requests/{review_request_id}
GET  /api/review-session-requests/{review_request_id}/lifecycle-events
GET  /api/model-versions/{model_version_id}/review-issues
POST /api/model-versions/{model_version_id}/review-issues
GET  /api/review-sessions/{session_id}/annotations
POST /api/review-sessions/{session_id}/annotations
```

## Seed Records

```txt
project_demo_001
version_demo_001
artifact_ifc_demo_001
artifact_usdc_demo_001
ISSUE-DEMO-001
```

Artifact `status` is `ready` after conversion posts a succeeded conversion result, otherwise it may be `missing`.

## Review Session Request

`POST /api/review-session-requests` stores review intent before a coordinator session exists:

```json
{
  "requested_by": "dev_user_001",
  "tenant_id": "tenant_demo_001",
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "artifact_group_ids": ["ag_xxx"],
  "startup_policy": { "routing_policy": "same_instance" },
  "kit_profile": { "provider": "local_fixed" }
}
```

If the requested artifact group has source, derived USDC, and mapping metadata, status is `created`. Missing derived or mapping metadata sets `status=blocked_conversion` with `blocker=conversion_readiness`.

Coordinator session bindings are patched back:

```json
{
  "status": "active",
  "session_id": "review_session_xxx",
  "artifact_bindings": [],
  "kit_instance_bindings": [],
  "lifecycle_event": { "type": "sessionBound", "session_id": "review_session_xxx" }
}
```

`GET /api/review-session-requests/{review_request_id}/lifecycle-events` returns request-side lifecycle events owned by `_bim-control`. These events correlate review intent with the coordinator session audit trail, but they do not replace coordinator session lifecycle events.

```json
{
  "review_request_id": "review_request_xxx",
  "items": [
    {
      "event_id": "lifecycle_1700000000000",
      "review_request_id": "review_request_xxx",
      "session_id": "review_session_xxx",
      "correlation_id": "review_request_xxx",
      "type": "sessionBound",
      "payload": {
        "type": "sessionBound",
        "session_id": "review_session_xxx"
      },
      "created_at": "2026-05-12T10:00:00.000Z"
    }
  ]
}
```

`reviewRequestCreated` events have `session_id=null` until a coordinator session is bound.
