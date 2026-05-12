## MODIFIED Requirements

### Requirement: Worker supports storage IFC batch quality verification

`_worker` SHALL provide an implementation path for batch quality verification over repo-local `storage/*.ifc` fixtures. Windows canonical fixture glob `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 與 worktree-local `_worker` dev source root `../storage` SHALL be treated as the same fixture source class for local validation。

Batch verification path MUST use existing worker artifact intake and selected-source conversion contracts unless a later production batch-job spec is opened。每個 fixture result MUST record filename、relative path、size、source artifact ID、artifact group ID、conversion job ID、USDC openability、mapped count、unmapped count、coverage ratio、coverage status、lineage API status、duration when available，以及 failure / warning details。

Canonical baseline runs MUST also record per-fixture phase timings and timeout diagnostics。Phase timings MUST identify observable conversion phases needed to diagnose slow or stuck runs，包含 source read 或 artifact intake、conversion total duration、IFC open、source entity enumeration、geometry iteration、mesh authoring、non-renderable entity materialization、stage save、stage reopen、artifact publish 與 lineage lookup when available。若 timeout 或 failure 發生在 phase start 前，MUST report that phase as not reached or unavailable diagnostic，而不得靜默省略。

Batch summary status MUST distinguish `blocked`、`partial`、`timed_out`、`failed`、`passed`。`_worker` MUST NOT set `minimum_coverage_locked=true` unless the full required canonical fixture set completes real conversion and every fixture passes USDC openability、truthful mapping、lineage API lookup 與 locked all-IFC-entity coverage criteria。

Canonical batch implementation MUST run the canonical `--limit 1` single fixture first。Only after that single-fixture run either passes with complete conversion evidence or records a deterministic blocker may the helper attempt the full 13-file batch。When the single-fixture run passes，the result MUST expose stable artifact IDs and object URLs needed by the existing review viewer flow to load the produced `model.usdc`。

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

#### Scenario: Canonical single fixture gates full batch

- **WHEN** canonical batch verification is requested for the full fixture set before the canonical `--limit 1` run has produced either a passing result or deterministic blocker evidence
- **THEN** `_worker` MUST keep the batch evidence non-passed and require the single-fixture evidence first

#### Scenario: Canonical single fixture exposes preview handoff data

- **WHEN** the canonical `--limit 1` fixture completes real conversion with openable USDC and lineage
- **THEN** `_worker` exposes the `conversion_job_id`, `artifact_group_id`, source artifact ID, derived `model.usdc` artifact ID or URL, mapping artifact ID or URL, and readiness state needed by the existing review viewer flow

#### Scenario: Full canonical batch locks coverage

- **WHEN** all 13 canonical storage fixtures complete real conversion with openable USDC, truthful mapping output, successful lineage lookup, and `coverage_status=pass` under the locked all-IFC-entity denominator
- **THEN** `_worker` returns batch `status=passed` and may set `minimum_coverage_locked=true`
