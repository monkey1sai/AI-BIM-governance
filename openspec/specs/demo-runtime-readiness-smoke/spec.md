# demo-runtime-readiness-smoke Specification

## Purpose
Define a deterministic local demo runtime smoke/readiness contract that
classifies every prerequisite tier (worker conversion, review request,
coordinator session lifecycle, Socket.IO collaboration, Kit/WebRTC, browser
visual evidence, single-Kit render) before any verification report or task
list claims demo runtime success. The contract standardizes blocker
classification, owner boundaries, rerunnable commands, and evidence artifacts
so missing IFC fixtures, invalid smoke inputs, missing Kit launchers, blocked
browser automation, and deferred multi-Kit capacity surface as actionable
prerequisites rather than ambiguous demo failures.

## Requirements
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

### Requirement: Single-Kit demo runtime renders the optimized USDC and captures viewport proof

The demo runtime smoke SHALL drive a single-Kit happy-path that renders the
`model.usdc` produced by the completed
`optimize-worker-non-renderable-materialization` change in
`web-viewer-sample`. Kit MUST be launched with `-SkipAutoLoad`; the viewer
MUST issue `openStageRequest` via DataChannel using
`stream_config.model.url`. When the happy-path succeeds, a
`single_kit_render` evidence tier MUST be classified as `passed` with
viewport proof. Multi-Kit dedicated routing remains out of scope and MUST
NOT be claimed as `passed` by this tier.

#### Scenario: Kit launches in skip-auto-load and viewer drives stage load

- **WHEN** the single-Kit demo runtime starts and the viewer joins the review session
- **THEN** Kit is launched with `-SkipAutoLoad` and the viewer issues `openStageRequest` carrying `stream_config.model.url`
- **AND** Kit MUST NOT receive worker `model.usdc` URLs through `-UsdPath` or any other launch argument

#### Scenario: Single-Kit viewport proof is captured

- **WHEN** `single_kit_render` is classified as `passed`
- **THEN** evidence records the viewer URL, `session_id` or `review_request_id`, Kit endpoint, video width and height as non-zero values, DataChannel stage-load result, and a screenshot path (manual or automated)
- **AND** the screenshot MUST correspond to the canonical optimized `model.usdc` from the active worker conversion job

#### Scenario: Missing prerequisites keep single-Kit render blocked

- **WHEN** the Kit launcher is missing, the signaling port is not listening, GPU preflight fails, or the worker has no successful `model.usdc` available for the canonical fixture
- **THEN** `single_kit_render` is classified as `blocked` with the missing prerequisite, the resolved next command, and (when applicable) the missing artifact identity
- **AND** the tier MUST NOT be classified as `passed`

#### Scenario: Multi-Kit dedicated routing stays deferred

- **WHEN** only one GPU-backed Kit endpoint exists in the workspace
- **THEN** dedicated multi-Kit routing remains classified as `deferred`
- **AND** `stream_config.kit_instance_bindings` contains at most one binding, and a `single_kit_render=passed` evidence record MUST NOT be promoted to dedicated multi-Kit success

### Requirement: Web viewer surfaces a conversion summary card sourced from existing endpoints

The `web-viewer-sample` SHALL display a conversion summary card whenever
`stream_config.model.status == "ready"` and a successful conversion result
is available. The card MUST source data from existing coordinator or worker
endpoints only and MUST NOT cache, recompute, or persist quality metrics in
the viewer.

#### Scenario: Card renders when stream_config carries a ready model

- **WHEN** `stream_config.model.status == "ready"` and the coordinator forwards `quality_metrics_summary`
- **THEN** the viewer card displays fixture identity, `source_ifc_entity_count`, `sidecar_carrier_count`, `materialization_strategy`, `coverage_ratio`, `coverage_status`, and `conversion_duration_seconds`
- **AND** the displayed values match the corresponding fields in `GET /api/conversions/{conversion_job_id}/result`

#### Scenario: Card shows degraded state when conversion is not ready

- **WHEN** `stream_config.model.status` is not `"ready"`, or no successful conversion result exists for the active session
- **THEN** the viewer card displays a degraded state with the current `model.status`, the blocker classification surfaced from smoke evidence (when available), and the next rerunnable command or prerequisite
- **AND** the card MUST NOT display stale or fabricated quality values

#### Scenario: Card uses dev-only fallback fetch when coordinator did not forward summary

- **WHEN** the coordinator did not forward `quality_metrics_summary` and the viewer is running in dev mode (for example `import.meta.env.DEV` is true)
- **THEN** the viewer MAY fetch `GET /api/conversions/{conversion_job_id}/result` from `_worker` for read-only display
- **AND** in production builds, the fallback MUST be unreachable and the card MUST render the degraded state from the previous scenario
- **AND** the viewer MUST NOT write back, transform, or rebroadcast the fetched values
