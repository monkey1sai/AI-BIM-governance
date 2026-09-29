# S1 real-API smoke — model file lifecycle (session purge + record tombstone)

- Commit under test: `f044aab` (branch `feat/model-file-lifecycle-s1`)
- Date: 2026-09-29
- Scope: `bim-review-coordinator` only, no Kit/WebRTC. Confirms the two new
  DELETE routes and the closed-session-list filename field over a real HTTP
  server (not vitest supertest), including persistence across a process
  restart.

## Environment-override approach

The coordinator was started twice from `bim-review-coordinator` with
`npm run dev` (`tsx src/index.ts`), against a throwaway directory under the
machine's temp folder (referred to below as `<tmp>`; never a subdirectory of
the repo's own `data/`). Every coordinator-local store path was redirected
there so the run could not touch the real `bim-review-coordinator/data/`:

```
SESSION_STORE_DIR=<tmp>\sessions
EVENT_LOG_DIR=<tmp>\events
CONVERSION_LEDGER_STORE_PATH=<tmp>\conversion-ledger.json
EXTERNAL_IFC_READY_STORE_PATH=<tmp>\external-ifc-ready.json
CALLBACK_OUTBOX_STORE_PATH=<tmp>\callback-outbox.json
ARTIFACT_HEALTH_LEDGER_STORE_PATH=<tmp>\artifact-health-ledger.json
SOURCE_BUNDLE_STORE_PATH=<tmp>\source-bundles.json
PIPELINE_JOB_STORE_PATH=<tmp>\pipeline-jobs.json
CFD_RUN_LEDGER_STORE_PATH=<tmp>\cfd-run-ledger.json
STORAGE_ROOT=<tmp>\storage
LOG_ROOT=<tmp>\logs
PORT=8014
CONVERSION_POLL_ENABLED=false
```

The first four are what the task called out explicitly; the rest are the
other `<cwd>/data/...`-defaulted paths read from `bim-review-coordinator/src/config.ts`
(`loadConfig`), added so *no* store defaults back into the worktree's real
`data/`/`storage/`/`logs/` trees. `PORT=8014` is a free loopback port picked
for this run. `CONVERSION_POLL_ENABLED=false` avoids the coordinator polling
a (nonexistent, in this smoke) streaming-conversion server. No other env var
was set — `DEV_AUTH_TOKEN`, `INTERNAL_API_AUTH_TOKEN`, and the conversion-control
IP allowlist all used their `src/config.ts` source-code defaults, which
already allow loopback callers, so no dev token or allowlist override was
needed for a client calling from `127.0.0.1`. Requests were driven with
Python's stdlib `urllib.request` (no third-party HTTP client).

## Sequence and files

1. `POST /api/review-sessions` with only `project_id`/`model_version_id` →
   session A created (`01-create-session.json`).
2. `POST /api/review-sessions/{A}/close` with `{"reason":"smoke"}` → closed
   (`02-close-session.json`).
3. `GET /api/review-sessions?status=closed` → session A listed with
   `source_ifc_filename: null` (`03-list-closed-sessions.json`).
4. `DELETE /api/review-sessions/{A}?reason=manual` → HTTP 200
   (`04-delete-session.json`).
5. `GET /api/review-sessions/{A}` → HTTP 404 (`05-get-session-after-delete.json`).
6. Ledger seed record `mw_aaaa0000bbbb0001` (shape copied from
   `tests/conversion-record-remove-route.test.ts`'s `ledgerRecord()`, written
   to `<tmp>\conversion-ledger.json` **before** the first server start) shows
   up via `GET /api/conversion/records` with `sessions: []` and
   `source_ifc_filename: "model.ifc"` (derived from the record's
   `object_key`) (`06-list-records-before-delete.json`).
7. `DELETE /api/conversion/records/mw_aaaa0000bbbb0001` → HTTP 200
   (`07-delete-record.json`).
8. `GET /api/conversion/records` → `count: 0` (tombstone hidden by default)
   (`08-list-records-after-delete.json`).
9. `GET /api/conversion/records?include_removed=1` → the tombstone,
   `status: "removed"` with `removed_at`/`removed_by` (`09-list-records-include-removed.json`).
10. Coordinator process stopped and restarted with the *same* env (steps 1-9
    ran against the first process). `GET /api/review-sessions/{A}` still HTTP
    404 after restart (`10-after-restart-session.json`).
11. `GET /api/conversion/records?include_removed=1` after restart still shows
    the same tombstone (`removed_at` unchanged from step 9), proving the
    tombstone is durable, not in-memory-only (`11-after-restart-records.json`).
12. Filesystem check of `<tmp>\sessions` right after step 4/5: the purge
    writes `{session_id}.json.purged` and removes `{session_id}.json`
    (`12-purge-marker-filesystem-check.txt`).

Every JSON file is the literal `{ "http_status": <n>, "body": <response> }`
captured for that call. The coordinator process was stopped and the whole
`<tmp>` directory removed at the end of the run; nothing under
`bim-review-coordinator/data/` was read or written at any point.
