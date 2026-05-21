# local-coordinator-ifc-ready-intake-boundary — Spec Delta (fast-ifc-link-demo-loop)

> Delta against `openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md`(本檔僅含本 change 的差異)。本 change 加同步下載 IFC 至本地 shared volume 階段;coordinator 收到 ifc-ready 後完成下載才回 200,並把 download/viewer 狀態暴露在 GET job endpoint。

## MODIFIED Requirements

### Requirement: Coordinator owns the external IFC-ready intake contract

`bim-review-coordinator` SHALL be the only service that exposes the external IFC-ready intake contract `POST /api/external/ifc-ready`. `bim-streaming-server` SHALL NOT expose an external IFC-ready entry; it MUST only receive internal conversion requests from `bim-review-coordinator`.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` 把 `POST /api/external/ifc-ready` 行為由「ack + immediate async dispatch + 202」改為「同步下載 IFC 至本地 shared volume `storage/ifc-cache/<ifc_ready_job_id>/source.ifc` + dispatch streaming-server + 200」。intake boundary 仍由 coordinator 獨佔,streaming-server 仍只收 internal conversion request(現在多了 `local_path` / `host_local_path` 欄位)。

#### Scenario: External IFC Worker posts ifc-ready to coordinator

- **WHEN** the customer-edge IFC Worker(或 Postman 模擬器)finishes producing a `.ifc` and calls `POST /api/external/ifc-ready` on `bim-review-coordinator`
- **THEN** `bim-review-coordinator` validates the request, creates a local IFC-ready job with `download_status="pending"`, synchronously downloads the IFC from `source_ifc.ref`(canonical)或 `ifc_path`(worker compat)to the shared volume path `storage/ifc-cache/<ifc_ready_job_id>/source.ifc`, marks `download_status="downloaded"`, binds `external_model_version_id`, and dispatches an internal conversion request to `bim-streaming-server` with both `local_path`(container view)and `host_local_path`(host view)
- **AND** `bim-streaming-server` exposes no public IFC-ready endpoint for that flow

#### Scenario: Streaming server is not a public entry

(unchanged — preserved from existing spec)

- **WHEN** any external caller targets `bim-streaming-server` directly for IFC-ready intake
- **THEN** the architecture MUST treat that as out of contract
- **AND** the supported external contract remains `bim-review-coordinator` `POST /api/external/ifc-ready`

### Requirement: External intake is idempotent and binds external model version

The external intake SHALL be idempotent on explicit `idempotency_key` / `correlation_id` when provided, and SHALL support worker compatibility idempotency derived from `project_id`, `version`, and `task_id` when explicit keys are absent. Every accepted job SHALL bind to `external_model_version_id`; for worker compatibility payloads, `version` SHALL be the source of that binding unless a future authenticated provider supplies a stronger model-version mapping.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` 強化 idempotency:既存 job 直接回 200 + `idempotent_replay:true`,**不重新下載 IFC** 也不重新派工。 implementation 透過 `externalIfcReadyStore.findExisting(idempotencyKey, correlationId)` 在下載動作前 short-circuit。

#### Scenario: Duplicate ifc-ready is idempotent

- **WHEN** the IFC Worker retries the same `ifc_ready` with an already-seen explicit `idempotency_key` or the same derived worker identity (`project_id`, `version`, `task_id`)
- **THEN** `bim-review-coordinator` returns the existing local conversion job with `idempotent_replay:true`
- **AND** it does not create a duplicate active job for the same IFC artifact unless explicitly forced
- **AND** the IFC bytes are NOT re-downloaded to the shared volume

#### Scenario: Job carries external model version binding

(unchanged — preserved from existing spec)

- **WHEN** a conversion job is created from a valid `ifc_ready`
- **THEN** the job record stores `external_model_version_id` and `correlation_id`
- **AND** later conversion result / failure callbacks reuse that binding

## ADDED Requirements

### Requirement: Coordinator synchronously downloads IFC to shared volume before responding

`bim-review-coordinator` SHALL, after authenticating and de-duplicating an `ifc-ready` event, synchronously download the IFC referenced by `source_ifc.ref`(canonical)或 `ifc_path`(worker compat)over HTTP into the shared volume path `storage/ifc-cache/<ifc_ready_job_id>/source.ifc` BEFORE returning a successful HTTP response to the caller. The download stage MAY be configured with a timeout via environment variable `IFC_DOWNLOAD_TIMEOUT_SECONDS`(default 600). Failure to download(network error, timeout, non-2xx response, partial write)MUST mark the job `download_status="failed"`, MUST NOT dispatch the streaming conversion request, and MUST return an HTTP `502` with a structured error body including the `ifc_ready_job_id` and `error` reason.

#### Scenario: Successful synchronous download returns 200 with downloaded marker

- **WHEN** an authenticated, non-duplicate `ifc-ready` event arrives and the source IFC is reachable
- **THEN** `bim-review-coordinator` writes the IFC bytes to `storage/ifc-cache/<ifc_ready_job_id>/source.ifc` and sets the job `download_status` to `downloaded` with `local_path` and `host_local_path` recorded
- **AND** the response is HTTP 200 with body `{ ifc_ready_job_id, download_status:"downloaded", message, local_path, conversion_job_id, conversion_status:"queued" }`

#### Scenario: Download timeout marks the job failed and returns 502

- **WHEN** the source IFC HTTP fetch exceeds `IFC_DOWNLOAD_TIMEOUT_SECONDS`(default 600)
- **THEN** `bim-review-coordinator` aborts the partial write, removes the partial file, marks the job `download_status="failed"` with a timeout reason, does NOT dispatch the streaming conversion request, and responds HTTP 502 with `{ detail:"IFC download failed", ifc_ready_job_id, error:"timeout", download_status:"failed" }`

#### Scenario: Download network failure marks the job failed and returns 502

- **WHEN** the source IFC HTTP fetch fails with a connection error or non-2xx HTTP response
- **THEN** `bim-review-coordinator` records the failure on the job, removes any partial file, does NOT dispatch the streaming conversion request, and responds HTTP 502 with `{ detail:"IFC download failed", ifc_ready_job_id, error:"<reason>", download_status:"failed" }`

#### Scenario: Idempotent replay does NOT re-download

- **WHEN** an `ifc-ready` event arrives whose `idempotency_key` / `correlation_id` (canonical) or derived worker identity (`project_id`, `version`, `task_id`) matches an existing local job
- **THEN** `bim-review-coordinator` returns the existing job's state with `idempotent_replay:true` and does NOT perform a second HTTP GET for the IFC bytes
- **AND** the existing `local_path` / `host_local_path` is returned as-is

### Requirement: Coordinator GET job endpoint exposes download and viewer state

`bim-review-coordinator` SHALL extend `GET /api/external/ifc-ready/{jobId}` to expose `download_status`, `viewer_url`, `web_view_session_id`, and `download_failure`(optional)alongside the existing `conversion_status`, `conversion_job_id`, `external_model_version_id`, and source IFC reference fields. `viewer_url` SHALL be `null` until streaming-owned conversion is `ready`, at which point the coordinator MUST spawn a local web view session for the job, persist `web_view_session_id` and `viewer_url` on the job, and reflect both in the GET response. `viewer_url` SHALL be a redirect URL pointing to the coordinator(`/ui/open?session=<web_view_session_id>`)so that LAN clients reach the viewer through the coordinator-owned redirect endpoint(viewer is `127.0.0.1`-bound,not LAN-addressable).

#### Scenario: Polling job before conversion ready returns null viewer_url

- **WHEN** a caller `GET /api/external/ifc-ready/{jobId}` while `conversion_status` is `queued` or `running`
- **THEN** the response includes `download_status` (typically `downloaded`), `conversion_status`, `viewer_url:null`, and `web_view_session_id:null`

#### Scenario: Polling job after conversion ready returns viewer_url

- **WHEN** a caller `GET /api/external/ifc-ready/{jobId}` after streaming-owned conversion has reached `ready` and the coordinator has spawned a local web view session for the job
- **THEN** the response includes `download_status:"downloaded"`, `conversion_status:"ready"`, `viewer_url:"http://<public_host>:<coordinator_port>/ui/open?session=<web_view_session_id>"`, and the matching `web_view_session_id`

#### Scenario: Failed download exposes download_failure

- **WHEN** a caller `GET /api/external/ifc-ready/{jobId}` for a job whose download stage failed
- **THEN** the response includes `download_status:"failed"`, `download_failure:"<reason>"`, `conversion_status:null` or `not_dispatched`, and `viewer_url:null`

### Requirement: Coordinator provides /ui/open redirect for viewer entry

`bim-review-coordinator` SHALL expose `GET /ui/open?session=<web_view_session_id>` which returns an HTTP 302 redirect to `http://127.0.0.1:5173/?session=<web_view_session_id>`. The `session` query parameter MUST be validated against the local web view session id format(`^lwv_[A-Za-z0-9_]+$`)and MUST return HTTP 400 on validation failure. The endpoint MUST NOT proxy the viewer page itself; it MUST only redirect, so the actual viewer connection terminates on the client's local loopback(the viewer container is bound to `127.0.0.1:5173` and not addressable from LAN).

#### Scenario: Valid session id redirects to local viewer

- **WHEN** a client requests `GET /ui/open?session=lwv_abc123`
- **THEN** the coordinator responds with HTTP 302 and `Location: http://127.0.0.1:5173/?session=lwv_abc123`

#### Scenario: Invalid session id returns 400

- **WHEN** a client requests `GET /ui/open?session=../secrets` or `GET /ui/open` without a session parameter
- **THEN** the coordinator responds with HTTP 400 and a structured error body
