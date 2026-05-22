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

The host-native conversion authority service SHALL publish a ready result only when validated artifacts are present. If the primary PowerShell/Kit/HOOPS converter fails to import a locally readable IFC, the adapter MAY use an IfcOpenShell + OpenUSD fallback converter, but only when the fallback produces a real `model.usdc`, `element_mapping.json`, `entity_index.json`, `metadata.json`, and quality metrics derived from the source IFC. The fallback output MUST pass the same no-placeholder and openability gates as primary converter output.

#### Scenario: fallback converter produces publishable artifacts

- **WHEN** the primary converter fails with a source IFC import error
- **AND** the fallback converter successfully tessellates source IFC geometry and writes `model.usdc`
- **THEN** `GET /api/conversions/{conversion_job_id}/result` returns `status="succeeded"` or an explicitly allowed warning status
- **AND** `model.status="ready"`
- **AND** `artifacts.model_usdc.url`, `artifacts.element_mapping.url`, `artifacts.entity_index.url`, and metadata refs are present
- **AND** `quality_metrics.materialization_strategy="ifcopenshell_openusd_fallback"`

#### Scenario: fallback converter does not fabricate mappings

- **WHEN** a source IFC entity cannot be represented as a renderable USD prim by the fallback converter
- **THEN** the entity is reported as unmapped, sidecar-only, or omitted according to documented fallback policy
- **AND** the converter MUST NOT create fake GUID-to-prim mappings to inflate coverage
- **AND** `element_mapping.json` MUST identify `mock=false`

#### Scenario: final archive evidence requires real fallback success

- **WHEN** this OpenSpec change is considered for archive
- **THEN** the archived evidence MUST include a real runtime conversion of the user-provided or equivalent 341MB IFC that reaches ready conversion state
- **AND** unit-only or fake converter tests MUST NOT be sufficient archive evidence

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
