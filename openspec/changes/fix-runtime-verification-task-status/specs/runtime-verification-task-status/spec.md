## ADDED Requirements

### Requirement: Runtime verification task status distinguishes outcome

OpenSpec runtime verification tasks SHALL distinguish successful runtime validation from blocked evidence classification.

#### Scenario: Runtime evidence is successfully captured

- **WHEN** a task claims GPU render, multi-Kit runtime routing, browser readiness, non-zero video frame, viewport screenshot, or distinct Kit endpoint validation
- **THEN** the task and verification report MUST include the corresponding evidence proving that runtime behavior passed

#### Scenario: Runtime prerequisites are unavailable

- **WHEN** the machine lacks a renderable USD / USDC artifact, active Kit stream listener, browser video proof, or multiple Kit endpoints required by the runtime tier
- **THEN** checked tasks MUST be worded as attempted verification, blocker classification, or evidence recording rather than successful runtime validation

#### Scenario: OpenSpec reports all tasks done

- **WHEN** `openspec instructions apply` reports `state=all_done`
- **THEN** readers MUST still be able to determine from tasks and verification report whether each runtime tier is `passed`, `blocked`, or `failed`

### Requirement: Review finding resolution uses live re-verification

Review finding fixes for runtime evidence SHALL verify the current workspace state before claiming a finding is resolved.

#### Scenario: GPU render evidence finding is checked

- **WHEN** resolving a finding about missing GPU render evidence
- **THEN** the reviewer MUST check the selected fixture, worker-derived artifact type, Kit signaling / stream listener state, and browser visual evidence state before deciding whether the task can claim render success or only blocked evidence capture

#### Scenario: Multi-Kit runtime finding is checked

- **WHEN** resolving a finding about multi-Kit runtime validation
- **THEN** the reviewer MUST check root `scripts/` orchestration, streaming server port configurability, available distinct Kit endpoints, and browser readiness evidence before deciding whether the task can claim runtime validation or only topology blocker classification

### Requirement: Blocked runtime evidence remains explicit

Runtime verification documentation SHALL keep blocked evidence explicit and consistent across OpenSpec tasks and verification reports.

#### Scenario: Task and report both mention a blocker

- **WHEN** a runtime tier is blocked by placeholder artifacts, missing stream port, missing screenshot, or unavailable multi-Kit topology
- **THEN** both `tasks.md` and the verification report MUST name the blocker and MUST NOT present the tier as successful validation
