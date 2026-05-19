## MODIFIED Requirements

### Requirement: Conversion handoff uses correlation IDs and idempotent events

The architecture SHALL use event IDs and correlation IDs across the external customer-edge IFC Worker, `bim-review-coordinator`, and `bim-streaming-server` so external IFC-ready intake, internal IFC→USDC conversion, and company-cloud callback can be traced and retried safely. The external `ifc_ready` source SHALL be the customer-edge IFC Worker and the external entry point SHALL be `bim-review-coordinator` `POST /api/external/ifc-ready`; `bim-streaming-server` SHALL only receive internal conversion requests. When the worker sends the compatibility payload (`status`, `ifc_path`, `project_id`, `version`, `task_id`) instead of the canonical payload, `bim-review-coordinator` SHALL derive the missing correlation and idempotency values at the intake boundary and SHALL preserve those values through internal conversion and callback evidence.

#### Scenario: End-to-end correlation is preserved

- **WHEN** the customer-edge IFC Worker calls `POST /api/external/ifc-ready` on `bim-review-coordinator`
- **THEN** `bim-review-coordinator` creates or propagates `correlation_id`
- **AND** `bim-streaming-server` (internal conversion) and the company-cloud callback preserve the same correlation ID in job records, callbacks, and evidence

#### Scenario: Worker task id becomes traceable fallback

- **WHEN** the worker compatibility payload supplies `task_id` but no explicit correlation or idempotency key
- **THEN** `bim-review-coordinator` derives stable retry metadata from `project_id`, `version`, and `task_id`
- **AND** the derived values are visible on the local IFC-ready job, internal conversion request, and later callback evidence

#### Scenario: Duplicate ifc_ready event is idempotent

- **WHEN** the customer-edge IFC Worker retries the same `ifc_ready` event to `bim-review-coordinator`
- **THEN** `bim-review-coordinator` returns the existing local conversion job if payload is compatible
- **AND** it does not create duplicate active conversion jobs for the same IFC artifact unless forced

#### Scenario: Worker compatibility payload enters internal conversion exactly once

- **WHEN** the worker posts the same compatible `project_id`, `version`, `task_id`, and `ifc_path` more than once
- **THEN** only the first accepted request dispatches a new internal conversion request
- **AND** later compatible retries return the existing local job state

### Requirement: Failed upstream stages do not create downstream success

A failed or blocked RVT→IFC export SHALL NOT create a streaming conversion job. A failed streaming conversion job SHALL NOT create a ready review artifact. For the worker compatibility payload, only `status="ifc_ready"` SHALL be treated as a completed upstream IFC export; all other worker statuses MUST be rejected or handled as non-ready upstream states without dispatching internal conversion.

#### Scenario: RVT export blocked

- **WHEN** the customer-edge IFC Worker classifies RVT→IFC as blocked or not ready
- **THEN** it MUST NOT create a downstream ready artifact
- **AND** `bim-review-coordinator` MUST NOT dispatch internal IFC→USDC conversion from a non-`ifc_ready` worker status

#### Scenario: IFC conversion failed

- **WHEN** `bim-streaming-server` marks conversion failed
- **THEN** company-cloud callback metadata reports `failed` or equivalent not-ready state
- **AND** coordinator/viewer do not present the model as openable
