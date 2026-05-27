## MODIFIED Requirements

### Requirement: Same-Kit concurrent streaming uses primary and spectator streams

Same-Kit concurrent browser runtime validation SHALL use one GPU-backed Kit process, one review session, and distinct primary / spectator WebRTC transport endpoints. The same-session topology MUST prove that both viewer pages joined the same `review_session_id` while using separate stream roles.

Dedicated multi-Kit process routing is out of scope for this pass and SHALL remain non-passed unless separate capacity evidence exists.

#### Scenario: Primary and spectator streams are configured

- **WHEN** same-Kit concurrent runtime validation is executed for this change
- **THEN** one GPU-backed Kit process MUST expose one primary WebRTC signaling endpoint and at least one spectator WebRTC signaling endpoint
- **AND** the primary and spectator streams MUST expose distinct signaling ports and, when configured, distinct media / stream ports
- **AND** the evidence MUST record that this is same-Kit primary/spectator evidence, not dedicated multi-Kit evidence

#### Scenario: Browser E2E targets two same-session viewers

- **WHEN** `web-viewer-sample` is opened for same-Kit concurrent runtime verification
- **THEN** one browser page MUST target the primary stream through the same `review_session_id`
- **AND** another browser page MUST target a spectator stream through the same `review_session_id`
- **AND** each page MUST provide its own browser readiness, screenshot evidence, stage-load diagnostics, and non-zero video evidence

#### Scenario: Same primary endpoint evidence remains a blocker

- **WHEN** two browser pages connect only to the same primary WebRTC endpoint
- **THEN** the evidence MAY classify same-session bootstrap and participant coordination
- **AND** the same-Kit concurrent streaming tier MUST remain `blocked` until primary/spectator stream evidence exists

#### Scenario: Dedicated multi-Kit process routing is out of scope for this pass

- **WHEN** the product requires isolated GPU runtimes or multiple Kit processes
- **THEN** that validation MUST remain deferred until GPU purchase and deployment provide a dedicated capacity tier with its own endpoint pool and E2E evidence
