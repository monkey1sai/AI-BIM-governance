# cross-service-structured-log-baseline — Spec Delta

## ADDED Requirements

### Requirement: Cross-service log records SHALL conform to a shared JSON schema

The system SHALL provide a single JSON schema at `tests/contracts/structured-log/schema.json` that all four execution units (bim-review-coordinator, bim-streaming-server, web-viewer-sample, PowerShell scripts) MUST validate against when emitting structured log records. Each record SHALL be a single-line JSON object with required fields `ts` (ISO-8601 UTC ms precision), `level` (`debug`/`info`/`warn`/`error`/`fatal`), `event_type` (one of seven: `logic_error`/`operation_anomaly`/`env_snapshot`/`lifecycle`/`audit`/`network`/`general`), `service` (`coordinator`/`streaming-server`/`viewer`/`scripts`), `component`, `run_id`, `trace_id`, `msg`, `data`.

#### Scenario: Coordinator emits log record matching shared schema
- **WHEN** bim-review-coordinator process emits any structured log record via the adapter
- **THEN** the record file line SHALL parse as valid JSON and pass validation against `tests/contracts/structured-log/schema.json`

#### Scenario: Streaming-server emits log record matching shared schema
- **WHEN** bim-streaming-server Kit extension emits any structured log record via the Python adapter
- **THEN** the record SHALL pass validation against the same shared schema as coordinator

#### Scenario: Browser viewer emits log record matching shared schema after POST to coordinator
- **WHEN** web-viewer-sample flushes its in-memory buffer to `POST /api/internal/viewer-log`
- **AND** coordinator persists the records to `logs/viewer/<date>/<run_id>.jsonl`
- **THEN** each persisted record SHALL pass validation against the shared schema

#### Scenario: PowerShell script emits log record matching shared schema
- **WHEN** any script under `scripts/` uses `New-StructLogger` from `scripts/lib/StructLog.psm1` and writes a record
- **THEN** the record SHALL pass validation against the shared schema

#### Scenario: Record with required field missing fails validation
- **WHEN** a record is written without `ts`, `level`, `event_type`, `service`, `component`, `run_id`, `trace_id`, `msg`, or `data`
- **THEN** validation SHALL fail and the contract test SHALL report the missing field

### Requirement: Each event_type SHALL define data sub-schema requirements

The system SHALL enforce per-`event_type` requirements on the `data` object:

- `logic_error`: data MUST include `error.name` (string), `error.message` (string), `error.stack_tail` (string array, max 8 entries)
- `operation_anomaly`: data MUST include `anomaly_kind` (`retry`/`fallback`/`timeout`/`unexpected_state`) and `reason` (string)
- `env_snapshot`: data MUST include `vars` (array of `{key, source, value_or_redacted, type}`)
- `lifecycle`: data MUST include `phase` (`start`/`active`/`closing`/`closed`), `subject_kind` (`review_session`/`conversion_job`/`kit_subprocess`/`ifc_ready_job`/`script_run`/`outbox_delivery`), `subject_id`
- `audit`: data MUST include `action`, `actor`, `target`
- `network`: data MUST include `direction` (`inbound`/`outbound`), `protocol` (`http`/`websocket`/`socket.io`/`webrtc-signal`/`datachannel`), `peer` (logical name, not host:port), `status`; `duration_ms` and `path` are optional
- `general`: no required `data` keys; `data` MAY be omitted or empty object

#### Scenario: logic_error record without error.stack_tail fails validation
- **WHEN** a record has `event_type: "logic_error"` and `data` missing `error.stack_tail`
- **THEN** validation SHALL fail and the contract test SHALL report missing `data.error.stack_tail`

#### Scenario: network record peer contains logical name
- **WHEN** a record has `event_type: "network"` and `data.peer`
- **THEN** the value SHALL be one of `coordinator`/`streaming-server`/`external-edge`/`external-cloud`/`kit-subprocess`/`viewer` and MUST NOT contain a raw host:port URL

#### Scenario: general record may omit data field
- **WHEN** a record has `event_type: "general"`
- **THEN** validation SHALL pass even if `data` is `{}` or absent

### Requirement: trace_id SHALL propagate across services using documented carriers

The system SHALL transport `trace_id` between services so that grep over `logs/` for one `trace_id` returns chronologically orderable records from every service that participated:

- coordinator ⇄ streaming-server HTTP: header `X-Trace-Id`
- coordinator ⇄ viewer Socket.IO: event payload field `trace_id`
- viewer ⇄ streaming-server WebRTC DataChannel: event payload field `trace_id` (the vendor `ApplicationMessage` bridge serializes `{event_type,payload}` and does not expose an independent root envelope field)
- external cloud callback outbox: payload field `trace_id`
- Kit subprocess invocation: CLI arg `--trace-id=<id>`
- PowerShell scripts: env var `BIM_TRACE_ID`

`trace_id` naming convention:
- the existing `ifc_ready_job_id` (already prefixed `ifcready_`) is the root trace for an IFC-ready originated closed loop and MUST NOT be prefixed a second time
- `rev_<existing_session_id>` for standalone review-session originated traces only; a review session derived from IFC-ready MUST retain the upstream `ifcready_*` root trace
- `stream_conv_<existing_job_id>` for internal conversion originated traces only when no valid inbound trace exists
- `script_<run_id>` for PowerShell script originated traces with no upstream

Optional record field `parent_trace_id` MAY link derived traces back to originating trace.

#### Scenario: Coordinator outbound HTTP carries X-Trace-Id
- **WHEN** coordinator dispatches conversion request to bim-streaming-server
- **THEN** the HTTP request SHALL include `X-Trace-Id` equal to the originating IFC-ready job's `ifc_ready_job_id`
- **AND** streaming-server SHALL validate and persist that trace with the conversion job and use it for conversion lifecycle records

#### Scenario: IFC-ready review session carries the root trace into viewer bootstrap
- **WHEN** coordinator creates or reuses a review session for an IFC-ready job
- **THEN** the session/open response and browser-visible viewer URL SHALL carry the same `ifcready_*` root trace
- **AND** viewer production bootstrap SHALL create one browser logger with that trace, install global handlers, and emit startup records through `POST /api/internal/viewer-log`

#### Scenario: Supported PowerShell smoke runner joins the root trace
- **WHEN** `scripts/smoke-bscheme-intake.ps1` receives the accepted IFC-ready job response
- **THEN** it SHALL set its structured logger to the returned `ifc_ready_job_id` and emit subsequent poll/session/close records with that trace

#### Scenario: Kit subprocess receives trace_id via CLI
- **WHEN** `convert-ifc-to-usdc.ps1` launches Kit subprocess
- **THEN** the subprocess command line SHALL include `--trace-id=<trace_id>` and the Kit extension SHALL adopt it as the active `trace_id` for the run

#### Scenario: Socket.IO binds one server-owned root trace
- **WHEN** a viewer joins, heartbeats, or leaves a review session over Socket.IO
- **THEN** the client event SHALL carry only a candidate `trace_id` and coordinator SHALL resolve the canonical trace persisted immutably at session creation
- **AND** a legacy session MAY backfill from zero or one distinct valid linked root, while multiple roots, stored/linked conflict, malformed state, or mutable latest-job ordering SHALL NOT produce authority
- **AND** every successful acknowledgement and presence emission SHALL carry the canonical trace; a rejected acknowledgement SHALL carry only a stable error and no canonical trace
- **AND** rejection SHALL occur before socket-room join/leave, participant/session mutation, or presence emission
- **AND** malformed, mismatched, or ambiguous linked roots SHALL fail closed rather than replace the browser trace
- **AND** an IFC-ready-linked session SHALL retain its `ifcready_*` root while a standalone session SHALL use `rev_<session_id>`

#### Scenario: Every DataChannel message carries the verified root trace
- **GIVEN** Socket.IO has case-exactly verified the viewer's canonical session trace
- **WHEN** viewer or Kit sends any DataChannel catalog message, including a read-only request/response, mutation/result/rejection, progress update, binding event, selection event, or other unsolicited event
- **THEN** that message's `payload.trace_id` SHALL equal the verified canonical trace
- **AND** viewer SHALL send no DataChannel message before verification
- **AND** Kit SHALL reject a missing or mismatched inbound trace before acting and SHALL propagate the same trace on every response or event
- **AND** all 26 event types enumerated by `tests/contracts/kit-datachannel-v1.schema.json` SHALL be covered in viewer outbound, Kit inbound, Kit outbound, and viewer inbound directions
- **AND** viewer SHALL reject a Kit→viewer message with missing or mismatched trace before correlation bookkeeping, request completion, accepted logging, or UI/state mutation
- **AND** mutators SHALL still obtain coordinator runtime authority before changing state

#### Scenario: Callback outbox retains the root trace
- **WHEN** coordinator persists or delivers a ready or failed external cloud callback
- **THEN** the outbox payload SHALL include `trace_id` case-exactly equal to the IFC-ready root

#### Scenario: Grep one trace_id returns timeline across 4 services
- **WHEN** an IFC-ready job completes a full closed loop (PowerShell smoke runner → coordinator intake → streaming conversion → review session → viewer bootstrap → close)
- **AND** an agent runs `Select-String -Path logs/**/*.jsonl -Pattern '"trace_id":"<id>"'`
- **THEN** the result SHALL contain records from coordinator, streaming-server, viewer (via coordinator intake), and the participating PowerShell runner, sortable by `ts`
- **AND** evidence produced by manually injecting the same trace into otherwise-unwired adapters SHALL NOT satisfy this scenario

### Requirement: Each service SHALL emit env_snapshot at logger creation

The system SHALL emit exactly one `env_snapshot` record per service logger run, before the logger creation API returns. Server and PowerShell snapshots SHALL include all process environment variables observed at startup. Browser snapshots SHALL include only documented build-time allow-list runtime config and non-sensitive browser metadata; they SHALL NOT enumerate arbitrary `window`, storage, or query-string values. Values SHALL be transformed as follows:

- If `key` is in the allow-list documented at `docs/contracts/structured-log-env-allowlist.md`: emit raw value
- Else if `key` contains pattern `TOKEN`/`SECRET`/`KEY`/`PASSWORD`/`AUTH`/`CREDENTIAL` (case-insensitive): emit `[REDACTED:type=<string|number|boolean>, len=<n>]`
- Else: emit `[TYPE:type=<...>, len=<...>]` (type + length, original value omitted)

Each entry SHALL also record `source` (one of `.env`/`.env.example`/`system`/`docker-compose`/`default`).

#### Scenario: logger factory emits env_snapshot before returning
- **WHEN** any of `createLogger()` (TS), `create_logger()` (Python), `createBrowserLogger()` (Browser), or `New-StructLogger` (PowerShell) is invoked
- **THEN** server and PowerShell factories SHALL write an `env_snapshot` record to their sink before returning the logger handle
- **AND** `createBrowserLogger()` SHALL enqueue exactly one `env_snapshot` in its in-memory buffer before returning and SHALL deliver it through the existing asynchronous flush policy

#### Scenario: Secret-pattern env value is redacted
- **WHEN** env contains `INTERNAL_API_TOKEN=abc123xyz`
- **THEN** the env_snapshot record SHALL contain `value_or_redacted: "[REDACTED:type=string, len=9]"` for that key and SHALL NOT contain the substring `abc123xyz`

#### Scenario: Allow-list env value is emitted raw
- **WHEN** env contains `STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` and `STORAGE_ROOT` is in the allow-list
- **THEN** the env_snapshot record SHALL contain `value_or_redacted: "C:\\Repos\\active\\iot\\AI-BIM-governance\\storage"`

#### Scenario: Non-listed, non-secret env value emits type metadata only
- **WHEN** env contains `RANDOM_KEY=some-value-12345` and `RANDOM_KEY` is neither in allow-list nor matches secret pattern
- **THEN** the env_snapshot record SHALL contain `value_or_redacted` indicating type and length but SHALL NOT contain the original value

### Requirement: Every adapter SHALL redact secret-like keys in general event data

Before serialization, all four adapters SHALL traverse ordinary event `data` with a bounded, cycle-safe recursive sanitizer. Any nested key matching `TOKEN`/`SECRET`/`KEY`/`PASSWORD`/`AUTH`/`CREDENTIAL` case-insensitively—including literal `key` and `auth`—SHALL replace its value with `[REDACTED]`. The env allow-list SHALL NOT exempt ordinary event keys. Only `env_snapshot.vars[]` MAY use its dedicated schema-aware sanitizer to preserve the structural fields `key`, `source`, `value_or_redacted`, and `type`. `MAX_REDACTION_DEPTH` SHALL be 8 with the root `data` container at depth 0; an object or array that would be entered at depth 9 SHALL be replaced exactly with `[Truncated]`. Circular references SHALL replace only the cyclic subtree with `[Circular]`. No marker or error SHALL echo the original secret value.

#### Scenario: Nested general data cannot persist an auth or key value
- **WHEN** any adapter receives ordinary event data containing secret sentinel values under nested object or array keys such as `auth`, `key`, `password`, `api_key`, or `token`
- **THEN** the emitted record SHALL contain redaction markers at those positions
- **AND** its serialized representation SHALL NOT contain any sentinel value

#### Scenario: env_snapshot preserves schema vocabulary without creating a global exemption
- **WHEN** an adapter emits `env_snapshot.vars[]`
- **THEN** the row's structural `key`, `source`, `value_or_redacted`, and `type` fields SHALL remain available
- **AND** secret-like fields elsewhere in the same event SHALL still be recursively redacted

#### Scenario: Deep or circular data fails safe
- **WHEN** ordinary event data exceeds the redaction depth bound or contains a circular collection
- **THEN** the adapter SHALL retain the original record event type, replace only the affected subtree with `[Truncated]` or `[Circular]`, and SHALL NOT throw or expose values reachable only beyond that boundary or cyclic edge

### Requirement: Log records SHALL persist to logs/<service>/YYYY-MM-DD/<service>-<run_id>.jsonl

The system SHALL write structured log records as one-record-per-line JSONL into a directory structure rooted at repository root `logs/`. The path SHALL be `logs/<service>/<YYYY-MM-DD>/<service>-<run_id>.jsonl`, where `<run_id>` is generated at logger creation and stable for the lifetime of the service process. Records SHALL also be emitted to stdout for the same process.

The `logs/` directory SHALL be ignored by git.

#### Scenario: Coordinator log file written to dated directory
- **WHEN** coordinator runs on 2026-05-26 with run_id `run_20260526_142010_a3f9`
- **THEN** records SHALL be appended to `logs/coordinator/2026-05-26/coordinator-run_20260526_142010_a3f9.jsonl`

#### Scenario: Cross-midnight rotation opens new dated directory
- **WHEN** a service is running across UTC midnight from 2026-05-26 to 2026-05-27
- **THEN** records written after midnight SHALL go to `logs/<service>/2026-05-27/<service>-<run_id>.jsonl` while the previous file is closed

#### Scenario: logs/ is gitignored
- **WHEN** any service writes to `logs/`
- **THEN** `git status` from repository root SHALL NOT report `logs/` as tracked

### Requirement: Coordinator SHALL accept viewer log records via POST /api/internal/viewer-log

bim-review-coordinator SHALL expose `POST /api/internal/viewer-log` that accepts an array of `LogRecord` JSON objects in request body. Before parsing the body, the endpoint SHALL authenticate one active primary or spectator viewer lease using the case-exact headers `X-Review-Session-Id`, `X-Viewer-Lease-Id`, and `X-Viewer-Lease-Token`. Missing, wrong, cross-session, expired, or released authority SHALL return 401 without reading or persisting the body. The endpoint SHALL enforce its 256 KiB parser before the global 1 MiB JSON parser, validate each record against the shared schema, accept only records whose `service` is exactly `viewer`, and persist passing records to `logs/viewer/<date>/<run_id>.jsonl`. Records failing validation or service pinning SHALL be dropped from disk but counted in the per-process counter exposed via authenticated `GET /api/internal/structLog/health`.

#### Scenario: Viewer batch is persisted to logs/viewer/
- **WHEN** web-viewer-sample with an active viewer lease POSTs an array of 10 schema-valid `service: "viewer"` records to `/api/internal/viewer-log` with all three authority headers
- **THEN** coordinator SHALL respond 200 and append 10 lines to `logs/viewer/<date>/viewer-<run_id>.jsonl`

#### Scenario: Oversized request is rejected
- **WHEN** an authenticated viewer POSTs a fixed-length or chunked request larger than the configured max (default 256 KiB)
- **THEN** coordinator SHALL respond 413 and SHALL NOT write any line

#### Scenario: Malformed records are dropped, valid records persist
- **WHEN** viewer POSTs an array containing 8 schema-valid records and 2 records missing required fields
- **THEN** coordinator SHALL respond 200, persist 8 lines, increment dropped counter by 2, and NOT throw

#### Scenario: Invalid lease authority is rejected before body parsing
- **WHEN** viewer-log receives missing, wrong, cross-session, expired, or released lease authority
- **THEN** coordinator SHALL respond 401 with one uniform public error shape
- **AND** SHALL NOT parse or persist any request record

#### Scenario: Viewer intake cannot spoof another service
- **WHEN** an authenticated batch contains a schema-valid record whose `service` is `coordinator`, `streaming-server`, or `scripts`
- **THEN** that record SHALL be counted as dropped and SHALL NOT create or append to any non-viewer service log path

### Requirement: Coordinator SHALL expose GET /api/internal/structLog/health

bim-review-coordinator SHALL expose `GET /api/internal/structLog/health`, protected by the existing internal token contract, returning a JSON object describing the coordinator logger's runtime state:

- `run_id`: current run_id string
- `current_file`: absolute path of the active JSONL file
- `records_written`: integer count of records successfully appended this run
- `records_dropped`: integer count of viewer records dropped due to validation or size
- `last_failure`: object `{ts, reason}` or null

#### Scenario: Health endpoint returns logger metadata
- **WHEN** an authorized internal client GETs `/api/internal/structLog/health` with the existing internal token
- **THEN** the response SHALL be 200 with JSON containing `run_id`, `current_file`, `records_written`, `records_dropped`, `last_failure`

#### Scenario: Health endpoint rejects missing or wrong internal token
- **WHEN** a client GETs `/api/internal/structLog/health` without the configured internal token or with a wrong token
- **THEN** coordinator SHALL respond 401 and SHALL NOT return logger file or run metadata

### Requirement: Logger SHALL fail-soft on sink errors

The logging adapter SHALL never throw exceptions that propagate to caller code in the main service flow when the sink (file or stdout) fails. On failure the adapter SHALL:

1. Retain the record in an in-process ring buffer of last 100 records
2. Emit `[structLog sink failed]` plus the record to stderr
3. Continue accepting subsequent records without state corruption
4. On file lock encountered, retry by writing to `logs/<service>/_recovery/<date>-<run_id>.jsonl` for the failing record then resume normal sink on next record

#### Scenario: Disk full does not crash service
- **WHEN** the sink file write fails because disk is full
- **THEN** the adapter SHALL NOT throw to caller, SHALL write `[structLog sink failed]` to stderr with the dropped record, and SHALL continue accepting subsequent records

#### Scenario: Circular reference in data retains the original event safely
- **WHEN** caller passes a `data` object containing a circular reference
- **THEN** the adapter SHALL retain the original record event type, replace only the cyclic subtree with `[Circular]`, and SHALL NOT throw or expose values reachable only through the cyclic edge

### Requirement: Coordinator EventLog SHALL mirror lifecycle events to structured log

For every successful call to `EventLog.append(sessionId, type, payload)` in bim-review-coordinator, the system SHALL also emit a corresponding `lifecycle` record via the structured log adapter. The mapping table from EventLog event type to `subject_kind` + `phase` SHALL be documented in `tasks.md` and SHALL cover at minimum: `sessionCreated`, `sessionActive`, `sessionClosing`, `sessionClosed`, `kitInstanceReleased`, `kitInstancesReleased`. The existing `/api/.../lifecycle-events` endpoint and `storage/event-log/*.jsonl` file format SHALL remain unchanged.

#### Scenario: sessionCreated emits both EventLog entry and structured lifecycle record
- **WHEN** coordinator calls `EventLog.append(sessionId, 'sessionCreated', payload)`
- **THEN** the existing `storage/event-log/<sessionId>.jsonl` SHALL receive the entry as before
- **AND** `logs/coordinator/<date>/<run_id>.jsonl` SHALL receive a record with `event_type: "lifecycle"`, `data.phase: "start"`, `data.subject_kind: "review_session"`, `data.subject_id: <sessionId>`

#### Scenario: Existing lifecycle-events API response is unchanged
- **WHEN** an agent calls `GET /api/review-sessions/<id>/lifecycle-events` before and after this change
- **THEN** the response schema, fields, and ordering SHALL be identical

### Requirement: Retention script SHALL prune log directories older than 30 days

The system SHALL provide `scripts/log-retention/prune-logs.ps1` that scans `logs/<service>/<YYYY-MM-DD>/` directories and deletes those whose date is more than 30 calendar days before today (UTC). The script SHALL default to `-DryRun` reporting deletions without acting; `-Apply` SHALL execute deletions. The script SHALL NOT delete `logs/` itself, SHALL NOT delete any `<service>` directory itself, and SHALL NOT delete a `<YYYY-MM-DD>` directory whose date is exactly 30 days old.

#### Scenario: -DryRun lists deletions without acting
- **WHEN** `prune-logs.ps1` runs with `-DryRun` against a fixture containing 5/15/30/45/60-day-old directories
- **THEN** the script SHALL print intended deletions for 45-day and 60-day directories and SHALL NOT remove any file

#### Scenario: -Apply deletes >30-day directories only
- **WHEN** `prune-logs.ps1 -Apply` runs against the same fixture
- **THEN** the 45-day and 60-day directories SHALL be removed
- **AND** the 5-day, 15-day, and 30-day directories SHALL remain
- **AND** `logs/` and each `<service>/` directory SHALL remain

### Requirement: Viewer-log delivery SHALL use active lease authority and bounded host exposure

The base runtime-manager Compose profile SHALL publish coordinator and viewer host ports only on `127.0.0.1`. The explicit host-kit LAN profile MAY continue publishing its documented LAN ports, so viewer-log SHALL NOT rely on host binding as authentication. Browser delivery authority SHALL exist only in memory and the three viewer-log request headers; the lease token SHALL NOT appear in a URL, request body, structured-log record, console artifact, trace artifact, or evidence metadata. The browser SHALL obtain or reuse authority only for an explicit user Flush and SHALL NOT claim a primary lease on component mount or let a spectator steal primary. If no valid authority is available, it SHALL perform no viewer-log fetch and SHALL retain the batch for retry.

#### Scenario: Base profile is loopback-only while host-kit retains explicit LAN behavior
- **WHEN** the base runtime-manager Compose configuration is rendered
- **THEN** coordinator and viewer published host ports SHALL bind to `127.0.0.1`
- **AND** the explicit host-kit override MAY retain its documented LAN publish without weakening viewer-log authentication

#### Scenario: Browser has no delivery authority
- **WHEN** the user activates Flush but the viewer cannot obtain or reuse an active primary or spectator lease
- **THEN** the browser SHALL issue no request to `/api/internal/viewer-log`
- **AND** SHALL retain the diagnostics action and show a retryable failure

#### Scenario: Authority remains outside persisted evidence
- **WHEN** a viewer-log request is sent or browser evidence is captured
- **THEN** the lease token SHALL exist only in the request header and in-memory lease state
- **AND** SHALL NOT appear in the request body, structured-log buffer, console/network evidence, Playwright trace, or artifact manifest

### Requirement: Standalone review viewer SHALL provide bounded structured-log delivery diagnostics

The standalone viewer route reached through coordinator `/ui/open` for an existing review session SHALL render one bounded structured-log delivery diagnostics surface when the browser logger is available. Operator-console routes and controls SHALL NOT substitute for this surface. This surface is not a centralized log dashboard. It SHALL reuse the existing browser logger and coordinator contracts without adding a backend endpoint or changing the shared log schema.

The surface SHALL expose:

- the active root `trace_id`, browser logger `run_id`, and review session id;
- the conversion job id and Kit instance id when the coordinator stream config provides them, otherwise an explicit not-observed value;
- a user-triggered flush control with idle, loading, success, failure, and retry states; and
- a user-triggered review-session close control with closing, closed, failure, and retry states.

The UI SHALL NOT render structured-log record bodies, environment values, absolute JSONL paths, or read repository log files. Browser network traffic SHALL remain coordinator-only.

The action controls SHALL be enabled only when the route contains one valid review session/root trace carrier, the loaded session matches that carrier, and the bootstrapped logger trace matches the route trace case-exactly. A mismatch SHALL render an unavailable state rather than perform an evidence action.

On explicit Flush, the diagnostics surface SHALL obtain or reuse structured-log delivery authority before transport. A successful flush SHALL remove only the exact captured in-flight buffer entries acknowledged by the transport; records appended or retained during the request SHALL remain queued and SHALL NOT be counted as delivered.

#### Scenario: User flushes browser records through the real coordinator endpoint
- **GIVEN** a coordinator-generated viewer route has a valid review session and root trace
- **WHEN** the user activates `Flush structured logs`
- **THEN** the viewer SHALL enqueue a diagnostics record and show a visible loading state
- **AND** the existing browser logger SHALL POST buffered records to coordinator `/api/internal/viewer-log`
- **AND** a visible success state SHALL require the action's target flushed count to be reached with no new drops and the unique diagnostics action absent from the retained buffer
- **AND** success SHALL contain the active trace and browser run ids

#### Scenario: Viewer-log delivery failure exposes a retry without false success
- **WHEN** all transport attempts for the user-triggered flush fail
- **THEN** the viewer SHALL show a visible failure state and a `Retry flush` control
- **AND** the viewer SHALL NOT show success or discard a still-retained record merely to clear the UI state

#### Scenario: Retry uses the same production carrier
- **GIVEN** the prior user-triggered flush is visibly failed
- **WHEN** the user activates `Retry flush`
- **THEN** the viewer SHALL retry through the same browser logger and coordinator `/api/internal/viewer-log` endpoint
- **AND** the viewer SHALL reuse the retained diagnostics action rather than enqueue a duplicate action
- **AND** a successful response SHALL replace the failure state with visible success

#### Scenario: Manual flush waits for a timer-started batch
- **GIVEN** the browser timer already has a flush in flight when the user action is enqueued
- **WHEN** the diagnostics surface invokes the public manual flush
- **THEN** manual flush SHALL wait for the in-flight batch to reach a terminal state
- **AND** SHALL attempt any diagnostics action still retained afterward
- **AND** the UI SHALL NOT treat progress from only the older batch as delivery of the diagnostics action

#### Scenario: Concurrent append survives a successful in-flight flush
- **GIVEN** a captured batch is in flight and a newer record is appended or buffer overflow removes an older entry
- **WHEN** the transport acknowledges the captured batch
- **THEN** the logger SHALL remove only the captured entry identities still present
- **AND** every newer or unrelated retained entry SHALL remain queued for exactly one later delivery

#### Scenario: Visible failure remains stable until explicit retry
- **WHEN** the user-triggered diagnostics batch reaches terminal failure
- **THEN** the viewer SHALL keep timer and threshold auto-flush paused while the failure and retry control are visible
- **AND** background delivery SHALL NOT consume the retained diagnostics action before the user activates Retry
- **AND** auto-flush SHALL resume after successful retry or component cleanup

#### Scenario: User closes the same review session from the diagnostics surface
- **GIVEN** the diagnostics surface identifies review session `<sessionId>`
- **WHEN** the user activates `Close review session`
- **THEN** the viewer SHALL show a visible closing state and POST cooperative-close body `{}` to coordinator `/api/review-sessions/<sessionId>/close`
- **AND** the viewer SHALL NOT attach an operator termination `reason`
- **AND** response status `closed` SHALL produce a visible closed state for that same session
- **AND** a failed close SHALL expose a retry control without claiming the session is closed

#### Scenario: Forced delivery failure exists only in browser evidence
- **WHEN** Playwright verifies the failure and retry states
- **THEN** the test MAY intercept the first user-triggered viewer-log POST sequence
- **AND** production code SHALL NOT expose a failure query parameter, fault-injection endpoint, or test-only success branch
- **AND** the successful retry SHALL reach the real coordinator endpoint after interception is removed
