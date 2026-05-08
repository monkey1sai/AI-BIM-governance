# worker-artifact-pipeline Specification

## Purpose
TBD - created by archiving change introduce-worker-review-session-lifecycle. Update Purpose after archive.
## Requirements
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

### Requirement: Worker preserves original filename in source metadata

`_worker` SHALL preserve the unsanitized client-provided filename as `original_filename` in source artifact metadata, the source artifact index, the source artifact API response, and the conversion result payload published to `_bim-control`. Disk object names MAY remain sanitized for path safety, but the metadata layer MUST keep the original filename so traceability survives across non-ASCII or special characters.

#### Scenario: Source artifact metadata records the original filename

- **WHEN** a client calls `POST /api/artifacts` with a `filename` containing non-ASCII characters or characters outside `[A-Za-z0-9_.-]`
- **THEN** the source artifact `metadata.json` written under the versioned object layout MUST include `original_filename` equal to the request `filename` byte-for-byte (no sanitization), while the on-disk object key MAY use a sanitized filename for path safety

#### Scenario: Source artifact index records the original filename

- **WHEN** `_worker` upserts an entry into `data/objects/_index/source_artifacts.json`
- **THEN** the entry MUST include `original_filename` so that consumers can recover the original filename without opening the per-artifact `metadata.json`

#### Scenario: Source artifact API response includes the original filename

- **WHEN** `POST /api/artifacts` succeeds
- **THEN** the response body MUST include `original_filename` equal to the request `filename`

#### Scenario: Conversion result includes the original filename

- **WHEN** a conversion job started from any source artifact succeeds
- **THEN** `GET /api/conversions/{conversion_job_id}/result` MUST include `original_filename` carried from the source artifact metadata

#### Scenario: Callback to BIM control includes the original filename

- **WHEN** `_worker` publishes a successful conversion result to `_bim-control` via the model-version conversion-result callback
- **THEN** the callback payload MUST include `original_filename`, and `_bim-control` MUST set the source IFC artifact `name` field to that value when present, falling back to the existing default name when the field is absent

#### Scenario: Backward-compatible reads of legacy metadata

- **WHEN** `_worker` reads an existing `metadata.json` or `_index/source_artifacts.json` entry that was written before this requirement existed
- **THEN** the read path MUST treat `original_filename` as optional and MUST NOT fail or refuse to serve the artifact when the field is missing

