# session-first-review-viewer — Spec Delta (fix-ifc-usdc-hoops-load-failure)

> Delta against `openspec/specs/session-first-review-viewer/spec.md`。本 change 補強 session-first viewer 的 stage-load truth gate 與 WebRTC disconnect 可觀測性，避免 viewer metadata 指到新 artifact 但 Kit 實際仍顯示舊 stage。

## MODIFIED Requirements

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

