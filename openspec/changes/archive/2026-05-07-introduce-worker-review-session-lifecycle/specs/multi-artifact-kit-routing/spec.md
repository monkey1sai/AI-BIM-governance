## ADDED Requirements

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

The coordinator SHALL decide Kit topology from routing policy and artifact characteristics. `same_instance` MUST allow multiple compatible USDC artifacts to load as layers or payloads in one Kit instance. `dedicated_instance` MUST allocate separate Kit instances for large models, tenant isolation, or GPU-heavy artifact groups. `shared_state` MUST synchronize selection and issue focus through coordinator events rather than video synchronization.

#### Scenario: Compatible artifacts share an instance

- **WHEN** a session requests small compatible artifacts with `routing_policy=same_instance`
- **THEN** coordinator assigns them to one Kit instance binding

#### Scenario: Large model gets a dedicated instance

- **WHEN** a session requests a large or isolated artifact group with `routing_policy=dedicated_instance`
- **THEN** coordinator assigns that artifact group to its own Kit instance binding

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
