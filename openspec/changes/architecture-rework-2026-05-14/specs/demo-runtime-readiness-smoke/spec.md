# demo-runtime-readiness-smoke Specification Delta

## MODIFIED Requirements

### Requirement: Demo runtime smoke includes B-scheme conversion tiers

Demo runtime smoke SHALL classify the new B-scheme tiers independently: `rvt_intake`, `rvt_to_ifc_bridge`, `streaming_conversion_job`, `mapping_quality`, `coordinator_session_lifecycle`, `single_kit_render`, `single_kit_multi_viewer`, and `usd_stage_composition`.

#### Scenario: RVT intake passes but export is blocked

- **WHEN** `_bim-control` accepts fake RVT intake but `_worker` has no Revit runtime and no fixture mode
- **THEN** `rvt_intake` MAY be `passed`
- **AND** `rvt_to_ifc_bridge` is `blocked`
- **AND** downstream streaming conversion tiers remain non-passed

#### Scenario: Worker IFC ready passes but streaming conversion is missing

- **WHEN** `_worker` emits valid `ifc_ready` but `bim-streaming-server` conversion API is not listening
- **THEN** `rvt_to_ifc_bridge` MAY be `passed`
- **AND** `streaming_conversion_job` is `blocked`

#### Scenario: Streaming conversion passes without WebRTC

- **WHEN** `bim-streaming-server` conversion job produces valid USDC and mapping but Kit/WebRTC endpoint is not listening
- **THEN** `streaming_conversion_job` and `mapping_quality` MAY be `passed`
- **AND** `single_kit_render` remains `blocked` or `not_observed`

#### Scenario: Historical worker evidence is not promoted

- **WHEN** historical `_worker` conversion evidence exists but no streaming-server-owned conversion run was executed in the current pass
- **THEN** `streaming_conversion_job` MUST be `not_observed`, `blocked`, or `deferred`
- **AND** it MUST NOT be `passed`

### Requirement: Demo smoke records authority boundary in evidence

Every evidence record for conversion readiness SHALL include the owning service boundary.

#### Scenario: Conversion result is streaming-owned

- **WHEN** streaming conversion job passes
- **THEN** evidence records `conversion_authority="bim-streaming-server"`, `conversion_job_id`, derived artifact IDs, mapping artifact ID, and quality metrics summary
