## ADDED Requirements

### Requirement: Demo observation evidence classifies every current capability tier

Runtime verification evidence SHALL include a current demo observation report that classifies every current demo tier as `passed`, `failed`, `blocked`, `deferred`, or `not_observed`. The report MUST include the command or observation method, timestamp, service endpoints, runtime prerequisites, and identifiers required to replay or compare the result.

#### Scenario: Current demo observation report is recorded

- **WHEN** a demo observation pass is executed
- **THEN** the evidence records statuses for service health, API smoke, focused tests/builds, worker conversion/artifact readiness, review session lifecycle, Socket.IO collaboration, browser E2E, Kit/WebRTC runtime, and dedicated multi-Kit capacity
- **AND** each status includes commands or observation steps, result summary, timestamp, and relevant IDs such as `conversion_job_id`, `artifact_group_id`, `review_request_id`, or `session_id` when available

#### Scenario: Hardware or capacity prerequisite is missing

- **WHEN** Kit, GPU, browser automation, stream ports, renderable artifacts, or multiple Kit endpoints are unavailable
- **THEN** the affected tier is recorded as `blocked` or `deferred` with the missing prerequisite and next runnable step
- **AND** the evidence MUST NOT classify that tier as `passed`

#### Scenario: A tier is not rerun

- **WHEN** a tier is intentionally skipped or only historical evidence exists
- **THEN** the current report records the tier as `not_observed` or references the historical evidence separately without treating it as a current pass

### Requirement: Demo observation evidence preserves service ownership boundaries

Runtime verification evidence SHALL attribute each observed result to the service or folder that owns that responsibility. Evidence MUST NOT use success in one boundary to claim success in another boundary.

#### Scenario: Worker evidence is recorded

- **WHEN** `_worker` accepts source artifacts, creates conversion jobs, exposes derived artifacts, or reports artifact group readiness
- **THEN** the evidence records `_worker` artifact/conversion status separately from review session, browser, and Kit runtime status

#### Scenario: Review session evidence is recorded

- **WHEN** `_bim-control` stores review intent and `bim-review-coordinator` creates or manages a session
- **THEN** the evidence records metadata authority, session lifecycle, collaboration events, and close/release behavior without claiming USD stage render success

#### Scenario: Browser and Kit evidence is recorded

- **WHEN** `web-viewer-sample` connects to `bim-streaming-server`
- **THEN** the evidence records browser readiness, WebRTC/DataChannel status, non-zero video dimensions, `openedStageResult` or equivalent runtime response, and screenshot or blocker evidence separately from API-only smoke results

### Requirement: Demo observation evidence archives replayable artifacts

Runtime verification evidence SHALL store current demo observation results in repo-local verification documentation and archive generated screenshots or machine-readable summaries when available.

#### Scenario: Browser evidence is captured

- **WHEN** browser or Kit runtime observation produces visual or machine-readable proof
- **THEN** the report references repo-local evidence paths, browser URL, capture time, stream endpoint, video dimensions, and related session or artifact IDs

#### Scenario: Observation produces no visual artifact

- **WHEN** a tier cannot produce a screenshot or machine-readable summary because a prerequisite is missing
- **THEN** the report records the blocker and the missing artifact explicitly instead of leaving the evidence path blank or ambiguous
