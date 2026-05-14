# streaming-multi-layer-payload-loading Specification Delta

## ADDED Requirements

### Requirement: openStageRequest supports explicit stage composition payload

`openStageRequest` SHALL support a payload that identifies one primary model and zero or more ordered secondary layers. The response SHALL report what was actually applied.

#### Scenario: Payload contains primary and secondary artifacts

- **WHEN** viewer sends `openStageRequest` with `stage_composition.primary` and `stage_composition.secondary_layers[]`
- **THEN** `bim-streaming-server` opens the primary model and applies secondary layers in order
- **AND** `openedStageResult` returns `applied_primary`, `applied_secondary_layers`, `skipped_secondary_layers`, and `applied_mode`

#### Scenario: Legacy URL payload is still accepted during migration

- **WHEN** viewer sends legacy payload `{ "url": "...model.usdc" }`
- **THEN** streaming server MAY open it as a single primary model during migration
- **AND** result marks `applied_mode="legacy_single_url"`

#### Scenario: Invalid composition payload is rejected

- **WHEN** payload has no primary model, multiple primary models, or invalid layer URLs
- **THEN** `bim-streaming-server` returns an error result
- **AND** it MUST NOT guess composition from unordered URL lists
