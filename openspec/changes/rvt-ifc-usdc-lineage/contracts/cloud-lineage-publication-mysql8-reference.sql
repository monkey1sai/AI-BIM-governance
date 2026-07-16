-- REFERENCE ONLY - NOT A MIGRATION - DO NOT EXECUTE FROM THIS REPOSITORY.
--
-- Direction:
--   edge bim-review-coordinator
--     -> external company-cloud bim-control
--     -> cloud MySQL
--
-- The external bim-control repository owns physical schema names, migrations,
-- credentials, deployment and live-database validation. This reference maps the
-- normative logical model only. It intentionally contains no per-element
-- RVT/IFC/USDC lineage table; complete rows remain in customer-edge MinIO.

CREATE TABLE lineage_publications (
    publication_identity VARCHAR(512) NOT NULL,
    registration_id VARCHAR(200) NOT NULL,
    first_event_id CHAR(36) NOT NULL,
    edge_site_id VARCHAR(120) NOT NULL,
    tenant_id VARCHAR(200) NOT NULL,
    project_id VARCHAR(200) NOT NULL,
    external_model_version_id VARCHAR(200) NOT NULL,
    source_bundle_id VARCHAR(200) NOT NULL,
    pipeline_job_id VARCHAR(200) NOT NULL,
    attempt_id VARCHAR(200) NOT NULL,
    result_id VARCHAR(200) NOT NULL,
    attempt_outcome VARCHAR(32) NOT NULL,
    manifest_digest CHAR(64) NOT NULL,
    result_manifest_ref JSON NOT NULL,
    lineage_mapping_ref JSON NOT NULL,
    alignment_report_json_ref JSON NOT NULL,
    alignment_report_csv_ref JSON NOT NULL,
    alignment_summary JSON NOT NULL,
    current_health_state ENUM(
        'VERIFIED',
        'MISSING',
        'INTEGRITY_FAILED',
        'TOMBSTONED'
    ) NOT NULL DEFAULT 'VERIFIED',
    published_at DATETIME(6) NOT NULL,
    stored_at DATETIME(6) NOT NULL,
    PRIMARY KEY (publication_identity),
    UNIQUE KEY uq_lineage_publications_registration (registration_id),
    UNIQUE KEY uq_lineage_publications_first_event (first_event_id),
    UNIQUE KEY uq_lineage_publications_result (
        edge_site_id,
        external_model_version_id,
        result_id
    ),
    CONSTRAINT ck_lineage_publications_manifest_digest
        CHECK (manifest_digest REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_publications_attempt_outcome
        CHECK (
            attempt_outcome IN (
                'succeeded',
                'succeeded_with_warnings',
                'failed',
                'cancelled'
            )
        ),
    CONSTRAINT ck_lineage_publications_refs_are_objects
        CHECK (
            JSON_TYPE(result_manifest_ref) = 'OBJECT'
            AND JSON_TYPE(lineage_mapping_ref) = 'OBJECT'
            AND JSON_TYPE(alignment_report_json_ref) = 'OBJECT'
            AND JSON_TYPE(alignment_report_csv_ref) = 'OBJECT'
            AND JSON_TYPE(alignment_summary) = 'OBJECT'
        )
) ENGINE = InnoDB;

CREATE TABLE lineage_publication_health_events (
    health_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id CHAR(36) NOT NULL,
    publication_identity VARCHAR(512) NOT NULL,
    manifest_digest CHAR(64) NOT NULL,
    health_state ENUM(
        'VERIFIED',
        'MISSING',
        'INTEGRITY_FAILED',
        'TOMBSTONED'
    ) NOT NULL,
    confirmation_count INT UNSIGNED NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    tombstone_record_id VARCHAR(200) NULL,
    original_result_manifest_ref JSON NOT NULL,
    observed_at DATETIME(6) NOT NULL,
    stored_at DATETIME(6) NOT NULL,
    PRIMARY KEY (health_event_id),
    UNIQUE KEY uq_lineage_health_event (event_id),
    KEY ix_lineage_health_publication_time (
        publication_identity,
        observed_at
    ),
    CONSTRAINT fk_lineage_health_publication
        FOREIGN KEY (publication_identity)
        REFERENCES lineage_publications (publication_identity)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT ck_lineage_health_manifest_digest
        CHECK (manifest_digest REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_health_confirmation
        CHECK (
            confirmation_count >= 1
            AND (
                health_state NOT IN ('MISSING', 'INTEGRITY_FAILED')
                OR confirmation_count >= 2
            )
        ),
    CONSTRAINT ck_lineage_health_tombstone_record
        CHECK (
            health_state <> 'TOMBSTONED'
            OR tombstone_record_id IS NOT NULL
        ),
    CONSTRAINT ck_lineage_health_ref_is_object
        CHECK (JSON_TYPE(original_result_manifest_ref) = 'OBJECT')
) ENGINE = InnoDB;

CREATE TABLE lineage_event_receipts (
    receipt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id CHAR(36) NOT NULL,
    event_type ENUM(
        'lineage_result_published',
        'lineage_result_health_changed'
    ) NOT NULL,
    publication_identity VARCHAR(512) NOT NULL,
    manifest_digest CHAR(64) NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    registration_id VARCHAR(200) NOT NULL,
    received_at DATETIME(6) NOT NULL,
    replay BOOLEAN NOT NULL,
    PRIMARY KEY (receipt_id),
    KEY ix_lineage_receipts_event (
        event_id,
        received_at
    ),
    KEY ix_lineage_receipts_publication (
        publication_identity,
        received_at
    ),
    CONSTRAINT fk_lineage_receipts_publication
        FOREIGN KEY (publication_identity)
        REFERENCES lineage_publications (publication_identity)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT ck_lineage_receipts_manifest_digest
        CHECK (manifest_digest REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_receipts_payload_digest
        CHECK (payload_sha256 REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_receipts_replay
        CHECK (replay IN (0, 1))
) ENGINE = InnoDB;

-- Normative transaction rules live in the OpenSpec capability:
-- - first valid event commit -> HTTP 201
-- - published same identity + digest + immutable content -> HTTP 200 replay
-- - new health event_id -> append health event and receipt, HTTP 201
-- - same health event_id + same payload_sha256 -> append replay receipt, HTTP 200
-- - same event_id + different payload_sha256 -> HTTP 409, no mutation
-- - every accepted first delivery/replay appends a receipt row; receipts are not updated
-- - parent missing -> HTTP 422
-- - tenant binding mismatch -> HTTP 403
--
-- This file is not evidence that these statements were executed against MySQL.
