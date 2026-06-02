## MODIFIED Requirements

### Requirement: Host-native conversion authority service exposes internal API

`bim-streaming-server` SHALL provide a host-native HTTP conversion authority service that can be started independently from the live Kit/WebRTC runtime. The service SHALL bind to `127.0.0.1:49101` by default, SHALL be addressable through `STREAMING_CONVERSION_API_BASE`, and SHALL expose `GET /health`, `POST /api/conversions/ifc-to-usdc`, `GET /api/conversions/{conversion_job_id}`, and `GET /api/conversions/{conversion_job_id}/result`.

The internal token (configured via `STREAMING_CONVERSION_INTERNAL_TOKEN`) enforces only state-changing requests (`POST /api/conversions/ifc-to-usdc`). Read-only GET endpoints rely on the default loopback binding as the trust boundary and SHALL NOT require the internal token; the code SHALL document that a non-loopback `STREAMING_CONVERSION_HOST` should also protect GET/artifacts routes. When no internal token is configured (default unset), the service SHALL NOT enforce token checks, keeping the local demo usable.

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

#### Scenario: Read-only GET endpoints rely on loopback binding

- **WHEN** the service is bound to the default `127.0.0.1` loopback and a client sends `GET /api/conversions/{id}/result` or `GET /artifacts/{job_id}/{filename}` without an internal token
- **THEN** the request is served (read-only over loopback is the trust boundary)
- **AND** the code SHALL document that a non-loopback `STREAMING_CONVERSION_HOST` should also protect GET/artifacts routes

#### Scenario: Token unset keeps local demo usable

- **WHEN** no internal conversion token is configured (default unset; empty `STREAMING_CONVERSION_INTERNAL_TOKEN` is treated as unset)
- **THEN** `POST /api/conversions/ifc-to-usdc` without `X-Internal-Conversion-Token` is accepted (`202`)
- **AND** the service does not enforce token checks until a token is explicitly configured
