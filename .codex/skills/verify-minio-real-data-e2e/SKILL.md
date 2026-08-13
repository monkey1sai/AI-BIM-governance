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
- Credential values and identities remain owner-private. Do not open or parse `.env*`, presigned credential fields, access-key IDs, secret keys, authorization headers, or private inventory values.
- Do not print or commit host/user values, private endpoints, deploy roots, runtime-data roots, bucket object keys, or raw URLs.
- A read-only acceptance never resets, rebuilds, restarts, recreates, or stops a service. If deployment mutation is needed, stop as `HELD`; only a separate explicit deploy/rebuild request may invoke `deploy-linux-test-environment`.
- If `CONVERSION_LEDGER_STORE_PATH` is unknown or not proven durable, the whole acceptance is `HELD`. A snapshot is evidence, not a restore mechanism.
- This repository may be public. Tracked evidence must not contain raw customer/project names, `project_id`, object keys, idempotency/correlation/model-version/job identifiers, exact event timestamps, artifact path components, or values that link two private observations.
- Never use tracked historical production evidence as a fixture. Keep detailed live output only in an owner-approved protected local evidence location outside the repository.

## 1. Read-only target preflight

Load `deploy-linux-test-environment` and follow only its read-only readiness/status path. It owns owner-inventory validation, target identity, SSH connection, private-root checks, and output redaction.

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

Collect live responses into protected local temporary evidence, then compute only the following reportable aggregates:

1. Watcher state: enabled boolean, error-present boolean, poll-count advancement boolean, baseline/seen/triggered counts, malformed count.
2. Coordinator ledger: total count, terminal-state histogram, records-with-job count, and missing-link count.
3. Streaming conversions: total count, terminal-state histogram, and failed-job count.
4. Cross-surface consistency: record count versus expected watch count, unique job-link count, missing/duplicate linkage counts. Any nonzero missing or duplicate linkage count is `HELD`.
5. Same-process idempotency: poll count advances while the protected seen-object, triggered-object, and conversion-job identifier sets remain exactly stable. Stable totals without stable set membership are insufficient. Persist only aggregate equality booleans and counts.
6. Cross-process idempotency, only when an already-authorized external operation produced two observations and protected evidence binds each observation to a distinct coordinator process creation identity. Compare stable identifiers in protected memory, then retain only `same_job_set=true|false`, before/after counts, and duplicate/new-job counts. Without verified process-instance change evidence, report this check as `unverified`; do not persist identities, identifiers, or a reusable mapping.
7. Mapping quality: aggregate provenance/fidelity histogram, fake-enabled count, fake-mapping count, mapped total, and unmapped total. Do not commit raw GUIDs, element names, or per-model rows.
8. RVT boundary: report only counts of RVT-only observations and unexpected ledger entries. Without a protected source listing and preserved command lineage, mark the result `unverified`; never infer RVT-to-IFC derivation from co-location.

Require at least one current, fully linked MinIO object -> coordinator ledger record -> terminal successful conversion lineage. Empty or nonterminal-only observations are `HELD`.

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

Any mutation need, private-input need, unknown or non-durable conversion ledger, missing command lineage, empty or nonterminal-only lineage, intake/linkage failure, non-exhaustive result, privacy-redaction failure, or cross-run linkage retained in tracked files is `HELD`, not a pass.
