# host-native-conversion-authority-service Specification

## Purpose
TBD - created by archiving change introduce-host-native-conversion-authority-service. Update Purpose after archive.
## Requirements
### Requirement: Host-native conversion authority service exposes internal API

`bim-streaming-server` SHALL provide a host-native HTTP conversion authority service that can be started independently from the live Kit/WebRTC runtime. The service SHALL bind to `127.0.0.1:49101` by default, SHALL be addressable through `STREAMING_CONVERSION_API_BASE`, and SHALL expose `GET /health`, `POST /api/conversions/ifc-to-usdc`, `GET /api/conversions/{conversion_job_id}`, and `GET /api/conversions/{conversion_job_id}/result`.

#### Scenario: Service starts on the local conversion port

- **WHEN** the host-native conversion authority service is started with default development settings
- **THEN** `GET http://127.0.0.1:49101/health` returns a healthy service identity
- **AND** the response identifies `authority="bim-streaming-server"` and the service as conversion-only
- **AND** it MUST NOT claim WebRTC, Kit launcher, or viewport readiness

#### Scenario: Coordinator creates an internal conversion job

- **WHEN** `bim-review-coordinator` sends a valid internal conversion request to `POST /api/conversions/ifc-to-usdc`
- **THEN** the service returns `202`
- **AND** the response includes `conversion_job_id`, `status`, `authority="bim-streaming-server"`, `correlation_id`, and `idempotency_key`

#### Scenario: Internal token is enforced when configured

- **WHEN** the service is configured with an internal conversion token and clients are expected to send that configured value in the `X-Internal-Conversion-Token` request header
- **THEN** requests that omit `X-Internal-Conversion-Token` or provide a value that does not match the configured internal conversion token are rejected with `401` or `403`
- **AND** no conversion job is created for rejected requests

### Requirement: Host-native converter adapter publishes only validated artifacts

The host-native conversion authority service SHALL run conversion through a converter adapter and SHALL publish a ready result only when validated outputs are present. Required outputs are `model.usdc`, `element_mapping.json`, `entity_index.json`, and `metadata.json` or equivalent artifact refs. The result SHALL include quality metrics and lineage that can be traced back to the source IFC reference.

#### Scenario: Successful conversion returns ready artifacts

- **WHEN** the converter adapter completes an IFC to USDC conversion with all required outputs
- **THEN** `GET /api/conversions/{conversion_job_id}/result` returns `status="succeeded"` or `status="succeeded_with_warnings"` and `model.status="ready"`
- **AND** the result includes USDC, element mapping, entity index, metadata refs, quality metrics, and lineage

#### Scenario: Placeholder output is rejected

- **WHEN** the converter adapter produces a placeholder, missing, or unopenable `model.usdc`
- **THEN** the conversion job is marked `failed` or another non-ready terminal status
- **AND** the result MUST NOT publish `model.status="ready"`

#### Scenario: Missing converter is an honest blocker

- **WHEN** the host does not have the configured converter executable, script, or Kit app prerequisite
- **THEN** health or job evidence reports a `blocked` or `converter_unavailable` diagnostic
- **AND** downstream coordinator/viewer readiness MUST remain non-passed

### Requirement: Host-native conversion job state is durable enough for local evidence

The service SHALL persist local conversion job state and result metadata so smoke tests and coordinator result ingestion can query conversion outcome after initial dispatch. Persistence MAY be file-based for this MVP, but it MUST preserve `conversion_job_id`, request fingerprint, idempotency data, status, result refs, and error diagnostics.

#### Scenario: Job status remains queryable

- **WHEN** a conversion job has been accepted
- **THEN** `GET /api/conversions/{conversion_job_id}` returns the current job state
- **AND** the response includes enough identifiers for coordinator callback outbox and verification evidence

#### Scenario: Duplicate idempotency request replays the existing job

- **WHEN** the same idempotency key is sent with an equivalent request
- **THEN** the service returns the existing `conversion_job_id`
- **AND** it does not create a second active conversion job

#### Scenario: Conflicting idempotency request is rejected

- **WHEN** the same idempotency key is reused with a different IFC source or request fingerprint
- **THEN** the service rejects the request with a conflict response
- **AND** no new job is created
