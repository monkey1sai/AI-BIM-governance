# worker-demo-upload-convert-ui Specification

## Purpose
TBD - created by archiving change add-dev-ifc-source-selection-flow. Update Purpose after archive.
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
