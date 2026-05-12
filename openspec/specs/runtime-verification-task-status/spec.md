# runtime-verification-task-status Specification

## Purpose
Define when runtime verification tasks may be marked complete, and keep GPU-backed Kit evidence, same-Kit concurrent streaming evidence, blocker classifications, and deferred dedicated multi-Kit capacity tiers distinguishable in OpenSpec tasks and verification reports.
## Requirements
### Requirement: Runtime verification task status requires live GPU evidence

OpenSpec runtime verification tasks SHALL only mark hardware-dependent runtime validation as complete when the corresponding behavior has run on a GPU-backed Kit runtime and produced reviewable evidence.

#### Scenario: Runtime evidence is successfully captured

- **WHEN** a task claims GPU render, same-Kit concurrent streaming, browser readiness, non-zero video frame, viewport screenshot, or stream endpoint validation
- **THEN** the task and verification report MUST include evidence from a live GPU-backed Kit run proving that runtime behavior passed

#### Scenario: Single Kit GPU render is marked complete

- **WHEN** a task marks single Kit GPU render validation as complete
- **THEN** the evidence MUST include GPU probe result, active Kit signaling / stream endpoint, renderable USD / USDC artifact identity, `review_request_id` or `session_id`, stream config, `openedStageResult` or equivalent stage-load success, browser video readiness, non-zero video frame dimensions, and an archived viewport screenshot

#### Scenario: Browser E2E visual evidence is archived

- **WHEN** browser E2E runtime validation is marked `passed`
- **THEN** the viewport screenshot MUST be saved as a repo-local evidence artifact and the verification report MUST reference its path, capture time, browser URL, `session_id`, Kit endpoint, artifact URL, and video dimensions

#### Scenario: Same-Kit concurrent stream screenshots are archived

- **WHEN** a task marks same-Kit primary / spectator browser runtime validation as complete
- **THEN** the primary stream and each spectator stream MUST have their own archived screenshots linked to the corresponding stream role, signaling / media config, and browser readiness evidence

#### Scenario: Runtime prerequisites are unavailable

- **WHEN** the machine lacks a renderable USD / USDC artifact, active Kit stream listener, browser video proof, or spectator stream required by the runtime tier
- **THEN** the verification report MAY record blocker classification, but any in-scope runtime pass task MUST remain unchecked or be explicitly deferred rather than marked complete

#### Scenario: OpenSpec reports all tasks done

- **WHEN** `openspec instructions apply` reports `state=all_done`
- **THEN** every in-scope GPU or same-Kit concurrent stream runtime tier MUST have `passed` evidence, or the task list MUST explicitly remove/defer that tier from the completed change scope, and readers MUST still be able to determine whether each runtime tier is `passed`, `blocked`, `failed`, or `deferred`

### Requirement: Review finding resolution uses live re-verification

Review finding fixes for runtime evidence SHALL verify the current workspace state before claiming a finding is resolved.

#### Scenario: GPU render evidence finding is checked

- **WHEN** resolving a finding about missing GPU render evidence
- **THEN** the reviewer MUST run or observe the selected fixture through the GPU-backed Kit path and capture worker-derived artifact type, Kit signaling / stream listener state, DataChannel stage-load result, browser video readiness, and visual evidence before claiming render success

#### Scenario: Same-Kit concurrent runtime finding is checked

- **WHEN** resolving a finding about concurrent browser runtime validation for this stage
- **THEN** the reviewer MUST run or observe one GPU-backed Kit process exposing primary and spectator WebRTC streams, with concurrent browser readiness and screenshot evidence, before claiming concurrent runtime validation; otherwise the task remains unchecked or deferred

### Requirement: Blocked runtime evidence remains explicit

Runtime verification documentation SHALL keep blocked evidence explicit and consistent across OpenSpec tasks and verification reports.

#### Scenario: Task and report both mention a blocker

- **WHEN** a runtime tier is blocked by placeholder artifacts, missing stream port, missing screenshot, or unavailable spectator stream topology
- **THEN** both `tasks.md` and the verification report MUST name the blocker and MUST NOT present the tier as successful validation or a completed runtime pass

#### Scenario: Blocker classification is complete

- **WHEN** a blocker investigation task is completed
- **THEN** the completed blocker task MUST be separate from the runtime pass task so readers can see that the blocker is known but the GPU runtime tier remains not passed

### Requirement: Same-Kit concurrent streaming uses primary and spectator streams

Same-Kit concurrent browser runtime validation SHALL use one GPU-backed Kit process with a primary stream and at least one spectator stream, not two logical bindings that point at the same primary WebRTC endpoint.

#### Scenario: Primary and spectator streams are configured

- **WHEN** same-Kit concurrent runtime validation is executed
- **THEN** `bim-streaming-server` MUST be launched with one primary WebRTC stream and at least one spectator WebRTC stream
- **AND** the primary and spectator streams MUST expose distinct signaling ports and, when configured, distinct media / stream ports

#### Scenario: Browser E2E targets primary and spectator streams

- **WHEN** `web-viewer-sample` is opened for same-Kit concurrent runtime verification
- **THEN** one browser page MUST target the primary stream and provide DataChannel stage-load success evidence
- **AND** another browser page MUST target a spectator stream with video readiness and screenshot evidence from the same `session_id`

#### Scenario: Dedicated multi-Kit process routing is out of scope for this pass

- **WHEN** the product requires isolated GPU runtimes or multiple Kit processes
- **THEN** that validation MUST remain deferred until GPU purchase and deployment provide a dedicated capacity tier with its own endpoint pool and E2E evidence
