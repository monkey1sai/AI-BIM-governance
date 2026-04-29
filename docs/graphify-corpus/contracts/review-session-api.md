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
  "created_by": "dev_user_001",
  "mode": "single_kit_shared_state",
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
  "source": "local_fixed",
  "webrtc": {
    "signalingServer": "127.0.0.1",
    "signalingPort": 49100,
    "mediaServer": "127.0.0.1"
  },
  "model": {
    "status": "ready",
    "artifact_id": "artifact_usdc_demo_001",
    "url": "http://127.0.0.1:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc",
    "mapping_url": "http://127.0.0.1:8002/static/projects/project_demo_001/versions/version_demo_001/element_mapping.json"
  },
  "artifacts": []
}
```

If no ready USDC artifact exists, `model.status` is `missing` and `url` is `null`.
