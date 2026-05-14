# streaming-usd-stage-composition Specification

## ADDED Requirements

### Requirement: Review sessions compose primary and secondary USDC artifacts through USD layers

The review runtime SHALL support a stage composition model where one primary USDC artifact is opened as the root model and additional USDC artifacts are composed as secondary subLayers through a runtime session layer.

#### Scenario: Primary model opens as root layer

- **WHEN** a review session has a primary artifact binding
- **THEN** `bim-streaming-server` opens the primary `model.usdc` as the root layer or root stage input
- **AND** the result identifies the applied primary artifact

#### Scenario: Secondary artifacts are added as subLayers

- **WHEN** secondary artifact bindings are present
- **THEN** `bim-streaming-server` applies them in coordinator-provided order as subLayers or equivalent composition inputs
- **AND** the opened-stage result reports applied and skipped secondary layers

#### Scenario: Secondary layer failure does not hide primary success

- **WHEN** primary loads but one secondary layer is missing or invalid
- **THEN** primary open MAY still be `passed`
- **AND** the secondary layer is reported as `failed` or `skipped` with reason

### Requirement: Coordinator decides composition policy and streaming applies it

`bim-review-coordinator` SHALL decide primary/secondary ordering and include composition policy in session/stream config. `bim-streaming-server` SHALL apply the policy but SHALL NOT become project metadata authority.

#### Scenario: Coordinator sends composition policy

- **WHEN** viewer joins a review session
- **THEN** stream config includes `stage_composition.primary_artifact_id` and ordered `secondary_artifact_ids`
- **AND** viewer uses this payload to request stage opening

#### Scenario: Streaming server rejects ambiguous primary

- **WHEN** openStageRequest includes no primary or more than one primary
- **THEN** `bim-streaming-server` returns an explicit error
- **AND** it does not guess a primary model from unordered URLs
