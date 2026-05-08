# runtime-verification-evidence Specification

## Purpose
TBD - created by archiving change complete-spec-runtime-verification. Update Purpose after archive.
## Requirements
### Requirement: Runtime verification evidence is tiered

The workspace SHALL record runtime verification evidence by tier instead of using a single ambiguous end-to-end status. Evidence tiers MUST distinguish non-GPU contract checks, single Kit GPU render checks, multi Kit routing checks, and stress checks.

#### Scenario: Non-GPU contract evidence is recorded

- **WHEN** `bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1` is run
- **THEN** the verification report records the command, result, and that it validates DataChannel stage-loading contract shape without claiming GPU viewport render success

#### Scenario: Hardware-dependent evidence is blocked

- **WHEN** a verification tier requires GPU, Kit SDK, valid geometry, multiple Kit instances, or load-test inputs that are unavailable
- **THEN** the verification report records `blocked` with the missing prerequisites and next runnable step instead of leaving the item as plain unverified

### Requirement: Single Kit render evidence uses valid geometry

The workspace SHALL only treat Kit viewport render as verified when the loaded model contains valid renderable geometry and browser evidence proves video readiness.

#### Scenario: Repo-local storage fixture is selected

- **WHEN** single Kit render evidence is prepared
- **THEN** the fixture MUST come from repo-local `storage/` unless the verification report explicitly records an approved exception and reason

#### Scenario: Header-only IFC fixture is rejected for render evidence

- **WHEN** a smoke fixture only contains IFC header / footer text and no renderable building geometry
- **THEN** the verification report MUST NOT classify the run as successful Kit GPU viewport render evidence

#### Scenario: Valid geometry renders in browser

- **WHEN** a valid IFC, USD, or USDC fixture is loaded through `_worker`, `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server`
- **THEN** the evidence records the fixture identity, artifact URLs, `review_request_id` or `session_id`, video readiness, non-zero video dimensions, `openedStageResult`, and a viewport screenshot or equivalent visual proof

### Requirement: Dedicated Kit routing evidence requires multiple Kit instances

The workspace SHALL only classify `dedicated_instance` routing as runtime-verified when the environment provides two or more distinct Kit instance endpoints.

#### Scenario: Root scripts coordinate multi Kit startup

- **WHEN** multi Kit runtime verification needs to launch or check more than one service
- **THEN** the orchestration entrypoint MUST live under root `scripts/` while `bim-streaming-server/scripts/` may remain the low-level single-instance launcher

#### Scenario: Single local_fixed instance cannot verify dedicated routing

- **WHEN** the environment only has one `local_fixed` Kit instance on signaling port `49100`
- **THEN** a second viewer receiving GPU busy / already streaming is recorded as an environment capacity limit, not as a failed `dedicated_instance` routing verification

#### Scenario: Multiple dedicated instances stream concurrently

- **WHEN** coordinator registers two or more Kit instances with distinct signaling ports and a session requests `routing_policy=dedicated_instance`
- **THEN** evidence records distinct `kit_instance_bindings[]`, distinct stream configs, concurrent browser readiness for each assigned artifact group, and Socket.IO collaboration continuity across the shared `session_id`

### Requirement: Stress verification has explicit thresholds

The workspace SHALL define thresholds before claiming large IFC or Socket.IO concurrency stress verification.

#### Scenario: Large IFC stress is measured

- **WHEN** a large IFC fixture is used for conversion and review-session readiness
- **THEN** evidence records fixture size, conversion duration, memory or process observations when available, readiness state transitions, final status, and viewer behavior while conversion is `processing`

#### Scenario: Socket.IO concurrency stress is measured

- **WHEN** Socket.IO collaboration stress is run with more than two clients
- **THEN** evidence records client count, event types, broadcast success criteria, observed failures, and coordinator health after the run

#### Scenario: Socket.IO target load uses local sustainable capacity

- **WHEN** Socket.IO stress is prepared on the user's workstation
- **THEN** the verification MUST first determine the machine's maximum sustainable client count and use 90% of that count as the formal stress target
