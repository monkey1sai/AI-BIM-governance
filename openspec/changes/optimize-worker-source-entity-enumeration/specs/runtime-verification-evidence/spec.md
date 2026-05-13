## ADDED Requirements

### Requirement: Source entity enumeration optimization evidence

Runtime verification evidence MUST record the source entity enumeration burn-down before the canonical batch baseline can advance. Evidence MUST include the canonical fixture identity, command, timeout setting, baseline timing or timeout result, implemented optimization summary, post-change `source_entity_enumeration` timing, source IFC entity count, whether conversion advanced past enumeration, fallback usage, and the next gating phase or blocker.

If source entity enumeration remains unable to complete within the configured timeout, evidence MUST classify the result as `timed_out` or `blocked`, preserve `minimum_coverage_locked=false`, and identify whether the unresolved limitation appears to be `_worker`-owned or external to the worker converter logic.

Fine-grained source enumeration profiling evidence MAY be recorded for canonical burn-down runs. When enabled, it SHOULD distinguish model iteration, entity id extraction, IFC class extraction, GlobalId extraction, Name extraction, row append, and progress write counts so the evidence can separate IfcOpenShell/runtime costs from `_worker` identity-scan costs.

#### Scenario: Before and after timing recorded

- **WHEN** `_worker` changes source entity enumeration behavior for canonical fixtures
- **THEN** verification evidence records the pre-change timeout or baseline timing and the post-change timing for `source_entity_enumeration`
- **AND** the evidence references the exact canonical fixture path or source identity used

#### Scenario: Canonical single fixture advances past enumeration

- **WHEN** canonical `--limit 1 --timeout-seconds 600` is rerun after the optimization
- **THEN** evidence records whether conversion progressed beyond `source_entity_enumeration`
- **AND** if conversion succeeds, evidence records the resulting `conversion_job_id`, `artifact_group_id`, derived USDC artifact ID or URL, mapping artifact ID or URL, and readiness state

#### Scenario: Optimization evidence keeps baseline unlocked when incomplete

- **WHEN** the optimized run still times out, fails, or only produces partial evidence
- **THEN** runtime verification evidence records the exact phase and failure reason
- **AND** the canonical batch baseline remains unlocked with `minimum_coverage_locked=false`
