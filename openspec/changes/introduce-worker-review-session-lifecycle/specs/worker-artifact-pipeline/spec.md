## ADDED Requirements

### Requirement: Worker accepts source artifacts

`_worker` SHALL expose `POST /api/artifacts` for IFC/RVT/DWG source artifact intake. The request MUST include enough lineage context to associate the file with `tenant_id`, `project_id`, `model_version_id`, `source_system`, and uploader identity. `_worker` SHALL persist file bytes in its object layer and return a stable `source_artifact_id`, checksum, object URL, and upload status without making `_bim-control` store file bytes.

#### Scenario: Source IFC artifact is uploaded

- **WHEN** a client calls `POST /api/artifacts` with a valid IFC file or signed upload reference and model lineage fields
- **THEN** `_worker` returns a `source_artifact_id`, checksum, object URL, and `status=uploaded`

#### Scenario: Source artifact is missing lineage

- **WHEN** a client calls `POST /api/artifacts` without `project_id` or `model_version_id`
- **THEN** `_worker` rejects the request and does not create an orphan artifact

### Requirement: Worker manages conversion jobs

`_worker` SHALL expose `POST /api/conversions` to create conversion jobs from a `source_artifact_id`. A conversion job MUST track `queued`, `running`, `succeeded`, and `failed` states, and it MUST record `target_format`, `generate_mapping`, `created_at`, and conversion lineage.

#### Scenario: USDC conversion is queued

- **WHEN** a client calls `POST /api/conversions` with an existing `source_artifact_id`, `target_format=usdc`, and `generate_mapping=true`
- **THEN** `_worker` returns a `conversion_job_id` with `status=queued`

#### Scenario: Conversion source is unknown

- **WHEN** a client calls `POST /api/conversions` with an unknown `source_artifact_id`
- **THEN** `_worker` returns an error and does not enqueue a conversion job

### Requirement: Worker publishes derived artifact results

`_worker` SHALL expose `GET /api/conversions/{id}` and `GET /api/conversions/{id}/result`. A succeeded result MUST include derived artifact identifiers and URLs for `model.usdc`, `ifc_index.json`, `usd_index.json`, and `element_mapping.json` when mapping generation is requested.

#### Scenario: Conversion result is ready

- **WHEN** a conversion job has succeeded
- **THEN** `GET /api/conversions/{id}/result` returns derived artifact IDs, object URLs, `mapping_url`, and conversion lineage

#### Scenario: Conversion result is not ready

- **WHEN** a conversion job is still `queued` or `running`
- **THEN** `GET /api/conversions/{id}/result` reports the current status and does not claim derived artifacts are ready

### Requirement: Worker uses versioned object layout

`_worker` MUST store source and derived artifacts under a versioned object layout that includes tenant, project, model version, artifact group, source artifact, and conversion job lineage. Each artifact group MUST include `metadata.json` with `artifact_id`, `parent_artifact_id`, `artifact_group_id`, `source_system`, `source_format`, `sha256`, `version_no`, `uploaded_by`, `conversion_job_id`, `created_at`, and lineage.

#### Scenario: Derived USDC files are written

- **WHEN** a conversion job succeeds
- **THEN** `_worker` writes derived files under `derived/{conversion_job_id}/usdc/` and writes `metadata.json` with lineage fields

#### Scenario: Duplicate source bytes are uploaded

- **WHEN** a source artifact with the same checksum is uploaded again for the same model version
- **THEN** `_worker` records lineage without overwriting unrelated artifact groups

### Requirement: Worker reports metadata without taking BIM authority

`_worker` MUST notify `_bim-control` of conversion success or failure using metadata, artifact IDs, URLs, mapping URL, and lineage. `_worker` MUST NOT become the authority for project, model version, review issue, annotation, or review intent data.

#### Scenario: Conversion success is reported

- **WHEN** `_worker` completes a conversion job successfully
- **THEN** `_bim-control` can discover ready artifact metadata while the file bytes remain owned by `_worker`

#### Scenario: Conversion fails

- **WHEN** `_worker` cannot produce the requested target artifact
- **THEN** `_worker` reports failure metadata and log URL without creating a ready artifact record
