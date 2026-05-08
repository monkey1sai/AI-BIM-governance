## ADDED Requirements

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
