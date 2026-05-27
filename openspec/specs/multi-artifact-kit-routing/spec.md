# multi-artifact-kit-routing Specification

## Purpose
Define how review sessions bind multiple artifacts to one or more Kit runtime
instances. The coordinator records artifact bindings, Kit instance bindings,
routing policy, stream configuration, capacity identity, and same/dedicated/
shared topology decisions while keeping collaboration session identity separate
from Kit runtime capacity.

Dedicated multi-Kit runtime execution is deferred until GPU purchase and
deployment provide at least two GPU-backed Kit endpoints. Before that capacity
exists, this specification remains the control-plane contract and routing
target, not proof that dedicated runtime evidence has passed.
## Requirements
### Requirement: Sessions contain artifact bindings

`bim-review-coordinator` SHALL store `artifact_bindings[]` for each review session. Each binding MUST include `artifact_group_id`, `model_version_id`, `artifact_id`, `artifact_role`, URL fields, `mapping_url` when available, `load_order`, `routing_policy`, and `ready_status`.

#### Scenario: Session binds a base model

- **WHEN** a review session is created for a ready base model artifact group
- **THEN** the session contains an artifact binding with `artifact_role=derived`, `ready_status=ready`, and a loadable USDC URL

#### Scenario: Mapping artifact is missing

- **WHEN** an artifact group has a model URL but no mapping URL
- **THEN** the artifact binding reports mapping readiness without pretending issue highlight mapping is available

### Requirement: Sessions contain Kit instance bindings

`bim-review-coordinator` SHALL store `kit_instance_bindings[]` for each review session. Each binding MUST include `kit_instance_id`, `provider`, `tenant_id`, `assigned_artifact_ids[]`, `status`, `stream_config`, `started_at`, `last_heartbeat_at`, `released_at`, and GPU profile or capacity slot information when available.

#### Scenario: Kit instance is allocated

- **WHEN** coordinator assigns artifacts to a Kit instance
- **THEN** the session records a Kit instance binding with assigned artifacts and stream configuration

#### Scenario: Kit instance drains

- **WHEN** a session begins closing
- **THEN** its Kit instance binding moves toward `draining` and then `released`

### Requirement: Routing policy determines Kit topology

The coordinator SHALL decide Kit topology from routing policy and artifact characteristics. `same_instance` MUST allow multiple compatible USDC artifacts to load as layers or payloads in one Kit instance. `dedicated_instance` MUST record separate Kit instance allocation intent for large models, tenant isolation, or GPU-heavy artifact groups and MUST allocate separate Kit instances when GPU capacity is available. `shared_state` MUST synchronize selection and issue focus through coordinator events rather than video synchronization.

Technical note: for `same_instance`, the coordinator only assigns compatible artifacts to one Kit instance; the actual multi-model viewport is produced by `bim-streaming-server` USD runtime composition. The first ready artifact binding is opened as the primary/root stage, and secondary USD/USDC artifacts are composed through the USD session layer. This preserves independent `_worker` artifact lineage and avoids generating a new merged USDC file.

#### Scenario: Compatible artifacts share an instance

- **WHEN** a session requests small compatible artifacts with `routing_policy=same_instance`
- **THEN** coordinator assigns them to one Kit instance binding

#### Scenario: Large model gets a dedicated instance

- **WHEN** a session requests a large or isolated artifact group with `routing_policy=dedicated_instance` and deployed GPU capacity is available
- **THEN** coordinator assigns that artifact group to its own Kit instance binding

#### Scenario: Dedicated runtime capacity is not deployed yet

- **WHEN** a session requests `routing_policy=dedicated_instance` before purchased and deployed GPU capacity exposes two or more Kit endpoints
- **THEN** the coordinator records the requested dedicated topology and leaves runtime allocation evidence pending
- **AND** the workspace does not classify dedicated_instance runtime evidence as passed or failed

#### Scenario: Shared state spans instances

- **WHEN** a session uses multiple Kit instances with shared review context
- **THEN** selection, issue focus, and annotation collaboration are synchronized through Socket.IO session events

### Requirement: Streaming runtime loads bound artifacts honestly

`bim-streaming-server` SHALL support loading artifacts from coordinator-provided bindings through `openStageRequest` or optional `loadArtifactGroupRequest`. Runtime responses MUST include applied mode and missing path information, and MUST NOT silently convert missing mapping paths into successful mapping evidence.

#### Scenario: Artifact group is loaded

- **WHEN** web viewer sends a load request for a bound artifact group
- **THEN** streaming runtime loads artifacts according to `load_order` and returns a success result with applied mode

#### Scenario: Prim path is missing

- **WHEN** a highlight or focus request references a prim path that is not present in the loaded stage
- **THEN** streaming runtime returns the path under `missing_paths` or equivalent result details

### Requirement: Session identity is independent from Kit identity

The system MUST treat `session_id` as the collaboration room identity and `kit_instance_id` as runtime capacity identity. A review session MAY reference zero, one, or many Kit instance bindings depending on lifecycle and routing state.

#### Scenario: Session waits for capacity

- **WHEN** a review session exists but no Kit instance is ready
- **THEN** clients can query session lifecycle while streaming connection is deferred

#### Scenario: Multiple viewers join one session

- **WHEN** multiple clients join the same `session_id`
- **THEN** they share collaboration events even if the underlying artifacts are served by more than one Kit instance

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

A single Kit instance with multiple viewers sharing one review session SHALL be tracked separately from dedicated multi-Kit routing. For this pass, `single_kit_multi_viewer` MAY be proven by two or more browser clients using the same `review_session_id` and the same Kit endpoint, provided each viewer has its own WebRTC lifecycle evidence and stage-load/video readiness evidence.

Dedicated multi-Kit routing SHALL remain a separate capacity tier requiring separate Kit process or endpoint pool evidence. Passing same-session multi-viewer evidence MUST NOT mark dedicated multi-Kit routing as passed.

#### Scenario: Single Kit multiple viewers

- **WHEN** two viewers join the same review session and share one Kit endpoint
- **THEN** evidence may classify `single_kit_multi_viewer` as passed
- **AND** it MUST NOT classify dedicated multi-Kit routing as passed

#### Scenario: Viewers share session identity but keep client evidence separate

- **WHEN** two browser clients open the same `review_session_id`
- **THEN** coordinator-visible session state records both participants or viewer observations
- **AND** each viewer has separate browser readiness and screenshot evidence
- **AND** both viewers reference the same expected stage URL from the session stream config

#### Scenario: Dedicated multi-Kit remains deferred

- **WHEN** the evidence only shows two clients connected to one Kit endpoint
- **THEN** `single_kit_multi_viewer` MAY be `passed`
- **AND** dedicated multi-Kit runtime evidence MUST remain `deferred`, `not_observed`, or otherwise non-passed

