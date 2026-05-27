## MODIFIED Requirements

### Requirement: Same-Kit concurrent streaming uses validated same-session viewer topology

Same-Kit concurrent browser runtime validation SHALL use one GPU-backed Kit process and one review session. For this change, the baseline same-session topology MAY use two browser clients connected to the same primary Kit WebRTC endpoint when both clients produce separate WebRTC lifecycle evidence, non-zero video evidence, and matching expected stage URL evidence. A stronger topology with distinct primary and spectator streams MAY be used when available, but it is not required to classify this change's `single_kit_multi_viewer` tier as passed.

Dedicated multi-Kit process routing is out of scope for this pass and SHALL remain non-passed unless separate capacity evidence exists.

#### Scenario: Same primary endpoint multi-viewer is configured

- **WHEN** same-Kit concurrent runtime validation is executed for this change
- **THEN** one GPU-backed Kit process MAY expose one primary WebRTC signaling endpoint
- **AND** two browser clients MAY target that same endpoint through the same `review_session_id`
- **AND** the evidence MUST record that this is same-primary-endpoint multi-viewer evidence, not dedicated multi-Kit evidence

#### Scenario: Browser E2E targets two same-session viewers

- **WHEN** `web-viewer-sample` is opened for same-Kit concurrent runtime verification
- **THEN** two browser pages MUST target the same `review_session_id`
- **AND** each page MUST provide its own browser readiness, screenshot evidence, and stage-load/video diagnostics

#### Scenario: Spectator stream evidence is stronger but optional

- **WHEN** a primary/spectator stream topology is available from the same Kit process
- **THEN** validation MAY record distinct signaling ports for primary and spectator streams
- **AND** that evidence MAY supersede same-primary-endpoint evidence
- **AND** absence of spectator topology alone MUST NOT block this change's same-session multi-viewer validation

#### Scenario: Dedicated multi-Kit process routing is out of scope for this pass

- **WHEN** the product requires isolated GPU runtimes or multiple Kit processes
- **THEN** that validation MUST remain deferred until GPU purchase and deployment provide a dedicated capacity tier with its own endpoint pool and E2E evidence
