# Retired Conversion API Contract

`_conversion-service` and `_conversion-server` are retired from the current
local demo runtime. They are kept only in historical planning material and must
not be used as active startup, health-check, smoke-test, or review-session
dependencies.

Current file and conversion behavior is documented in:

```txt
docs/contracts/worker-api.md
```

Current worker base URL:

```txt
http://127.0.0.1:8005
```

Current flow:

```txt
_worker dev IFC source selection
→ _worker conversion job
→ _worker object URLs
→ _bim-control artifact metadata
→ bim-review-coordinator review session
→ web-viewer-sample / bim-streaming-server runtime loading
```

Do not add new callers to the retired conversion API. If a historical document
still mentions the old API, treat that reference as archival context and verify
current behavior against `worker-api.md`.
