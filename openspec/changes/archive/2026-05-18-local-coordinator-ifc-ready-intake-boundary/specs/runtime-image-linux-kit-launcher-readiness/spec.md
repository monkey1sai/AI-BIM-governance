## ADDED Requirements

### Requirement: Runtime image must launch the produced Linux Kit launcher with honest evidence

The runtime image SHALL be validated to launch the produced Linux Kit launcher, closing the predecessor archive's deferred item `Validate runtime image launches produced Linux Kit launcher`. Evidence SHALL be explicit and MUST NOT be faked: if GPU, driver, or Kit license/auth prerequisites are unavailable, the result MUST be recorded as `deferred`, never as `passed`.

#### Scenario: Linux Kit launcher launches inside the runtime image

- **WHEN** the runtime image is built and the produced Linux Kit launcher is executed inside it
- **THEN** evidence records image digest, launcher path, startup log, exit code, and the sample USDC path used
- **AND** the run either completes a Kit runtime smoke (e.g. loads a sample USDC) or is explicitly classified

#### Scenario: GPU/Kit prerequisites missing is deferred, not passed

- **WHEN** NVIDIA runtime, GPU, driver, or Kit license/auth prerequisites are unavailable
- **THEN** the readiness result is `deferred` with recorded reason
- **AND** it MUST NOT be reported as `passed`, and host-local Kit MUST NOT be used as a substitute pass
