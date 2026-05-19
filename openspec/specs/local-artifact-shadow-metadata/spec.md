# local-artifact-shadow-metadata Specification

## Purpose
TBD - created by archiving change local-coordinator-ifc-ready-intake-boundary. Update Purpose after archive.
## Requirements
### Requirement: Company cloud and local runtime own distinct metadata authorities

The company cloud `bim-control` SHALL remain the authority for control-plane metadata: tenant/customer, project, user, role/permission/RBAC, license, model version / commit record, IFC conversion task request, version history, high-level artifact index, and callback receipt status. This repo SHALL be the authority for data-plane metadata: local conversion job state, source IFC / USDC / element_mapping local availability, artifact manifest, converter version, runtime image digest, Kit launcher validation evidence, local web view session, and callback outbox retry state.

#### Scenario: Control-plane metadata is not re-owned locally

- **WHEN** project / user / RBAC / license / model-version authority is needed
- **THEN** the company cloud `bim-control` is the authority
- **AND** this repo does not present itself as the authority for that metadata

#### Scenario: Data-plane availability is owned locally

- **WHEN** local conversion job state or local artifact availability is queried
- **THEN** this repo answers as the authority
- **AND** it does not require the company cloud to answer local artifact availability

### Requirement: Local runtime keeps only minimal shadow metadata, not a cloud mirror

This repo SHALL persist only the minimal shadow fields required for idempotency, conversion, local web view, and callback retry: `tenant_id`, `project_id`, `external_model_version_id`, `external_conversion_task_id`, `correlation_id`, `source_ifc_ref`, `source_ifc_etag` (checksum), `conversion_job_id`, `artifact_manifest_ref`, `callback_url`, `callback_status`, `last_callback_attempt_at`. It MUST NOT mirror the full company cloud database.

#### Scenario: No full database mirror

- **WHEN** local runtime needs identifiers to run a job, resolve a viewer artifact, or retry a callback
- **THEN** only the minimal shadow field set is stored locally
- **AND** the local store is not a synchronized copy of the company cloud MySQL

#### Scenario: External platform stays the model-version authority

- **WHEN** model version truth is needed
- **THEN** the external company cloud platform remains authoritative
- **AND** the local shadow record references it via `external_model_version_id` without claiming authority

