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
this Phase B contract and root `AGENTS.md` §1 workspace boundary.

## Host-native conversion authority service (127.0.0.1:49101)

`bim-streaming-server` owns a host-native conversion authority service that can
be started independently from the live Kit/WebRTC runtime. It is internal-only
(`bim-review-coordinator` is still the single external IFC-ready entry point)
and conversion-only — it MUST NOT claim WebRTC `49100`, Kit launcher, or
viewport readiness.

Endpoints (served by the existing `create_conversion_api_app` factory):

```txt
GET  /health                                     -> conversion-only identity
POST /api/conversions/ifc-to-usdc                -> 202 + conversion_job_id
GET  /api/conversions/{conversion_job_id}        -> job state
GET  /api/conversions/{conversion_job_id}/result -> streaming-owned result
```

Published `model.usdc` is immutable per `conversion_job_id`. A successful
result records `artifacts.model_usdc.checksum_sha256`; every status/result/list
projection re-hashes the file before claiming `ready`. Missing legacy digests
or changed bytes fail closed as `artifact_integrity_violation` and are excluded
from `ready=true` listings. Direct `/artifacts/{job}/{filename}` downloads also
verify the persisted checksum and reject changed bytes before `FileResponse`.
A retry must replay the existing idempotent job or
create a new job/artifact path; it must never overwrite a published model while
continuing to report the old result as ready.

The host-native launcher is a single-worker process. Store instances sharing a
`jobs_dir` use process-shared locks for idempotent find-or-create and conversion
completion, and job JSON is published with atomic replace. This is not a
multi-process lock contract; deploying multiple Uvicorn workers requires a
transactional shared store/lock before it is supported.

Start (Windows host-native — use PowerShell, not Git Bash):

```powershell
pwsh -File bim-streaming-server/scripts/start-host-native-conversion-service.ps1
```

Git Bash is only a git shell here. The converter path
(`bim-streaming-server/scripts/convert-ifc-to-usdc.ps1` -> Kit/HOOPS) and the
launcher rely on PowerShell `.ps1` / `.bat` semantics; launching the `.bat` /
Kit tooling from Git Bash fails before service startup and MUST be classified
as an environment/shell blocker, not a code regression.

Converter prerequisites are resolved at runtime via `STREAMING_CONVERSION_*`
env vars (`STREAMING_CONVERSION_KIT_EXE`, `STREAMING_CONVERSION_HOOPS_MAIN`,
`STREAMING_CONVERSION_CONFIG_PATH`, ...). When prerequisites are missing the
adapter raises `converter_unavailable` and the job fails (`model.status` not
`ready`) — it never publishes placeholder USDC or fake mapping. Smoke / evidence
classify this honestly as `blocked`, never as a fabricated pass.

Coordinator pull ingestion:

```txt
POST /api/internal/conversions/{conversion_job_id}/ingest
  -> coordinator fetches GET /api/conversions/{id}/result from the host-native
     service, maps it to the existing internal conversion-result shape, and
     enqueues the metadata-only conversion_result_ready / conversion_failed
     callback outbox entry (no .usdc / .ifc / .rvt bodies).
```

Callback outbox `source_ifc.ref` masking (honesty rule — presigned signatures):

The `conversion_result_ready` callback payload sent to the company cloud always
masks the presigned signature on `source_ifc.ref` — only the bucket/key object
address (origin + pathname) is emitted, never the `X-Amz-*` signature /
credential / expiry. Conversion completion means the cloud already holds the
`usdc` artifact, so it does not need a presigned download of the original IFC;
masking is functionally lossless. The full presigned ref lives only in the
server-side dispatch path (coordinator → `bim-streaming-server`). This closes the
callback-outbox egress so every browser-visible / external / cloud exit is
signature-free (coordinator `maskPresignedRef`).
