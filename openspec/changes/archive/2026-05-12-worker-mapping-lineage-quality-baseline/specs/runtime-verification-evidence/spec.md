## ADDED Requirements

### Requirement: Batch storage IFC evidence calibrates mapping baseline

Runtime verification evidence SHALL include a batch conversion evidence tier for repo-local `storage/*.ifc` fixtures before declaring the mapping coverage baseline locked. The evidence MUST identify the fixture glob, resolved root, fixture count, per-fixture conversion job IDs, per-fixture artifact group IDs, USDC openability, source IFC entity count, mapped/unmapped entity counts, coverage ratio, `minimum_coverage_ratio=1.0`, coverage status, lineage API status, and whether all required fixtures passed.

The standard local Windows fixture glob is `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`. In worktrees and CI-like local runs, the same requirement MAY resolve through `_worker` `dev_storage_root` as repo-local `storage/*.ifc`, but the evidence MUST record the resolved path or approved exception.

#### Scenario: Full storage fixture batch passes

- **WHEN** all required `storage/*.ifc` fixtures complete real IFC->USDC conversion with openable USDC, truthful mapping output, lineage API success, and every source IFC entity mapped to at least one real USD prim path
- **THEN** the evidence records `minimum_coverage_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, per-fixture metrics, and the batch status as `passed`

#### Scenario: Storage fixture batch is incomplete

- **WHEN** the fixture root is unavailable, contains no IFC files, or only a subset was intentionally run
- **THEN** the evidence records `blocked` or `partial` with the missing prerequisite or subset reason and MUST NOT mark the production mapping baseline as locked

#### Scenario: One fixture fails baseline

- **WHEN** any required fixture fails conversion, USDC openability, truthful mapping checks, lineage API lookup, or locked coverage threshold
- **THEN** the batch evidence records the failed fixture and reason, and the overall batch status is not `passed`

### Requirement: Issue-to-real-prim evidence requires locked real mapping

Runtime verification evidence SHALL only classify issue-to-real-prim highlight baseline as verified when the worker mapping is real, coverage baseline is locked, and the highlighted prim path can be traced from an issue's IFC GUID through `element_mapping.json` to `primary_usd_prim_path` or `usd_prim_paths`.

#### Scenario: Issue highlight uses real mapping

- **WHEN** a reviewer or smoke test highlights an issue whose IFC GUID appears in real mapping output with a valid primary USD prim path
- **THEN** the evidence records the issue identifier, IFC GUID, mapped USD prim path, conversion job ID, artifact group ID, and `minimum_coverage_locked=true`

#### Scenario: Issue highlight uses fallback or missing mapping

- **WHEN** the highlighted issue path comes from fallback IDs, synthetic IDs, missing mapping, or an unlocked coverage baseline
- **THEN** the evidence MUST NOT classify issue-to-real-prim baseline as verified, even if the browser or Kit interaction itself succeeds

## MODIFIED Requirements

### Requirement: Real conversion evidence records quality metrics

The workspace SHALL record real conversion quality metrics before treating a conversion as accepted evidence. Metrics MUST include fixture identity, fixture size, converter identity, duration, USDC openability, source IFC entity count, USD prim count, mapped entity count, unmapped entity count, coverage ratio, coverage status, lineage API status, and whether a minimum coverage baseline is locked.

Evidence before threshold lock MUST use a measure-first policy: coverage report is required, but low coverage alone MUST NOT fail CI until the baseline threshold is established. Evidence after threshold lock MUST record `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, denominator policy for all source IFC entities, pass/warn/fail policy, and whether the current conversion satisfies issue-to-real-prim readiness.

#### Scenario: Large IFC fixture is converted

- **WHEN** a repo-local IFC fixture is converted by the real conversion path
- **THEN** the evidence records fixture path or identifier, file size, converter identity, duration, resulting artifact URLs, USDC openability, lineage API result, and mapping coverage metrics

#### Scenario: Mapping coverage is measured before threshold lock

- **WHEN** the real conversion path produces a coverage report before a minimum threshold is locked
- **THEN** the evidence records the observed coverage, keeps CI passing if the hard conversion checks passed, and does not classify minimum issue-to-real-prim coverage as verified

#### Scenario: Mapping coverage is evaluated after threshold lock

- **WHEN** the real conversion path produces a coverage report after a minimum threshold is locked
- **THEN** the evidence records `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status`, policy diagnostics, and whether the conversion is accepted, warned, or failed by the locked baseline

#### Scenario: Non-geometric entity coverage is recorded

- **WHEN** a fixture contains non-geometric IFC entities such as property sets, type objects, relationship entities, project, site, building, or storey containers
- **THEN** the evidence records whether those entities materialized as non-renderable USD prims and includes them in mapped/unmapped entity counts

#### Scenario: Warning coverage remains reviewable

- **WHEN** real conversion evidence records `coverage_status=warn`
- **THEN** the evidence may classify the artifact group as reviewable with degraded mapping quality, but MUST NOT classify issue-to-real-prim baseline as verified

#### Scenario: Lineage API is missing from conversion evidence

- **WHEN** real conversion succeeds but the lineage API cannot return the source -> derived -> mapping graph for the converted artifact
- **THEN** the evidence records conversion success separately and MUST NOT claim lineage visualization or traceability baseline passed
