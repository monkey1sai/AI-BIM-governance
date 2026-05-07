# session-first-review-viewer Specification

## Purpose
TBD - created by archiving change introduce-worker-review-session-lifecycle. Update Purpose after archive.
## Requirements
### Requirement: Viewer bootstraps from review request or session

`web-viewer-sample` SHALL bootstrap the review page from a review request or review session identifier. It MUST query `_bim-control` or coordinator for session state and stream config instead of hard-coding BIM model paths or local static URLs.

#### Scenario: Viewer opens an active session

- **WHEN** a user opens a review page with an active `session_id`
- **THEN** the viewer retrieves session state, stream config, artifact bindings, and collaboration endpoint details

#### Scenario: Viewer opens a review request

- **WHEN** a user opens a review page with a `review_request_id`
- **THEN** the viewer resolves the bound session or shows the request lifecycle state

### Requirement: Viewer displays artifact and lifecycle state

The review page SHALL present the current artifact readiness, mapping readiness, session lifecycle, and Kit binding readiness needed for a reviewer to understand whether streaming and issue highlighting are available.

#### Scenario: Artifact is ready for review

- **WHEN** artifact and mapping bindings are ready
- **THEN** the viewer enables review interactions using the session stream config

#### Scenario: Artifact is blocked by conversion

- **WHEN** the review request has `status=blocked_conversion`
- **THEN** the viewer shows a blocked state and does not attempt a WebRTC connection

#### Scenario: Session is queued for GPU

- **WHEN** the review request or session has `status=queued_for_instance`
- **THEN** the viewer shows capacity waiting state and does not claim streaming is ready

### Requirement: Viewer separates runtime commands from collaboration events

`web-viewer-sample` SHALL send USD runtime commands such as `openStageRequest`, `highlightPrimsRequest`, `focusPrimRequest`, or optional `loadArtifactGroupRequest` through the DataChannel to the bound Kit instance. It SHALL send presence, selection, issue focus, and annotation collaboration through coordinator Socket.IO or REST contracts.

#### Scenario: Reviewer highlights an issue

- **WHEN** a reviewer selects an issue with mapped prim paths
- **THEN** the viewer sends a DataChannel highlight request to the bound Kit runtime and sends collaboration context through coordinator events

#### Scenario: Reviewer creates an annotation

- **WHEN** a reviewer creates an annotation
- **THEN** the viewer sends the collaboration event through coordinator so `_bim-control` can persist review metadata

### Requirement: Viewer supports multi-artifact review controls

The review page SHALL support selecting or inspecting artifact groups bound to the session. For multi-instance sessions, it MUST associate each artifact group with the appropriate stream or Kit binding before sending DataChannel commands.

#### Scenario: Reviewer loads an overlay artifact

- **WHEN** a reviewer enables an overlay artifact bound to the session
- **THEN** the viewer sends the load request to the Kit binding assigned to that artifact group

#### Scenario: Reviewer switches between artifact groups

- **WHEN** a reviewer focuses an artifact group assigned to another Kit instance
- **THEN** the viewer uses the corresponding stream config or clearly reports that the binding is not ready

### Requirement: Viewer handles lifecycle transitions safely

`web-viewer-sample` MUST respond to `created`, `active`, `closing`, `closed`, and `failed` lifecycle states without fabricating a ready stream. During `closing` or `closed`, it MUST stop new runtime commands that mutate the session.

#### Scenario: Session is closing

- **WHEN** the session lifecycle changes to `closing`
- **THEN** the viewer stops new join or mutating runtime actions and allows final state to be shown

#### Scenario: Session has failed

- **WHEN** the session lifecycle changes to `failed`
- **THEN** the viewer shows the error reference and does not retry destructive session creation automatically

