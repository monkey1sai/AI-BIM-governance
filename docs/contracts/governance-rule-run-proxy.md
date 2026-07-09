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
POST /api/governance/rule-runs/for-ifc-ready/{jobId}    → POST /api/rule-runs   (resolves downloaded IFC-ready source)
GET  /api/governance/rule-runs                         → GET  /api/rule-runs   (history query by persisted lineage)
GET  /api/governance/rule-runs/{runId}                  → GET  /api/rule-runs/{runId}
GET  /api/governance/rule-runs/{runId}/results          → GET  /api/rule-runs/{runId}/results
GET  /api/governance/rule-runs/{runId}/failures         → GET  /api/rule-runs/{runId}/failures  (per-rule group, paginated, storey-enriched)
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

`source_metadata` is not accepted from this browser-facing direct route. The
coordinator strips any caller-supplied value before forwarding so lineage cannot
be forged by the browser; persisted lineage is injected only by resolver routes
that bind an existing session / IFC-ready job.

## GET /api/governance/rule-runs

Read-only history query. The coordinator forwards query params unchanged to
`governance-service GET /api/rule-runs` and does not interpret or persist the
result. Supported filters:

```txt
project_id
model_category
model_version_id
ifc_ready_job_id
idempotency_key
review_session_id
limit   (1..100)
offset  (>=0)
```

The response is paged:

```json
{
  "filters": {
    "project_id": "project_demo_001",
    "model_category": "建築",
    "model_version_id": "version_demo_001"
  },
  "limit": 5,
  "offset": 0,
  "total": 1,
  "items": [
    {
      "rule_run_id": "rr_...",
      "status": "succeeded",
      "score": 98,
      "rule_set": "sample-fire-rating.ids",
      "model_version_id": "version_demo_001",
      "source_metadata": {
        "source_kind": "minio_ifc_ready",
        "ifc_ready_job_id": "ifcready_...",
        "idempotency_key": "mw_...",
        "project_id": "project_demo_001",
        "project_display_name": "松風庵",
        "model_category": "建築",
        "model_version_id": "version_demo_001"
      },
      "summary": null,
      "started_at": "2026-07-09T01:00:00Z",
      "finished_at": "2026-07-09T01:00:03Z"
    }
  ]
}
```

The history response intentionally does not include `ifc_source_path`,
`host_local_path`, `local_path`, presigned URLs, or secrets. It is for traceable
governance management and audit display, not for replaying host file paths in
the browser.

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
  "source_metadata": {
    "source_kind": "minio_ifc_ready",
    "ifc_ready_job_id": "<ifcready_* job id>",
    "idempotency_key": "<intake idempotency key>",
    "project_id": "<project id>",
    "project_display_name": "<display name or null>",
    "model_category": "<category or null>",
    "model_version_id": "<resolved model version>",
    "source_ifc_etag": "<etag or object-key-derived etag>",
    "review_session_id": "<session id or null>",
    "conversion_job_id": "<conversion job id or null>",
    "conversion_status": "<conversion status or null>"
  },
  "ids_path": "<override, if provided>",
  "rule_set": "<override, if provided>"
}
```

`source_metadata` is coordinator-injected lineage only. It is persisted by
`governance-service` on the rule-run and returned by `GET /api/rule-runs/{runId}`
so A1 can show which MinIO IFC project/category/version produced the result.
It MUST NOT contain `host_local_path`, `local_path`, `source_ifc_ref`, presigned
URLs, or secrets; governance-service rejects unsupported metadata keys.

`element_mapping_path` is NOT injected: the coordinator only owns the downloaded
IFC source path on disk, not a host-side mapping file (the element mapping lives
as a streaming-artifact URL, not a coordinator-local path). Forward it via the
direct `POST /api/governance/rule-runs` endpoint if a host path is known.

## POST /api/governance/rule-runs/for-ifc-ready/{jobId}

For the A1 MinIO path when the watcher/intake has already downloaded a
`source_ifc` but no Review Room session exists yet. The browser passes only the
browser-visible `ifc_ready_job_id`; the coordinator resolves `job.host_local_path`
server-side, forwards the rule-run, and attaches the same `source_metadata`
lineage described above.

This endpoint does not trigger IFC download or IFC-to-USDC conversion. If the
MinIO object has not been observed by the watcher/intake yet, use the conversion
scheduling/intake flow first.

Responses mirror `for-session`: `202` when forwarded, `400` for unsafe job id,
`404` when the job is missing or not downloaded, `409` when the downloaded source
IFC became stale/missing, and `502` when governance-service is unreachable.

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
The same file also covers `for-ifc-ready` downloaded/no-session forwarding and
the forwarded `source_metadata` lineage contract.
