## Why

The predecessor `optimize-worker-canonical-batch-and-secondary-enumeration` proved the coverage goal (canonical 13-file batch `minimum_coverage_locked=true`) but exposed two operational problems it explicitly deferred (route α; settled decisions recorded in its archived `design.md` "Successor handoff"):

1. **Monolithic all-or-nothing batch.** `verify_storage_batch.py --limit 13` runs all fixtures inside one long-lived (~65 min) process. v2 lost progress when fixture 4 hit a Windows `PermissionError [WinError 5]` on `<jobs_dir>/conv_*.phase.json.tmp` rename (high-frequency progress writes inside a long-lived process under git/AV watch); the whole run's exit code went non-zero and the 3 already-passed fixtures were discarded. There is no resume — a late failure forces a full restart.
2. **No post-USDC artifact retention.** Each fixture emits ≈1.58 GB of derived artifacts (`element_mapping.json` 663 MB + `ifc_index.json` 578 MB + `entity_index.json` 330 MB) next to a 9.4 MB `model.usdc` — the only runtime artifact downstream actually loads. One canonical session accumulated ≈58 GB across v1/v2/v3, much of it inside the git worktree.

This change converts the canonical batch from a single monolithic process into a **persisted, resumable queue that dispatches one fixture at a time**, and adds a **post-USDC artifact retention policy** so canonical-verification scratch stays ≈130 MB-class instead of ≈58 GB. The `outcome_distribution` / `minimum_coverage_locked` semantics from the predecessor are inherited unchanged — only the orchestration and the on-disk footprint change.

## What Changes

- Add a persisted **`batch_queue.json` manifest** that is simultaneously the work queue *and* the artifact index: one row per canonical `source_id` (the existing `dev_sources` sha256 identity) carrying `status` (`pending` / `running` / `passed` / `passed_with_quality_warning` / `failed` / `timed_out`), `conversion_job_id`, recorded retained artifact paths, and a retention class.
- Add queue subcommands to `verify_storage_batch.py`: `--enqueue` (build/refresh the manifest from `list_dev_ifc_sources`), `--run-next` (dispatch the next `pending` fixture via the existing single-fixture path, record its outcome once), `--summary` (compute `outcome_distribution` + `minimum_coverage_locked` from the manifest), `--status` (human-readable progress), `--retry <source_id>` (explicit, deliberate re-run of one recorded failure). The existing one-shot `--limit` / `--timeout-seconds` / `--profile-source-entities` CLI is preserved unchanged for CI / single-shot use.
- Add **post-USDC retention strategy A**: once per-fixture coverage is computed, the giant 1.6M-row JSON arrays (`ifc_index.json`, `element_mapping.json`, `entity_index.json`) for the canonical-verification scratch tenant are dropped; only `model.usdc`, `metadata.json`, `usd_index.json`, the coverage **summary**, and the small `unmapped_*` lists are retained, with the retained paths recorded in the manifest row.
- Default the queue manifest **and** canonical-verification artifact root **outside the git worktree** (configurable), root-fixing both the Windows `.tmp`-rename file lock and the "tens of GB inside the worktree" problem. Add explicit cleanup of canonical-verification scratch (the `tenant_batch_verification` outputs are throwaway evidence, not durable review data).
- `outcome_distribution` and `minimum_coverage_locked` are computed from the persisted manifest rows instead of an in-memory list; their bucket definitions and lock gate are byte-for-byte the predecessor's. Resuming a crashed run only re-dispatches rows that never received a recorded outcome.

## Capabilities

### New Capabilities

- None. (Queue orchestration + retention are additive behaviors on the existing `worker-artifact-pipeline` / `runtime-verification-evidence` capabilities.)

### Modified Capabilities

- `worker-artifact-pipeline`:
  - ADD a requirement that the canonical storage batch verification is driven by a persisted resumable queue manifest (`batch_queue.json`) keyed by `source_id`, recording one outcome per fixture, resumable after a crash without re-running fixtures that already have a recorded outcome.
  - ADD a requirement that canonical-verification derived artifacts apply a post-coverage retention policy: the large per-entity index/mapping arrays MAY be dropped after coverage is computed, while `model.usdc`, `usd_index.json`, `metadata.json`, the coverage summary and `unmapped_*` lists MUST be retained; the **real review-artifact path is unaffected** (retention is scoped to the `tenant_batch_verification` scratch tenant).
- `runtime-verification-evidence`:
  - ADD a requirement that full canonical batch evidence MAY be produced incrementally via the queue (one fixture per `--run-next`), that `outcome_distribution` / `minimum_coverage_locked` are derived from the persisted manifest with semantics identical to the predecessor, and that a resumed run MUST NOT auto-retry a fixture that already has a recorded `failed` / `timed_out` outcome (explicit `--retry` only).

## Impact

- Owner: `_worker`.
- Likely code paths: `_worker/app/batch_verification.py` (queue manifest model, `--run-next` dispatch reusing `_run_single_fixture_with_timeout`, summary from manifest), `_worker/scripts/verify_storage_batch.py` (new subcommands; one-shot CLI preserved), `_worker/app/store.py` or a small retention helper (drop giant arrays post-coverage for the scratch tenant, record retained paths), `_worker/app/settings.py` (configurable manifest + scratch root, default outside worktree), focused `_worker/tests/*`.
- Data structures: new `batch_queue.json` (additive, standalone file — not part of any existing artifact schema); per-fixture row records retained artifact paths + retention class. No change to `entity_index.json` / `element_mapping.json` schema (they are dropped, not reshaped). `outcome_distribution` / `minimum_coverage_locked` shapes unchanged.
- Dependencies: no new production dependency. Reuses the existing single-fixture conversion + timeout + phase-progress machinery.
- Runtime boundary: visual preview / coordinator / viewer / Kit unchanged. Downstream Handoff Framework (from predecessor) already confirms coordinator/viewer/streaming consume only `model.usdc` + renderable-prim mapping (~7k rows), never the 1.5M-row sidecar arrays, so dropping the full arrays post-coverage for the scratch tenant is semantically safe.
- Non-Goals: see `design.md`.

## Open Questions (Round 1 — resolved)

- [x] Q1: Fold into predecessor or new change? — **A:** New successor change (route α; predecessor proven done, archived; folding would contaminate a finished deliverable and contradict its own Non-Goal).
- [x] Q2: Retention strategy A / B / C? — **A:** A (drop giant arrays post-coverage, keep summary + small lists). Confirmed by user; downstream Handoff Framework proves it safe.
- [x] Q3: Queue driver model? — **A:** repeated short-lived `--run-next` (root-mitigates the Windows lock); long-lived `--drain` rejected.
- [x] Q4: Failure semantics vs predecessor Decision 7 (single-pass, no auto-retry)? — **A:** Preserved. Resume only re-dispatches rows with **no** recorded outcome (crash mid-flight); a recorded `failed`/`timed_out` is re-run only via explicit `--retry`. The queue makes "one recorded outcome per fixture" a durable guarantee rather than an in-memory convention.
- [x] Q5: Manifest + artifact location? — **A:** Default outside the git worktree, configurable; canonical-verification scratch (`tenant_batch_verification`) is explicitly throwaway with defined cleanup.
- [x] Q6: stop persisting the full 1.6M-row arrays at all and stream-compute coverage inside the converter? — **A:** Resolved as **out of scope** for this change (decision, not a pending question). It touches the converter (`IfcOpenShellUsdConverter.convert`) with a much larger blast radius; this change only drops the arrays *after* they are written and coverage is computed. Recorded as an explicit Non-Goal in `design.md` and named as a potential further follow-up.
