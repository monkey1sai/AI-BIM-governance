## ADDED Requirements

### Requirement: Demo runtime smoke classifies prerequisites before claiming runtime success

The workspace SHALL provide a local demo runtime smoke/readiness path that
classifies each tier as `passed`, `failed`, `blocked`, `deferred`, or
`not_observed` before any verification report or task list claims demo runtime
success. The classification MUST include the responsible owner boundary and the
next rerunnable command or prerequisite when the tier is not passed.

#### Scenario: Missing dev IFC fixtures are blocked

- **WHEN** the smoke resolves `WORKER_DEV_STORAGE_ROOT` and finds no `.ifc` or `.IFC` files
- **THEN** the worker conversion tier is classified as `blocked`
- **AND** the evidence records the resolved root, fixture count, expected fixture source, and next setup command or action

#### Scenario: Invalid smoke fixture is rejected before success claims

- **WHEN** a smoke input cannot be parsed as an IFC model by the configured worker converter
- **THEN** the smoke records conversion `failed` or input `blocked` with the converter diagnostic
- **AND** it MUST NOT claim worker conversion readiness, review artifact readiness, Kit render success, or browser visual success

#### Scenario: Deferred multi-Kit capacity remains explicit

- **WHEN** fewer than two live GPU-backed Kit endpoints are available
- **THEN** dedicated multi-Kit runtime verification is classified as `deferred` or `blocked`
- **AND** the evidence MUST NOT classify dedicated runtime routing as `passed`

### Requirement: Demo runtime smoke separates service tiers

The demo runtime smoke SHALL report worker conversion readiness, review request
state, coordinator session lifecycle, Socket.IO collaboration, Kit WebRTC
readiness, and browser visual evidence as separate tiers. A pass in one tier
MUST NOT imply pass in another tier.

#### Scenario: Coordinator lifecycle passes while model is missing

- **WHEN** coordinator creates, returns, and closes a review session whose stream config reports `model.status=missing`
- **THEN** coordinator lifecycle MAY be classified as `passed`
- **AND** worker artifact readiness, Kit render readiness, and browser visual evidence remain non-passed unless their own evidence exists

#### Scenario: Socket collaboration passes independently

- **WHEN** Socket.IO join, presence, selection, annotation, or broadcast smoke succeeds
- **THEN** Socket.IO collaboration MAY be classified as `passed`
- **AND** the evidence MUST NOT treat Socket.IO success as proof of WebRTC video or DataChannel stage loading

#### Scenario: Worker conversion success records artifact identities

- **WHEN** worker conversion readiness is classified as `passed`
- **THEN** evidence records `source_artifact_id`, `artifact_group_id`, `conversion_job_id`, derived `model.usdc` URL or artifact ID, mapping URL or artifact ID, and readiness state

### Requirement: Kit and browser readiness evidence is explicit

The demo runtime smoke SHALL only classify Kit/WebRTC or browser visual tiers
as `passed` when a live Kit endpoint and browser evidence prove the behavior.
Missing launchers, closed ports, unavailable GPU runtime, or blocked browser
automation MUST remain explicit blockers.

#### Scenario: Missing Kit launcher is blocked

- **WHEN** `bim-streaming-server` preflight cannot find the expected built Kit launcher
- **THEN** Kit/WebRTC readiness is classified as `blocked`
- **AND** evidence records the missing launcher path and build or preflight command needed to retry

#### Scenario: WebRTC port is not listening

- **WHEN** the expected Kit signaling endpoint such as `127.0.0.1:49100` is not listening
- **THEN** single Kit WebRTC readiness is classified as `blocked`
- **AND** browser visual evidence MUST remain non-passed

#### Scenario: Browser visual pass requires viewport proof

- **WHEN** browser visual readiness is classified as `passed`
- **THEN** evidence records browser URL, `session_id` or `review_request_id`, Kit endpoint, video readiness, non-zero video dimensions, DataChannel stage-load result when available, and a screenshot path or equivalent visual proof

#### Scenario: Browser automation is blocked by policy

- **WHEN** browser automation cannot open the local viewer route because of tool or policy restrictions
- **THEN** browser visual readiness is classified as `blocked` or `not_observed`
- **AND** evidence records the blocked URL, policy/tool diagnostic, and acceptable manual evidence fields for rerun

### Requirement: Demo runtime smoke emits reviewable evidence artifacts

The demo runtime smoke SHALL emit or update structured evidence artifacts that
can be referenced from verification reports and roadmap updates. Evidence MUST
be sufficient for reviewers to distinguish current live observations from
historical context.

#### Scenario: Command summary is written

- **WHEN** the demo runtime smoke completes or stops on a blocker
- **THEN** it writes a command summary artifact that records command, working directory, status, important IDs, blocker classification, and evidence paths for each tier that ran

#### Scenario: Historical evidence is not promoted to current pass

- **WHEN** a runtime tier did not run in the current pass
- **THEN** the evidence may link historical context
- **AND** it MUST classify the current tier as `not_observed`, `blocked`, or `deferred` rather than `passed`

#### Scenario: Reports cite evidence artifacts

- **WHEN** a verification report or roadmap update summarizes demo runtime readiness
- **THEN** it references the current evidence artifact paths and preserves the tier statuses without merging them into one ambiguous end-to-end status
