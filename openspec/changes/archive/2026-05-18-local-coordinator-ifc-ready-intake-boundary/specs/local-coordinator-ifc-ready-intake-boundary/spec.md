## ADDED Requirements

### Requirement: Coordinator owns the external IFC-ready intake contract

`bim-review-coordinator` SHALL be the only service that exposes the external IFC-ready intake contract `POST /api/external/ifc-ready`. `bim-streaming-server` SHALL NOT expose an external IFC-ready entry; it MUST only receive internal conversion requests from `bim-review-coordinator`.

#### Scenario: External IFC Worker posts ifc-ready to coordinator

- **WHEN** the customer-edge IFC Worker finishes producing a `.ifc` and calls `POST /api/external/ifc-ready` on `bim-review-coordinator`
- **THEN** `bim-review-coordinator` validates the request, creates a local conversion job, binds `external_model_version_id`, and dispatches an internal conversion request to `bim-streaming-server`
- **AND** `bim-streaming-server` exposes no public IFC-ready endpoint for that flow

#### Scenario: Streaming server is not a public entry

- **WHEN** any external caller targets `bim-streaming-server` directly for IFC-ready intake
- **THEN** the architecture MUST treat that as out of contract
- **AND** the supported external contract remains `bim-review-coordinator` `POST /api/external/ifc-ready`

### Requirement: IFC-ready caller is the customer-edge IFC Worker on the edge intranet

The supported `ifc_ready` caller SHALL be the customer-edge IFC Worker reachable on the same customer-edge intranet as this repo's runtime. The company cloud test/production hosts (`192.168.20.238` / `192.168.20.237`) SHALL NOT be modeled as the direct IFC-ready caller; the company cloud interacts only via control-plane APIs and callback receipt.

#### Scenario: Edge IFC Worker is the caller

- **WHEN** an `ifc_ready` request arrives
- **THEN** the accepted source identity is the customer-edge IFC Worker (edge intranet boundary)
- **AND** the company cloud is not expected to call `POST /api/external/ifc-ready` directly

### Requirement: External intake authenticates via a pluggable service auth provider

The external IFC-ready intake SHALL authenticate machine-to-machine callers through a pluggable `AuthProvider` interface, not user SSO. The initial `intranet-dev` provider SHALL support IP allowlist plus a request secret or HMAC signature, and SHALL require `correlation_id`, `idempotency_key`, and `tenant_id` / `project_id` / `external_model_version_id`.

#### Scenario: Unauthorized machine caller is rejected

- **WHEN** a caller fails the active `AuthProvider` (not in allowlist, or missing/invalid signature/secret)
- **THEN** `bim-review-coordinator` rejects the request and does not create a conversion job

#### Scenario: Auth provider is replaceable without contract rewrite

- **WHEN** a future `sso-token-introspection`, `machine-token`, or `mTLS` provider is introduced
- **THEN** it is added behind the same `AuthProvider` interface
- **AND** the external intake contract and existing callers do not require a redesign

### Requirement: External intake is idempotent and binds external model version

The external intake SHALL be idempotent on `idempotency_key` / `correlation_id` and SHALL bind each accepted job to `external_model_version_id` for later callback correlation.

#### Scenario: Duplicate ifc-ready is idempotent

- **WHEN** the IFC Worker retries the same `ifc_ready` with an already-seen `idempotency_key`
- **THEN** `bim-review-coordinator` returns the existing local conversion job
- **AND** it does not create a duplicate active job for the same IFC artifact unless explicitly forced

#### Scenario: Job carries external model version binding

- **WHEN** a conversion job is created from a valid `ifc_ready`
- **THEN** the job record stores `external_model_version_id` and `correlation_id`
- **AND** later conversion result / failure callbacks reuse that binding
