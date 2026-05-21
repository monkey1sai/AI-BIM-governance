# local-coordinator-ifc-ready-intake-boundary Specification

## Purpose
TBD - created by archiving change local-coordinator-ifc-ready-intake-boundary. Update Purpose after archive.
## Requirements
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

The external IFC-ready intake SHALL authenticate machine-to-machine callers through a pluggable `AuthProvider` interface, not user SSO. The initial `intranet-dev` provider SHALL support IP allowlist plus a request secret or HMAC signature. Canonical callers SHALL provide `correlation_id`, `idempotency_key`, and `tenant_id` / `project_id` / `external_model_version_id` through the existing header/body identity contract. Worker compatibility callers MAY omit explicit correlation / idempotency fields when `task_id` is present; in that case `bim-review-coordinator` SHALL derive correlation and idempotency values from the authenticated identity plus `project_id`, `version`, and `task_id`. Production auth providers MUST still authenticate caller identity and MUST NOT rely on the worker body alone as proof of identity.

#### Scenario: Unauthorized machine caller is rejected

- **WHEN** a caller fails the active `AuthProvider` (not in allowlist, or missing/invalid signature/secret when the provider requires one)
- **THEN** `bim-review-coordinator` rejects the request and does not create a conversion job

#### Scenario: Auth provider is replaceable without contract rewrite

- **WHEN** a future `sso-token-introspection`, `machine-token`, or `mTLS` provider is introduced
- **THEN** it is added behind the same `AuthProvider` interface
- **AND** the external intake contract and existing callers do not require a redesign

#### Scenario: Worker task identity fills retry metadata

- **WHEN** an authenticated worker compatibility payload omits explicit `X-Correlation-Id` or `X-Idempotency-Key`
- **THEN** `bim-review-coordinator` derives stable correlation and idempotency values from `project_id`, `version`, and `task_id`
- **AND** those derived values are stored in the local job and used for duplicate replay detection

### Requirement: External intake is idempotent and binds external model version

The external intake SHALL be idempotent on explicit `idempotency_key` / `correlation_id` when provided, and SHALL support worker compatibility idempotency derived from `project_id`, `version`, and `task_id` when explicit keys are absent. Every accepted job SHALL bind to `external_model_version_id`; for worker compatibility payloads, `version` SHALL be the source of that binding unless a future authenticated provider supplies a stronger model-version mapping.

#### Scenario: Duplicate ifc-ready is idempotent

- **WHEN** the IFC Worker retries the same `ifc_ready` with an already-seen explicit `idempotency_key` or the same derived worker identity (`project_id`, `version`, `task_id`)
- **THEN** `bim-review-coordinator` returns the existing local conversion job
- **AND** it does not create a duplicate active job for the same IFC artifact unless explicitly forced

#### Scenario: Job carries external model version binding

- **WHEN** a conversion job is created from a valid `ifc_ready`
- **THEN** the job record stores `external_model_version_id` and `correlation_id`
- **AND** later conversion result / failure callbacks reuse that binding

#### Scenario: Conflicting worker retry is rejected

- **WHEN** a worker reuses the same derived worker identity (`project_id`, `version`, `task_id`) with a materially different `ifc_path`
- **THEN** `bim-review-coordinator` returns a 409-style conflict response
- **AND** it MUST NOT replace the original job's source IFC reference silently

### Requirement: Coordinator accepts worker ifc-ready compatibility payload

`bim-review-coordinator` SHALL accept a worker compatibility body on `POST /api/external/ifc-ready` with `status="ifc_ready"`, `ifc_path`, `project_id`, `version`, and `task_id`. The coordinator SHALL normalize this body at the intake boundary into the canonical local IFC-ready event before creating a local conversion job or dispatching an internal request to `bim-streaming-server`.

> **Implementation status (2026-05-21)**: this requirement was ratified by archive `2026-05-21-coordinator-ifc-ready-worker-webhook` but its code path was never implemented (retro-audit commit `a32fcd6`). Change `backfill-coordinator-webhook-and-auto-session` backfills the implementation in `bim-review-coordinator/src/app.ts` (`normalizeIntakePayload` helper plus the `/api/external/ifc-ready` route handler wiring). See its `tasks.md` for the scenario-to-test mapping.

#### Scenario: Worker payload is accepted and normalized

- **WHEN** the customer-edge IFC Worker posts `status="ifc_ready"`, `ifc_path`, `project_id`, `version`, and `task_id` to `POST /api/external/ifc-ready`
- **THEN** `bim-review-coordinator` accepts the body as a valid IFC-ready compatibility payload after service auth passes
- **AND** it normalizes `status` to `event="ifc_ready"`
- **AND** it normalizes `ifc_path` to `source_ifc.ref`
- **AND** it normalizes `version` to `external_model_version_id`
- **AND** it normalizes `task_id` to `external_conversion_task_id`

#### Scenario: Non-ready worker status is rejected

- **WHEN** the worker posts a payload whose `status` is not exactly `"ifc_ready"`
- **THEN** `bim-review-coordinator` rejects the request with a 4xx response
- **AND** it MUST NOT create a local conversion job
- **AND** it MUST NOT dispatch an internal conversion request to `bim-streaming-server`

#### Scenario: Missing worker fields are rejected

- **WHEN** the worker payload omits or sends an empty `ifc_path`, `project_id`, `version`, or `task_id`
- **THEN** `bim-review-coordinator` rejects the request with a 4xx response
- **AND** the rejection identifies the invalid request boundary without saving partial shadow metadata

#### Scenario: Worker payload does not leak into streaming contract

- **WHEN** a worker compatibility payload is accepted
- **THEN** `bim-review-coordinator` sends `bim-streaming-server` the existing internal conversion request shape
- **AND** it MUST NOT forward the raw worker payload as the streaming API contract

