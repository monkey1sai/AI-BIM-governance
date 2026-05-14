## Context

`optimize-worker-non-renderable-materialization` selected **Option 4 (sidecar carrier) + Option 3 (chunked progress writes)** and shipped:

- Canonical single-fixture `--limit 1 --timeout-seconds 600` passed at `conversion_total=267.72s` for the 89 MB fixture `許良宇圖書館建築_2026 - 複製 (10).ifc`.
- `non_renderable_entity_materialization=5.05s` (down from `>375.09s` timeout; 74× faster).
- `materialized_entity_count=1,597,773`, `materialization_strategy=sidecar`, `mapped_count=1,604,771`, `unmapped_count=2`, `coverage_ratio=0.9999987537178155`.
- Canonical IDs: `conversion_job_id=conv_20260513105315_57b2c0fa`, `artifact_group_id=ag_bc5f30cda296`, `source_artifact_id=artifact_src_e63ba1705fe1`, `usdc_artifact_id=artifact_usdc_20260513105315_57b2c0fa`, `mapping_artifact_id=artifact_mapping_20260513105315_57b2c0fa`, `entity_index` artifact `artifact_entity_index_20260513105315_57b2c0fa`.

What is **not** yet evidence:

- Behavior of the remaining 12 fixtures in `storage/*.ifc` under the sidecar carrier path. We do not know how often per-fixture `stage_reopen` succeeds, how often `mapping_quality_failed` fires (warn / fail coverage status), or whether any fixture hits the 600 s per-fixture timeout.
- Why `unmapped_count=2` on the 89 MB fixture. The roadmap notes these are geometry-shape entities that lack `ifc_guid`. The current carrier rule requires every source IFC entity to resolve to *at least one* carrier (USD prim path or sidecar mapping entry); for `coverage_status=pass`, these two must land somewhere.
- Whether the secondary `guid_extraction` + `name_extraction` ~20.6 s window in `source_entity_enumeration` is worth optimizing. The baseline-annotated effect in the predecessor's design table marked it as ≤10 s saving against a 365 s primary bottleneck and explicitly **deferred** it.

This change is scoped at the **batch level** plus a small carrier-rule clarification, not at single-fixture micro-optimization. The implementation reuses what's already in `_worker`; new behaviors are surgical additions to existing requirements.

The affected ownership boundary remains `_worker`: file bytes, object URLs, conversion jobs, converter diagnostics, mapping output, sidecar artifact, artifact groups, batch summary, and verification evidence. `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` remain downstream consumers that only see `_worker`'s artifact group after conversion succeeds. The Carrier-shift Handoff Framework introduced by the predecessor is **N/A for this change** because no carrier is being shifted; the sidecar carrier shape is inherited as-is.

## Goals / Non-Goals

**Goals:**

- Produce reproducible full 13-file canonical batch evidence under the sidecar carrier path: per-fixture outcome (`passed` / `timed_out` / `failed` / `mapping_quality_failed`), phase timings, stable artifact IDs when applicable, plus an aggregate `outcome_distribution` (counts and rates) at the batch summary layer.
- Resolve `unmapped_count=2` for the 89 MB fixture by making the sidecar carrier explicitly cover **all** source IFC entities that lack `ifc_guid`, including geometry-shape entries. Coverage denominator stays at `source_ifc_entity_count`; the carrier rule is the only thing that broadens.
- Measure secondary `guid_extraction` / `name_extraction` cost on every canonical burn-down run. Optionally optimize when the measurement shows a win ≥ 5 s without GUID / Name fidelity regression; otherwise emit a written deferral.
- Keep the door open for `minimum_coverage_locked=true` to fire if and only if every fixture in the full canonical batch passes; do not pre-lock.
- Update `worker-artifact-pipeline` and `runtime-verification-evidence` spec text in a backward-compatible way; existing scenarios remain truthful.

**Non-Goals:**

- No changes to `_bim-control` metadata authority, coordinator session lifecycle, web viewer rendering, Kit runtime, WebRTC, GPU provisioning, auth, or production deployment.
- No carrier shift. The sidecar carrier is inherited; this change does **not** revisit USD-prim vs sidecar selection.
- No new dependencies. Reuse `IfcOpenShell`, `usd-core`, and the existing `verify_storage_batch.py` CLI.
- No weakening of the all-IFC-entity coverage denominator. No `IfcProduct`-only, GUID-only, or renderable-only fast path.
- No changes to `web-viewer-sample` highlight / focus contracts or DataChannel command surface.
- No retry-on-failure logic in batch verification. A fixture either passes, times out, fails, or hits `mapping_quality_failed` exactly once per batch run; the evidence records the outcome.
- No production batch-job scheduler; this remains a local canonical verification helper path.

## Options Considered

The decision lattice is narrow because the predecessor already chose the carrier and the CLI. The remaining design choices are how to broaden the sidecar carrier rule, how to record outcome distribution, and whether to act on secondary enumeration optimization.

### A. `unmapped_count=2` resolution

| # | Approach | Coverage impact | Downstream impact | Notes |
|---|---|---|---|---|
| A1 | Extend the sidecar carrier rule so any source IFC entity without `ifc_guid` that is also not authored as a renderable USD prim is written to `entity_index.json`. | None on denominator; mapped_count rises by exactly the residue count. | None — sidecar is already an established artifact; downstream filters `usd_prim_path` truthiness and is unaffected. | **Chosen.** Minimal, schema-compatible. Closes `coverage_status=warn → pass` once batch is clean. |
| A2 | Allow the no-GUID geometry-shape entities to remain unmapped and document `coverage_status=warn` as the new steady state. | Stays at `warn` permanently; `minimum_coverage_locked=true` becomes unreachable. | None directly, but breaks the spec's existing `Full canonical batch locks coverage` scenario. | **Rejected.** Contradicts the load-bearing invariant that `pass` must be reachable for clean fixtures. |
| A3 | Synthesize an `ifc_guid`-like identifier for no-GUID geometry-shape entities and route them through the renderable USD prim carrier. | Denominator unchanged but GUID fidelity violated. | Coordinator / viewer may consume a synthetic GUID as if it were real. | **Rejected.** Violates `MUST NOT substitute synthetic identifiers for real IFC GUIDs`. |

### B. Outcome distribution recording

| # | Approach | Storage shape | Notes |
|---|---|---|---|
| B1 | Compute `outcome_distribution` (per-status `count` + `rate`) from per-fixture results inside `batch_verification` at summary time. | Additive optional field on batch summary; per-fixture rows unchanged. | **Chosen.** Idempotent (derivable from per-fixture rows), no new persistence shape. |
| B2 | Persist a separate "distribution.json" artifact per batch run. | New artifact kind; lineage edge `batch_summary → distribution`. | **Rejected.** Adds an artifact for information already present in the batch summary; lineage churn without payoff. |
| B3 | Defer distribution recording to evidence docs only, not the batch summary. | None; pure docs. | **Rejected.** Tests cannot assert on documentation; evidence requirement needs a programmatic source. |

### C. Secondary `guid_extraction` / `name_extraction` optimization

| # | Approach | Measured win precondition | Risk | Notes |
|---|---|---|---|---|
| C1 | Profile every canonical run; optimize **only** if a measured run shows ≥ 5 s saving without GUID / Name fidelity regression; otherwise emit deferral statement. | Mandatory profile output already exists under `--profile-source-entities`. | Bounded: optimization is opt-in per run; deferral is the default. | **Chosen.** Honors the predecessor's deferral while keeping the door open. |
| C2 | Always optimize in this change regardless of measured win. | None. | Risks GUID / Name fidelity regression for ≤10 s saving. | **Rejected.** Predecessor explicitly bounded this scope; not worth the regression risk. |
| C3 | Defer entirely; do not even profile. | None. | Loses the chance to gather data for a future change. | **Rejected.** Profiling is cheap (already wired) and required by the secondary-evidence spec amendment. |

## Selected Options

- **A1** — sidecar carrier rule explicitly covers no-GUID geometry-shape entities.
- **B1** — `outcome_distribution` is computed inside `batch_verification` and surfaced on the batch summary.
- **C1** — secondary enumeration measured on every canonical run; optimization gated on ≥ 5 s saving and GUID / Name fidelity preservation.

### Expected outcomes

- **Per-fixture coverage**: the 89 MB fixture's `unmapped_count=2 → 0`, `coverage_ratio` reaches `1.0`, `coverage_status` becomes `pass`. Sidecar size grows by ~2 entries (negligible JSON cost).
- **Batch run shape**: 13 per-fixture rows + an aggregate `outcome_distribution` block. Distribution example shape:
  ```json
  {
    "outcome_distribution": {
      "total": 13,
      "passed":             {"count": N, "rate": N/13},
      "timed_out":          {"count": N, "rate": N/13},
      "failed":             {"count": N, "rate": N/13},
      "mapping_quality_failed": {"count": N, "rate": N/13}
    }
  }
  ```
- **`minimum_coverage_locked`**: emitted as `true` if and only if `outcome_distribution.passed.count == 13` and every fixture's `quality_metrics.minimum_coverage_baseline_locked=true`. Otherwise both keys remain `false`.
- **Secondary enumeration**: per-run measurement always recorded; optimization either lands with a written before/after delta or a written deferral.

## Decisions

1. **Sidecar covers no-GUID geometry-shape entities.**
   - Rationale: it's the only chosen `unmapped_count=2` resolution that keeps real-GUID fidelity and reaches `coverage_status=pass` without weakening the denominator.
   - Approach: `_materialize_unmapped_entities` continues to write to the sidecar; the inclusion predicate is broadened from "non-renderable AND has identity" to "any source IFC entity not authored as a renderable USD prim, regardless of whether `ifc_guid` is present". Entries without `ifc_guid` keep `ifc_guid=null` in the sidecar — they are still uniquely keyed by `ifc_entity_key` / `ifc_entity_id`.
   - Alternative rejected: see Option A2 / A3 above.

2. **Coverage denominator stays at all-entity.**
   - Rationale: load-bearing invariant inherited from the predecessor changes.
   - Approach: nothing changes here. `coverage_denominator=source_ifc_entity_count` continues; `mapped_count + unmapped_count = source_ifc_entity_count` remains an asserted invariant in tests.

3. **`outcome_distribution` is additive and idempotent.**
   - Rationale: distribution is information that can be derived from existing per-fixture rows; recomputing on read keeps batch summaries simple.
   - Approach: `outcome_distribution` is computed in `batch_verification` and emitted on the batch summary. Existing keys (`status`, `fixtures`, `minimum_coverage_locked`) are preserved unchanged.
   - Alternative rejected: persisting a separate distribution artifact (Option B2) — see above.

4. **`minimum_coverage_locked=true` requires a clean full batch.**
   - Rationale: matches the existing `Full canonical batch locks coverage` scenario in `worker-artifact-pipeline`. We do not relax this gate; we only make `pass` reachable.
   - Approach: batch summary emits `minimum_coverage_locked=true` exactly when (a) `outcome_distribution.passed.count == 13`, (b) every fixture's `quality_metrics.minimum_coverage_baseline_locked=true`, and (c) every fixture's `coverage_status=pass`. Any failure keeps both keys at `false`.

5. **Secondary enumeration is profiled always, optimized only on a measured win.**
   - Rationale: predecessor analyzed the cost at ~20.6 s vs a 365 s primary bottleneck (now resolved). The win is real but small; optimizing without measurement risks fidelity regression for limited reward.
   - Approach: `verify_storage_batch.py --profile-source-entities` already produces the per-call breakdown; canonical batch runs MUST include `--profile-source-entities`. If `guid_extraction + name_extraction` cost is ≥ 5 s aggregate saving achievable without changing `ifc_guid` / `name` source values, an optimization task lands in this change. Otherwise the deferral is recorded in the evidence doc and the open question is closed.
   - Alternative rejected: always-optimize (Option C2) or never-profile (Option C3) — see above.

6. **No carrier shift; no Carrier-shift Handoff Framework re-fill required.**
   - Rationale: the framework exists for transitions between carriers (e.g. USD-prim → sidecar). This change does not shift carriers; it widens the existing sidecar carrier's inclusion predicate.
   - Approach: design.md notes "Carrier=sidecar; framework N/A for this change (predecessor's answers remain authoritative)". Tests assert that no `usd_prim_path` is created for no-GUID geometry-shape entries; they remain sidecar-only.

7. **Batch runs are single-pass; no automatic retries.**
   - Rationale: distribution evidence requires deterministic outcomes per fixture. Retries blur the distribution and make the evidence less useful for follow-up risk assessment.
   - Approach: a fixture's outcome is recorded once per batch run. If a user wants to retry a single fixture, they run `--limit 1` against that file in a separate session; the result is logged independently and does not modify the prior batch summary.

8. **Evidence first, optimization second.**
   - Rationale: even without secondary optimization, distribution evidence is the deliverable.
   - Approach: tasks order distribution recording + carrier-rule fix before any optional secondary optimization. The canonical batch run is the primary verification; secondary work is gated on it.

## Carrier-shift Handoff Framework

- **Status for this change:** Carrier=sidecar; framework N/A.
- **Why:** No carrier transition; only an inclusion-predicate widening. The predecessor's framework answers (coordinator does not consume `usd_prim_count`; viewer filters `usd_prim_path` truthiness; streaming does not traverse non-renderable prims) remain authoritative.
- **Re-verification trigger:** Re-fill the framework only when a future change either (a) moves non-renderable identity back to USD prims, (b) introduces a new carrier kind, or (c) changes the renderable-prim shape consumed by `web-viewer-sample`.

## Risks / Trade-offs

- **Risk: more than one fixture in the 13-file batch hits `timed_out`.** → Mitigation: distribution evidence is the deliverable; partial pass keeps `minimum_coverage_locked=false` truthfully. We MUST NOT widen the per-fixture timeout above 600 s within this change.
- **Risk: `mapping_quality_failed` fires on multiple fixtures due to fixtures with significantly different IFC author tools / schema versions.** → Mitigation: distribution evidence isolates which fixtures fail; follow-up changes can scope per-author-tool fixes if needed. No coverage rule weakening in this change.
- **Risk: widening the sidecar carrier rule accidentally writes the same entity twice (once as renderable prim, once in sidecar).** → Mitigation: a test asserts `mapped_count = mapped_renderable_count + sidecar_carrier_count` with no overlap; sidecar inclusion predicate is "not authored as a renderable USD prim", evaluated post-rendering.
- **Risk: secondary optimization regresses `ifc_guid` or `name` fidelity for niche IFC entity classes.** → Mitigation: optimization is gated on profile-measured win; tests assert that source-level `ifc_guid` and `name` values are byte-identical before and after on a small representative fixture set.
- **Risk: distribution math drifts from per-fixture rows.** → Mitigation: `outcome_distribution` is computed at read time from the same per-fixture status field used by the existing batch status logic; a test asserts re-derived distribution equals the recorded distribution.
- **Risk: full 13-file batch wall time exceeds practical session length (e.g. > 60 minutes on the local dev box).** → Mitigation: the run is independent of any service uptime; tasks list the canonical command with `--limit 13 --timeout-seconds 600`. Evidence may be collected over multiple sessions if needed; per-fixture artifacts are persistent in worker storage.

## Current Evidence (pre-change)

- 2026-05-13 canonical `--limit 1 --timeout-seconds 600 --profile-source-entities` (post `optimize-worker-non-renderable-materialization`):
  - `ifc_open=4.2s`, `source_entity_enumeration=27.4s`, `geometry_iteration=190.9s`, `mesh_authoring=8.1s`, `non_renderable_entity_materialization=5.05s`, `conversion_total=267.72s`.
  - `source_ifc_entity_count=1,604,773`, `mapped_count=1,604,771`, `unmapped_count=2`, `coverage_ratio=0.99999875`, `coverage_status=warn`.
  - `materialization_strategy=sidecar`, `sidecar_carrier_count=1,597,773`, `mapped_renderable_count≈6,998`.
  - Source enumeration profile detail: `iteration≈2.3s`, `guid_extraction=10.6s`, `name_extraction=10.0s`, `id_extraction≈1.3s`, `class_extraction≈1.1s`, `row_append≈0.3s`.
  - `conversion_job_id=conv_20260513105315_57b2c0fa`, `artifact_group_id=ag_bc5f30cda296`.
  - `minimum_coverage_locked=false`.
- Full 13-file batch: `not_run`. Remaining 12 fixtures' phase timings, outcomes, and `mapping_quality` distribution are unknown.
