## Context

This change inherits the settled "Successor handoff" decisions recorded in the archived predecessor `openspec/changes/archive/2026-05-15-optimize-worker-canonical-batch-and-secondary-enumeration/design.md`. The predecessor proved the canonical 13-file batch can reach `minimum_coverage_locked=true` (v3: all 13 `coverage_status=pass`, `unmapped_count=0`) but ran monolithically and left ≈58 GB of scratch. Route α was chosen: the predecessor closed out clean; queue orchestration + post-USDC retention land here.

The existing single-fixture machinery is reused as-is: `_run_single_fixture_with_timeout` already spawns an isolated subprocess per fixture with a timeout and phase-progress writes. The only missing pieces are (a) a persisted manifest so dispatch can span invocations and survive a crash, and (b) a retention step so the scratch footprint stays bounded. `dev_sources._source_id` already provides a stable per-fixture sha256 identity — the natural manifest key.

Ownership stays `_worker`: file bytes, conversion jobs, batch summary, verification evidence. `bim-review-coordinator` / `web-viewer-sample` / `bim-streaming-server` are unaffected — the predecessor's Carrier-shift Handoff Framework already established they consume only `model.usdc` + renderable-prim mapping (~7k rows), never the 1.5M-row sidecar/index arrays.

## Goals / Non-Goals

**Goals:**

- Convert the canonical batch from one ~65-min all-or-nothing process into a persisted, resumable queue that dispatches one fixture per short-lived `--run-next` invocation.
- Make "one recorded outcome per fixture" a durable guarantee (manifest), preserving the predecessor's single-pass / no-auto-retry invariant (Decision 7 spirit).
- Bound canonical-verification scratch to ≈130 MB-class via post-coverage retention strategy A.
- Default manifest + scratch root outside the git worktree, configurable; define scratch cleanup.
- Keep `outcome_distribution` / `minimum_coverage_locked` bit-identical to the predecessor when a batch is run to completion; only the data source moves from in-memory list to persisted manifest.

**Non-Goals:**

- No production batch-job scheduler / daemon / cron. This stays a local canonical verification helper.
- No converter change. Stream-computing coverage so the 1.6M-row arrays are never written at all (proposal Q6) is explicitly **out of scope** — it touches `IfcOpenShellUsdConverter.convert` with a much larger blast radius. This change only drops the arrays *after* they are written and coverage is computed.
- No change to `outcome_distribution` bucket definitions or the `minimum_coverage_locked` gate logic — inherited verbatim from the predecessor.
- No auto-retry of a recorded `failed` / `timed_out` fixture. Resume re-dispatches only rows with no recorded outcome; re-running a recorded failure is an explicit `--retry <source_id>`.
- No change to `_bim-control` authority, coordinator session lifecycle, web viewer, Kit runtime, WebRTC, GPU, auth.
- No reshaping of `entity_index.json` / `element_mapping.json` / `ifc_index.json` schemas — they are dropped under retention, not modified.
- No retention applied to the real review-artifact path. Retention is scoped to the canonical-verification scratch tenant (`tenant_batch_verification`); real conversions keep publishing the full derived artifact set.

## Options Considered

### A. Queue driver model

| # | Approach | Crash blast radius | Windows lock exposure | Notes |
|---|---|---|---|---|
| A1 | Persisted manifest + repeated short-lived `--run-next` (one fixture per process) | Only the in-flight fixture | Minimal — short process lifetime | **Chosen.** Short process lifetime is what root-mitigates the `.tmp`-rename lock; trivially resumable. |
| A2 | Persisted manifest + long-lived `--drain` loop (all fixtures, one process, isolated subprocesses) | Only in-flight fixture (state persisted) | High — long-lived parent process still under git/AV watch | Rejected. Re-introduces the long-lived-process lock risk the predecessor hit. |
| A3 | No manifest; keep monolithic `--limit 13` | Whole batch | High | Rejected. This is exactly the predecessor pain being removed. |

### B. Post-USDC retention

| # | Approach | Footprint (13 fixtures) | Downstream safety | Notes |
|---|---|---|---|---|
| B-A | Drop `ifc_index.json` / `element_mapping.json` / `entity_index.json` after coverage computed; keep `model.usdc` + `usd_index.json` + `metadata.json` + summary + `unmapped_*` | ≈130 MB-class | Safe — Handoff Framework: downstream never reads the dropped arrays | **Chosen** (user-confirmed "A"). |
| B-B | gzip the giant arrays in place | ≈ several GB | Safe | Rejected. Still GB-scale; compression CPU per fixture; no real consumer of the arrays. |
| B-C | Keep everything (status quo) | ≈58 GB | Safe | Rejected. The problem being solved. |

### C. Manifest + scratch location

| # | Approach | Windows lock | Worktree pollution | Notes |
|---|---|---|---|---|
| C1 | Default outside git worktree, configurable via settings/env | Root-fixed | None | **Chosen.** Also fixes the predecessor's 36 GB-in-worktree problem. |
| C2 | Inside `_worker/data` (status quo) | Recurring `.tmp` lock | Tens of GB in worktree | Rejected. Root cause of v2's `PermissionError`. |

## Selected Options

- **A1** — persisted manifest + repeated short-lived `--run-next`.
- **B-A** — retention strategy A (drop giant arrays post-coverage, scoped to scratch tenant).
- **C1** — manifest + scratch root default outside the git worktree, configurable.

## Decisions

1. **Manifest-as-index.** A single `batch_queue.json` is simultaneously the work queue and the artifact index: one row per canonical `source_id` carrying `status`, `conversion_job_id`, retained artifact paths, retention class, and the per-fixture coverage summary fields needed by `--summary`. `outcome_distribution` / `minimum_coverage_locked` are recomputed from these rows with the predecessor's exact bucket + gate logic.

2. **Resume = re-dispatch only un-outcomed rows.** A row with no recorded terminal outcome (still `pending`, or `running` from a crashed process) is eligible for `--run-next`. A row with a recorded `passed` / `passed_with_quality_warning` / `failed` / `timed_out` is final for that batch and is NOT re-dispatched automatically. `--retry <source_id>` explicitly resets one recorded-failure row to `pending` (deliberate, logged), the durable-state equivalent of the predecessor's "run `--limit 1` in a separate session."

3. **Retention strategy A, scoped to the scratch tenant.** After per-fixture coverage is computed and the manifest row is written, the large arrays (`ifc_index.json`, `element_mapping.json`, `entity_index.json`) under the canonical-verification scratch tenant are deleted; `model.usdc`, `usd_index.json`, `metadata.json`, the coverage summary, and the small `unmapped_*` lists are retained, with retained paths recorded in the row. The real review-artifact path (non-`tenant_batch_verification`) is untouched — the existing "Worker publishes derived artifact results" contract still holds there.

4. **Location outside the worktree, configurable.** Manifest path + canonical-verification scratch root default to a location outside the git worktree (settings/env configurable). This root-fixes the Windows `.tmp`-rename lock and removes worktree pollution. Scratch cleanup is explicit and idempotent (`tenant_batch_verification` is throwaway).

5. **Semantics frozen from predecessor.** Bucket definitions (`passed` / `passed_with_quality_warning` / `timed_out` / `failed` / `blocked`) and the lock gate (`not partial AND passed.count == selected AND every fixture baseline_locked`) are reused verbatim. A property test asserts: a queue run to completion yields the same `outcome_distribution` + `minimum_coverage_locked` as the monolithic predecessor path on the same inputs.

6. **One-shot CLI preserved.** `--limit` / `--timeout-seconds` / `--profile-source-entities` keep working unchanged for CI / single-shot. Queue subcommands (`--enqueue` / `--run-next` / `--summary` / `--status` / `--retry`) are additive.

## Carrier-shift Handoff Framework

- **Status:** Carrier=sidecar; framework N/A. No carrier transition; this change does not touch the converter or the renderable-prim shape. The predecessor's framework answers remain authoritative and are the basis for retention-A safety (downstream never reads the dropped arrays).

## Dependencies

- No new production dependency. Reuses `_run_single_fixture_with_timeout`, `dev_sources._source_id`, existing settings.
- No new OpenSpec capability; additive requirements on `worker-artifact-pipeline` and `runtime-verification-evidence`.

## Risks / Trade-offs

- **Risk: manifest and on-disk artifacts drift** (a row says retained-path X but the file was pruned/missing). → Mitigation: retention writes the row only after a successful prune; `--status` / `--summary` validate retained paths exist and surface drift as a diagnostic, never silently pass.
- **Risk: a crashed `--run-next` leaves a row `running` forever.** → Mitigation: `running` is treated as eligible for re-dispatch (crash mid-flight = no recorded terminal outcome); a stale-`running` row is reclaimed by the next `--run-next`, recorded once.
- **Risk: retention deletes an array still needed by some consumer.** → Mitigation: retention is scoped to `tenant_batch_verification` scratch only; Handoff Framework proves downstream consumes only `model.usdc` + renderable mapping. A test asserts retention never touches a non-scratch tenant path.
- **Risk: `--retry` abused to mask a real failure as pass.** → Mitigation: `--retry` is explicit, single-`source_id`, logged in the manifest row history; `--summary` reflects the latest recorded outcome and never hides that a retry occurred.
- **Risk: semantics drift from predecessor.** → Mitigation: the bucket + gate code is reused (not reimplemented); a regression test pins queue-derived distribution == monolithic-derived distribution on identical inputs.
- **Risk: scope creep into a production scheduler.** → Mitigation: explicit Non-Goal; no daemon/cron; `--run-next` is a manual/CI-driven single step.

## Verification ordering

`openspec validate --strict` → focused `_worker` tests (queue manifest model, resume, retention scoping, semantics-parity) → dry-run `--enqueue` / `--status` on a tmp fixture set → real canonical evidence via repeated `--run-next` to completion, asserting parity with the predecessor's v3 `outcome_distribution` + `minimum_coverage_locked`.

## Open Questions (Round 2 — resolved)

- [x] Q7: Does retention break the existing "Worker publishes derived artifact results" / "Worker derives indices and mapping" requirements? — **A:** No. Those requirements govern the real review-artifact path; retention is scoped to the `tenant_batch_verification` scratch tenant only. Spec deltas are ADDED requirements that explicitly carve the scratch scope, not MODIFIED contradictions.
- [x] Q8: How is `--summary` kept identical to the predecessor? — **A:** Reuse the existing `_compute_outcome_distribution` + lock-gate functions unchanged; `--summary` only changes the *input source* (manifest rows vs in-memory list). A parity test pins equality.
- [x] Q9: What about the orphaned locked predecessor worktree dir? — **A:** Unrelated to this change; it is git-deregistered scratch the user clears manually. Not in scope.
