## ADDED Requirements

### Requirement: Non-renderable entity materialization optimization evidence

Runtime verification evidence MUST record the non-renderable entity materialization burn-down before the canonical batch baseline can advance. Evidence MUST include the canonical fixture identity, command, timeout setting, baseline `non_renderable_entity_materialization` timing or timeout result, implemented optimization summary (including which option from the design comparison was selected and whether a sidecar carrier was used), post-change `non_renderable_entity_materialization` timing, count of entities materialized as USD prims, count of entities materialized to sidecar carrier when applicable, whether conversion advanced past materialization to `stage_save` / `stage_reopen` / `lineage_lookup`, fallback usage, and the next gating phase or blocker.

If non-renderable entity materialization remains unable to complete within the configured timeout, evidence MUST classify the result as `timed_out` or `blocked`, preserve `minimum_coverage_locked=false`, and identify whether the unresolved limitation appears to be `_worker`-owned or external to the worker converter logic.

When the secondary scope (`guid_extraction` / `name_extraction` cost in source enumeration) is exercised in the same change, evidence MUST also record before/after `source_entity_enumeration` fine-grained timing and confirm that IFC GUID / Name fidelity for all source entities is preserved.

Fine-grained materialization profiling evidence MAY be recorded for canonical burn-down runs. When enabled, it SHOULD distinguish per-batch USD authoring time, per-attribute write cost, `_unique_prim_path` set-membership cost, and sidecar IO cost so the evidence can separate USD authoring cost from identity-write cost.

#### Scenario: Before and after timing recorded

- **WHEN** `_worker` changes non-renderable entity materialization behavior for canonical fixtures
- **THEN** verification evidence records the pre-change timeout or baseline timing and the post-change timing for `non_renderable_entity_materialization`
- **AND** the evidence references the exact canonical fixture path or source identity used

#### Scenario: Canonical single fixture produces model.usdc

- **WHEN** canonical `--limit 1 --timeout-seconds 600` is rerun after the optimization
- **THEN** evidence records whether conversion progressed past `non_renderable_entity_materialization` and produced `model.usdc`
- **AND** if conversion succeeds, evidence records the resulting `conversion_job_id`, `artifact_group_id`, derived USDC artifact ID or URL, mapping artifact ID or URL, sidecar artifact ID or URL when applicable, and readiness state

#### Scenario: Sidecar carrier choice is documented

- **WHEN** the optimization moves non-renderable IFC entities from USD prims to a sidecar carrier
- **THEN** evidence records the selected option from the design comparison, the count of entities written to the sidecar carrier, the count remaining in USD prims (if any), and the downstream handoff notes that confirm `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` continue to surface complete coverage data

#### Scenario: Secondary GUID / Name extraction evidence is recorded

- **WHEN** the change exercises the optional secondary scope to reduce `guid_extraction` / `name_extraction` cost
- **THEN** evidence records before/after fine-grained timing for those operations and confirms that `ifc_guid` and `name` fields remain correct for all source entities
- **AND** evidence MUST NOT claim secondary scope success if any source IFC entity loses real GUID or Name fidelity

#### Scenario: Optimization evidence keeps baseline unlocked when incomplete

- **WHEN** the optimized run still times out, fails, or only produces partial evidence
- **THEN** runtime verification evidence records the exact phase and failure reason
- **AND** the canonical batch baseline remains unlocked with `minimum_coverage_locked=false`
