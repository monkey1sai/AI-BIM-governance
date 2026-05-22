# session-first-review-viewer Specification

## Purpose
Define the session-first browser review experience for `web-viewer-sample`.
The viewer bootstraps from review request/session state, respects lifecycle
transitions, sends USD runtime commands through the Kit DataChannel, sends
collaboration events through coordinator contracts, and exposes multi-artifact
review controls without becoming a data authority or GPU runtime manager.
## Requirements
### Requirement: Viewer bootstraps from review request or session

`web-viewer-sample` SHALL bootstrap from the coordinator review session and SHALL treat `stream_config.stage_composition.primary.url` (or `stream_config.model.url` when no primary composition exists) as the expected stage URL for the session. The viewer MUST accept the coordinator handoff query key `session` and legacy `sessionId`, and MUST NOT create a new default session when a valid `session` query value is present.

#### Scenario: Coordinator handoff uses session query key

- **WHEN** a browser opens `http://127.0.0.1:5173/?session=<review_session_id>`
- **THEN** the viewer loads that coordinator session
- **AND** it MUST NOT ignore the query key and auto-create an unrelated session

#### Scenario: Expected stage URL is derived from stream config

- **WHEN** stream config returns a ready model and stage composition primary binding
- **THEN** the viewer records the expected stage URL from the primary binding
- **AND** `openStageRequest` targets that URL
- **AND** the viewer displays the expected conversion job and model URL for operator inspection

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

`web-viewer-sample` SHALL handle WebRTC stream lifecycle transitions explicitly. AppStreamer `onStop`, `onTerminate`, and stream failure callbacks MUST update visible state and provide a controlled reconnect or remount path instead of only logging to the console.

#### Scenario: WebRTC stream disconnects

- **WHEN** AppStreamer stops or terminates after a stream was visible
- **THEN** the viewer displays `webrtc_disconnected` with the last known video diagnostics and Kit endpoint
- **AND** it offers a reconnect/remount action or records that a Kit runtime restart is required

#### Scenario: Reload does not require killing Chrome

- **WHEN** the user reloads the viewer after a disconnect
- **THEN** the viewer attempts to create a clean WebRTC client lifecycle for the same session
- **AND** if reconnect cannot succeed because Kit remains busy or disconnected, the viewer shows a deterministic blocker instead of silently hanging

### Requirement: Viewer displays streaming-owned conversion and composition status

`web-viewer-sample` SHALL display streaming-owned conversion and composition status, and SHALL classify the viewer as ready only when Kit stage-load evidence matches the current session's expected stage URL. Metadata display alone is not sufficient.

#### Scenario: Kit loaded URL matches expected conversion artifact

- **WHEN** the viewer receives `openedStageResult` or `loadingStateResponse` from Kit after sending `openStageRequest`
- **THEN** it compares the Kit-reported URL with the expected stage URL
- **AND** it marks the viewer stage as ready only when the URL matches or when Kit echoes an accepted cached-path representation tied to the same requested URL

#### Scenario: Kit reports stale demo stage

- **WHEN** Kit reports a loaded stage URL such as `bim-models/許良宇圖書館建築_2026.usdc` while the expected stage URL is the current conversion job artifact
- **THEN** the viewer displays a `stale_stage_or_mismatch` blocker
- **AND** it MUST NOT claim that the current IFC-ready job has been visually loaded

#### Scenario: Stage load is not proven

- **WHEN** the viewer displays a ready conversion URL but no matching DataChannel or loading-state evidence has been observed
- **THEN** it displays a pending or unproven stage-load state
- **AND** Chrome E2E evidence MUST classify single-Kit render as non-passed

