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
- If `CONVERSION_LEDGER_STORE_PATH` is unknown or not proven durable, the whole acceptance is `HELD`. A snapshot is evidence, not a restore mechanism. The accepted read-only proof has two parts that must both hold: (1) the governed deployment's redacted effective-env snapshot (produced under `artifacts/deploy-reports/canonical-linux/` by the deploy helper) showing the variable present and pointing under the mounted runtime data root, and (2) the currently running coordinator's own startup `env_snapshot` structured-log line (emitted once per process at bootstrap, redacted to type and length) showing the same variable present with the same value length in this process, from a container whose creation time postdates that deploy report. A deploy-time snapshot alone certifies nothing about a coordinator restarted or re-enveloped since deployment; if either part is missing or the lengths disagree, durability is unproven and the acceptance is `HELD`. Runtime APIs deliberately do not expose store paths. Known gap: issue #531 tracks the canonical compose wiring for this variable (the coordinator otherwise falls back to a container-local path that does not survive recreate, while the callback outbox is already durably wired); expect this `HELD` until #531 lands.
- This repository may be public. Tracked evidence must not contain raw customer/project names, `project_id`, object keys, idempotency/correlation/model-version/job identifiers, exact event timestamps, artifact path components, or values that link two private observations.
- Never use tracked historical production evidence as a fixture. Keep detailed live output only in an owner-approved protected local evidence location outside the repository.

## 1. Read-only target preflight

Load `deploy-linux-test-environment` and follow only its read-only readiness/status path. It owns owner-inventory validation, target identity, SSH connection, private-root checks, and output redaction. Only its reviewed `Get-DeployTarget -Canonical -InventoryPath <owner-approved-path>` call may parse the inventory; this skill must not inspect the inventory before or after that call or substitute another parser.

Through the validated connection:

1. Read `GET /api/external/minio-watch/status` twice with a bounded wait no shorter than one reported poll interval. Require the second `poll_count` to be strictly greater than the first and require the status contract to expose the nonempty effective configured IFC key suffix. If the effective suffix is absent or cannot be proven from this runtime-owned response, the object scope is unknown and the whole acceptance is `HELD`; do not read `.env*` or assume the default suffix.
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

1. Read the current object listing from `GET /api/minio/objects` using the watcher-reported prefix, but treat it as complete only when the runtime response supplies an authoritative raw-versus-returned completeness signal and proves that no key was suppressed. The current browse surface can omit unsupported keys without returning a skipped-key count, so its rows alone are not complete-list proof. If authoritative completeness is absent, both the object scope and RVT boundary are `unverified` and the whole acceptance is `HELD`. Only after completeness is proven, retain a separate protected RVT subset from rows whose object key has an exact case-insensitive `.rvt` suffix and a separate set of every current object that matches the effective configured IFC key suffix. Any such IFC candidate with a non-`source_ifc` role, an empty `idempotency_key`, or incomplete derived project/category/version fields is malformed and makes the acceptance `HELD`; do not silently filter it away. A nonzero watcher `skipped_malformed_total` requires reconciliation against the current complete listing: it is not current-scope proof by itself, but if protected evidence cannot prove the count is historical-only, the acceptance is `HELD`. Select the accepted IFC lineage subset only after those checks. Retain object keys and identifiers only in protected memory.
2. Join `GET /api/conversion/records?limit=100` by those exact idempotency keys. This endpoint returns only the first 20 records unless `limit` is raised, its hard cap is 100, it has no offset/cursor, and its `count` field is always the full ledger total: require `count` to equal the returned item count, otherwise record completeness cannot be proven through this API and the acceptance is `HELD`. Any duplicate key, missing record, or record outside the current listing must not enter the accepted lineage; a missing or duplicate in-scope join is `HELD`. For every unique join, require the object `idempotency_key`, `project_id`, `category`, and `version` to equal the ledger `idempotency_key`, `project_id`, `category`, and `external_model_version_id`; any mismatch is `HELD`.
3. Derive the in-scope streaming conversion-job set only from the joined ledger records' nonempty `conversion_job_id` values. Query each job or filter streaming results by that set; never aggregate the unfiltered global conversion collection. Additionally, for every joined lineage, query streaming filtered by that lineage's `model_version_id` and require the returned job set to be exactly the ledger-linked job for that lineage: any additional streaming job for the same model version is an invisible duplicate that the ledger's single `conversion_job_id` cannot reveal, and it makes the acceptance `HELD`. Require every identity field exposed by both surfaces to agree, including ledger `conversion_job_id`, `correlation_id`, `project_id`, and `external_model_version_id` versus streaming `conversion_job_id`, `correlation_id`, `project_id`, and `model_version_id`. Before comparing normalized dispatch fields, apply the exact `sanitizeArtifactIdPart` contract from `bim-review-coordinator/src/services/streamingConversionClient.ts` to the ledger-side correlation, project, and external-model-version values; do not invent a lossy approximation. Any missing required field or mismatch is `HELD`. An idempotency-key match alone does not prove these bindings.
4. Apply this same scoped key/job set to both observations in every same-process or cross-process comparison, and rebuild the complete object listing (keys and etags) at each observation: if the two listings differ in any key or etag, the object snapshot has drifted, every idempotency comparison over that interval is `unverified`, and a fresh pair of observations is required — a stable `same_job_set` over a drifted snapshot proves nothing. The RVT boundary uses only the separate pre-filter RVT subset from step 1. If the complete listing or a required joined surface is truncated or non-exhaustive, the acceptance is `HELD`.

The words `total`, `histogram`, `set`, and `count` below always mean values recomputed from the current protected MinIO-scoped object and lineage sets, never the complete coordinator ledger, streaming service, or a watcher lifetime counter, except an explicitly named RVT-only count, which uses the protected pre-filter RVT subset. Compute only the following reportable aggregates:

1. Watcher state: enabled boolean, error-present boolean, and poll-count advancement boolean. Report `baseline_count`, `seen_count`, `triggered_total`, and `skipped_malformed_total` only as process-lifetime diagnostics; never relabel them as current-scope totals or use them to derive the current expected object count. A nonzero malformed lifetime count is `HELD` only when it binds to a current malformed object or cannot be proven historical-only from protected evidence.
2. Coordinator ledger: in-scope total count, terminal-state histogram, records-with-job count, and missing-link count.
3. Streaming conversions: in-scope total count, terminal-state histogram, and failed-job count.
4. Cross-surface consistency: current protected valid-IFC count versus ledger record count, unique job-link count, missing/duplicate linkage counts, and metadata-binding equality. Any nonzero missing or duplicate linkage count or any metadata-binding mismatch is `HELD`.
5. Same-process idempotency: protected evidence must bind both observations to the same verified coordinator process creation identity, and poll count must advance while the protected seen-object, triggered-object, and conversion-job identifier sets remain exactly stable. If either creation identity is unavailable or the identities differ, report this check as `unverified`; do not relabel it as same-process evidence. For every comparison that is actually verified, require `same_job_set=true` and zero duplicate/new jobs; a false equality or nonzero change count is `HELD`. Stable totals without stable set membership are insufficient. Persist only aggregate equality booleans and counts, never the process identity.
6. Cross-process idempotency, only when an already-authorized external operation produced two observations and protected evidence binds each observation to a distinct coordinator process creation identity. Compare stable identifiers in protected memory, then retain only `same_job_set=true|false`, before/after counts, and duplicate/new-job counts. For every comparison that is actually verified, require `same_job_set=true` and zero duplicate/new jobs; otherwise the acceptance is `HELD`. Without verified process-instance change evidence, report this check as `unverified`; do not persist identities, identifiers, or a reusable mapping.
7. Mapping quality: aggregate provenance/fidelity histogram, fake-enabled count, fake-mapping count, mapped total, and unmapped total. For every in-scope lineage, require `mapping_provenance=converter_verified`, `mock=false`, `allow_fake_mapping=false`, and `fake_mapping_count=0`; any missing quality field, `fake_smoke_test` provenance, true fake flag, or nonzero fake count makes the whole acceptance `HELD`, even when the conversion is terminal-success. Do not commit raw GUIDs, element names, or per-model rows.
8. RVT boundary: derive the RVT-only count from the protected complete-list subset retained before IFC filtering, then report only that count and the count of unexpected ledger entries. Count an unexpected ledger entry only when protected command lineage binds it to an RVT row. Any proven unexpected RVT ledger count above zero is `HELD`. Without the complete protected source listing and preserved command lineage, mark the result `unverified`; never infer RVT-to-IFC derivation from co-location.

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

Any mutation need, private-input need, unknown effective IFC key suffix, unknown or non-durable conversion ledger, missing command lineage, empty lineage, malformed IFC observation, fake or unverified mapping quality, any failed or nonterminal in-scope lineage, intake/linkage/metadata-binding failure, failed verified idempotency comparison, proven unexpected RVT ledger entry, non-exhaustive object or conversion result, privacy-redaction failure, or cross-run linkage retained in tracked files is `HELD`, not a pass.
