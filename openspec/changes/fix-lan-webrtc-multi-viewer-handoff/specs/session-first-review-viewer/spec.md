## MODIFIED Requirements

### Requirement: Viewer bootstraps from review request or session

`web-viewer-sample` SHALL bootstrap from the coordinator review session and SHALL
treat `stream_config.stage_composition.primary.url` (or
`stream_config.model.url` when no primary composition exists) as the expected
stage URL for the session. The viewer MUST accept the coordinator handoff query
key `session` and legacy `sessionId`, and MUST NOT create a new default session
when a valid `session` query value is present. The viewer MUST NOT render the
`USDAsset` picker or `USDStage` tree by default; these debug surfaces SHALL be
gated behind the `?debug=1` query parameter.

When the coordinator handoff includes `coordinatorApiBase` and `coordinatorSocketUrl`, the viewer SHALL use those browser-visible endpoints before falling back to Vite environment variables or localhost defaults. A remote client opening a coordinator-provided viewer URL MUST NOT silently call its own `127.0.0.1:8004` for session or socket state.

#### Scenario: Coordinator handoff uses session query key

- **WHEN** a browser opens `http://<viewer-host>:5173/?session=<review_session_id>`
- **THEN** the viewer loads that coordinator session
- **AND** it MUST NOT ignore the query key and auto-create an unrelated session

#### Scenario: Handoff endpoint overrides localhost defaults

- **WHEN** a browser opens a coordinator-generated viewer URL with `coordinatorApiBase=http://192.168.10.105:8004` and `coordinatorSocketUrl=http://192.168.10.105:8004`
- **THEN** the viewer uses those endpoints for REST and Socket.IO calls
- **AND** it MUST NOT fall back to `http://127.0.0.1:8004` for that session

#### Scenario: Expected stage URL is derived from stream config

- **WHEN** stream config returns a ready model and stage composition primary
  binding
- **THEN** the viewer records the expected stage URL from the primary binding
- **AND** `openStageRequest` targets that URL
- **AND** the viewer displays the expected conversion job and model URL for
  operator inspection

#### Scenario: USDAsset picker is hidden without ?debug=1

- **WHEN** viewer 載入 `?session=<id>` 但沒有 `?debug=1`
- **THEN** USDAsset 下拉 / USDStage tree / DataChannel log 等 debug 區段
  SHALL NOT 渲染進主畫面 DOM
- **AND** Inspector 第四層「技術細節」標籤 SHALL 顯示「`?debug=1` 啟用以查看」

#### Scenario: USDAsset picker is visible with ?debug=1

- **WHEN** viewer 載入 `?session=<id>&debug=1`
- **THEN** Inspector 第四層「技術細節」SHALL 展開
- **AND** USDAsset 下拉 / USDStage tree / DataChannel log 等 debug 區段 SHALL
  渲染進主畫面 DOM(操作 legacy asset 仍視為 debug,與 session expected stage
  mismatch 時顯示警示)
