## ADDED Requirements

### Requirement: Coordinator records first_frame_at as backend evidence

The coordinator SHALL expose `POST /api/review-sessions/:sessionId/first-frame` that records a coordinator-authoritative `first_frame_at` timestamp on the review session and appends a `firstFrameObserved` operational milestone to the event log. The endpoint SHALL be idempotent (a second call for a session that already has `first_frame_at` returns the existing timestamp without appending a duplicate milestone), SHALL reject a malformed session id with 400, an unknown session with 404, and a non-mutable session with 409, and SHALL NOT append an orphan milestone event when the underlying session store update fails. `first_frame_at` SHALL be surfaced on the runtime status session summary so downstream readiness derivation reads the real value rather than a hardcoded `"not_observed"`.

#### Scenario: First frame is recorded on first POST

- **WHEN** a client POSTs to `/api/review-sessions/<id>/first-frame` for a mutable session that has no `first_frame_at`
- **THEN** the coordinator records `first_frame_at` on the session
- **AND** appends one `firstFrameObserved` milestone to the event log
- **AND** the runtime status session summary exposes that `first_frame_at`

#### Scenario: Second POST is idempotent

- **WHEN** a client POSTs to the first-frame endpoint for a session that already has `first_frame_at`
- **THEN** the coordinator returns the existing `first_frame_at`
- **AND** it MUST NOT append a second `firstFrameObserved` milestone

#### Scenario: Invalid or non-mutable session is rejected

- **WHEN** a client POSTs a malformed session id, an unknown session id, or a non-mutable session id
- **THEN** the coordinator responds 400, 404, or 409 respectively
- **AND** it MUST NOT append a `firstFrameObserved` milestone for the rejected request

### Requirement: Console embeds the live viewer through a versioned postMessage bridge

The unified console SHALL embed the existing `web-viewer-sample` viewer in an iframe (reusing the live streaming stack, not building a separate console-side WebRTC connection) and SHALL communicate with it through a versioned `protocol: "vg01"` postMessage bridge. Outbound messages from the console SHALL target an explicit viewer origin and MUST NOT use `"*"` as the target origin. Inbound messages received by either side SHALL be accepted only when the message origin is in the coordinator/viewer allowlist, the `event.source` matches the expected window, and the protocol version matches; messages failing any check SHALL be ignored.

#### Scenario: Console sends highlight with explicit target origin

- **WHEN** the console sends a `vg01` highlight command to the embedded viewer
- **THEN** the postMessage target origin is the resolved viewer origin
- **AND** it MUST NOT be `"*"`

#### Scenario: Cross-origin or wrong-protocol message is ignored

- **WHEN** a message arrives whose origin is not in the allowlist, whose `event.source` does not match, or whose protocol is not `vg01`
- **THEN** the receiver ignores the message
- **AND** it MUST NOT act on the payload

### Requirement: Viewer posts lifecycle events and gates mutating commands by operability

The viewer `Window` SHALL post `viewer_ready`, `first_frame`, `stage_loaded`, and `selected_guid` events to the parent window, sending `first_frame` exactly once per stage at the real stage-completion point (not on a failure or disconnect path). The viewer SHALL accept parent `highlight`, `focus`, and `clear` commands only when the session is operable (`canOperate`); a spectator or non-operable context SHALL silently discard mutating commands. The viewer SHALL cross-validate `document.referrer` against the coordinator origin allowlist before honoring parent commands.

#### Scenario: First frame is posted once at stage completion

- **WHEN** the viewer reaches the real stage-completion point for a session
- **THEN** it posts a single `first_frame` message to the parent
- **AND** it MUST NOT post `first_frame` again for the same stage or on a failure/disconnect path

#### Scenario: Mutating command is discarded when not operable

- **WHEN** a parent `highlight`, `focus`, or `clear` command arrives in a non-operable (e.g. spectator) context
- **THEN** the viewer silently discards the command
- **AND** it MUST NOT mutate the rendered overlay

### Requirement: A1 workbench enables 3D highlight only when first-frame and stage-match evidence are real

The A1 governance workbench SHALL embed the live viewer (gated render keyed by session) and SHALL enable the "在 3D 高亮" (3D highlight) action only when all IX-A1-06 conditions are met: a real first frame has been observed, the loaded stage matches the session expected stage, the rule run has failed elements, and those elements are mapped. Before first frame, the button SHALL be disabled with an honest "等待 3D 第一幀" state; unmapped results SHALL be honestly refused rather than optimistically highlighted; a stage mismatch SHALL surface a warning. The `ViewerPresentationPage` first-frame evidence SHALL be derived from real runtime status instead of a hardcoded placeholder.

#### Scenario: Highlight button stays disabled before first frame

- **WHEN** the A1 page is mounted for a session whose viewer has not reported a first frame
- **THEN** the "在 3D 高亮" button is disabled
- **AND** it shows the "等待 3D 第一幀" state

#### Scenario: Highlight enabled only when all four conditions hold

- **WHEN** a real first frame is observed, the loaded stage matches the session expected stage, and the rule run has mapped failed elements
- **THEN** the "在 3D 高亮" button becomes enabled
- **AND** clicking it sends a `vg01` highlight command to the embedded viewer and reflects the `highlight_result`
