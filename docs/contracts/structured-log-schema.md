# Structured Log Schema — Contract

> **Source of truth** for the cross-service structured log baseline.
> Capability spec: `openspec/specs/cross-service-structured-log-baseline/` (post-archive).
> Design rationale: `docs/superpowers/specs/2026-05-26-cross-service-structured-log-baseline-design.md`.
> JSON Schema artifact: `tests/contracts/structured-log/schema.json` (draft-07).

This document is the single source of truth for the cross-service structured log schema. Any change to record shape, `event_type` enumeration, `data` sub-schema, `trace_id` naming, or transport headers MUST update this document and the matching `tests/contracts/structured-log/schema.json` in the same change.

## 1. Record shape

Each structured log record is a single-line JSON object. Records are appended one per line into `logs/<service>/<YYYY-MM-DD>/<service>-<run_id>.jsonl` and also emitted to stdout for the originating process.

### 1.1 Required fields

| Field | Type | Description |
|---|---|---|
| `ts` | string | ISO-8601 UTC timestamp, millisecond precision (e.g. `2026-05-26T14:23:11.482Z`) |
| `level` | enum | `debug` \| `info` \| `warn` \| `error` \| `fatal` |
| `event_type` | enum | See §2 |
| `service` | enum | `coordinator` \| `streaming-server` \| `viewer` \| `scripts` |
| `component` | string | Free-form module name within service (e.g. `ifcDownloader`, `stage_loading`, `preflight-docker`) |
| `run_id` | string | `run_<YYYYMMDD>_<HHMMSS>_<6 lowercase hex>` — one per process startup |
| `trace_id` | string | See §4 |
| `msg` | string | Human-readable short message |
| `data` | object | Event-specific payload — see §3. For `event_type: "general"` MAY be `{}` |

### 1.2 Optional fields

| Field | When | Description |
|---|---|---|
| `seq` | always optional | Strictly increasing integer within a `trace_id`; used by EventLog-style audit consumers |
| `caller` | required when `level=error` or `warn` | `file:line` (e.g. `src/services/ifcDownloader.ts:142`) |
| `error` | required when `level=error` or `fatal` | `{ name: string, message: string, stack_tail: string[] }` (`stack_tail` length ≤ 8) |
| `parent_event_id` | self-defined | Links retry / fallback chain to the originating record's `event_id` (if record was given one) |
| `parent_trace_id` | self-defined | Links derived traces back to upstream `trace_id` (e.g. `rev_<id>.parent_trace_id = ifcready_<id>`) |

## 2. `event_type` enumeration (7 values)

| event_type | Purpose |
|---|---|
| `logic_error` | Handled or unhandled exceptions, validation failures, contract violations |
| `operation_anomaly` | Retry / fallback / timeout / unexpected_state — operational deviations that are not fatal but should be visible |
| `env_snapshot` | Startup environment / configuration dump (exactly one per service run, emitted before `createLogger`/`create_logger`/`New-StructLogger` returns) |
| `lifecycle` | session / conversion job / Kit subprocess / IFC-ready job / script run / outbox delivery lifecycle |
| `audit` | agent / human key commands (e.g. `deploy-report`, `gh pr merge`, fast MVP dispatch) |
| `network` | Inbound / outbound HTTP / WebSocket / Socket.IO / WebRTC signal / DataChannel events |
| `general` | Fallback for raw `debug` / `info` / `warn` calls that do not fit a semantic category; `data` MAY be empty |

### 2.1 API to `event_type` mapping

Adapter public APIs map to `event_type` deterministically:

| Adapter call | Default `event_type` |
|---|---|
| `network(...)` semantic helper | `network` |
| `audit(...)` semantic helper | `audit` |
| `lifecycle(...)` semantic helper | `lifecycle` |
| `anomaly(...)` semantic helper | `operation_anomaly` |
| `envSnapshot(...)` / `env_snapshot(...)` semantic helper | `env_snapshot` |
| `debug(...)`, `info(...)`, `warn(...)` raw | `general` |
| `error(err, ...)`, `fatal(err, ...)` raw | `logic_error` (with `data.error.{name, message, stack_tail}` auto-populated from the `Error`-like argument) |

If a caller wants a specific `event_type` they MUST use the corresponding semantic helper.

## 3. `data` sub-schema by `event_type`

### 3.1 `logic_error`

```jsonc
{
  "error": {
    "name": "ValidationError",
    "message": "session_id must be safe",
    "stack_tail": ["at validateSession (src/...)", "at ..."]  // up to 8 entries
  }
}
```

Required keys: `error.name`, `error.message`, `error.stack_tail`.

### 3.2 `operation_anomaly`

```jsonc
{
  "anomaly_kind": "fallback",   // retry | fallback | timeout | unexpected_state
  "reason": "hoops_a3d_failed",
  /* additional event-specific keys MAY be added */
}
```

Required keys: `anomaly_kind`, `reason`.

### 3.3 `env_snapshot`

```jsonc
{
  "vars": [
    { "key": "STORAGE_ROOT", "source": ".env", "value_or_redacted": "C:\\Repos\\active\\iot\\AI-BIM-governance\\storage", "type": "string" },
    { "key": "INTERNAL_API_TOKEN", "source": ".env", "value_or_redacted": "[REDACTED:type=string, len=9]", "type": "string" }
  ]
}
```

Required: `vars` array of `{ key, source, value_or_redacted, type }`. `source` ∈ `.env` \| `.env.example` \| `system` \| `docker-compose` \| `default`.

### 3.4 `lifecycle`

```jsonc
{
  "phase": "start",          // start | active | closing | closed
  "subject_kind": "review_session", // see table below
  "subject_id": "review_session_xxx"
}
```

`subject_kind` values and corresponding `subject_id` semantics:

| `subject_kind` | `subject_id` |
|---|---|
| `review_session` | coordinator review session id (e.g. `review_session_xxx`) |
| `conversion_job` | streaming-server conversion job id (e.g. `stream_conv_20260525055218_115177da`) |
| `kit_subprocess` | Kit subprocess pid (stringified) |
| `ifc_ready_job` | coordinator IFC-ready job id (e.g. `ifcready_1779687625000_064c6813`) |
| `script_run` | PowerShell script run_id |
| `outbox_delivery` | outbox entry id |

### 3.5 `audit`

```jsonc
{
  "action": "deploy-report",
  "actor": "agent:claude-opus-4-7",
  "target": "compose-host"
}
```

Required keys: `action`, `actor`, `target`.

### 3.6 `network`

```jsonc
{
  "direction": "outbound",    // inbound | outbound
  "protocol": "http",         // http | websocket | socket.io | webrtc-signal | datachannel
  "peer": "streaming-server", // logical name, see below
  "status": 200,              // HTTP code | Socket.IO event name | "connected" | "disconnected"
  "duration_ms": 47,          // optional
  "path": "/api/external/ifc-ready"  // optional, HTTP only; query string MUST be stripped
}
```

Required keys: `direction`, `protocol`, `peer`, `status`.

`peer` MUST be one of: `coordinator` \| `streaming-server` \| `external-edge` \| `external-cloud` \| `kit-subprocess` \| `viewer`. Raw host:port URLs are forbidden to avoid internal topology disclosure.

Request/response bodies MUST NOT be embedded. A future `data.evidence_ref` field (not implemented in this baseline) may point to a sidecar evidence file when payload-level forensics are required.

### 3.7 `general`

```jsonc
{}
```

No required keys. `data` MAY be omitted entirely or be an empty object.

## 4. `trace_id` naming and propagation

### 4.1 Naming convention

| Prefix | Origin | Example |
|---|---|---|
| `ifcready_<existing_job_id>` | Coordinator IFC-ready intake | `ifcready_1779687625000_064c6813` |
| `rev_<existing_session_id>` | Coordinator review session (mint new; MAY carry `parent_trace_id` referencing the upstream `ifcready_*`) | `rev_20260526_1234abcd` |
| `stream_conv_<existing_job_id>` | Streaming-server internal conversion (typically inherits from `ifcready_*`; MAY mint when conversion is invoked directly) | `stream_conv_20260525055218_115177da` |
| `script_<run_id>` | PowerShell script with no upstream | `script_run_20260526_142010_a3f9` |

### 4.2 Propagation carriers

| Carrier | Field |
|---|---|
| HTTP request (coordinator ⇄ streaming-server, coordinator ⇄ external cloud callback) | Header `X-Trace-Id` |
| Socket.IO events (coordinator ⇄ viewer) | Event payload field `trace_id` |
| WebRTC DataChannel envelope (viewer ⇄ streaming-server) | Envelope field `trace_id` |
| External cloud callback outbox payload | Payload field `trace_id` |
| Kit subprocess invocation | CLI argument `--trace-id=<id>` |
| PowerShell scripts (cross-process / cross-script) | Environment variable `BIM_TRACE_ID` |

Receivers MUST:
1. Read the inbound carrier if present and adopt it as the active `trace_id`.
2. Forward the same `trace_id` to all downstream carriers.
3. If no inbound carrier is present, derive `trace_id` from an existing entity id (e.g. `ifcready_<job_id>` when ingesting a fresh IFC-ready request) before any log record is emitted.

## 5. Redaction rules

### 5.1 Env value redaction (used in `env_snapshot.vars[].value_or_redacted`)

1. If `key` appears in the allow-list (`docs/contracts/structured-log-env-allowlist.md`): emit the raw value as-is.
2. Else if `key` matches case-insensitive pattern `TOKEN` \| `SECRET` \| `KEY` \| `PASSWORD` \| `AUTH` \| `CREDENTIAL`: emit `[REDACTED:type=<string|number|boolean>, len=<n>]` where `n` is the original character length.
3. Else: emit `[TYPE:type=<...>, len=<...>]` — type + length only, original value omitted.

### 5.2 Generic `data` depth-defense redaction

Adapters MUST run a `redactDataBeforeWrite(data)` pass before serialization. The pass walks the `data` object recursively; if any key (case-insensitive) contains a secret pattern (§5.1 step 2), its value is replaced with `[REDACTED]` regardless of how the caller constructed `data`.

### 5.3 Network record host/URL handling

- `peer` MUST be a logical name from §3.6.
- HTTP `path` MAY include the request path; **query strings MUST be stripped** before logging (they often carry tokens).
- Request/response bodies MUST NOT be embedded.

## 6. Sink behavior

### 6.1 File sink

- Path: `<repo-root>/logs/<service>/<YYYY-MM-DD>/<service>-<run_id>.jsonl`
- Append-only, JSONL (one record per line)
- One file per service process (one `run_id` per process startup)
- Date rotation: when a record's `ts` date differs from the currently open file's date, the old file is closed and a new one opened
- `<repo-root>/logs/` MUST be present in `.gitignore`

### 6.2 stdout sink

Every record is also written to the originating process's stdout as a single JSON line. This provides redundancy when run under `docker logs`, `journalctl`, or `convert-ifc-to-usdc.ps1`'s `kit-stdout.log` capture.

### 6.3 Recovery sink

When the main file sink fails (lock, permission), the adapter MUST attempt to write the failing record to `<repo-root>/logs/<service>/_recovery/<YYYY-MM-DD>-<run_id>.jsonl` before resuming normal writes on the next record. Adapters MUST NEVER throw to the calling code on sink failure; instead they write `[structLog sink failed]` plus the record to stderr and continue.

## 7. Coordinator-mediated viewer intake

Browser viewers cannot write to the local file system. They batch records in an in-memory ring buffer (max 500 records) and flush via `POST /api/internal/viewer-log` (coordinator) on any of three triggers:

- ≥ 50 buffered records
- 2 seconds elapsed since last flush
- Explicit flush call

Coordinator's intake validates each record against this schema, persists passing records to `logs/viewer/<date>/viewer-<run_id>.jsonl`, drops failing or oversized records (counted in `GET /api/internal/structLog/health.records_dropped`), and responds with HTTP 200 (or 413 if request body exceeds the configured maximum).

This endpoint is **local-dev-only baseline** and MUST NOT require authentication in this capability. Production hardening (token, IP allow-list) is a future change.

## 8. Health endpoint

Coordinator exposes `GET /api/internal/structLog/health`:

```jsonc
{
  "run_id": "run_20260526_142010_a3f9",
  "current_file": "C:\\Repos\\active\\iot\\AI-BIM-governance\\logs\\coordinator\\2026-05-26\\coordinator-run_20260526_142010_a3f9.jsonl",
  "records_written": 1247,
  "records_dropped": 3,
  "last_failure": null
}
```

`last_failure` is `null` when no sink failure has occurred this run; otherwise `{ ts: ISO-8601, reason: string }`.

## 9. EventLog mirror mapping

`bim-review-coordinator/src/services/eventLog.ts.append(sessionId, type, payload)` continues to write its existing JSONL into `storage/event-log/<sessionId>.jsonl`. In addition, every append emits a parallel `lifecycle` record to the structured log baseline using the following mapping table:

| EventLog `type` | `subject_kind` | `phase` | `subject_id` |
|---|---|---|---|
| `sessionCreated` | `review_session` | `start` | `sessionId` (from append args) |
| `sessionActive` | `review_session` | `active` | `sessionId` |
| `sessionClosing` | `review_session` | `closing` | `sessionId` |
| `sessionClosed` | `review_session` | `closed` | `sessionId` |
| `kitInstanceReleased` | `kit_subprocess` | `closed` | from `payload.kit_instance_id` (string) |
| `kitInstancesReleased` | `kit_subprocess` | `closed` | from `payload.kit_instance_ids[]` joined with `,` |
| Any other type (future addition) | `review_session` | `active` | `sessionId` (until mapping is amended in this document) |

The existing `/api/.../lifecycle-events` REST endpoint and its response shape are unchanged.

## 10. Retention

Daily dated directories under `logs/<service>/` are the unit of retention. `scripts/log-retention/prune-logs.ps1` deletes `<YYYY-MM-DD>` directories older than `LOG_RETENTION_DAYS` calendar days (default 30, UTC) when invoked with `-Apply`. `-DryRun` (the default) lists candidates without deleting. `logs/` itself and the per-service directories are never deleted. The script may be invoked manually or via Windows Task Scheduler; CI does NOT run retention in this baseline.

## 11. Changelog discipline

Any PR that:

- Adds or renames an `event_type`
- Adds, renames, or changes a required `data` key
- Adds a `subject_kind` or `anomaly_kind` value
- Adds a new propagation carrier or changes an existing carrier's field name
- Adds an entry to or removes one from the env allow-list (`docs/contracts/structured-log-env-allowlist.md`)

MUST update this document and `tests/contracts/structured-log/schema.json` in the same change.
