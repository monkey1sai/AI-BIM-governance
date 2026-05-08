# legacy-storage-conversion-retirement Specification

## Purpose
Define the worker-only retirement boundary for legacy local storage and
conversion services after `_worker` became the current artifact + conversion
facade. This spec keeps `_s3_storage`, `_conversion-service`, and
`_conversion-server` out of current startup, health check, smoke test, and
review-session dependencies while preserving clearly marked historical
references as archive context.
## Requirements
### Requirement: Worker-Only Demo Service Set

The current demo startup path SHALL no longer require `_s3_storage`, `_conversion-service`, or `_conversion-server` as runnable services.

#### Scenario: One-shot startup omits legacy services

- **WHEN** the root one-shot startup script is run for the current demo
- **THEN** it SHALL start `_bim-control`, `_worker`, `bim-review-coordinator`, optional `bim-streaming-server`, and optional `web-viewer-sample`, and SHALL NOT start ports `8002` or `8003`

#### Scenario: Health check omits legacy services

- **WHEN** the root development health check is run
- **THEN** it SHALL verify current services and SHALL NOT fail because `_s3_storage` or `_conversion-service` is absent

### Requirement: Runtime URLs Use Worker Objects

Current artifact, mapping, session, and streaming flows SHALL use `_worker` object URLs instead of `_s3_storage` static URLs.

#### Scenario: Conversion result uses worker URLs

- **WHEN** a conversion result is returned by `_worker`
- **THEN** source, derived model, index, and mapping URLs SHALL use the configured worker public object base URL

#### Scenario: Session artifact binding uses worker URLs

- **WHEN** a review session is created from a ready artifact group
- **THEN** coordinator session artifact bindings SHALL reference worker object URLs and SHALL NOT reference `http://127.0.0.1:8002/static`

#### Scenario: Streaming runtime loads worker URL

- **WHEN** the browser sends a stage loading request from a current session
- **THEN** `bim-streaming-server` SHALL receive a worker-hosted model URL for stage loading

### Requirement: Legacy Service References Are Removed From Current Runbooks

Current runbooks, demo UI copy, service boundary docs, contracts, scripts, and tests SHALL no longer describe `_s3_storage`, `_conversion-service`, or `_conversion-server` as current services.

#### Scenario: Current documentation is updated

- **WHEN** a user reads the current README, AGENTS, CLAUDE, or contract docs
- **THEN** `_worker` SHALL be described as the local file/conversion boundary and legacy storage/conversion services SHALL NOT appear as services to start

#### Scenario: Historical documents are clearly non-current

- **WHEN** old planning documents still mention `_s3_storage`, `_conversion-service`, or `_conversion-server`
- **THEN** they SHALL be archived or clearly labeled as historical so they are not interpreted as current runbooks

### Requirement: Legacy Folders Are Removed

The workspace SHALL remove `_s3_storage/`, `_conversion-service/`, and `_conversion-server/` after worker-only startup and validation are complete.

#### Scenario: Legacy folders are absent after migration

- **WHEN** the migration is complete
- **THEN** `_s3_storage/`, `_conversion-service/`, and `_conversion-server/` SHALL not exist as runnable service folders in the repo

#### Scenario: Verification excludes deleted services

- **WHEN** root verification scripts run after migration
- **THEN** they SHALL not attempt to run tests from `_s3_storage` or `_conversion-service`
