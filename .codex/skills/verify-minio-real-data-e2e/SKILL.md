---
name: verify-minio-real-data-e2e
description: Verify the canonical Linux real-MinIO IFC intake and conversion loop without mutating deployment or bucket state. Use when the user asks to 驗收真 MinIO 資料, verify the MinIO watch loop, or re-check IFC intake, conversion, idempotency, and RVT boundaries. Not for deployment/rebuild, credential diagnosis, production-bucket writes, local-windows, or Kit/WebRTC visual E2E.
---

# Verify MinIO Real-Data E2E

Run a read-only acceptance of the canonical Linux data-plane path:

```text
owner-managed MinIO -> watcher intake -> coordinator ledger -> IFC-to-USDC conversion
```

This skill verifies current behavior. Old reports, snapshots, PR comments, and generated artifacts are not runtime authority.

## 0. Non-negotiable boundaries

- Treat the MinIO bucket and its metadata as production data. Only list and read through approved runtime APIs; never upload, delete, rename, force-retrigger, or otherwise mutate bucket objects.
- Credential values and identities remain owner-private. Do not open or parse `.env*`, presigned credential fields, access-key IDs, secret keys, or authorization headers. The sole inventory exception is the governed `Get-DeployTarget` resolver used by the read-only `deploy-linux-test-environment` preflight: pass it an owner-approved inventory path without reading the file, keep its returned target object in protected memory, and never enumerate, serialize, print, persist, or expose its private values.
- Do not print or commit host/user values, private endpoints, deploy roots, runtime-data roots, bucket object keys, or raw URLs.
- A read-only acceptance never resets, rebuilds, restarts, recreates, or stops a service. If deployment mutation is needed, stop as `HELD`; only a separate explicit deploy/rebuild request may invoke `deploy-linux-test-environment`.
- If `CONVERSION_LEDGER_STORE_PATH` is unknown or not proven durable, the whole acceptance is `HELD`. A snapshot is evidence, not a restore mechanism.
- This repository may be public. Tracked evidence must not contain raw customer/project names, `project_id`, object keys, idempotency/correlation/model-version/job identifiers, exact event timestamps, artifact path components, or values that link two private observations.
- Never use tracked historical production evidence as a fixture. Keep detailed live output only in an owner-approved protected local evidence location outside the repository.

## 1. Read-only target preflight

Load `deploy-linux-test-environment` and follow only its read-only readiness/status path. It owns owner-inventory validation, target identity, SSH connection, private-root checks, and output redaction. Only its reviewed `Get-DeployTarget -Canonical -InventoryPath <owner-approved-path>` call may parse the inventory; this skill must not inspect the inventory before or after that call or substitute another parser.

Through the validated connection:

1. Read `GET /api/external/minio-watch/status` twice with a bounded wait no shorter than one reported poll interval. Require the second `poll_count` to be strictly greater than the first.
2. Run the deployed `scripts/verify-all.ps1 -Profile Deployment` with the validated remote inventory path set only in the child process.
3. Clear the child-process inventory variable immediately after the verifier exits.
4. Record only target role, service role/port, exit status, and redacted boolean outcomes.

Do not construct raw SSH commands by interpolating inventory-derived values. Use the governed connection/helper. If a path cannot be passed as an argument or safely single-quoted after validation, stop as `HELD`.

Status routing:

- `enabled=true`, `last_error=null`, a strictly advancing two-sample `poll_count`, and no relevant `last_triggered[].error`: proceed.
- any relevant per-object intake error or linkage deficit: stop as `HELD`; list-loop liveness alone is not intake health.
- default-disabled opt-in note: stop as `HELD: owner durable opt-in required`.
- incomplete configuration or authorization error: stop as `HELD: owner-private configuration required`.
- connection error: report only the error class; topology diagnosis remains in the owner-private boundary.

## 2. Owner-private durable configuration

When status is disabled or incomplete, tell the owner which key names are required, without asking for values:

```text
MINIO_WATCH_ENABLED
MINIO_WATCH_ENDPOINT
MINIO_WATCH_BUCKET
MINIO_WATCH_ACCESS_KEY
MINIO_WATCH_SECRET_KEY
```

The owner edits `<runtime_data_root>/env.local` in a private terminal. The generated `<deploy-root>/.env.web-plane.host-kit` is never edited or read by this skill.

After an owner change, stop. A separate explicit rebuild request must run the full governed deployment workflow from fresh `origin/main`. This skill resumes only after that workflow finishes and the owner requests a new read-only acceptance.

## 3. Read-only acceptance checks

Collect live responses into protected local temporary evidence. Before computing any aggregate, build the current MinIO scope inside that protected boundary:

1. Read the complete current object listing from `GET /api/minio/objects` using the watcher-reported prefix. Before filtering, retain a separate protected RVT subset from rows whose object key has an exact case-insensitive `.rvt` suffix. Then select the IFC lineage subset only from `role=source_ifc` rows with a nonempty `idempotency_key` and complete non-null derived project/category/version fields; those fields prove the row matched the active watcher's exact prefix/suffix intake shape. Retain object keys and identifiers only in protected memory.
2. Join `GET /api/conversion/records` by those exact idempotency keys. Any duplicate key, missing record, or record outside the current listing must not enter the accepted lineage; a missing or duplicate in-scope join is `HELD`.
3. Derive the in-scope streaming conversion-job set only from the joined ledger records' nonempty `conversion_job_id` values. Query or filter streaming results by that set; never aggregate the unfiltered global conversion collection.
4. Apply this same scoped key/job set to both observations in every same-process or cross-process comparison. The RVT boundary uses only the separate pre-filter RVT subset from step 1. If the complete listing or a required joined surface is truncated or non-exhaustive, the acceptance is `HELD`.

The words `total`, `histogram`, `set`, and `count` below always mean this MinIO-scoped IFC subset, never the complete coordinator ledger or streaming service, except an explicitly named RVT-only count, which uses the protected pre-filter RVT subset. Compute only the following reportable aggregates:

1. Watcher state: enabled boolean, error-present boolean, poll-count advancement boolean, baseline/seen/triggered counts, malformed count.
2. Coordinator ledger: in-scope total count, terminal-state histogram, records-with-job count, and missing-link count.
3. Streaming conversions: in-scope total count, terminal-state histogram, and failed-job count.
4. Cross-surface consistency: record count versus expected watch count, unique job-link count, missing/duplicate linkage counts. Any nonzero missing or duplicate linkage count is `HELD`.
5. Same-process idempotency: protected evidence must bind both observations to the same verified coordinator process creation identity, and poll count must advance while the protected seen-object, triggered-object, and conversion-job identifier sets remain exactly stable. If either creation identity is unavailable or the identities differ, report this check as `unverified`; do not relabel it as same-process evidence. Stable totals without stable set membership are insufficient. Persist only aggregate equality booleans and counts, never the process identity.
6. Cross-process idempotency, only when an already-authorized external operation produced two observations and protected evidence binds each observation to a distinct coordinator process creation identity. Compare stable identifiers in protected memory, then retain only `same_job_set=true|false`, before/after counts, and duplicate/new-job counts. Without verified process-instance change evidence, report this check as `unverified`; do not persist identities, identifiers, or a reusable mapping.
7. Mapping quality: aggregate provenance/fidelity histogram, fake-enabled count, fake-mapping count, mapped total, and unmapped total. Do not commit raw GUIDs, element names, or per-model rows.
8. RVT boundary: derive the RVT-only count from the protected complete-list subset retained before IFC filtering, then report only that count and the count of unexpected ledger entries. Count an unexpected ledger entry only when protected command lineage binds it to an RVT row. Without the complete protected source listing and preserved command lineage, mark the result `unverified`; never infer RVT-to-IFC derivation from co-location.

Require at least one current, fully linked MinIO object -> coordinator ledger record -> terminal successful conversion lineage, and require every fully linked in-scope lineage to be terminal-success. Any in-scope failed, cancelled, queued, running, or otherwise nonterminal ledger/conversion count is `HELD`; a successful lineage cannot mask it. Empty observations are also `HELD`.

Respect API pagination. Do not use unparameterized defaults as proof of exhaustive per-record verification. `GET /api/conversions` currently caps results at 200 without an authoritative total or cursor; if a response reaches that cap and completeness cannot be proven independently, the acceptance is `HELD`. Where filters or per-ID reads can prove completeness inside the protected boundary, retain only aggregates.

## 4. Public-safe evidence contract

Before writing any tracked report:

- Create a fresh report for the current run; never copy prior private snapshots.
- Record commands as redacted templates plus exact exit codes and aggregate outputs.
- Include changed files, checks run, checks not run with reasons, known risks, deployed revision, and main-tip comparison.
- Use aggregate counts or fresh per-report salted pseudonyms only. Never retain the salt or a cross-report lookup table.
- Round or bucket timestamps when timing matters; never retain exact private event timestamps.
- Store artifact references only as aggregate existence/size-class results, never host URLs or stable path components.
- Before tracking, run secret scanning plus a bounded privacy scan directly on the protected candidate report. After staging, run the same checks on the final tracked diff and repository. Any unsafe match or scan failure is `HELD`; never print the matched value. A no-match result is pattern-bounded, not proof against every encoding.
- If safe redaction would make a claim unauditable, keep the detailed evidence outside the repo and mark the tracked claim `unverified`.

Required report sections:

- Verified facts
- Inferences
- Unverified risks
- Next actions
- Executed checks
- Checks not run
- Privacy/redaction result

## 5. Completion rule

This skill may conclude only the MinIO data-plane acceptance that was actually observed. It does not prove deployment correctness, Kit GPU conversion, WebRTC first frame, USD stage truth, DataChannel acknowledgement, viewer operability, design fidelity, or full-system E2E.

Any mutation need, private-input need, unknown or non-durable conversion ledger, missing command lineage, empty lineage, any failed or nonterminal in-scope lineage, intake/linkage failure, non-exhaustive result, privacy-redaction failure, or cross-run linkage retained in tracked files is `HELD`, not a pass.
