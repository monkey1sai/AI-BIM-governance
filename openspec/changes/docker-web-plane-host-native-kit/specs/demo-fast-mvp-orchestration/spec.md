## ADDED Requirements

### Requirement: Fast MVP runbook SHALL include hybrid Docker web-plane path

The fast MVP documentation SHALL describe a post-fast-MVP hybrid path where Docker runs only the coordinator/viewer web plane and host-native NVIDIA runtime remains outside Docker.

#### Scenario: Operator can choose hybrid web-plane mode

- **WHEN** an operator reads the fast MVP or deployment runbook
- **THEN** the runbook SHALL list hybrid Docker web-plane mode as a supported single-machine path for `bim-review-coordinator` and `web-viewer-sample`
- **AND** it SHALL state that this mode starts containerized `8004` and `5173`
- **AND** it SHALL state that `49100` / `47998` / `49101` remain host-native

#### Scenario: Runbook separates hybrid readiness from Docker GPU Kit readiness

- **WHEN** the runbook describes validation for hybrid Docker web-plane mode
- **THEN** it SHALL explicitly state that successful `8004` / `5173` container health and host-native bridge checks do not satisfy `runtime-manager-docker-kit-mvp` GPU-container pass criteria
- **AND** it SHALL state that host-native Kit evidence MUST NOT be used to mark Docker GPU Kit readiness as passed

#### Scenario: Runbook documents localhost semantics

- **WHEN** the runbook describes environment variables or compose overrides for hybrid Docker web-plane mode
- **THEN** it SHALL distinguish container-to-host URLs such as `host.docker.internal:49101` from browser-visible Kit endpoints such as `127.0.0.1:49100`
- **AND** it SHALL warn that container-local `127.0.0.1` and browser/host `127.0.0.1` are not the same network endpoint
