# multi-artifact-kit-routing Specification Delta

## ADDED Requirements

### Requirement: Multi-artifact routing includes primary/secondary composition policy

`bim-review-coordinator` SHALL choose a primary artifact and ordered secondary artifacts for a review session. This routing decision SHALL be separate from conversion execution and SHALL be expressed in session/stream config for `bim-streaming-server` to apply.

#### Scenario: Coordinator selects primary artifact

- **WHEN** multiple ready USDC artifacts are available
- **THEN** coordinator selects exactly one primary artifact according to documented policy
- **AND** all other selected artifacts are ordered as secondary layers

#### Scenario: Coordinator does not route non-ready artifacts as ready layers

- **WHEN** an artifact conversion status is `missing`, `converting`, `failed`, or `blocked`
- **THEN** coordinator MUST NOT include it as an applied ready layer
- **AND** it MAY list it as pending/blocked in session metadata

### Requirement: Single-Kit multi-viewer sharing is distinguished from dedicated multi-Kit routing

A single Kit instance with multiple viewers sharing one viewport SHALL be tracked separately from dedicated multi-Kit routing.

#### Scenario: Single Kit multiple viewers

- **WHEN** two viewers join the same review session and share one Kit endpoint
- **THEN** evidence may classify `single_kit_multi_viewer` as passed
- **AND** it MUST NOT classify dedicated multi-Kit routing as passed
