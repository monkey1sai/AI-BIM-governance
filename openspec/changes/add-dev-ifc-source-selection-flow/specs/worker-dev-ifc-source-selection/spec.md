## ADDED Requirements

### Requirement: Dev IFC Source Root

`_worker` SHALL expose a dev-only IFC source root for local demo input files, configured by `WORKER_DEV_STORAGE_ROOT` and defaulting to the repo root `storage/` folder.

#### Scenario: Source root is unavailable

- **WHEN** `GET /api/dev/ifc-sources` is called and the configured source root does not exist
- **THEN** the response SHALL be HTTP 200 with an empty `items` array and source root status metadata that makes the missing root diagnosable

#### Scenario: Source root is bounded

- **WHEN** `_worker` resolves files for listing or selected-source conversion
- **THEN** it MUST reject any path that resolves outside `WORKER_DEV_STORAGE_ROOT`

### Requirement: List Local IFC Sources

`_worker` SHALL provide `GET /api/dev/ifc-sources` to recursively list regular `.ifc` files under the dev source root for demo selection.

#### Scenario: IFC files are listed

- **WHEN** the dev source root contains one or more `.ifc` or `.IFC` files
- **THEN** the response SHALL include one item per IFC file with `source_id`, `filename`, `relative_path`, `size_bytes`, and `modified_at`

#### Scenario: Non-IFC files are ignored

- **WHEN** the dev source root contains files whose extension is not `.ifc`
- **THEN** those files MUST NOT appear in the `GET /api/dev/ifc-sources` response

#### Scenario: Absolute local paths are hidden

- **WHEN** `GET /api/dev/ifc-sources` returns source items
- **THEN** the response MUST NOT include absolute filesystem paths

### Requirement: Start Conversion From Selected Source

`_worker` SHALL provide `POST /api/dev/ifc-sources/{source_id}/conversions` to create a source artifact from a selected dev IFC and start a conversion job through the existing worker artifact pipeline.

#### Scenario: Selected source starts worker job

- **WHEN** a valid `source_id` is posted with tenant, project, model version, source system, and uploaded-by metadata
- **THEN** `_worker` SHALL store the selected IFC in the versioned worker object layout, create a source artifact, create a conversion job, and return `source_artifact_id`, `artifact_group_id`, `conversion_job_id`, `status`, and result lookup URLs

#### Scenario: Conversion uses existing worker result contract

- **WHEN** the selected-source conversion job succeeds
- **THEN** `GET /api/conversions/{conversion_job_id}/result` SHALL return the same derived artifact, object URL, mapping URL, readiness, and lineage shape as conversions started from `POST /api/conversions`

#### Scenario: Unknown source is rejected

- **WHEN** `POST /api/dev/ifc-sources/{source_id}/conversions` is called with an unknown, stale, non-IFC, or out-of-root `source_id`
- **THEN** `_worker` MUST return a 4xx response and MUST NOT create a source artifact or conversion job

### Requirement: Publish Metadata Only To BIM Control

Selected-source conversions SHALL preserve the existing boundary where `_worker` publishes artifact metadata and conversion result metadata to `_bim-control`, without making `_bim-control` read local files.

#### Scenario: Conversion completion callback

- **WHEN** a selected-source conversion completes and `_bim-control` is reachable
- **THEN** `_worker` SHALL publish conversion result metadata to `_bim-control` using the existing model-version conversion result callback

#### Scenario: BIM control never receives source bytes

- **WHEN** selected-source conversion metadata is published
- **THEN** `_bim-control` SHALL receive URLs, identifiers, readiness, and lineage metadata only, not IFC file bytes or local filesystem paths
