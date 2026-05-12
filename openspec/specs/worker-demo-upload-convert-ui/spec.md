# worker-demo-upload-convert-ui Specification

## Purpose
Define the `_worker` demo UI boundary for local artifact intake and conversion
steps. The UI supports IFC source selection, conversion job progress, artifact
group readiness, and handoff toward review session creation without replacing
the browser review viewer, session control plane, or review metadata editor.
## Requirements
### Requirement: Worker Demo UI Entry

`_worker` SHALL serve a demo UI on port `8005` at `GET /` and `GET /ui` for demo steps ① 上傳建模 and ② 自動轉換.

#### Scenario: Worker UI loads

- **WHEN** a user opens `http://127.0.0.1:8005/`
- **THEN** the worker demo UI SHALL render without requiring `_s3_storage` or `_conversion-service`

#### Scenario: Stepbar routes to worker

- **WHEN** any current demo stepbar renders steps ① or ②
- **THEN** those steps SHALL point to the worker demo UI instead of ports `8002` or `8003`

### Requirement: IFC Selection Experience

The worker demo UI SHALL show the available dev IFC sources from `GET /api/dev/ifc-sources` and allow exactly one source to be selected for conversion at a time.

#### Scenario: Sources are visible

- **WHEN** `GET /api/dev/ifc-sources` returns IFC source items
- **THEN** the UI SHALL display selectable rows or controls that identify each source by filename and relative path

#### Scenario: Empty source list is clear

- **WHEN** no IFC files are available
- **THEN** the UI SHALL show a friendly empty state and SHALL NOT show an enabled conversion action

### Requirement: Conversion Job Interaction

The worker demo UI SHALL trigger the selected-source conversion API and display job progress through worker status/result endpoints.

#### Scenario: User starts conversion

- **WHEN** the user selects an IFC source and activates the conversion action
- **THEN** the UI SHALL call `POST /api/dev/ifc-sources/{source_id}/conversions` and show the returned `conversion_job_id` and initial status

#### Scenario: Job status is polled

- **WHEN** a selected-source conversion job is running
- **THEN** the UI SHALL poll `GET /api/conversions/{conversion_job_id}` or `GET /api/conversions/{conversion_job_id}/result` until success, failure, or timeout

#### Scenario: Job succeeds

- **WHEN** the conversion job succeeds
- **THEN** the UI SHALL show artifact group readiness, the worker object URL for the converted model, and a next-step route toward review session creation

#### Scenario: Job fails

- **WHEN** the conversion job fails or times out
- **THEN** the UI SHALL show the failure state with enough service/status detail to diagnose the worker job without exposing absolute local file paths

### Requirement: Demo UI Boundary

The worker demo UI SHALL remain scoped to artifact intake and conversion, and SHALL NOT replace the browser review viewer or session control plane.

#### Scenario: Review workflow continues outside worker

- **WHEN** an artifact group becomes ready
- **THEN** the next user action SHALL route to `bim-review-coordinator` or the existing review viewer flow for session creation and streaming review

#### Scenario: No review metadata editing

- **WHEN** the worker demo UI renders
- **THEN** it MUST NOT provide issue editing, annotation editing, session lifecycle management, or WebRTC streaming controls

### Requirement: Worker UI visualizes lineage and quality status

The worker demo UI SHALL expose a lineage and conversion quality view for worker artifacts. The UI MUST use `_worker` APIs such as `GET /api/artifacts/{artifact_id}/lineage`, `GET /api/conversions/{conversion_job_id}/result`, and `GET /api/artifact-groups/{artifact_group_id}/readiness` rather than reading local files directly.

The view MUST remain scoped to artifact intake, conversion observability, lineage, and quality evidence. It MUST NOT provide review issue editing, annotation editing, session lifecycle management, or WebRTC streaming controls.

#### Scenario: User opens lineage for a converted artifact

- **WHEN** a conversion job succeeds and the user opens its lineage view
- **THEN** the UI displays source IFC, derived USDC, index artifacts, mapping artifact, stable artifact IDs, conversion job ID, artifact group ID, object URLs, metadata URL, and quality status

#### Scenario: Quality status is visible

- **WHEN** lineage API or conversion result returns quality metrics
- **THEN** the UI displays coverage ratio, `minimum_coverage_ratio`, baseline lock status, `coverage_denominator=source_ifc_entity_count`, mapped/unmapped IFC entity counts, coverage status, and warnings or diagnostics when present

#### Scenario: Warning quality remains reviewable

- **WHEN** the lineage API or conversion result reports `coverage_status=warn`
- **THEN** the UI keeps the review handoff available while clearly showing degraded mapping quality and MUST NOT label issue-to-real-prim readiness as verified

#### Scenario: Lineage is incomplete

- **WHEN** the lineage API reports missing mapping, missing derived artifact, legacy metadata gaps, or unavailable quality metrics
- **THEN** the UI displays the incomplete state without hiding the source artifact or exposing absolute local filesystem paths

#### Scenario: Review workflow remains outside worker UI

- **WHEN** an artifact group is ready and lineage is visible in the worker UI
- **THEN** the next review action still routes to `bim-review-coordinator` or the existing review viewer flow, and the worker UI does not manage review sessions
