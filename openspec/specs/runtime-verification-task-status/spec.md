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

### Requirement: Demo observation tasks require current evidence

Demo observation tasks SHALL 只有在 claimed status 具備 current evidence 時才能標記完成。Historical evidence MAY 作為 context 引用，但 task completion MUST 識別 current run 是 `passed`、`failed`、`blocked`、`deferred` 或 `not_observed`。

#### Scenario: Task is marked complete after live observation

- **WHEN** task 將某個 demo tier 標記為 observed
- **THEN** `tasks.md` 或 verification report 包含 current command 或 observation method、result status、timestamp，以及 evidence path 或 blocker details

#### Scenario: Historical evidence is reused as context

- **WHEN** task 引用較舊的 report 或 archived OpenSpec change
- **THEN** task 將它記錄為 historical context，並仍需說明 current tier 是否已重新執行，或保留為 `not_observed`

#### Scenario: Blocker investigation is complete

- **WHEN** runtime tier 的 blocker 已完成分類
- **THEN** blocker-classification task MAY 標記完成，但 runtime pass task MUST 維持未完成，除非存在 live pass evidence

### Requirement: Demo observation checklist separates observation from fixes

Demo observation checklist SHALL 區分 evidence gathering 與 implementation fixes。Failed 或 blocked observation MUST 產生清楚 finding 與 next step，而不是在 observation task 內靜默改變 product behavior。

#### Scenario: Observation discovers a defect

- **WHEN** current demo observation 找到 code、configuration、dependency 或 runtime defect
- **THEN** task 記錄 finding、affected owner、evidence，以及 smallest next fix path
- **AND** affected functional pass 維持未完成，直到 fix 已實作並重新觀測

#### Scenario: Observation requires no product change

- **WHEN** 所有 in-scope demo tiers 都已通過，或已具備明確 blocker/deferred classifications
- **THEN** observation change 可以只用 documentation 與 evidence updates 完成
