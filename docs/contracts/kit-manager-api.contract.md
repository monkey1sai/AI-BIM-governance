# Kit Manager API Contract

Internal service base URL (coordinator-only):

```txt
http://127.0.0.1:8010
```

Browser base URL (the only browser entrypoint):

```txt
http://127.0.0.1:8004/api/kit
```

The coordinator forwards the endpoints below to the internal service. Browser
clients MUST NOT use `:8010` directly. Compose publishes `:8010` on loopback
only for local health diagnostics; remote/LAN callers cannot bypass the
coordinator. Mutation requests through `:8004` require `x-operator-token` or
`x-dev-token`; the operator UI keeps the entered token in memory only.

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
