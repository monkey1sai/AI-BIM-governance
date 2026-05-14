# Draft Contract: bim-review-platform deployment boundary

`bim-review-platform` is a deployment/integration boundary. It is not a nested repository and not one monolithic process.

## Services inside boundary

```txt
bim-review-coordinator  session/control plane
bim-streaming-server    conversion authority + Kit/WebRTC runtime
web-viewer-sample       browser client
```

## Health response shape

```json
{
  "platform": "bim-review-platform",
  "status": "degraded",
  "services": {
    "bim-review-coordinator": { "status": "passed", "url": "http://127.0.0.1:8004/health" },
    "bim-streaming-server.conversion": { "status": "passed", "url": "http://127.0.0.1:49100/api/conversions/health" },
    "bim-streaming-server.webrtc": { "status": "blocked", "reason": "signaling port not listening" },
    "web-viewer-sample": { "status": "passed", "url": "http://127.0.0.1:5173" }
  }
}
```

## Invariants

- A pass in conversion does not imply WebRTC pass.
- A pass in coordinator session lifecycle does not imply model readiness.
- `bim-review-platform` does not create nested `.git`.
- Each service keeps its own tests and logs.
