# conversion-kit-lifecycle-recovery Specification

## Purpose
定義 conversion artifact readiness、terminal conversion failure recovery，以及 Kit stage-open 與 viewer first-frame 證據分離的跨服務契約，避免缺檔產物或 metadata binding 被誤報為可用 runtime。
## Requirements
### Requirement: Conversion ready status requires serveable artifacts

`bim-streaming-server` SHALL NOT publish or continue serving a conversion job as ready when the persisted job/result metadata points to required artifact files that are missing or not serveable by the conversion authority.

Required artifacts for ready IFC→USDC output include the primary `model.usdc`, `metadata.json`, and any required sidecars declared by the result (`element_mapping.json`, `entity_index.json` when requested). The authority MAY preserve the original converter exit status in diagnostics, but browser-visible and coordinator-consumed readiness MUST reflect current artifact availability.

#### Scenario: persisted ready job loses model.usdc

- **WHEN** a persisted conversion job result says `status="succeeded"` or `ready=true`
- **AND** the `model.usdc` file referenced by the result does not exist on disk or cannot be served from `/artifacts/.../model.usdc`
- **THEN** `GET /api/conversions`, `GET /api/conversions/{id}`, and `GET /api/conversions/{id}/result` MUST expose the job as non-ready
- **AND** the response MUST include a diagnostic reason such as `artifact_missing`
- **AND** coordinator MUST NOT create or present a viewer-open-ready review session from that result

#### Scenario: ready job artifacts are serveable

- **WHEN** a conversion job has required artifacts present on disk
- **AND** the authority can serve `model.usdc` from its public artifact URL
- **THEN** the job MAY be exposed as `ready=true` / `status="succeeded"`
- **AND** coordinator MAY ingest it as conversion-ready metadata

### Requirement: Terminal converter failures recover by re-trigger, not dispatch retry

`bim-review-coordinator` SHALL distinguish dispatch failures from terminal converter failures. Dispatch retry is only valid before a conversion job is successfully accepted by `bim-streaming-server`. Once a conversion job reaches terminal `failed`, recovery SHALL be modeled as re-ingest or re-trigger from the source IFC, producing a new conversion attempt/correlation trail rather than mutating the terminal conversion job into ready.

#### Scenario: dispatch failure remains retryable

- **WHEN** an ifc-ready job has `status="dispatch_failed"` or `status="dropped_on_restart"`
- **THEN** the existing retry action MAY requeue the original pending dispatch context
- **AND** no new source IFC trigger is required if pending dispatch context still exists

#### Scenario: converter failure requires source re-trigger

- **WHEN** an ifc-ready job has a `conversion_job_id`
- **AND** its conversion lifecycle is terminal `failed`
- **THEN** `/api/conversion/jobs/:id/retry` MUST NOT pretend dispatch retry can rerun the converter
- **AND** browser-visible job summary MUST expose a recovery action equivalent to `retrigger_required` or `reingest_required`
- **AND** the operator-facing action MUST submit a new ifc-ready/trigger request from the source IFC when source access is still available

#### Scenario: source IFC cache is missing

- **WHEN** a terminal failed conversion job points at a source IFC cache path that no longer exists
- **THEN** the recovery status MUST say source re-trigger is required
- **AND** the system MUST NOT present the old job as directly retryable

### Requirement: Kit binding intent is separate from stage-open proof

`bim-review-coordinator` SHALL expose Kit capacity/binding intent separately from actual Kit stage-open state. `kit_instance_bindings.status="ready"` or equivalent local-fixed allocation SHALL NOT by itself mean that a USDC has been opened in Kit/GPU runtime.

#### Scenario: session is created from ready artifact before Kit open

- **WHEN** coordinator creates a review session for a serveable ready USDC artifact
- **THEN** it MAY record a Kit binding intent and stream endpoint
- **AND** it MUST expose stage-open state as `not_requested`, `requested`, `sent`, `blocked`, or equivalent non-opened state until runtime command evidence exists
- **AND** UI MUST NOT label the session as stage-opened solely from `kit_instance_bindings`

#### Scenario: Kit manager sends openStageRequest

- **WHEN** an operator or automated policy opens a ready artifact in Kit
- **THEN** the command MUST flow through kit-manager or the streaming runtime control path
- **AND** the command payload MUST identify the primary runtime URI and any secondary layers
- **AND** coordinator/runtime status MAY advance stage-open state only from command acknowledgement or DataChannel evidence

#### Scenario: viewer first frame remains separate evidence

- **WHEN** Kit open command is sent or acknowledged
- **THEN** viewer first-frame evidence remains `not_observed` until a browser/WebRTC client reports or proves first frame
- **AND** full-system E2E MUST NOT be declared complete from conversion-ready or stage-open metadata alone
