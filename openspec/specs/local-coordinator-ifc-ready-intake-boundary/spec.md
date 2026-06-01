# local-coordinator-ifc-ready-intake-boundary Specification

## Purpose
TBD - created by archiving change local-coordinator-ifc-ready-intake-boundary. Update Purpose after archive.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` ADD 3 個 requirements:`Coordinator synchronously downloads IFC to shared volume before responding`、`Coordinator GET job endpoint exposes download and viewer state`、`Coordinator provides /ui/open redirect for viewer entry`,以及 MODIFIED 2 個既有 requirements(`Coordinator owns the external IFC-ready intake contract` + `External intake is idempotent and binds external model version` 加 implementation status note 反映同步下載階段 + idempotent replay 不重下載)。完整 ADD requirement body 與 scenario 見 `openspec/changes/archive/2026-05-21-fast-ifc-link-demo-loop/specs/local-coordinator-ifc-ready-intake-boundary/spec.md`。實作:`bim-review-coordinator/src/services/ifcDownloader.ts`、`POST /api/external/ifc-ready` handler、`GET /api/external/ifc-ready/:jobId`(加 download_status / viewer_url / web_view_session_id)、`GET /ui/open?session=`(302 redirect)。
## Requirements
### Requirement: Coordinator owns the external IFC-ready intake contract

`bim-review-coordinator` SHALL be the only service that exposes the external IFC-ready intake contract `POST /api/external/ifc-ready`. `bim-streaming-server` SHALL NOT expose an external IFC-ready entry; it MUST only receive internal conversion requests from `bim-review-coordinator`.

#### Scenario: External IFC Worker posts ifc-ready to coordinator

- **WHEN** the customer-edge IFC Worker finishes producing a `.ifc` and calls `POST /api/external/ifc-ready` on `bim-review-coordinator`
- **THEN** `bim-review-coordinator` validates the request, creates a local conversion job, binds `external_model_version_id`, and dispatches an internal conversion request to `bim-streaming-server`
- **AND** `bim-streaming-server` exposes no public IFC-ready endpoint for that flow

#### Scenario: Streaming server is not a public entry

- **WHEN** any external caller targets `bim-streaming-server` directly for IFC-ready intake
- **THEN** the architecture MUST treat that as out of contract
- **AND** the supported external contract remains `bim-review-coordinator` `POST /api/external/ifc-ready`

### Requirement: IFC-ready caller is the customer-edge IFC Worker on the edge intranet

The supported `ifc_ready` caller SHALL be the customer-edge IFC Worker reachable on the same customer-edge intranet as this repo's runtime. The company cloud test/production hosts (`192.168.20.238` / `192.168.20.237`) SHALL NOT be modeled as the direct IFC-ready caller; the company cloud interacts only via control-plane APIs and callback receipt.

#### Scenario: Edge IFC Worker is the caller

- **WHEN** an `ifc_ready` request arrives
- **THEN** the accepted source identity is the customer-edge IFC Worker (edge intranet boundary)
- **AND** the company cloud is not expected to call `POST /api/external/ifc-ready` directly

### Requirement: External intake authenticates via a pluggable service auth provider

The external IFC-ready intake SHALL authenticate machine-to-machine callers through a pluggable `AuthProvider` interface, not user SSO. The initial `intranet-dev` provider SHALL support IP allowlist plus a request secret or HMAC signature. Canonical callers SHALL provide `correlation_id`, `idempotency_key`, and `tenant_id` / `project_id` / `external_model_version_id` through the existing header/body identity contract. Worker compatibility callers MAY omit explicit correlation / idempotency fields when `task_id` is present; in that case `bim-review-coordinator` SHALL derive correlation and idempotency values from the authenticated identity plus `project_id`, `version`, and `task_id`. Production auth providers MUST still authenticate caller identity and MUST NOT rely on the worker body alone as proof of identity.

#### Scenario: Unauthorized machine caller is rejected

- **WHEN** a caller fails the active `AuthProvider` (not in allowlist, or missing/invalid signature/secret when the provider requires one)
- **THEN** `bim-review-coordinator` rejects the request and does not create a conversion job

#### Scenario: Auth provider is replaceable without contract rewrite

- **WHEN** a future `sso-token-introspection`, `machine-token`, or `mTLS` provider is introduced
- **THEN** it is added behind the same `AuthProvider` interface
- **AND** the external intake contract and existing callers do not require a redesign

#### Scenario: Worker task identity fills retry metadata

- **WHEN** an authenticated worker compatibility payload omits explicit `X-Correlation-Id` or `X-Idempotency-Key`
- **THEN** `bim-review-coordinator` derives stable correlation and idempotency values from `project_id`, `version`, and `task_id`
- **AND** those derived values are stored in the local job and used for duplicate replay detection

### Requirement: External intake is idempotent and binds external model version

The external intake SHALL be idempotent on explicit `idempotency_key` / `correlation_id` when provided, and SHALL support worker compatibility idempotency derived from `project_id`, `version`, and `task_id` when explicit keys are absent. Every accepted job SHALL bind to `external_model_version_id`; for worker compatibility payloads, `version` SHALL be the source of that binding unless a future authenticated provider supplies a stronger model-version mapping.

#### Scenario: Duplicate ifc-ready is idempotent

- **WHEN** the IFC Worker retries the same `ifc_ready` with an already-seen explicit `idempotency_key` or the same derived worker identity (`project_id`, `version`, `task_id`)
- **THEN** `bim-review-coordinator` returns the existing local conversion job
- **AND** it does not create a duplicate active job for the same IFC artifact unless explicitly forced

#### Scenario: Job carries external model version binding

- **WHEN** a conversion job is created from a valid `ifc_ready`
- **THEN** the job record stores `external_model_version_id` and `correlation_id`
- **AND** later conversion result / failure callbacks reuse that binding

#### Scenario: Conflicting worker retry is rejected

- **WHEN** a worker reuses the same derived worker identity (`project_id`, `version`, `task_id`) with a materially different `ifc_path`
- **THEN** `bim-review-coordinator` returns a 409-style conflict response
- **AND** it MUST NOT replace the original job's source IFC reference silently

### Requirement: Coordinator accepts worker ifc-ready compatibility payload

`bim-review-coordinator` SHALL accept a worker compatibility body on `POST /api/external/ifc-ready` with `status="ifc_ready"`, `ifc_path`, `project_id`, `version`, and `task_id`. The coordinator SHALL normalize this body at the intake boundary into the canonical local IFC-ready event before creating a local conversion job or dispatching an internal request to `bim-streaming-server`.

> **Implementation status (2026-05-21)**: this requirement was ratified by archive `2026-05-21-coordinator-ifc-ready-worker-webhook` but its code path was never implemented (retro-audit commit `a32fcd6`). Change `backfill-coordinator-webhook-and-auto-session` backfills the implementation in `bim-review-coordinator/src/app.ts` (`normalizeIntakePayload` helper plus the `/api/external/ifc-ready` route handler wiring). See its `tasks.md` for the scenario-to-test mapping.

#### Scenario: Worker payload is accepted and normalized

- **WHEN** the customer-edge IFC Worker posts `status="ifc_ready"`, `ifc_path`, `project_id`, `version`, and `task_id` to `POST /api/external/ifc-ready`
- **THEN** `bim-review-coordinator` accepts the body as a valid IFC-ready compatibility payload after service auth passes
- **AND** it normalizes `status` to `event="ifc_ready"`
- **AND** it normalizes `ifc_path` to `source_ifc.ref`
- **AND** it normalizes `version` to `external_model_version_id`
- **AND** it normalizes `task_id` to `external_conversion_task_id`

#### Scenario: Non-ready worker status is rejected

- **WHEN** the worker posts a payload whose `status` is not exactly `"ifc_ready"`
- **THEN** `bim-review-coordinator` rejects the request with a 4xx response
- **AND** it MUST NOT create a local conversion job
- **AND** it MUST NOT dispatch an internal conversion request to `bim-streaming-server`

#### Scenario: Missing worker fields are rejected

- **WHEN** the worker payload omits or sends an empty `ifc_path`, `project_id`, `version`, or `task_id`
- **THEN** `bim-review-coordinator` rejects the request with a 4xx response
- **AND** the rejection identifies the invalid request boundary without saving partial shadow metadata

#### Scenario: Worker payload does not leak into streaming contract

- **WHEN** a worker compatibility payload is accepted
- **THEN** `bim-review-coordinator` sends `bim-streaming-server` the existing internal conversion request shape
- **AND** it MUST NOT forward the raw worker payload as the streaming API contract

### Requirement: Coordinator GET job endpoint exposes download and viewer state

`bim-review-coordinator` SHALL expose IFC-ready job state sufficient for `/ui` and operators to understand the closed-loop progress. In addition to `GET /api/external/ifc-ready/{jobId}`, the coordinator MAY expose a read-only job listing endpoint for recent in-memory jobs. The listing MUST include download, dispatch, conversion, callback, and viewer/session references, but MUST NOT include IFC bytes or generated model bytes.

#### Scenario: Operator lists recent IFC-ready jobs

- **WHEN** `/ui` requests recent IFC-ready jobs
- **THEN** the coordinator returns recent jobs with `ifc_ready_job_id`, `download_status`, `conversion_job_id`, `conversion_status`, `artifact_manifest_ref`, `web_view_session_id`, `viewer_url`, and timestamps
- **AND** the response omits model bytes and secrets

#### Scenario: Job listing preserves intake boundary

- **WHEN** a job has `download_status="downloaded"` and `conversion_status="ready"`
- **THEN** the listing still treats source IFC bytes as external/data-plane artifacts and generated USDC as streaming-owned artifacts
- **AND** coordinator remains a metadata/control-plane observer, not a converter or renderer

### Requirement: Coordinator provides /ui/open redirect for viewer entry

The coordinator SHALL provide viewer entry URLs and runtime status that make the host/browser boundary explicit. `GET /ui/open?session=` MAY still redirect to the browser-visible viewer URL, but `/ui/open` MUST NOT hard-code `127.0.0.1` when the viewer is intended for a LAN or remote client. The redirect target SHALL be built from trusted coordinator configuration, not from an arbitrary query-supplied redirect URL.

The coordinator SHALL support a configured `VIEWER_PUBLIC_BASE_URL` for the browser-visible viewer origin. If `VIEWER_PUBLIC_BASE_URL` is unset, the coordinator MAY derive the viewer origin from `PUBLIC_HOST` and `VIEWER_PORT`, falling back to localhost only for local development. The generated viewer URL SHALL include the validated `session` value and enough coordinator endpoint information for `web-viewer-sample` to call the same coordinator host that produced the handoff.

#### Scenario: UI exposes expected viewer handoff

- **WHEN** a conversion-ready job has a review session
- **THEN** `/ui` displays the coordinator URL, the browser-visible viewer URL, the expected stage URL, and the Kit endpoint
- **AND** it warns when the expected stage URL has not yet been proven as loaded by Kit

#### Scenario: LAN handoff does not redirect to client loopback

- **WHEN** `VIEWER_PUBLIC_BASE_URL` is configured as `http://192.168.10.105:5173` and a browser calls `GET /ui/open?session=<review_session_id>`
- **THEN** the coordinator responds with a redirect whose `Location` origin is `http://192.168.10.105:5173`
- **AND** the redirect target MUST NOT contain `http://127.0.0.1:5173` or `http://localhost:5173`

#### Scenario: Handoff carries coordinator endpoint for the viewer

- **WHEN** the coordinator redirects to `web-viewer-sample`
- **THEN** the redirect target includes `session=<review_session_id>`
- **AND** it includes a browser-visible coordinator API base and Socket.IO base derived from trusted coordinator configuration
- **AND** a remote client MUST NOT need to guess or rewrite `127.0.0.1:8004`

#### Scenario: Runtime status exposes remaining loopback gaps

- **WHEN** operator opens `/ui` after a conversion-ready job
- **THEN** the displayed viewer URL, coordinator handoff URL, expected stage URL, and Kit endpoint MUST make loopback-vs-LAN values visible
- **AND** if any browser-facing value still points to `127.0.0.1` while LAN profile is intended, the task remains a configuration gap rather than a completed client validation

#### Scenario: Redirect target is not caller-controlled

- **WHEN** a caller supplies an extra query parameter such as `redirect=http://evil.example`
- **THEN** `/ui/open` ignores that value
- **AND** the redirect target remains the trusted configured viewer origin with the validated session handoff

### Requirement: Coordinator exposes read-only runtime status for dashboard observability

`bim-review-coordinator` MAY expose a read-only runtime status endpoint to support `/ui` dashboard observability. The endpoint SHALL summarize coordinator-visible sessions, participants, configured Kit endpoints, and optional host-native runtime observations. It SHALL NOT parse or render USD/USDC and SHALL NOT become the source of truth for Kit internal stage state.

#### Scenario: Runtime status summarizes sessions and Kit endpoints

- **WHEN** `/ui` requests runtime status
- **THEN** the response includes configured Kit endpoints, session count, active participant count, and known `kit_instance_bindings`
- **AND** any host port/log observations are labeled as observations, not authoritative Kit state

#### Scenario: Runtime status reports WebRTC evidence separately

- **WHEN** recent Kit/WebRTC evidence indicates disconnects or busy frame drops
- **THEN** the dashboard displays that as WebRTC evidence
- **AND** it does not change conversion job readiness

### Requirement: Coordinator serializes concurrent IFC-ready dispatch with in-memory FIFO

`bim-review-coordinator` SHALL serialize the dispatch step (the synchronous
`POST /api/conversions/ifc-to-usdc` call to `bim-streaming-server`) for
`POST /api/external/ifc-ready` jobs using an in-memory FIFO queue. At any point
in time at most one job MAY be `in-flight` to streaming-server. Additional jobs
that have completed their local IFC download but are waiting for the dispatch
slot SHALL be reported with lifecycle status `queued_for_conversion` and an
integer `queue_position` (1-based). The HTTP `POST /api/external/ifc-ready`
response SHALL NOT block on the queue; it SHALL still return `202 Accepted`
immediately after the local intake / download stage.

This requirement is additive and MUST preserve the existing single-job happy
path: when only one job is being processed, behavior MUST be equivalent to the
pre-queue flow (no observable `queued_for_conversion` from the consumer's
perspective is required, though the store MAY transition through it briefly).

#### Scenario: Two concurrent ifc-ready POSTs serialize dispatch

- **WHEN** two `POST /api/external/ifc-ready` requests arrive while
  `bim-streaming-server` is intentionally slow to respond to the first
  `POST /api/conversions/ifc-to-usdc`
- **THEN** the first job SHALL be observable as `status="dispatched"` (or
  transitional `status` reflecting in-flight dispatch) and SHALL NOT carry a
  positive `queue_position`
- **AND** the second job SHALL be observable with `status="queued_for_conversion"`
  and `queue_position >= 1` while the first dispatch is still in-flight
- **AND** the second job's `queue_position` MUST be 1 (only one job ahead)

#### Scenario: Queued job dispatches after in-flight completes

- **WHEN** the streaming-server returns a response for the first job's dispatch
  (success or failure)
- **THEN** the queue worker SHALL pick up the next queued job and dispatch it
- **AND** that previously queued job SHALL transition from
  `queued_for_conversion` to `dispatched` (on success) or `dispatch_failed` (on
  dispatch error)
- **AND** the dispatched job's `queue_position` SHALL be cleared (`null`)

#### Scenario: In-flight dispatch failure does not block queued items

- **WHEN** the first job's streaming-server dispatch fails (network error,
  non-2xx response, exception)
- **THEN** the first job SHALL transition to `status="dispatch_failed"`
- **AND** the queue worker SHALL proceed to dispatch the next queued job
  regardless of the first job's outcome
- **AND** the queue worker MUST NOT remain stuck on a failed in-flight slot

#### Scenario: Coordinator restart drops queued jobs

- **WHEN** the coordinator process is restarted (or the queue is explicitly
  drained for test / shutdown purposes)
- **THEN** every job that was in `queued_for_conversion` state SHALL be marked
  `status="dropped_on_restart"`
- **AND** subsequent `GET /api/external/ifc-ready/:jobId` responses SHALL show
  this `dropped_on_restart` lifecycle
- **AND** operators SHALL be expected to re-submit those IFC-ready POSTs
  (documented in the runbook)
- **AND** in-flight jobs (mid-dispatch) MAY still complete naturally; this
  scenario only covers the queued-but-not-yet-dispatched set

#### Scenario: Single-job happy path is unchanged

- **WHEN** a single `POST /api/external/ifc-ready` arrives with no other jobs
  in flight or queued
- **THEN** the resulting end state SHALL match the pre-queue behavior:
  `status="dispatched"` with a `conversion_job_id`, optional
  `conversion_status` from streaming-server, and no positive `queue_position`
- **AND** existing happy-path smoke (e.g. `scripts/smoke-bscheme-intake.ps1`)
  SHALL continue to pass without modification

#### Scenario: Queue does not delay HTTP response

- **WHEN** any `POST /api/external/ifc-ready` is enqueued for dispatch
- **THEN** the HTTP response SHALL still return `202 Accepted` immediately
  after the local IFC download stage completes
- **AND** the response MUST NOT block on the streaming-server dispatch
- **AND** `GET /api/external/ifc-ready/:jobId` SHALL be the supported way for
  clients to observe the eventual queue / dispatch progression

### Requirement: IFC-ready download SHALL honor an explicit strict mode

coordinator 的 IFC-ready intake 下載 SHALL 支援由 `IFC_DOWNLOAD_STRICT` 設定驅動的 explicit strict mode。當 strict 啟用時,若對 IFC source 的 HTTP 取得回 non-2xx,coordinator SHALL 以 `502` 回應並把該 intake job 的 download 狀態標為 failed,MUST NOT 以 placeholder 內容靜默回報下載成功、MUST NOT 進入 conversion dispatch。當 strict 未啟用(預設)時,SHALL 維持既有 fallback 行為(供 demo / local 在無真實 IFC source 時以 placeholder 跑通)。strict 的 code 預設 SHALL 為 false(不破壞既有 demo);production 部署 SHALL 透過 `IFC_DOWNLOAD_STRICT=true` 啟用。

#### Scenario: Strict mode rejects unreachable IFC with 502

- **WHEN** `IFC_DOWNLOAD_STRICT` 啟用(strict)
- **AND** coordinator 對 `POST /api/external/ifc-ready` 帶入的 IFC source 做 HTTP 取得時收到 non-2xx
- **THEN** coordinator SHALL 回應 `502`
- **AND** 該 intake job 的 download 狀態 SHALL 標為 failed
- **AND** SHALL NOT 以 placeholder 內容回報下載成功
- **AND** SHALL NOT 進入 conversion dispatch

#### Scenario: Non-strict default preserves placeholder fallback

- **WHEN** `IFC_DOWNLOAD_STRICT` 未設(預設 non-strict)
- **AND** IFC source 的 HTTP 取得失敗
- **THEN** coordinator SHALL 維持既有 fallback 行為(以 placeholder 讓 demo / local 流程跑通)
- **AND** 既有 intake / dispatch 行為 SHALL NOT 因本 change 改變

