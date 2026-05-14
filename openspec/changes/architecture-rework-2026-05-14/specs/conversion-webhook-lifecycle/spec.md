# conversion-webhook-lifecycle Specification

## ADDED Requirements

### Requirement: Conversion handoff uses correlation IDs and idempotent events

The architecture SHALL use event IDs and correlation IDs across `_bim-control`, `_worker`, and `bim-streaming-server` so RVT intake, RVT→IFC export, and IFC→USDC conversion can be traced and retried safely.

#### Scenario: End-to-end correlation is preserved

- **WHEN** `_bim-control` accepts RVT intake
- **THEN** it creates or propagates `correlation_id`
- **AND** `_worker` and `bim-streaming-server` preserve the same correlation ID in job records, callbacks, and evidence

#### Scenario: Duplicate ifc_ready event is idempotent

- **WHEN** `_worker` retries the same `ifc_ready` event
- **THEN** `bim-streaming-server` returns the existing conversion job if payload is compatible
- **AND** it does not create duplicate active conversion jobs for the same IFC artifact unless forced

### Requirement: Webhook failures are observable and retryable

Webhook delivery failures SHALL be reported as explicit job or event states, not silent missing artifacts.

#### Scenario: Worker cannot reach streaming server

- **WHEN** `_worker` cannot deliver `ifc_ready`
- **THEN** the export job remains `ifc_ready_pending_delivery` or equivalent
- **AND** evidence records the target URL, retry count, and next retry command or action

#### Scenario: Streaming server cannot callback bim-control

- **WHEN** conversion completes but `_bim-control` callback fails
- **THEN** conversion job remains queryable from `bim-streaming-server`
- **AND** callback status is reported separately from conversion success

### Requirement: Failed upstream stages do not create downstream success

A failed or blocked RVT→IFC export SHALL NOT create a streaming conversion job. A failed streaming conversion job SHALL NOT create a ready review artifact.

#### Scenario: RVT export blocked

- **WHEN** `_worker` classifies RVT→IFC as blocked
- **THEN** it MUST NOT send `ifc_ready`
- **AND** `bim-streaming-server` MUST NOT create a conversion job from that blocked export

#### Scenario: IFC conversion failed

- **WHEN** `bim-streaming-server` marks conversion failed
- **THEN** `_bim-control` model artifact status is `failed` or `not_ready`
- **AND** coordinator/viewer do not present the model as openable
