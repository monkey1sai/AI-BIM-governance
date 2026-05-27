## MODIFIED Requirements

### Requirement: Same-Kit concurrent streaming uses primary and spectator streams

Same-Kit concurrent browser runtime validation SHALL use one GPU-backed Kit process, one review session, and distinct primary / spectator WebRTC transport endpoints. The same-session topology MUST prove that both viewer pages joined the same `review_session_id` while using separate stream roles.

Dedicated multi-Kit process routing is out of scope for this pass and SHALL remain non-passed unless separate capacity evidence exists.

#### Scenario: Primary and spectator streams are configured

- **WHEN** same-Kit concurrent runtime validation is executed for this change
- **THEN** one GPU-backed Kit process MUST expose one primary WebRTC signaling endpoint and at least one spectator WebRTC signaling endpoint
- **AND** the primary and spectator streams MUST expose distinct signaling ports and, when configured, distinct media / stream ports
- **AND** the evidence MUST record that this is same-Kit primary/spectator evidence, not dedicated multi-Kit evidence

#### Scenario: Default spectator capacity is generated

- **WHEN** hybrid host-native Kit deployment starts without an explicit spectator count override
- **THEN** the runtime topology MUST generate 5 spectator viewer slots in addition to the primary stream
- **AND** the generated spectator endpoints MUST use deterministic, distinct signaling and media/stream port pairs
- **AND** coordinator stream config MUST expose those spectator endpoints as distinct `kit_instance_bindings`
- **AND** `viewport_sharing.spectator_ready` MUST be `true` when at least one distinct spectator endpoint is available

#### Scenario: Operator controls spectator capacity

- **WHEN** operator sets spectator count to `N`
- **THEN** host-native Kit launch MUST receive exactly `N` spectator signaling ports and `N` spectator media/stream ports
- **AND** coordinator stream config MUST expose no more than `N` generated spectator bindings unless the operator explicitly provides a full endpoint list
- **AND** invalid or duplicate spectator port topology MUST fail validation rather than silently collapsing multiple viewers onto the same primary endpoint

#### Scenario: Browser E2E targets two same-session viewers

- **WHEN** `web-viewer-sample` is opened for same-Kit concurrent runtime verification
- **THEN** one browser page MUST target the primary stream through the same `review_session_id`
- **AND** another browser page MUST target a spectator stream through the same `review_session_id`
- **AND** each page MUST provide its own browser readiness, screenshot evidence, stage-load diagnostics, and non-zero video evidence

#### Scenario: Same primary endpoint evidence remains a blocker

- **WHEN** two browser pages connect only to the same primary WebRTC endpoint
- **THEN** the evidence MAY classify same-session bootstrap and participant coordination
- **AND** the same-Kit concurrent streaming tier MUST remain `blocked` until primary/spectator stream evidence exists
