## ADDED Requirements

### Requirement: Streaming conversion authority can run as a host-native service

`bim-streaming-server` SHALL support running its IFC to USDC conversion authority as a host-native service that is separate from the live Kit/WebRTC viewport runtime. The service SHALL remain internal-only and SHALL NOT expose the external IFC-ready intake contract.

#### Scenario: Host-native service preserves streaming ownership

- **WHEN** the host-native conversion service accepts an internal conversion request
- **THEN** the returned job and result identify `authority="bim-streaming-server"`
- **AND** coordinator consumes the result as streaming-owned conversion evidence

#### Scenario: External IFC-ready caller cannot bypass coordinator

- **WHEN** an external IFC Worker needs to report IFC readiness
- **THEN** the supported entry point remains `bim-review-coordinator` `POST /api/external/ifc-ready`
- **AND** the host-native conversion authority service remains an internal API called by coordinator

#### Scenario: Conversion readiness is not WebRTC readiness

- **WHEN** the host-native conversion service successfully produces USDC and mapping artifacts
- **THEN** conversion readiness MAY be classified as passed
- **AND** Kit launcher, WebRTC `49100`, DataChannel stage loading, and browser visual evidence remain separate tiers

### Requirement: Host-native conversion keeps heavy work off the live viewport path

Heavy IFC to USDC conversion SHALL run through the host-native service runner, converter subprocess, or worker lane instead of blocking the live viewport thread. The implementation SHALL keep a clear operational boundary between conversion execution and Kit/WebRTC streaming.

#### Scenario: Live Kit runtime is down while conversion succeeds

- **WHEN** `127.0.0.1:49101` is healthy and `127.0.0.1:49100` is not listening
- **THEN** a conversion API smoke MAY pass
- **AND** WebRTC or viewport smoke MUST remain `blocked` or `not_observed`

#### Scenario: Converter dependency fails

- **WHEN** the converter adapter fails because of missing executable, invalid IFC, missing output, or process failure
- **THEN** the conversion job records a non-ready failure
- **AND** live Kit/WebRTC runtime status is reported separately
