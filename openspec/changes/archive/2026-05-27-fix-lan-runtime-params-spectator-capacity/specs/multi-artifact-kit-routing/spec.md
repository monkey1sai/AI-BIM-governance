## MODIFIED Requirements

### Requirement: Single-Kit multi-viewer sharing is distinguished from dedicated multi-Kit routing

A single Kit process with multiple viewers sharing one review session SHALL be tracked separately from dedicated multi-Kit routing. For this pass, `single_kit_multi_viewer` MAY only be proven by two or more browser clients using the same `review_session_id` while the primary viewer and spectator viewer(s) use distinct WebRTC transport endpoints exposed by the same Kit process.

Dedicated multi-Kit routing SHALL remain a separate capacity tier requiring separate Kit process or endpoint pool evidence. Passing same-session multi-viewer evidence MUST NOT mark dedicated multi-Kit routing as passed.

#### Scenario: Single Kit multiple viewers use primary and spectator endpoints

- **WHEN** two viewers join the same review session through one Kit process
- **THEN** the primary viewer MUST use the primary Kit endpoint
- **AND** spectator viewer(s) MUST use generated or explicitly configured spectator endpoint(s)
- **AND** evidence may classify `single_kit_multi_viewer` as passed only when the endpoints are distinct
- **AND** it MUST NOT classify dedicated multi-Kit routing as passed

#### Scenario: Viewers share session identity but keep client evidence separate

- **WHEN** two browser clients open the same `review_session_id`
- **THEN** coordinator-visible session state records both participants or viewer observations
- **AND** each viewer has separate browser readiness and screenshot evidence
- **AND** both viewers reference the same expected stage URL from the session stream config

#### Scenario: Same endpoint viewers remain blocked for concurrent stream evidence

- **WHEN** the evidence only shows two clients connected to one primary Kit endpoint
- **THEN** same-session handoff MAY be recorded as observed
- **AND** `single_kit_multi_viewer` runtime evidence MUST remain `blocked` until primary/spectator endpoint evidence exists
- **AND** dedicated multi-Kit runtime evidence MUST remain `deferred`, `not_observed`, or otherwise non-passed
