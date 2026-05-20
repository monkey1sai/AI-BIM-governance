## ADDED Requirements

### Requirement: Demo smoke classifies host-native conversion authority independently

Demo runtime smoke SHALL include a `host_native_conversion_authority` tier for the local `127.0.0.1:49101` conversion service. This tier SHALL be evaluated independently from coordinator health, callback outbox delivery, Kit/WebRTC `49100`, DataChannel stage loading, and browser visual evidence.

#### Scenario: Host-native conversion service passes while WebRTC is blocked

- **WHEN** `127.0.0.1:49101` is healthy and a contract-correct IFC-ready flow produces a streaming-owned conversion result
- **THEN** `host_native_conversion_authority` MAY be classified as `passed`
- **AND** `single_kit_render`, WebRTC, and browser visual tiers remain `blocked`, `deferred`, or `not_observed` unless their own evidence exists

#### Scenario: Conversion service is down

- **WHEN** coordinator and viewer are running but `127.0.0.1:49101` is not reachable
- **THEN** `host_native_conversion_authority` is classified as `blocked` or `failed`
- **AND** evidence records the target URL, expected start command, working directory, and diagnostic

#### Scenario: Viewer ready gate is preserved during smoke

- **WHEN** stream config reports `model.status` other than `"ready"`
- **THEN** viewer smoke MUST NOT count `openStageRequest` as expected behavior
- **AND** it records that the ready gate prevented stage loading

### Requirement: Smoke evidence records Windows host-native environment traps

Smoke and runbook output SHALL record the shell, working directory, port, PID or process command, and converter prerequisite status for host-native conversion service checks. Windows `.bat` / Kit tooling launch instructions SHALL prefer PowerShell when `.bat` execution is required.

#### Scenario: Git Bash is used for a batch launcher

- **WHEN** a smoke or manual validation attempts to run a `.bat` / Kit repo launcher from Git Bash and it fails before service startup
- **THEN** the evidence classifies the failure as an environment or shell blocker when appropriate
- **AND** the next rerunnable command uses PowerShell with the correct working directory

#### Scenario: Converter prerequisite is missing

- **WHEN** the host-native service starts but converter preflight fails
- **THEN** the conversion tier records `blocked` with the missing prerequisite
- **AND** it MUST NOT claim mapping quality or ready model evidence
