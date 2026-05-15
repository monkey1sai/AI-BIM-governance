# Kit Manager API Contract

Base URL:

```txt
http://127.0.0.1:8010
```

## Endpoints

```http
GET  /health
GET  /api/usdc
GET  /api/kit/instances/current
POST /api/kit/instances/current/open
POST /api/kit/instances/current/close
```

## Open selected USDC

```json
{
  "artifact_ids": ["usdc_demo__a.usdc", "usdc_demo__b.usdc"],
  "replace_existing": true
}
```

Response:

```json
{
  "instance": {
    "instance_id": "kit_local_gpu_001",
    "status": "open",
    "selected_artifact_ids": ["..."],
    "opened_runtime_uris": ["file:///workspace/storage/demo/a.usdc"],
    "last_command": "open",
    "control_status": "sent"
  },
  "stage_composition_payload": {
    "type": "openStageRequest"
  },
  "message": "Open command recorded."
}
```

If the streaming server control endpoint is not ready, `control_status` must be
`blocked_runtime_control_unavailable` and must not be treated as GPU/viewport pass.
