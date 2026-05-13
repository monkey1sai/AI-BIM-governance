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

| # | Approach (hypothesis) | Coverage impact | Streaming impact | Notes |
|---|----------------------|----------------|------------------|-------|
| 1 | `Sdf.ChangeBlock` + direct `Sdf.PrimSpec` / `Sdf.AttributeSpec` instead of `UsdGeom.Xform.Define` + `CreateAttribute` | None | None | USD-internal optimization. Keeps stage shape. |
| 2 | Flat container under a single `Scope` prim with deterministic prim names; collapse `_unique_prim_path` set-membership cost | None on coverage; prim path strings change | Path string changes for non-renderable prims (irrelevant to viewer if those prims were not highlighted) | Mid-risk to consumers that walk the USD stage tree assuming the current prefix. |
| 3 | Chunked authoring with progress writes (e.g. flush per N entities), allowing resumable / diagnosable progress | None | None | Diagnoseability win; may not be a throughput win on its own. |
| 4 | Sidecar carrier: non-renderable IFC entity identity is written to `element_mapping.json` (or a new `entity_index.json` artifact) and is not authored into the USD stage; USD stage only contains renderable + mapped prims | None on denominator, but mapping artifact takes the carrier role | Streaming server no longer sees non-renderable prims (they were never rendered anyway); coordinator/viewer still get full coverage data via mapping artifact | Highest throughput hypothesis; requires Carrier-shift Handoff Framework answers before any code lands. |
| 5 | Secondary: reduce `guid_extraction` / `name_extraction` cost in source enumeration by reusing IfcOpenShell attribute access patterns or caching schema lookups | None, must keep ifc_guid / name fidelity | None | Lives under secondary scope §4; never blocks primary burn-down. |

Option (4) is the most promising hypothesis in throughput, but it is also the only one that crosses the artifact-carrier line. Selection MUST be conditional on completing the Carrier-shift Handoff Framework below.

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
