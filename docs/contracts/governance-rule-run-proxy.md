# Governance Rule-Run Proxy (coordinator → governance-service)

`bim-review-coordinator` exposes the A1/A2/A3 governance surface to the browser
on `:8004` and proxies to the host-native `governance-service` over loopback.
The browser only ever talks to `:8004`; `governance-service` is internal-only
(per root `AGENTS.md` boundary Req 5).

```txt
Browser → http://127.0.0.1:8004/api/governance/*  →  governance-service POST/GET /api/*
```

Upstream base URL: `GOVERNANCE_API_BASE` env (default `http://127.0.0.1:49102`).

The coordinator only **resolves + forwards**; it does NOT run rule-runs and is
NOT a governance data authority. When `governance-service` is unreachable the
coordinator returns HTTP `502 {detail, error}` and never fabricates a success.

## Proxied endpoints

```http
POST /api/governance/rule-runs                         → POST /api/rule-runs
POST /api/governance/rule-runs/for-session/{sessionId}  → POST /api/rule-runs   (resolves IFC path, see below)
GET  /api/governance/rule-runs/{runId}                  → GET  /api/rule-runs/{runId}
GET  /api/governance/rule-runs/{runId}/results          → GET  /api/rule-runs/{runId}/results
GET  /api/governance/rule-runs/{runId}/export           → GET  /api/rule-runs/{runId}/export  (Excel binary)
```

(`/api/governance/diffs*`, `/api/governance/federated-sets*`, `/api/governance/issues*`,
`/api/governance/bcf/export` are proxied the same way; see `src/routes/governanceProxy.ts`.)

## POST /api/governance/rule-runs

Direct pass-through. The caller already knows a server-side `ifc_source_path`.
Request body is forwarded verbatim to `governance-service POST /api/rule-runs`,
which requires `{ ifc_source_path }` and validates `os.path.exists(ifc_source_path)`
on the governance-service host. Optional: `model_version_id`, `element_mapping_path`,
`ids_path`, `rule_set`. Returns `202 { rule_run_id, status }`.

## POST /api/governance/rule-runs/for-session/{sessionId}

For the browser review viewer, which holds only `session_id` (NOT a server-side
IFC path). The coordinator resolves the IFC source path from its OWN stores and
forwards. Added in change `unified-console-mvp`.

### Resolution chain (coordinator-internal, read-only)

```txt
session_id
  → SessionStore.get(session_id)                         → ReviewSession.model_version_id
  → ExternalIfcReadyStore.list()
        .filter(job.review_session_id === session_id)     → IfcReadyIntakeJob   (most recent wins)
        (job.review_session_id is set by recordReviewSession() during
         conversion-ready auto-session handoff)
  → job.host_local_path  (governance-service host view; set by markDownloaded
                          when /api/external/ifc-ready downloads the IFC to
                          storage/ifc-cache/<ifc_ready_job_id>/source.ifc)
       fallback: job.local_path (container view)
```

### Request

Path param `sessionId` must match `review_session_[A-Za-z0-9_-]+` (else `400`).

Optional override body — additive, all fields optional:

```json
{
  "ids_path": "/host/abs/path/to/ruleset.ids",
  "rule_set": "fire-egress"
}
```

`ids_path` and `rule_set` (when non-empty strings) are forwarded as-is.
`ifc_source_path` and `model_version_id` always come from the resolution chain
above and CANNOT be overridden by the browser.

### Forwarded payload (coordinator → governance-service POST /api/rule-runs)

```json
{
  "ifc_source_path": "<resolved host_local_path>",
  "model_version_id": "<session.model_version_id>",
  "ids_path": "<override, if provided>",
  "rule_set": "<override, if provided>"
}
```

`element_mapping_path` is NOT injected: the coordinator only owns the downloaded
IFC source path on disk, not a host-side mapping file (the element mapping lives
as a streaming-artifact URL, not a coordinator-local path). Forward it via the
direct `POST /api/governance/rule-runs` endpoint if a host path is known.

### Responses

| Status | When | Body |
|---|---|---|
| `202` | resolved + forwarded; governance-service accepted | `{ rule_run_id, status }` |
| `400` | `sessionId` fails the safe-id pattern | `{ detail }` |
| `404` | session not found, no IFC-ready job linked to the session, or no server-side IFC path yet | `{ detail }` |
| `502` | `governance-service` unreachable at `GOVERNANCE_API_BASE` | `{ detail, error }` |

Honest failure only — the coordinator never invents an `ifc_source_path` and
never returns a fabricated `rule_run_id`. A `404` means the session has no IFC
that was ingested through `POST /api/external/ifc-ready` (e.g. a session created
directly via `POST /api/review-sessions` with only artifact URLs has no
server-side IFC path and is not resolvable).

## Tests

`bim-review-coordinator/tests/governance-rule-run-for-session.test.ts` covers:
resolve+forward (asserts `ifc_source_path === host_local_path` and
`model_version_id`), override `rule_set`/`ids_path` pass-through, `404` for
missing session, `404` for a session with no downloaded IFC, `400` for an
unsafe session id, and `502` when governance-service is unreachable.
