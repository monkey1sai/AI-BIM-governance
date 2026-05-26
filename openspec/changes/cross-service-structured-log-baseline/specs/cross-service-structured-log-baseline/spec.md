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
- viewer ⇄ streaming-server WebRTC DataChannel: envelope field `trace_id`
- external cloud callback outbox: payload field `trace_id`
- Kit subprocess invocation: CLI arg `--trace-id=<id>`
- PowerShell scripts: env var `BIM_TRACE_ID`

`trace_id` naming convention:
- `ifcready_<existing_job_id>` for IFC-ready originated traces
- `rev_<existing_session_id>` for review session originated traces (MAY include `parent_trace_id` referencing an `ifcready_*` trace)
- `stream_conv_<existing_job_id>` for internal conversion originated traces
- `script_<run_id>` for PowerShell script originated traces with no upstream

Optional record field `parent_trace_id` MAY link derived traces back to originating trace.

#### Scenario: Coordinator outbound HTTP carries X-Trace-Id
- **WHEN** coordinator dispatches conversion request to bim-streaming-server
- **THEN** the HTTP request SHALL include header `X-Trace-Id: ifcready_<job_id>` (or `rev_<session_id>` / `stream_conv_<job_id>` depending on origin)

#### Scenario: Kit subprocess receives trace_id via CLI
- **WHEN** `convert-ifc-to-usdc.ps1` launches Kit subprocess
- **THEN** the subprocess command line SHALL include `--trace-id=<trace_id>` and the Kit extension SHALL adopt it as the active `trace_id` for the run

#### Scenario: Grep one trace_id returns timeline across 4 services
- **WHEN** an IFC-ready job completes a full closed loop (coordinator intake → streaming conversion → review session → viewer DataChannel → callback outbox)
- **AND** an agent runs `Select-String -Path logs/**/*.jsonl -Pattern '"trace_id":"<id>"'`
- **THEN** the result SHALL contain records from coordinator, streaming-server, viewer (via coordinator intake), and any participating PowerShell script, sortable by `ts`

### Requirement: Each service SHALL emit env_snapshot at logger creation

The system SHALL emit exactly one `env_snapshot` record per service run, before the logger creation API returns. The snapshot SHALL include all process environment variables observed at startup, with values transformed as follows:

- If `key` is in the allow-list documented at `docs/contracts/structured-log-env-allowlist.md`: emit raw value
- Else if `key` contains pattern `TOKEN`/`SECRET`/`KEY`/`PASSWORD`/`AUTH`/`CREDENTIAL` (case-insensitive): emit `[REDACTED:type=<string|number|boolean>, len=<n>]`
- Else: emit `[TYPE:type=<...>, len=<...>]` (type + length, original value omitted)

Each entry SHALL also record `source` (one of `.env`/`.env.example`/`system`/`docker-compose`/`default`).

#### Scenario: createLogger emits env_snapshot before returning
- **WHEN** any of `createLogger()` (TS), `create_logger()` (Python), `New-StructLogger` (PowerShell) is invoked
- **THEN** an `env_snapshot` record SHALL be written to the sink before the function returns the logger handle

#### Scenario: Secret-pattern env value is redacted
- **WHEN** env contains `INTERNAL_API_TOKEN=abc123xyz`
- **THEN** the env_snapshot record SHALL contain `value_or_redacted: "[REDACTED:type=string, len=9]"` for that key and SHALL NOT contain the substring `abc123xyz`

#### Scenario: Allow-list env value is emitted raw
- **WHEN** env contains `STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` and `STORAGE_ROOT` is in the allow-list
- **THEN** the env_snapshot record SHALL contain `value_or_redacted: "C:\\Repos\\active\\iot\\AI-BIM-governance\\storage"`

#### Scenario: Non-listed, non-secret env value emits type metadata only
- **WHEN** env contains `RANDOM_KEY=some-value-12345` and `RANDOM_KEY` is neither in allow-list nor matches secret pattern
- **THEN** the env_snapshot record SHALL contain `value_or_redacted` indicating type and length but SHALL NOT contain the original value

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

bim-review-coordinator SHALL expose `POST /api/internal/viewer-log` that accepts an array of `LogRecord` JSON objects in request body. The endpoint SHALL validate each record against the shared schema and persist passing records to `logs/viewer/<date>/<run_id>.jsonl`. Records failing validation SHALL be dropped silently from disk but counted in a per-process counter exposed via `GET /api/internal/structLog/health`. The endpoint SHALL NOT require authentication in this baseline; it relies on `127.0.0.1` binding.

#### Scenario: Viewer batch is persisted to logs/viewer/
- **WHEN** web-viewer-sample POSTs an array of 10 schema-valid records to `/api/internal/viewer-log`
- **THEN** coordinator SHALL respond 200 and append 10 lines to `logs/viewer/<date>/viewer-<run_id>.jsonl`

#### Scenario: Oversized request is rejected
- **WHEN** viewer POSTs a request larger than the configured max (default 256 KiB)
- **THEN** coordinator SHALL respond 413 and SHALL NOT write any line

#### Scenario: Malformed records are dropped, valid records persist
- **WHEN** viewer POSTs an array containing 8 schema-valid records and 2 records missing required fields
- **THEN** coordinator SHALL respond 200, persist 8 lines, increment dropped counter by 2, and NOT throw

### Requirement: Coordinator SHALL expose GET /api/internal/structLog/health

bim-review-coordinator SHALL expose `GET /api/internal/structLog/health` returning a JSON object describing the coordinator logger's runtime state:

- `run_id`: current run_id string
- `current_file`: absolute path of the active JSONL file
- `records_written`: integer count of records successfully appended this run
- `records_dropped`: integer count of viewer records dropped due to validation or size
- `last_failure`: object `{ts, reason}` or null

#### Scenario: Health endpoint returns logger metadata
- **WHEN** an agent GETs `/api/internal/structLog/health`
- **THEN** the response SHALL be 200 with JSON containing `run_id`, `current_file`, `records_written`, `records_dropped`, `last_failure`

### Requirement: Logger SHALL fail-soft on sink errors

The logging adapter SHALL never throw exceptions that propagate to caller code in the main service flow when the sink (file or stdout) fails. On failure the adapter SHALL:

1. Retain the record in an in-process ring buffer of last 100 records
2. Emit `[structLog sink failed]` plus the record to stderr
3. Continue accepting subsequent records without state corruption
4. On file lock encountered, retry by writing to `logs/<service>/_recovery/<date>-<run_id>.jsonl` for the failing record then resume normal sink on next record

#### Scenario: Disk full does not crash service
- **WHEN** the sink file write fails because disk is full
- **THEN** the adapter SHALL NOT throw to caller, SHALL write `[structLog sink failed]` to stderr with the dropped record, and SHALL continue accepting subsequent records

#### Scenario: Circular reference in data triggers degraded record
- **WHEN** caller passes a `data` object containing a circular reference
- **THEN** the adapter SHALL write a downgraded record with `event_type: "operation_anomaly"`, `data.anomaly_kind: "unexpected_state"`, `data.reason: "struct_log serialization failed"`, listing original top-level keys, and SHALL NOT throw

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

### Requirement: viewer-log endpoint MUST NOT require authentication in this baseline

The `POST /api/internal/viewer-log` endpoint SHALL NOT enforce token-based authentication, header-based authentication, or session cookie verification in this baseline. The deployment relies on coordinator and viewer both binding to `127.0.0.1` interface only. Production hardening (e.g., `INTERNAL_API_TOKEN` requirement, IP allow-list) SHALL be a future change and SHALL NOT be introduced in this capability spec.

#### Scenario: Unauthenticated POST is accepted
- **WHEN** a client POSTs to `/api/internal/viewer-log` without any authentication header
- **THEN** coordinator SHALL accept and process the request as documented
