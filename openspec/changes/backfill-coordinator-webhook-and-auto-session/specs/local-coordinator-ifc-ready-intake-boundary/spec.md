## MODIFIED Requirements

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
