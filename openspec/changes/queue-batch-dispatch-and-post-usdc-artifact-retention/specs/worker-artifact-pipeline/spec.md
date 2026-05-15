## ADDED Requirements

### Requirement: Worker drives canonical storage batch verification via a resumable queue manifest

`_worker` SHALL drive canonical `storage/*.ifc` batch verification through a persisted queue manifest (`batch_queue.json`) that is simultaneously the work queue and the artifact index. The manifest MUST contain one row per canonical fixture keyed by the existing `dev_sources` `source_id` (a stable sha256 identity), recording at minimum: `status` ∈ {`pending`, `running`, `passed`, `passed_with_quality_warning`, `failed`, `timed_out`}, the `conversion_job_id` when a conversion was started, the retained derived-artifact paths, a retention class, and the per-fixture coverage summary fields required to recompute the batch summary.

`_worker` MUST dispatch fixtures one at a time. A single dispatch step (`--run-next`) MUST select exactly one eligible row, mark it `running`, run the existing single-fixture conversion-with-timeout path, and write back exactly one terminal outcome for that row. `_worker` MUST NOT, within one dispatch process, loop over the whole queue (no long-lived drain); short process lifetime is required to bound the Windows `.tmp`-rename file-lock exposure observed in the predecessor.

A row with no recorded terminal outcome — `pending`, or `running` left by a crashed dispatch — MUST be eligible for re-dispatch so a crashed batch resumes without losing already-completed fixtures. A row with a recorded terminal outcome (`passed`, `passed_with_quality_warning`, `failed`, `timed_out`) MUST NOT be re-dispatched automatically. Re-running a recorded failure MUST require an explicit, single-`source_id` `--retry` that resets only that row to `pending` and appends a retry entry to the row history; `--retry` MUST refuse rows that are not in a recorded-failure state.

The manifest read/write MUST be atomic (temp + replace). The manifest path MUST default to a location outside the git worktree and MUST be configurable via settings/environment. The one-shot `--limit` / `--timeout-seconds` / `--profile-source-entities` CLI MUST keep working unchanged; the queue subcommands are additive.

#### Scenario: Enqueue builds an idempotent manifest

- **WHEN** `--enqueue` runs against the canonical storage root
- **THEN** `batch_queue.json` is created (or refreshed) with one `pending` row per fixture keyed by `source_id`
- **AND** any row that already has a recorded terminal outcome is preserved unchanged (enqueue is idempotent and never overwrites a recorded outcome)

#### Scenario: Single dispatch records exactly one outcome

- **WHEN** `--run-next` is invoked and at least one row is eligible
- **THEN** exactly one row is selected, marked `running`, converted via the existing single-fixture timeout path, and written back with exactly one terminal outcome plus its `conversion_job_id` and coverage summary
- **AND** the dispatch process exits after that single fixture (it does not drain the queue)

#### Scenario: Crash mid-flight resumes without re-running completed fixtures

- **WHEN** a dispatch process crashes leaving a row in `running`, and `--run-next` is invoked again
- **THEN** the un-outcomed (`running`/`pending`) row is reclaimed and dispatched
- **AND** rows already recorded as `passed` / `passed_with_quality_warning` / `failed` / `timed_out` are NOT re-dispatched

#### Scenario: Recorded failure is re-run only by explicit retry

- **WHEN** `--retry <source_id>` targets a row whose recorded outcome is `failed` or `timed_out`
- **THEN** only that row is reset to `pending` and a retry entry (actor, timestamp, previous outcome) is appended to the row history
- **AND** `--retry` against a `passed` / `passed_with_quality_warning` row is refused with a diagnostic

### Requirement: Worker applies post-coverage artifact retention to canonical-verification scratch only

After per-fixture coverage is computed and the manifest row is written, `_worker` MAY drop the large per-entity arrays (`ifc_index.json`, `element_mapping.json`, `entity_index.json`) for the canonical-verification scratch tenant (`tenant_batch_verification`). `_worker` MUST retain `model.usdc`, `usd_index.json`, `metadata.json`, the coverage summary, and the small `unmapped_*` lists, and MUST record the retained paths and a retention class in the manifest row.

This retention MUST be scoped strictly to the `tenant_batch_verification` scratch tenant. `_worker` MUST NOT apply this retention to any real review-artifact path; the existing derived-artifact publishing contract for real conversions is unaffected. The canonical-verification scratch root MUST default outside the git worktree, be configurable, and have an explicit, idempotent cleanup path (the scratch is throwaway evidence, not durable review data).

`_worker` MUST surface manifest-vs-disk drift (a row claims a retained path that is missing) as a diagnostic in `--status` / `--summary`; it MUST NOT silently treat a drifted row as passing.

#### Scenario: Giant arrays are pruned for scratch tenant after coverage

- **WHEN** a canonical-verification fixture under `tenant_batch_verification` completes and its coverage summary is written to the manifest row
- **THEN** `ifc_index.json`, `element_mapping.json`, and `entity_index.json` for that fixture MAY be deleted
- **AND** `model.usdc`, `usd_index.json`, `metadata.json`, the coverage summary, and `unmapped_*` lists are retained and their paths recorded in the manifest row

#### Scenario: Retention never touches a non-scratch tenant

- **WHEN** retention runs
- **THEN** only paths under the `tenant_batch_verification` scratch tenant are eligible for pruning
- **AND** any real review-artifact path (non-`tenant_batch_verification`) is left fully intact, preserving the existing derived-artifact publishing contract

#### Scenario: Missing retained path is surfaced, not hidden

- **WHEN** a manifest row records a retained path that no longer exists on disk
- **THEN** `--status` / `--summary` report the drift as an explicit diagnostic
- **AND** the drifted fixture is not silently counted as a clean pass
