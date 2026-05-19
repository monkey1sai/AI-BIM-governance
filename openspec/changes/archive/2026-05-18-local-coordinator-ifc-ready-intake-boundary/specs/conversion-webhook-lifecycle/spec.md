## MODIFIED Requirements

### Requirement: Conversion handoff uses correlation IDs and idempotent events

The architecture SHALL use event IDs and correlation IDs across the external customer-edge IFC Worker, `bim-review-coordinator`, and `bim-streaming-server` so external IFC-ready intake, internal IFC→USDC conversion, and company-cloud callback can be traced and retried safely. The external `ifc_ready` source SHALL be the customer-edge IFC Worker and the external entry point SHALL be `bim-review-coordinator` `POST /api/external/ifc-ready`; `bim-streaming-server` SHALL only receive internal conversion requests.

#### Scenario: End-to-end correlation is preserved

- **WHEN** the customer-edge IFC Worker calls `POST /api/external/ifc-ready` on `bim-review-coordinator`
- **THEN** `bim-review-coordinator` creates or propagates `correlation_id`
- **AND** `bim-streaming-server` (internal conversion) and the company-cloud callback preserve the same correlation ID in job records, callbacks, and evidence

#### Scenario: Duplicate ifc_ready event is idempotent

- **WHEN** the customer-edge IFC Worker retries the same `ifc_ready` event to `bim-review-coordinator`
- **THEN** `bim-review-coordinator` returns the existing local conversion job if payload is compatible
- **AND** it does not create duplicate active conversion jobs for the same IFC artifact unless forced
