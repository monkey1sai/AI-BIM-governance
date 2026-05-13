## Context

`optimize-worker-source-entity-enumeration` has been completed: the 89MB canonical fixture enumerates 1,604,773 IFC entities in ~33.2s with `fallback_used=false`, and `source_entity_enumeration` is no longer the timeout phase. The next observed blocker is `_worker`-owned `non_renderable_entity_materialization`. Inside `_materialize_unmapped_entities` (`_worker/app/converters.py:640`), every unmapped source IFC entity becomes a USD `Xform` prim with six attributes (`ifc:entityKey`, `ifc:entityId`, `ifc:guid`, `ifc:type`, `ifc:name`, `worker:nonRenderableIfcEntity`). At ~1.5M unmapped entities, Python-level USD authoring exceeds the remaining per-fixture timeout budget.

The current baseline requirement in `openspec/specs/worker-artifact-pipeline/spec.md` is strict: "_worker MUST materialize every IFC entity as a USD prim with stable traceability". This change re-opens that requirement so the carrier of non-renderable IFC entity identity can be either a USD prim or a sidecar mapping artifact, but never at the cost of dropping the all-entity coverage denominator or IFC traceability fields.

The affected ownership boundary remains `_worker`: file bytes, object URLs, conversion jobs, converter diagnostics, mapping output, artifact groups, and verification evidence. `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` remain downstream consumers that only see `_worker`'s artifact group after conversion succeeds.

## Goals / Non-Goals

**Goals:**

- Make `non_renderable_entity_materialization` measurable enough to distinguish USD authoring cost from identity-write cost.
- Optimize the materialization path so the canonical `--limit 1` 89MB fixture produces `model.usdc` within the configured 600s per-fixture timeout.
- Preserve all-IFC-entity coverage semantics: every source IFC entity remains in `coverage_denominator=source_ifc_entity_count` and keeps stable IFC traceability fields.
- Keep conversion result, quality metrics, lineage, artifact group readiness, and review viewer handoff backward-compatible. Any new fields are additive optional diagnostics.
- Permit (but do not mandate) shifting the non-renderable IFC entity carrier from USD prims to a sidecar mapping artifact, with a clearly documented downstream handoff.
- Record before/after evidence and update roadmap/verification docs without claiming `minimum_coverage_locked=true` prematurely.
- Secondary: where it can be done safely, reduce `guid_extraction` / `name_extraction` cost in source enumeration so the combined burn-down is meaningful at full-batch scale.

**Non-Goals:**

- No changes to `_bim-control` metadata authority, coordinator session lifecycle, web viewer rendering, Kit runtime, WebRTC, GPU provisioning, auth, or production deployment.
- No switch to a different converter stack unless explicitly justified by measured evidence and approved as a separate dependency decision.
- No weakening of coverage by counting only renderable geometry, `IfcProduct`, or GUID-bearing entities.
- No full production batch-job scheduler; this remains a local canonical verification helper path.
- No changes to `web-viewer-sample` highlight / focus contracts; if the carrier moves, the viewer must keep current `primary_usd_prim_path` / `usd_prim_paths` shape for renderable mapped entries.

## Optimization Options Considered

`_materialize_unmapped_entities` currently runs an O(N) Python loop with per-entity USD-level calls. The options below were surfaced in `/opsx:explore` as **pre-measurement hypotheses**. None of them is selected and none of the columns below carries a measured effort estimate; the table exists only to seed the baseline profile (§2) and the Option Selection Gate (§2.5 in `tasks.md`). Final selection MUST cite numbers from the baseline profile, MUST be recorded in this `design.md` under a new "Selected Option(s)" subsection at apply time, and MUST NOT bypass the gate task.

| # | Approach (hypothesis) | Coverage impact | Streaming impact | Baseline-annotated effect | Notes |
|---|----------------------|----------------|------------------|---------------------------|-------|
| 1 | `Sdf.ChangeBlock` + direct `Sdf.PrimSpec` / `Sdf.AttributeSpec` instead of `UsdGeom.Xform.Define` + `CreateAttribute` | None | None | **HIGH win, primary target.** Baseline measured `xform_define_seconds=365.5s` (97.4% of 375s materialization for 69,189 entities); `attribute_write_seconds=8.2s` (2.2%). The bottleneck is the schema-level `Xform.Define` + `CreateAttribute` notification cost, exactly the pattern `Sdf.ChangeBlock` + `Sdf.PrimSpec` is designed to bypass. Even a conservative 5× throughput improvement projects ~1,690s for all 1.5M; combined with option 3 chunking and the existing geometry / enumeration time (~225s) the remaining 600s budget is still tight, but this is the only USD-prim-internal path that targets the measured bottleneck. | USD-internal optimization. Keeps stage shape and downstream contracts. Lowest blast radius. |
| 2 | Flat container under a single `Scope` prim with deterministic prim names; collapse `_unique_prim_path` set-membership cost | None on coverage; prim path strings change | Path string changes for non-renderable prims (irrelevant to viewer if those prims were not highlighted) | **LOW win.** Baseline `unique_prim_path_seconds=0.5s` (0.13% of materialization). Set membership is not the bottleneck. | Mid-risk to consumers that walk the USD stage tree assuming the current prefix. Not worth the prim-path churn on its own. |
| 3 | Chunked authoring with progress writes (e.g. flush per N entities), allowing resumable / diagnosable progress | None | None | **Already partially in place.** Progress writes cost `0.28s` across 192 publishes. Combined with option 1 it preserves diagnoseability and is a natural fit because `Sdf.ChangeBlock` flushes notifications on exit; chunked blocks give incremental progress reporting. Alone it does not raise throughput. | Diagnoseability + bounded `ChangeBlock` size. |
| 4 | Sidecar carrier: non-renderable IFC entity identity is written to `element_mapping.json` (or a new `entity_index.json` artifact) and is not authored into the USD stage; USD stage only contains renderable + mapped prims | None on denominator, but mapping artifact takes the carrier role | Streaming server no longer sees non-renderable prims (they were never rendered anyway); coordinator/viewer still get full coverage data via mapping artifact | **HIGHEST win in pure throughput** — eliminates all 1.5M `UsdGeom.Xform.Define` calls. Sub-second JSON dump replaces the 365s+ USD authoring loop. | Requires Carrier-shift Handoff Framework answers across coordinator/viewer/streaming before code can land. Higher coordination cost than option 1. Deferred to a follow-up change unless option 1 (+3) cannot fit the canonical 600s budget. |
| 5 | Secondary: reduce `guid_extraction` / `name_extraction` cost in source enumeration by reusing IfcOpenShell attribute access patterns or caching schema lookups | None, must keep ifc_guid / name fidelity | None | **Marginal.** Baseline `guid_extraction=10.6s + name_extraction=10.0s ≈ 20.6s` of 27.4s enumeration. Even halving that saves ~10s — small next to the 365s primary bottleneck. | Lives under secondary scope §4; never blocks primary burn-down. Deferred unless option 1 succeeds with headroom remaining. |

Option (4) is the most promising hypothesis in pure throughput, but it is also the only one that crosses the artifact-carrier line. Selection MUST be conditional on completing the Carrier-shift Handoff Framework below.

## Selected Option(s)

**Selected: Option 4 (sidecar carrier) + Option 3 (chunked progress writes).**

### Baseline profile citations

From canonical `--limit 1 --timeout-seconds 600 --profile-source-entities` run on `許良宇圖書館建築_2026 - 複製 (10).ifc` (89,394,282 bytes, `conversion_job_id=conv_20260513102219_4c543c8f`, `artifact_group_id=ag_ec7eda49abf7`, `source_artifact_id=artifact_src_17f2e857a8ff`):

- `non_renderable_entity_materialization` timed out at `375.09s`, having materialized `69,189` of `1,604,773` entities. Projected wall time for full set at this rate: **~8,160s (13.6× over the 600s budget)**.
- Per-operation breakdown within materialization:
  - `xform_define_seconds = 365.48s` — **97.4% of the phase**. This is `UsdGeom.Xform.Define` schema-level notification + `Tf` notice round-trip cost per prim.
  - `attribute_write_seconds = 8.19s` — 2.2%.
  - `unique_prim_path_seconds = 0.51s` — 0.13%.
  - `row_append_seconds = 0.14s`, `mapping_append_seconds = 0.17s`, `progress_write_seconds = 0.28s` — negligible.
  - `sidecar_io_seconds = 0.0s` — baseline did not exercise sidecar path.
- Source enumeration ran in `27.38s` with `guid_extraction = 10.61s`, `name_extraction = 10.05s`, `iteration = 2.25s` (total 1,604,773 entities). Halving `guid_extraction + name_extraction` would save ~10s — small next to the 365s primary bottleneck.

### Expected win (sidecar path)

Sidecar carrier writes 1.5M entity entries to a JSON artifact (`entity_index.json`) in a single bulk write. Estimated wall time: **< 5s** (JSON encode of ~1.5M small records is bound by I/O, not by per-record overhead). This eliminates the 365s `Xform.Define` loop entirely and reduces the materialization phase to roughly the time spent walking `source_entities` + writing one JSON file (target: < 10s combined). Projected full-fixture conversion: `ifc_open (4.3s) + source_entity_enumeration (27.4s) + geometry_iteration (190.9s) + mesh_authoring (8.1s) + non_renderable_entity_materialization (<10s) + stage_save + stage_reopen ≈ 240–260s`, well inside the 600s budget.

### Rejected options

- **Option 1 (`Sdf.ChangeBlock` + `Sdf.PrimSpec`)** — even at an optimistic 10× speedup on `xform_define_seconds`, the projected materialization time is ~37s for 69k entities, scaling to ~860s for 1.5M, still over the 600s budget. The win is real but not deterministically sufficient.
- **Option 2 (flat `Scope` prim path collapse)** — measured cost being optimized is `unique_prim_path_seconds = 0.51s` (0.13%). Negligible win; pure prim-path churn for no measurable gain.
- **Option 5 (secondary `guid_extraction` / `name_extraction` reduction)** — measured potential saving ~10s, deferred to §4 follow-up after the primary burn-down lands; will not be exercised in this change unless headroom remains after canonical rerun.

### Combination notes

- **Option 3 (chunked progress writes)** is retained because the per-entity diagnostics path (`materialized_entity_count`, `last_operation`, `elapsed_seconds`, `progress_write_count`) added in §2.1 already exists and is reused for the sidecar path. Sidecar carrier still walks `source_entities` and reports progress; the per-batch write is a single JSON dump at the end.
- This change does **NOT** enable Option 1 in code. If future evidence shows the sidecar path is insufficient (e.g. JSON encode > 30s for larger fixtures), `Sdf.ChangeBlock` remains a reusable hypothesis recorded in this table.

## Carrier-shift Handoff Framework — Answers for this change

The selected path is **Option 4 (sidecar carrier)**. Concrete answers below were verified against current source on 2026-05-13.

### Coordinator side (`bim-review-coordinator`)

- **Does the coordinator consume `usd_prim_count` or assume non-renderable USD prim presence?**
  - **No.** `bim-review-coordinator/src/types.ts:87` declares `usd_prim_path?: string | null` on `DemoMappingItem` (optional). No `usd_prim_count` is consumed in `src/`. Coordinator does not iterate the USD stage and does not enumerate non-renderable entities server-side.
  - **New field needed?** No. `materialization_strategy` in `quality_metrics` is sufficient; coordinator passes `quality_metrics` through without semantic transformation.
- **Does the coordinator broadcast/persist any IFC-entity-keyed event whose payload assumes a USD prim path?**
  - **No.** `dev-console.js:159` uses a constant `"/World"` placeholder for `usd_prim_path` in test scaffolding only. Real review events flow through `socket.io` carrying `ifc_guid` / `usd_prim_path` from upstream payloads; if `usd_prim_path` is null, downstream consumers fall back to `ifc_guid` keying.
- **Does the artifact group readiness API need a new flag for carrier choice?**
  - **No.** Existing readiness checks for `model_usdc`, `ifc_index`, `usd_index`, `element_mapping` are unchanged. `entity_index` is added as an additional derived artifact in the lineage graph and readiness check. `materialization_strategy=sidecar` in `quality_metrics` is sufficient signal.

### Viewer side (`web-viewer-sample`)

- **Where does the viewer surface non-renderable IFC entities today?**
  - **It does not surface them as a separate list.** `web-viewer-sample/src/Window.tsx:894` reads `element_mapping.json` and explicitly filters: `payload.items.filter((item) => Boolean(item['usd_prim_path']))`. Items without `usd_prim_path` are dropped from the selectable highlight list. Today's non-renderable USD prims (which DO carry `usd_prim_path` under the existing implementation) pass this filter but are not surfaced in a non-renderable-specific UI.
- **If the viewer iterates USD stage to enumerate non-renderable entities, what is the replacement path?**
  - **N/A.** Viewer does not iterate USD stage for enumeration today. The DataChannel `getChildrenRequest` flow walks the USD stage only for user-initiated tree expansion; non-renderable prims that disappear from the stage simply do not appear in tree expansion, which matches the current viewer behavior (non-renderable items in the tree have no highlight target anyway).
- **Does any DataChannel command currently assume non-renderable prims exist?**
  - **No.** `Window.tsx:846-947` shows the highlight flow guards on `usd_prim_path` truthiness before sending `highlightPrimsRequest`. Issues and mapping items without `usd_prim_path` are handled with "no DataChannel sent" branches today.
- **Net viewer impact for sidecar path:** the viewer's existing filter handles missing `usd_prim_path` correctly. No viewer code change is required for sidecar to ship. The new `entity_index.json` artifact is fetchable via lineage if a future viewer feature wants to surface non-renderable entries in a tree view, but that is out of scope for this change.

### Streaming side (`bim-streaming-server`)

- **Does Kit runtime rely on non-renderable prims for traversal, selection routing, or metadata lookup?**
  - **No.** `grep -ri "non_renderable\|element_mapping\|usd_prim_path"` in `bim-streaming-server/source` returns zero matches. Kit loads the USD stage as authored by `_worker` and renders renderable prims; non-renderable prims that today exist in the stage are inert at the rendering level.
- **Does USDC stage open time improve materially without non-renderable prims?**
  - **Plausible yes, but not measured here.** Removing ~1.5M `Xform` prims from `model.usdc` will reduce file size and stage-open prim count. Measurable in `stage_reopen` timing post-change.
- **Does `highlightPrimsRequest` need a fallback for entities with no prim?**
  - **No new fallback needed.** The viewer already does not send `highlightPrimsRequest` for entities without `usd_prim_path` (see Window.tsx guard above).
- **Net streaming impact for sidecar path:** no change required. Stage shrinks; `getChildrenRequest` returns fewer non-renderable nodes (matching the new authoritative truth).

### Sidecar artifact contract for this change

- **Filename / object key:** `entity_index.json`, written next to `model.usdc`, `ifc_index.json`, `usd_index.json`, `element_mapping.json` under the derived object prefix.
- **Artifact id:** `artifact_entity_index_<job-suffix>` (matches existing naming pattern).
- **Lineage:** added as a `kind=entity_index` node with `has_sidecar` edge from `model_usdc`, surfaced in `derived_artifact_ids.entity_index` and `entity_index_url` in conversion result.
- **Schema (sidecar entries):**
  ```json
  {
    "mapping_method": "ifc_entity_to_sidecar_index",
    "materialization_strategy": "sidecar",
    "source_artifact_id": "<source artifact id>",
    "entities": [
      {
        "ifc_entity_key": "...",
        "ifc_entity_id": "...",
        "ifc_guid": "..." | null,
        "ifc_class": "...",
        "name": "...",
        "renderable": false
      }
    ],
    "summary": {
      "sidecar_entity_count": N
    }
  }
  ```
- **Coverage accounting:**
  - `mapped_count = mapped_renderable_count + sidecar_carrier_count`
  - `usd_prim_count` counts only USD stage prims (renderable + structural roots like `/World`), excluding sidecar-only entities.
  - `coverage_denominator = source_ifc_entity_count`, unchanged.
  - `coverage_ratio = mapped_count / source_ifc_entity_count`.

## Decisions

1. **Profile before optimizing.**
   - Rationale: the current evidence identifies `non_renderable_entity_materialization` as the timeout phase, but does not yet isolate USD-level authoring cost versus identity-write cost. A baseline profile is required before selecting an option from the table above.
   - Approach: instrument `_materialize_unmapped_entities` to record per-batch authoring time and entity throughput (always-on, low overhead) and optional per-call USD authoring profile under the verification profiling flag. The first implementation task produces a repeatable canonical baseline.
   - Alternative rejected: blindly migrating to `Sdf.ChangeBlock` without measurement. That may hide a different root cause (e.g. `_unique_prim_path` set cost) and lose evidence value.

2. **Coverage denominator stays at all-entity, regardless of carrier choice.**
   - Rationale: this is the load-bearing invariant that prevents silently dropping non-renderable IFC entities from the coverage report.
   - Approach: whichever option is chosen, the resulting `mapping_summary.source_ifc_entity_count` MUST equal the source enumeration count and `coverage_denominator=source_ifc_entity_count` MUST remain truthful.
   - Alternative rejected: introducing a renderable-only or `IfcProduct`-only fast path. That would make timeout disappear by changing the meaning of coverage.

3. **Sidecar carrier is permitted but gated on documented handoff.**
   - Rationale: shifting carrier from USD prims to a sidecar artifact is the highest-throughput option, but it changes what `bim-streaming-server` sees and what `web-viewer-sample` can highlight via DataChannel `highlightPrimsRequest`. Non-renderable prims were never rendered or highlighted in practice, so this is plausible — but must be explicit.
   - Approach: if option (4) is selected, design.md updates with a section "Non-Renderable Carrier Handoff" describing how `bim-review-coordinator` and `web-viewer-sample` continue to surface non-renderable IFC entities in review UI (e.g. tree view, issue focus) without requiring USD prim presence. `element_mapping.json` keeps `primary_usd_prim_path` / `usd_prim_paths` semantics for renderable entries unchanged.
   - Alternative rejected: defaulting to USD-prim-only carrier forever. That keeps the timeout for the canonical fixture without justification.

4. **Publish progress during long materialization.**
   - Rationale: even after optimization, the fixture is large and `_worker` must remain diagnosable.
   - Approach: phase progress payloads include `materialized_entity_count`, `materialization_strategy` (one of `usd_prim`, `sidecar`, or hybrid), elapsed seconds, last operation, and `progress_write_count`. These fields are additive.
   - Alternative rejected: only writing a final phase timing. That recreates the prior blind timeout pattern.

5. **Validation stays staged.**
   - Rationale: this change burns down `non_renderable_entity_materialization` and (optionally) the next-largest enumeration cost; it does not burn down the entire SaaS roadmap.
   - Approach: focused unit tests first, then canonical `--limit 1 --timeout-seconds 600`. If single-fixture conversion succeeds, collect handoff IDs/URLs and run a single-fixture visual preview via the existing review viewer flow. Full 13-file batch remains a follow-up gate.

6. **Split always-on diagnostics from evidence-only profiling (continues from prior change).**
   - Rationale: canonical evidence needs to attribute cost between USD authoring, identity writing, sidecar IO, and progress writes; production conversion should not pay detailed profiling overhead by default.
   - Approach: always record `materialized_entity_count`, `materialization_strategy`, `elapsed_seconds`, `progress_write_count`, `fallback_used=false`. Fine-grained counters for per-call USD authoring, per-attribute write cost, and sidecar IO are enabled only via the existing `--profile-source-entities` (renamed or extended to a generic `--profile-conversion` if needed) flag.

7. **Secondary scope is optional and bounded.**
   - Rationale: `guid_extraction` (13s) + `name_extraction` (12s) is a known follow-on opportunity, but it is not the canonical timeout phase today.
   - Approach: include task(s) for secondary optimization only after the primary materialization burn-down passes its tests. If secondary work would regress IFC GUID / Name fidelity, defer it to its own change.
   - Alternative rejected: bundling secondary work into the primary critical path. That risks scope creep and delays the canonical first-fixture USDC.

8. **Option Selection Gate.**
   - Rationale: this design lists five hypotheses without measurement. Without an explicit gate, apply could drift past §2 baseline profile and into §3 implementation while the table above silently behaves as a decision.
   - Approach:
     - After §2 baseline profile completes, results are written into this `design.md` under a new "Selected Option(s)" subsection (created at apply time, not now), with citations to the per-batch authoring cost, per-call USD authoring breakdown, `_unique_prim_path` set cost, and (if relevant) sidecar IO cost measured in §2.
     - "Selected Option(s)" subsection MUST name the chosen option(s) (one or a composition), state expected win in seconds based on measurement, and state which hypotheses are rejected with one-line reasons.
     - If option (4) is selected, the Carrier-shift Handoff Framework section MUST be filled with concrete answers in the same subsection.
     - `tasks.md` §2.5 is the gate task that performs this write; §3 MUST NOT start until §2.5 is checked.
   - Alternative rejected: relying on Decision #1 alone. That asserts the order but does not enforce a write-back location.

## Carrier-shift Handoff Framework

`worker-artifact-pipeline` spec now permits non-renderable IFC entity identity to be carried in either a USD prim or a sidecar mapping artifact. Any carrier shift — including this change's option (4) and any future change — MUST answer the following three question groups before code lands.

### Coordinator side (`bim-review-coordinator`)

- Does the coordinator currently consume `usd_prim_count` or any field that assumes non-renderable USD prim presence? If so, what is the new field that carries the same fact when the carrier is the sidecar?
- Does the coordinator broadcast or persist any IFC-entity-keyed event whose payload assumes the entity has a USD prim path? What is the new resolution rule when only a sidecar entry exists?
- Does the artifact group readiness API need a new flag indicating which carrier was used, or is `materialization_strategy` in the conversion result sufficient?

### Viewer side (`web-viewer-sample`)

- Where does the viewer surface non-renderable IFC entities today (tree view, issue list, search)? Is the source `element_mapping.json`, `ifc_index.json`, or USD stage traversal via DataChannel?
- If the viewer iterates USD stage to enumerate non-renderable entities, what is the replacement path (e.g. fetch sidecar artifact, render from `element_mapping.json`)?
- Does any DataChannel command (`getChildrenRequest`, `selectPrimsRequest`, `highlightPrimsRequest`) currently assume non-renderable prims exist? If so, is the answer "those calls were never used for non-renderable entities" or "those calls need a graceful no-op when the entity has no prim path"?

### Streaming side (`bim-streaming-server`)

- Does Kit runtime currently rely on non-renderable prims for anything other than rendering (e.g. traversal, selection routing, metadata lookup)?
- If non-renderable prims disappear from the stage, does USDC stage open time improve materially? Is there a measurable regression risk?
- Does `highlightPrimsRequest` need a fallback path when the IFC entity has no prim (e.g. show issue card without 3D focus)?

### Filling the framework

- If this change selects option (4) in §2.5, each question above MUST have a concrete one-paragraph answer in the "Selected Option(s)" subsection, with links to code when the answer is "today's behavior is X".
- If this change does NOT select option (4), the framework is marked "Carrier=USD prim only; framework N/A for this change". The framework remains in `design.md` as a reusable artifact for the next carrier-shift proposal.
- An answer of "we have not verified this" is NOT acceptable as a closure state; a spike task MUST be added to `tasks.md` before code lands.

## Risks / Trade-offs

- **Risk: USD authoring itself dominates and even `Sdf.ChangeBlock` cannot fit in 600s.** → Mitigation: option (4) sidecar carrier is the fallback; record deterministic blocker if neither option fits.
- **Risk: sidecar carrier breaks an undocumented downstream assumption** (e.g. coordinator counting USD prims, viewer iterating stage tree). → Mitigation: design must include a downstream handoff section and the implementation must check coordinator / viewer payload shape before adopting option (4).
- **Risk: optimization accidentally drops non-renderable IFC entities.** → Mitigation: tests must assert `source_ifc_entity_count` is unchanged and `mapped_count + unmapped_count = source_ifc_entity_count`.
- **Risk: added instrumentation changes result payload shape.** → Mitigation: only optional nested diagnostics fields; existing keys remain stable.
- **Risk: `_unique_prim_path` set membership cost masquerades as USD authoring cost.** → Mitigation: baseline profile must measure `_unique_prim_path` cost separately.
- **Risk: secondary `guid_extraction` / `name_extraction` change silently substitutes synthetic IDs for real GUIDs.** → Mitigation: tests inherited from the prior change continue to assert real-GUID-only `mapped_count` and `coverage_ratio` increments.

## Current Evidence

- 2026-05-13 canonical `--limit 1 --timeout-seconds 600 --profile-source-entities`:
  - `ifc_open=4.23s`, `source_entity_enumeration=33.19s`, `geometry_iteration=198.08s`, `mesh_authoring=8.51s`.
  - `non_renderable_entity_materialization` timed out at >356s.
  - Source IFC entity count: 1,604,773; `fallback_used=false`.
  - Source enumeration profile detail: `iteration=2.86s`, `id_extraction=1.29s`, `class_extraction=1.11s`, `guid_extraction=12.99s`, `name_extraction=12.23s`, `row_append=0.34s`.
  - `conversion_job_id=conv_20260513061340_68a74e57`, `artifact_group_id=ag_d73913408c7f`, `source_artifact_id=artifact_src_f2b1d643c433`.
  - `minimum_coverage_locked=false`.
- No completed `model.usdc` was produced for this canonical fixture, so visual preview remains blocked and full 13-file canonical batch remains `not_run`.
