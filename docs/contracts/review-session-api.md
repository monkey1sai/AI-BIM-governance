# Review Session API

Base URL:

```txt
http://127.0.0.1:8004
```

Artifact URL fields in this contract are opaque strings. Examples that contain
`/artifacts/tenants/.../derived/...` document a possible historical shape only;
clients and tests must not parse tenant/project/job semantics from the path.
Current conversion-owned artifact URL shape is defined by the streaming
conversion result returned at runtime.

## Endpoints

```http
GET  /health
POST /api/review-sessions
GET  /api/review-sessions/{session_id}
POST /api/review-sessions/{session_id}/join
POST /api/review-sessions/{session_id}/leave
POST /api/review-sessions/{session_id}/close
POST /api/review-sessions/{session_id}/activity
GET  /api/review-sessions/{session_id}/idle-status
GET  /api/review-sessions/{session_id}/stream-config
GET  /api/review-sessions/{session_id}/events
POST /api/review-sessions/{session_id}/events
GET  /api/review-sessions/{session_id}/lifecycle-events
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
      "url": "http://127.0.0.1:49101/artifacts/tenants/.../model.usdc",
      "mapping_url": "http://127.0.0.1:49101/artifacts/tenants/.../element_mapping.json",
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
    "url": "http://127.0.0.1:49101/artifacts/tenants/tenant_demo_001/projects/project_demo_001/versions/version_demo_001/artifact-groups/ag_xxx/derived/conv_xxx/usdc/model.usdc",
    "mapping_url": "http://127.0.0.1:49101/artifacts/tenants/tenant_demo_001/projects/project_demo_001/versions/version_demo_001/artifact-groups/ag_xxx/derived/conv_xxx/usdc/element_mapping.json"
  },
  "artifacts": [
    {
      "artifact_id": "artifact_usdc_demo_001",
      "status": "ready",
      "url": "http://127.0.0.1:49101/artifacts/tenants/.../model.usdc"
    }
  ],
  "artifact_bindings": [
    {
      "artifact_group_id": "ag_xxx",
      "artifact_id": "artifact_usdc_demo_001",
      "url": "http://127.0.0.1:49101/artifacts/tenants/.../model.usdc",
      "mapping_url": "http://127.0.0.1:49101/artifacts/tenants/.../element_mapping.json",
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

## Inactivity Reclaim

Inactivity reclaim is disabled when `SESSION_IDLE_TIMEOUT_MS` is unset. An
explicit value must be a positive integer from 1 through 2147483647; this value
is the deployment-owned restart baseline and is not defaulted before the GPU
session baseline is measured.

`GET /api/runtime/session-idle-policy` returns the effective process-local
policy, its `source` (`environment` or `operator_override`), monotonic
`revision`, process-unique `process_epoch`, countdown duration, and explicit
live-apply/restart behavior.
`PUT /api/runtime/session-idle-policy` requires the existing operator token,
`expected_revision`, the matching `expected_process_epoch`, a non-empty audit
`reason`, and nullable `timeout_ms`.
The source-code default `dev-token` never enables this mutation path; token
attempts are rate-limited per source IP. Browser clients send credentials only
over HTTPS or exact loopback HTTP.
`null` disables reclaim; a positive integer enables it immediately. A stale
revision or coordinator process epoch returns HTTP 409. Applying a policy restarts the idle clock for already
ready sessions at the apply boundary; restarting the coordinator restores the
deployment environment value. The endpoint never edits `.env` or deployment
configuration.

The coordinator tracks only sessions with at least one `/review` socket that has
joined with the canonical trace and then reported `streamReadiness { ready: true }`.
`POST /api/review-sessions/{session_id}/activity` requires an active viewer
lease. Send JSON `{ "lease_id": "viewer_lease_xxx" }` together with the
matching `X-Viewer-Lease-Token` header. Missing, malformed, expired, released,
or mismatched lease credentials return HTTP 401 without disclosing which
credential failed. With valid credentials, the endpoint returns HTTP 200 with
`ok=true` only when the inactivity policy is enabled and a viewer is connected.
If those runtime conditions are not met it returns HTTP 409 and does not cancel
a countdown. `GET
/api/review-sessions/{session_id}/idle-status` reports `enabled`,
`has_connected_viewer`, `is_counting_down`, nullable `remaining_seconds`, and
nullable `last_activity_at`.

`GET /api/review-sessions/{session_id}/lifecycle-events` returns only lifecycle audit events, sorted by append order and `sequence`:

```json
{
  "items": [
    {
      "event_id": "1700000000000_abcd",
      "session_id": "review_session_xxx",
      "type": "sessionCreated",
      "sequence": 1,
      "created_at": "2026-05-12T10:00:00.000Z",
      "server_owned": true,
      "payload": {
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "review_request_id": "review_request_xxx"
      }
    }
  ]
}
```

Lifecycle audit event types include:

```txt
sessionCreated
sessionActive
sessionClosing
sessionClosed
kitInstanceReleased
```

The lifecycle endpoint excludes generic collaboration events such as `highlightRequest`, `selectionUpdate`, `annotationCreated`, and `finalReviewEvent`. Use `GET /api/review-sessions/{session_id}/events` for the full generic session event feed.

If `kit_profile.capacity_slots=0`, `POST /api/review-sessions` returns:

```json
{
  "detail": "No Kit capacity available.",
  "status": "queued_for_instance",
  "artifact_bindings": []
}
```

## Session Events

`POST /api/review-sessions/{session_id}/events` requires a JSON body with a non-empty `type` string. Additional event fields are preserved for accepted generic event types.

`sessionCreated`, `sessionActive`, and `sessionRecreated` are reserved for coordinator-owned transitions. A client attempt to append any of these types returns HTTP 400 with `detail: "Server-owned event type cannot be appended by a client."`. Events emitted by the coordinator for these transitions include the additive top-level field `server_owned: true`; legacy persisted events may omit it. Other generic event types, including the close-like archive compatibility types, retain their existing append behavior and are not authoritative lifecycle checkpoints unless the server-owned close metadata is present.

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
