## MODIFIED Requirements

### Requirement: Single-Kit multi-viewer sharing is distinguished from dedicated multi-Kit routing

A single Kit instance with multiple viewers sharing one review session SHALL be tracked separately from dedicated multi-Kit routing. For this pass, `single_kit_multi_viewer` MAY be proven by two or more browser clients using the same `review_session_id` and the same Kit endpoint, provided each viewer has its own WebRTC lifecycle evidence and stage-load/video readiness evidence.

Dedicated multi-Kit routing SHALL remain a separate capacity tier requiring separate Kit process or endpoint pool evidence. Passing same-session multi-viewer evidence MUST NOT mark dedicated multi-Kit routing as passed.

#### Scenario: Single Kit multiple viewers

- **WHEN** two viewers join the same review session and share one Kit endpoint
- **THEN** evidence may classify `single_kit_multi_viewer` as passed
- **AND** it MUST NOT classify dedicated multi-Kit routing as passed

#### Scenario: Viewers share session identity but keep client evidence separate

- **WHEN** two browser clients open the same `review_session_id`
- **THEN** coordinator-visible session state records both participants or viewer observations
- **AND** each viewer has separate browser readiness and screenshot evidence
- **AND** both viewers reference the same expected stage URL from the session stream config

#### Scenario: Dedicated multi-Kit remains deferred

- **WHEN** the evidence only shows two clients connected to one Kit endpoint
- **THEN** `single_kit_multi_viewer` MAY be `passed`
- **AND** dedicated multi-Kit runtime evidence MUST remain `deferred`, `not_observed`, or otherwise non-passed
