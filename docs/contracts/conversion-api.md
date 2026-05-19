# Phase B Conversion API Contract

`_conversion-service`, `_conversion-server`, `_worker`, and `_bim-control` are
retired from the current local demo runtime. They are kept only in historical
planning material or test-double context and must not be used as active
startup, health-check, smoke-test, or review-session dependencies.

Current conversion behavior is owned by `bim-streaming-server` and is triggered
internally by `bim-review-coordinator` after the coordinator receives the
external IFC-ready webhook.

Current local conversion base URL:

```txt
STREAMING_CONVERSION_API_BASE=http://127.0.0.1:49101
```

Current flow:

```txt
[external] customer-edge IFC Worker
→ POST /api/external/ifc-ready to bim-review-coordinator
→ coordinator creates/binds a local conversion job
→ coordinator calls bim-streaming-server internal conversion authority
→ streaming returns model/mapping/manifest artifact URLs
→ coordinator writes metadata-only callback outbox entries
→ web-viewer-sample / bim-streaming-server runtime loading
```

The current contract fixtures live in:

```txt
tests/contracts/ifc_ready_payload.json
tests/contracts/conversion_result_callback.json
tests/fakes/
```

Do not add new callers to the retired conversion API. If a historical document
still mentions `_worker`, `_bim-control`, or the old conversion API as runtime,
treat that reference as archival context and verify current behavior against
this Phase B contract and `AGENTS.md` §1.A / §10 / §11.
