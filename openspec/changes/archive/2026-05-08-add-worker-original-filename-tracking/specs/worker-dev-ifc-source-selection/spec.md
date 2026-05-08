## MODIFIED Requirements

### Requirement: Start Conversion From Selected Source

`_worker` SHALL provide `POST /api/dev/ifc-sources/{source_id}/conversions` to create a source artifact from a selected dev IFC and start a conversion job through the existing worker artifact pipeline. The response, the resulting source artifact metadata, and the conversion result MUST preserve the original dev IFC filename (including non-ASCII characters) as `original_filename`, even when the on-disk object name is sanitized for path safety.

#### Scenario: Selected source starts worker job

- **WHEN** a valid `source_id` is posted with tenant, project, model version, source system, and uploaded-by metadata
- **THEN** `_worker` SHALL store the selected IFC in the versioned worker object layout, create a source artifact, create a conversion job, and return `source_artifact_id`, `artifact_group_id`, `conversion_job_id`, `status`, `original_filename`, and result lookup URLs

#### Scenario: Conversion uses existing worker result contract

- **WHEN** the selected-source conversion job succeeds
- **THEN** `GET /api/conversions/{conversion_job_id}/result` SHALL return the same derived artifact, object URL, mapping URL, readiness, and lineage shape as conversions started from `POST /api/conversions`, plus `original_filename` carried from the source artifact metadata

#### Scenario: Unknown source is rejected

- **WHEN** `POST /api/dev/ifc-sources/{source_id}/conversions` is called with an unknown, stale, non-IFC, or out-of-root `source_id`
- **THEN** `_worker` MUST return a 4xx response and MUST NOT create a source artifact or conversion job

#### Scenario: Non-ASCII source filename is preserved end-to-end

- **WHEN** a dev IFC under `WORKER_DEV_STORAGE_ROOT` has a filename containing non-ASCII characters (for example, traditional Chinese characters, spaces, or parentheses)
- **THEN** the selected-source conversion response, the worker source `metadata.json`, the conversion result, and the `_bim-control` callback payload MUST all include `original_filename` equal to the original `relative_path` filename, even though the on-disk object key uses a sanitized form for path safety
