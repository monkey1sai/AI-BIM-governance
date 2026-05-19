# Historical Fake BIM Control API

> Phase B status: `_bim-control` has been removed from product runtime. This
> contract is retained only as historical/test-double context. Current control
> plane authority is the external company cloud; this repo keeps only minimal
> coordinator shadow metadata and metadata-only callback outbox state.

Historical base URL:

```txt
http://127.0.0.1:8001
```

Historically, `_bim-control` was the fake BIM data authority for local
development. In the current Phase B demo, do not start it as a local runtime
service.

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

Historically, `GET /api/review-session-requests/{review_request_id}/lifecycle-events` returned request-side lifecycle events owned by `_bim-control`. These events correlated review intent with the coordinator session audit trail, but they did not replace coordinator session lifecycle events.

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
