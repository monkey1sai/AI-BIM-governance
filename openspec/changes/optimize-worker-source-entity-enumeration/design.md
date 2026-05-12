## Context

`worker-canonical-storage-batch-baseline` has been archived with the canonical batch baseline still unlocked. Its evidence shows the first canonical 89MB IFC fixture completes `ifc_open`, then exceeds the 600 second per-fixture timeout while `source_entity_enumeration` is still running. That means `_worker` now has good timeout diagnostics, but still cannot produce the single-fixture conversion result needed before visual preview or the full 13-file batch.

The affected ownership boundary is `_worker`: file bytes, object URLs, conversion jobs, converter diagnostics, mapping output, artifact groups, and verification evidence. `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` remain downstream consumers for visual preview only after `_worker` has produced `model.usdc`.

## Goals / Non-Goals

**Goals:**

- Make `source_entity_enumeration` measurable enough to distinguish slow `_worker` logic from IfcOpenShell/runtime limits.
- Optimize source entity enumeration so the canonical `--limit 1` 89MB fixture progresses beyond the current timeout phase.
- Preserve all-IFC-entity coverage semantics: every source entity remains in the denominator and must keep stable IFC traceability.
- Keep conversion result, quality metrics, lineage, and review viewer handoff payloads backward-compatible.
- Record before/after evidence and update roadmap/verification docs without claiming `minimum_coverage_locked=true` prematurely.

**Non-Goals:**

- No changes to `_bim-control` metadata authority, coordinator session lifecycle, web viewer rendering, Kit runtime, WebRTC, GPU provisioning, auth, or production deployment.
- No switch to a different converter stack unless explicitly justified by measured evidence and approved as a separate dependency decision.
- No weakening of coverage by counting only renderable geometry, `IfcProduct`, or GUID-bearing entities.
- No full production batch-job scheduler; this remains a local canonical verification helper path.

## Decisions

1. **Profile before optimizing.**
   - Rationale: the current evidence identifies `source_entity_enumeration`, but not the expensive operation inside it.
   - Approach: add or use focused instrumentation around `_source_entities(model)`, entity iteration, class/name/global-id extraction, and any fallback path. The first implementation task should produce a repeatable baseline on the canonical first fixture.
   - Alternative rejected: immediately reducing the denominator to geometry entities. That would make the timeout disappear by changing the meaning of coverage, which violates the archived baseline spec.

2. **Keep a minimal identity scan as the source of truth for coverage.**
   - Rationale: mapping coverage only needs stable identity fields first: entity key, entity id, IFC class, GlobalId when present, and Name when cheap or already available.
   - Approach: avoid eager deep relationship traversal, inverse lookups, full property-set expansion, or repeated expensive attribute calls during enumeration. Additional metadata can be deferred until materialization only if it is bounded and measured.
   - Alternative rejected: duplicating full source entity lists for separate mapping/materialization phases. The converter should reuse a single measured identity collection.

3. **Publish progress during long enumeration.**
   - Rationale: if the optimized path still times out, evidence must reveal whether it is stuck before the first entity, progressing slowly, or blocked on a specific API call.
   - Approach: phase progress payloads should include available counters such as `enumerated_entity_count`, current IFC class when known, elapsed seconds, and diagnostic status. These fields are additive.
   - Alternative rejected: only writing a final phase timing. That recreates the prior blind timeout.

4. **Validation remains staged.**
   - Rationale: this change burns down the source enumeration blocker, not the entire SaaS roadmap.
   - Approach: run focused unit tests first, then canonical `--limit 1 --timeout-seconds 600`. If single-fixture conversion succeeds, collect handoff IDs/URLs and proceed to visual preview in the existing review viewer flow. Full 13-file batch remains a follow-up gate unless the single fixture and preview evidence are ready.

## Risks / Trade-offs

- **Risk: IfcOpenShell iteration itself remains too slow for the fixture.** → Mitigation: record deterministic blocker diagnostics, exact API/path, elapsed time, and keep baseline unlocked rather than silently passing.
- **Risk: optimization accidentally drops non-renderable IFC entities.** → Mitigation: tests must assert denominator preservation and include non-geometry entities; canonical evidence must report source IFC entity count before and after.
- **Risk: added instrumentation changes result payload shape.** → Mitigation: add only optional nested diagnostics fields and keep existing keys stable.
- **Risk: multiprocessing timeout hides child-process cleanup issues.** → Mitigation: rerun timeout smoke and confirm no residual conversion process remains before declaring the diagnostic path stable.
