## MODIFIED Requirements

### Requirement: Verification evidence records host-native conversion authority

Runtime verification evidence SHALL record host-native conversion authority observations separately from rendering observations. Evidence for this tier SHALL include service URL, health result, conversion request identifiers, conversion result status, artifact refs, quality metrics summary, callback outbox state, command, working directory, shell, and timestamp.

#### Scenario: Host-native conversion evidence passes

- **WHEN** a current verification run starts `127.0.0.1:49101`, creates a conversion job, and obtains a ready result with quality metrics
- **THEN** evidence records `host_native_conversion_authority.status="passed"`
- **AND** the evidence includes `conversion_job_id`, `correlation_id`, artifact refs, `coverage_status`, and callback outbox status
- **AND** it states that Kit/WebRTC and browser visual tiers require separate evidence

#### Scenario: Conversion evidence is blocked

- **WHEN** service startup, port binding, converter preflight, IFC parsing, or result validation fails
- **THEN** evidence records `host_native_conversion_authority.status` as `blocked` or `failed`
- **AND** the record includes the owner boundary, diagnostic, and next rerunnable command

#### Scenario: Historical evidence is not promoted

- **WHEN** a verification report references older worker-era conversion evidence or previous screenshots
- **THEN** it MUST NOT mark the current host-native conversion authority tier as passed
- **AND** it MUST NOT mark `single_kit_render`, WebRTC, or browser visual tiers as passed without current evidence

### Requirement: Verification links host-native result to viewer readiness without making viewer the authority

Verification evidence SHALL demonstrate that coordinator stream config can expose a host-native conversion result to the viewer, while preserving that `web-viewer-sample` is read-only for conversion metrics and only sends `openStageRequest` when model readiness is true.

#### Scenario: Ready stream config enables stage-load attempt

- **WHEN** coordinator stream config contains `model.status="ready"` and `conversion_authority="bim-streaming-server"` from a host-native conversion result
- **THEN** viewer E2E evidence may expect an `openStageRequest` attempt after Kit/DataChannel readiness
- **AND** the conversion metrics remain sourced from coordinator or the conversion result API, not recomputed by viewer

#### Scenario: Non-ready stream config blocks stage-load attempt

- **WHEN** coordinator stream config contains `model.status="converting"`, `"failed"`, `"missing"`, or `"blocked"`
- **THEN** viewer E2E evidence records that no normal `openStageRequest` should be sent
- **AND** conversion failure or pending status remains owned by coordinator and streaming conversion authority
