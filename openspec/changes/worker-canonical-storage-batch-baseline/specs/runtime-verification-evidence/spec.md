## MODIFIED Requirements

### Requirement: Batch storage IFC evidence calibrates mapping baseline

Runtime verification evidence SHALL include a batch conversion evidence tier for repo-local `storage/*.ifc` fixtures before declaring the mapping coverage baseline locked. The evidence MUST identify the fixture glob, resolved root, fixture count, per-fixture conversion job IDs, per-fixture artifact group IDs, USDC openability, source IFC entity count, mapped/unmapped entity counts, coverage ratio, `minimum_coverage_ratio=1.0`, coverage status, lineage API status, and whether all required fixtures passed.

The standard local Windows fixture glob is `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`. In worktrees and CI-like local runs, the same requirement MAY resolve through `_worker` `dev_storage_root` as repo-local `storage/*.ifc`, but the evidence MUST record the resolved path or approved exception.

Canonical baseline evidence MUST include per-fixture duration, phase timings when available, converter identity, output file size, warnings, and failure diagnostics. The evidence MUST classify the overall batch as `blocked`, `partial`, `timed_out`, `failed`, or `passed`. Dry-runs, subset runs, timeout runs, and any run with failed fixture-level quality checks MUST NOT mark `minimum_coverage_locked=true`.

Before running the full 13-file canonical batch, evidence MUST first include a completed real `--limit 1` run against the canonical fixture root. If that single-fixture run times out or fails, the evidence MUST record the bottleneck diagnostics and keep the production mapping baseline unlocked.

#### Scenario: Full storage fixture batch passes

- **WHEN** all required `storage/*.ifc` fixtures complete real IFC->USDC conversion with openable USDC, truthful mapping output, lineage API success, and every source IFC entity mapped to at least one real USD prim path
- **THEN** the evidence records `minimum_coverage_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, per-fixture metrics, and the batch status as `passed`

#### Scenario: Storage fixture batch is incomplete

- **WHEN** the fixture root is unavailable, contains no IFC files, or only a subset was intentionally run
- **THEN** the evidence records `blocked` or `partial` with the missing prerequisite or subset reason and MUST NOT mark the production mapping baseline as locked

#### Scenario: One fixture fails baseline

- **WHEN** any required fixture fails conversion, USDC openability, truthful mapping checks, lineage API lookup, or locked coverage threshold
- **THEN** the batch evidence records the failed fixture and reason, and the overall batch status is not `passed`

#### Scenario: Canonical single-fixture run times out

- **WHEN** the required `--limit 1` canonical storage run exceeds its configured timeout before completion
- **THEN** the evidence records `timed_out`, the configured timeout, elapsed duration, last known phase diagnostics, and MUST NOT classify the canonical batch baseline as passed or locked

#### Scenario: Canonical batch evidence records phase timings

- **WHEN** canonical storage batch evidence is produced for a real conversion run
- **THEN** the evidence records per-fixture phase timings for the available conversion phases and identifies any missing phase timing as unavailable or not reached
