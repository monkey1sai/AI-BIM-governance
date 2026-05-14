# streaming-multi-layer-payload-loading Specification

## Purpose
Define how `bim-streaming-server` loads multiple ready artifact bindings into a
single Kit runtime stage for `same_instance` review sessions. Runtime responses
must honestly report the applied loading mode, loaded bindings, missing paths,
and partial failures while preserving the existing single-URL stage loading
path.
## Requirements
### Requirement: Load Multiple Artifact Bindings Into One Runtime Stage

`bim-streaming-server` SHALL load every loadable model artifact binding in a `same_instance` review session into the active USD runtime stage, ordered by `artifact_bindings[].load_order`.

Technical note: this requirement describes USD runtime composition, not a merged USDC artifact. The first loadable binding is the primary/root model for the Kit runtime stage; secondary bindings are composed through the stage session layer, typically by appending their resolved layer identifiers to `stage.GetSessionLayer().subLayerPaths`. The source IFC files and derived USD/USDC artifacts remain independently traceable through `_worker` lineage, mapping metadata, and object URLs.

#### Scenario: Multi-binding session composes all loadable artifacts

- **WHEN** an `openStageRequest` or `loadArtifactGroupRequest` contains two or more ready `artifact_bindings` with model URLs
- **THEN** the runtime SHALL open the first binding as the primary stage and SHALL compose every remaining loadable binding into that stage as a sublayer or payload

#### Scenario: Load order is preserved

- **WHEN** multiple artifact bindings have different `load_order` values
- **THEN** the runtime SHALL process them in ascending `load_order`, using the first loadable binding as the primary stage

#### Scenario: Partial multi-binding failures are reported

- **WHEN** one or more secondary bindings cannot be composed
- **THEN** `openedStageResult` SHALL include loaded binding metadata, failed binding metadata, and `partial_load=true` while keeping the successfully opened primary stage available

#### Scenario: Single URL remains backward compatible

- **WHEN** `openStageRequest` contains only a top-level `url`
- **THEN** the runtime SHALL preserve the existing single-stage behavior and SHALL NOT require `artifact_bindings`

### Requirement: Multi-Binding Result Metadata Is Honest

`bim-streaming-server` SHALL report whether a stage request used `single_url`, `artifact_bindings_single`, or `artifact_bindings_multi_layer_payload`, and SHALL NOT claim multi-artifact success when only the first binding was loaded.

#### Scenario: Multi-binding success reports composition strategy

- **WHEN** all requested model bindings are loaded
- **THEN** `openedStageResult` SHALL include `applied_mode="artifact_bindings_multi_layer_payload"`, `primary_binding`, `loaded_bindings`, `failed_bindings=[]`, and the composition strategy used for each secondary binding

#### Scenario: Missing binding URLs remain diagnosable

- **WHEN** an artifact binding lacks a model URL
- **THEN** the runtime SHALL include that binding identifier in `missing_paths` and SHALL NOT treat it as loaded evidence

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
