## MODIFIED Requirements

### Requirement: Worker supports storage IFC batch quality verification

`_worker` SHALL provide an implementation path for batch quality verification over repo-local `storage/*.ifc` fixtures. The Windows local fixture glob `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` and the worktree-local `_worker` dev source root `../storage` SHALL be treated as the same fixture source class for local validation.

The batch verification path MUST use existing worker artifact intake and selected-source conversion contracts unless a later production batch-job spec is opened. Each fixture result MUST record filename, relative path, size, source artifact ID, artifact group ID, conversion job ID, USDC openability, mapped count, unmapped count, coverage ratio, coverage status, lineage API status, duration when available, and failure or warning details.

For canonical baseline runs, `_worker` MUST also record per-fixture phase timings and timeout diagnostics. Phase timings MUST identify the observable conversion phases needed to diagnose slow or stuck runs, including source read or artifact intake, conversion total duration, IFC open, source entity enumeration, geometry iteration, mesh authoring, non-renderable entity materialization, stage save, stage reopen, artifact publish, and lineage lookup when those phases are available. A timeout or failure before a phase starts MUST be reported as a diagnostic rather than omitted silently.

Batch summary status MUST distinguish `blocked`, `partial`, `timed_out`, `failed`, and `passed`. `_worker` MUST NOT set `minimum_coverage_locked=true` unless the full required canonical fixture set completes real conversion and every fixture passes USDC openability, truthful mapping, lineage API lookup, and locked all-IFC-entity coverage criteria.

#### Scenario: Storage IFC fixtures are converted in batch

- **WHEN** batch verification runs against a readable `storage/*.ifc` fixture set
- **THEN** `_worker` creates distinct source artifacts and conversion jobs for each fixture through the worker artifact pipeline
- **AND** the batch summary records per-fixture conversion quality and lineage API status

#### Scenario: Storage fixture root is unavailable

- **WHEN** the configured dev storage root is missing, unreadable, or contains no `.ifc` files
- **THEN** batch verification reports `blocked` with the missing fixture prerequisite and MUST NOT claim that the coverage baseline is locked

#### Scenario: Batch fixture has duplicate bytes

- **WHEN** two fixture files have identical bytes but different filenames or relative paths
- **THEN** `_worker` MUST preserve each fixture's `original_filename`, source artifact ID, conversion job ID, and lineage independently

#### Scenario: Canonical fixture run records phase timings

- **WHEN** batch verification runs a real canonical storage fixture
- **THEN** the fixture result records total duration and available phase timings for source intake, conversion, IFC parsing, source entity enumeration, geometry processing, USD authoring, stage validation, artifact publishing, and lineage lookup

#### Scenario: Canonical fixture times out

- **WHEN** any canonical storage fixture exceeds the configured per-fixture timeout before producing a completed conversion result
- **THEN** `_worker` records `status=timed_out`, includes the timeout duration and last known phase diagnostics, and MUST NOT mark the batch status as `passed`

#### Scenario: Full canonical batch locks coverage

- **WHEN** all 13 canonical storage fixtures complete real conversion with openable USDC, truthful mapping output, successful lineage lookup, and `coverage_status=pass` under the locked all-IFC-entity denominator
- **THEN** `_worker` returns batch `status=passed` and may set `minimum_coverage_locked=true`
