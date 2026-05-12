## Context

`worker-mapping-lineage-quality-baseline` moved lineage and all-IFC-entity coverage semantics into current specs, but its real storage batch evidence stayed incomplete. The known facts are:

- canonical fixture glob: `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`
- dry-run finds 13 IFC fixtures, each observed at `89394282` bytes
- the first real `--limit 1` run failed on a long OpenUSD output path and was mitigated with short staging
- the second real `--limit 1` run timed out after 600s without a completed result
- `minimum_coverage_locked=true` must remain false until full canonical batch evidence passes

The owning repo is `_worker`: it owns source bytes, conversion jobs, artifact groups, lineage API, and conversion quality evidence. `runtime-verification-evidence` owns the evidence acceptance semantics. `_bim-control`, `bim-review-coordinator`, `bim-streaming-server`, and `web-viewer-sample` are not owners for this batch baseline.

## Goals / Non-Goals

**Goals:**

- Turn the canonical storage batch gap into an active, auditable OpenSpec follow-up.
- Add enough phase timing to identify whether timeout comes from IFC open, source entity enumeration, geometry iteration, mesh writing, non-renderable entity materialization, stage save/reopen, artifact publish, or lineage lookup.
- Make the batch helper report deterministic status classes for blocked, partial, timed out, failed, and passed runs.
- Require a successful `--limit 1` canonical real conversion before attempting or claiming the full 13-file baseline.
- Require all 13 canonical fixtures to complete real conversion and pass quality criteria before production mapping baseline can be locked.

**Non-Goals:**

- Do not redefine lineage API, coverage denominator, or `minimum_coverage_ratio=1.0`; those are already current specs.
- Do not create a production distributed batch-job service, queue, or worker fleet.
- Do not move file ownership to `_bim-control` or review session ownership to `_worker`.
- Do not require Kit/GPU/browser smoke for the storage batch baseline. Issue-to-real-prim highlight evidence remains a separate runtime evidence layer.
- Do not mark the roadmap as production-ready unless full canonical batch evidence actually passes.

## Decisions

### 1. Treat this as a follow-up change, not an archive edit

The archived change remains historical evidence of accepted requirements. This change modifies the current specs to define stricter follow-up acceptance and implementation tasks. That keeps OpenSpec history append-only and makes the remaining risk visible instead of silently rewriting archive content.

Alternative considered: move the archived change back to active. Rejected because PR #29/#30 already merged and current specs already contain the accepted requirements.

### 2. Profile one canonical fixture before full batch

The first implementation slice must reproduce `--limit 1` and record phase timings. Running all 13 fixtures before knowing the bottleneck would multiply the same failure and create noisy evidence.

The timing payload should be per fixture and use stable phase names:

- `source_read`
- `artifact_intake`
- `conversion_total`
- `ifc_open`
- `source_entity_enumeration`
- `geometry_iteration`
- `mesh_authoring`
- `non_renderable_entity_materialization`
- `stage_save`
- `stage_reopen`
- `artifact_publish`
- `lineage_lookup`

Not every converter internals phase must exist in every result, but missing phase timings must be explicit diagnostics when the run times out or fails before the phase starts.

### 3. Batch status must be stricter than helper availability

The helper may exist and dry-run may find 13 fixtures, but evidence status must remain non-passed unless real conversions completed. The summary status must be:

- `blocked`: root missing/unreadable/empty or converter prerequisites unavailable
- `partial`: dry-run, intentional subset, or limit smaller than fixture count
- `timed_out`: any fixture exceeds configured timeout
- `failed`: any fixture completes with failed conversion, failed USDC openability, failed truthful mapping, failed lineage lookup, or failed locked coverage
- `passed`: every required fixture completed and all quality gates passed

Only `passed` may set `minimum_coverage_locked=true`.

### 4. Keep timeout diagnostics in `_worker`

Timeout classification should be recorded by `_worker` batch verification, not by shell-only wrapper behavior. The CLI may expose a timeout option, but the evidence JSON must include per-fixture timeout details so docs can be audited without terminal history.

### 5. Roadmap updates must distinguish active risk burn-down from new feature candidates

The roadmap should list `worker-canonical-storage-batch-baseline` as the next worker risk burn-down before `coordinator-session-lifecycle-events-audit`. That does not demote lifecycle events as a P1 feature; it clarifies that production mapping readiness has an unresolved evidence gate.

## Risks / Trade-offs

- [Long runtimes] 89MB fixture conversion may legitimately exceed local interactive time limits. → Add phase timings and configurable per-fixture timeout before broadening to 13 files.
- [Large output size] all-IFC-entity materialization may create many non-renderable prims. → Measure entity counts, prim counts, output bytes, and phase timings before optimizing.
- [Overfitting to one fixture] fixing only the first file may not solve all 13. → Full baseline remains unlocked until all required fixtures pass.
- [Local machine dependency drift] if IfcOpenShell/OpenUSD or Python package versions drift, evidence may become unreproducible. → Record converter identity and dependency versions in the verification report.
- [Spec scope creep] adding a production batch service would pull in queues and deployment concerns. → Keep this change as single-host `_worker` verification; open a later production batch-job spec only if needed.

## Migration Plan

1. Add timing/status fields in a backward-compatible way; existing batch helper consumers can ignore new fields.
2. Run focused unit tests for timeout/status/timing semantics with fake converters.
3. Reproduce canonical `--limit 1` with the real fixture root and record evidence.
4. Optimize or fix the identified bottleneck.
5. Re-run `--limit 1`, then full 13-file batch.
6. Update verification docs and roadmap based on the actual outcome.

Rollback is straightforward: revert the implementation PR. Existing archived specs and previous evidence remain intact, and the production baseline remains unlocked.

## Open Questions

- What per-fixture timeout should be considered acceptable for the first controlled run: 600s, 1200s, or a manually approved longer run?
- Should the full 13-file batch run serially first for deterministic evidence, or allow a later parallel mode after single-file stability is proven?
- If one or more canonical fixtures consistently fail because of unsupported IFC content, should the fixture set be curated, or should `coverage_status=warn` policy be extended with explicitly allowed degradation reasons?
