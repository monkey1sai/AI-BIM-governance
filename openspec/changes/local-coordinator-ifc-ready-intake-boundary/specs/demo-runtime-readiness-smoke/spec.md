## MODIFIED Requirements

### Requirement: Demo runtime smoke includes B-scheme conversion tiers

Demo runtime smoke SHALL classify the B-scheme tiers independently and SHALL NOT depend on the removed `_worker` / `_bim-control` services. The default smoke SHALL drive a contract stub (`tests/fakes` + `tests/contracts`) against the single external entry point `bim-review-coordinator` `POST /api/external/ifc-ready`, and classify: `external_ifc_ready_intake`, `streaming_internal_conversion`, `mapping_quality`, `cloud_callback_outbox`, `coordinator_session_lifecycle`, `runtime_image_kit_launcher`, `single_kit_render`, `single_kit_multi_viewer`, and `usd_stage_composition`. The external customer-edge IFC Worker and the company-cloud `bim-control` are external systems simulated only by test fixtures (never started as services).

#### Scenario: External IFC-ready intake passes but streaming conversion is missing

- **WHEN** the contract stub (test-only external IFC Worker double) posts a spec-correct `ifc_ready` to `bim-review-coordinator` `POST /api/external/ifc-ready` but `bim-streaming-server` internal conversion is not listening
- **THEN** `external_ifc_ready_intake` MAY be `passed`
- **AND** `streaming_internal_conversion` is `blocked` or recorded as `dispatch_failed`
- **AND** downstream render tiers remain non-passed

#### Scenario: Streaming conversion passes without WebRTC

- **WHEN** `bim-streaming-server` internal conversion job produces valid USDC and mapping but Kit/WebRTC endpoint is not listening
- **THEN** `streaming_internal_conversion` and `mapping_quality` MAY be `passed`
- **AND** `single_kit_render` remains `blocked` or `not_observed`

#### Scenario: Cloud callback outbox is classified independently of conversion

- **WHEN** internal conversion succeeds but the company-cloud callback endpoint is unreachable (OQ1 pending: real endpoint stays `pending`)
- **THEN** `streaming_internal_conversion` MAY be `passed`
- **AND** `cloud_callback_outbox` records retained-and-retried then `dead_letter` on exhaustion, never a silent drop
- **AND** the conversion result stays locally queryable independent of callback delivery

#### Scenario: Kit launcher prerequisite missing is deferred, not passed

- **WHEN** the runtime image is validated for the produced Linux Kit launcher but NVIDIA graphics/Vulkan/GPU/Kit license prerequisites are unavailable
- **THEN** `runtime_image_kit_launcher` is `deferred` with recorded reason
- **AND** it MUST NOT be `passed`, and host-local Kit MUST NOT be used as a substitute pass

#### Scenario: Historical mock evidence is not promoted

- **WHEN** historical `_worker` / `_bim-control` evidence exists but no B-scheme contract-stub run was executed in the current pass
- **THEN** the B-scheme tiers MUST be `not_observed`, `blocked`, or `deferred`
- **AND** they MUST NOT be `passed`
