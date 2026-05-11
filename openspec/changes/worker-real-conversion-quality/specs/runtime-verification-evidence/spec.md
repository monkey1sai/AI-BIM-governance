## ADDED Requirements

### Requirement: Real conversion evidence distinguishes API success from geometry success

Runtime verification evidence SHALL distinguish `_worker` API flow success from real IFC geometry conversion success. Evidence MUST NOT claim single Kit render readiness when the source artifact was converted by a placeholder path.

#### Scenario: API-only conversion smoke passes

- **WHEN** `_worker` accepts an IFC, creates a conversion job, and returns conversion result metadata
- **THEN** the evidence records API success separately and does not claim real geometry or Kit viewport success unless the derived USDC passed real conversion validation

#### Scenario: Placeholder output is detected

- **WHEN** `model.usdc` contains placeholder text, fake geometry, or a mock mapping marker
- **THEN** the verification report classifies the run as blocked for real render evidence and records the placeholder source

### Requirement: Real conversion evidence records quality metrics

The workspace SHALL record real conversion quality metrics before treating a conversion as accepted evidence. Metrics MUST include fixture identity, fixture size, converter identity, duration, USDC openability, source IFC element count, USD prim count, mapped count, unmapped count, coverage ratio, and whether a minimum coverage baseline is locked. P0 evidence MUST use a measure-first policy: coverage report is required, but low coverage alone MUST NOT fail CI until a later baseline threshold is established.

#### Scenario: Large IFC fixture is converted

- **WHEN** a repo-local IFC fixture is converted by the real conversion path
- **THEN** the evidence records fixture path or identifier, file size, converter identity, duration, resulting artifact URLs, USDC openability, and mapping coverage metrics

#### Scenario: Mapping coverage is measured before threshold lock

- **WHEN** the real conversion path produces a coverage report before a minimum threshold is locked
- **THEN** the evidence records the observed coverage, keeps CI passing if the hard conversion checks passed, and does not classify minimum issue-to-real-prim coverage as verified

### Requirement: Single Kit render evidence uses real worker artifacts

Single Kit render evidence SHALL use `_worker` real conversion artifacts when validating the review-session path from IFC source to browser viewport. The evidence MUST include the conversion job ID and artifact group ID so the rendered stage can be traced back to the source IFC.

#### Scenario: Real worker artifact renders in browser

- **WHEN** a valid IFC is converted through `_worker`, routed through `bim-review-coordinator`, loaded by `bim-streaming-server`, and displayed in `web-viewer-sample`
- **THEN** the evidence records the source IFC identity, `conversion_job_id`, `artifact_group_id`, `model.usdc` URL, mapping URL, `openedStageResult`, non-zero video dimensions, and a viewport screenshot or equivalent visual proof

#### Scenario: Kit or GPU prerequisite is unavailable

- **WHEN** real conversion succeeds but Kit/GPU/browser verification cannot run in the current environment
- **THEN** the evidence records conversion success and marks single Kit render evidence as `blocked` with the missing runtime prerequisite
