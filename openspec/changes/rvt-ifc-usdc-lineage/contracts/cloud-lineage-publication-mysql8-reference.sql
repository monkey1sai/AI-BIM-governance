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
-- Physical adoption of these declared constraints requires MySQL 8.0.16+ for
-- CHECK enforcement, plus InnoDB with innodb_page_size = 16 KiB and
-- ROW_FORMAT = DYNAMIC. The largest
-- declared ACK binding is at most 2,952 bytes against the 3,072-byte key limit.
-- The external owner MUST verify these settings and the live DDL before migration;
-- a smaller page size MUST fail preflight or use an equivalent collision-safe
-- physical key design without truncating the normative logical identity.
-- Canonical wire published_at/observed_at values are validated as uppercase
-- UTC Z before their zone marker is removed for DATETIME(6) storage. stored_at,
-- first_received_at and received_at come from the receiver UTC clock. DATETIME
-- carries no zone, so the external receiver owns and tests this UTC invariant.

CREATE TABLE lineage_publications (
    publication_identity VARCHAR(522)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    registration_id VARCHAR(200)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    first_event_id CHAR(36)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_event_type ENUM(
        'lineage_result_published',
        'lineage_result_health_changed'
    ) NOT NULL,
    first_raw_body_sha256 CHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    edge_site_id VARCHAR(120)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    tenant_id VARCHAR(200) NOT NULL,
    project_id VARCHAR(200) NOT NULL,
    external_model_version_id VARCHAR(200)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    source_bundle_id VARCHAR(200) NOT NULL,
    pipeline_job_id VARCHAR(200) NOT NULL,
    attempt_id VARCHAR(200) NOT NULL,
    result_id VARCHAR(200)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    attempt_outcome VARCHAR(32) NOT NULL,
    manifest_digest CHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    publication_content_sha256 CHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result_manifest_ref JSON NOT NULL,
    lineage_mapping_ref JSON NOT NULL,
    alignment_report_json_ref JSON NOT NULL,
    alignment_report_csv_ref JSON NOT NULL,
    alignment_summary JSON NOT NULL,
    published_at DATETIME(6) NOT NULL,
    stored_at DATETIME(6) NOT NULL,
    PRIMARY KEY (publication_identity),
    UNIQUE KEY uq_lineage_publications_registration (registration_id),
    UNIQUE KEY uq_lineage_publications_first_event (first_event_id),
    KEY ix_lineage_publications_first_event_tuple (
        first_event_id,
        first_event_type,
        publication_identity,
        first_raw_body_sha256
    ),
    UNIQUE KEY uq_lineage_publications_identity_manifest (
        publication_identity,
        manifest_digest
    ),
    UNIQUE KEY uq_lineage_publications_receipt_binding (
        publication_identity,
        manifest_digest,
        registration_id
    ),
    UNIQUE KEY uq_lineage_publications_result (
        edge_site_id,
        external_model_version_id,
        result_id
    ),
    CONSTRAINT ck_lineage_publications_identity_tuple
        CHECK (
            edge_site_id REGEXP '^[A-Za-z0-9._-]+$'
            AND LOCATE(':', external_model_version_id) = 0
            AND LOCATE(':', result_id) = 0
            AND CAST(publication_identity AS BINARY) = CAST(
                CONCAT(
                    edge_site_id,
                    ':',
                    external_model_version_id,
                    ':',
                    result_id
                ) AS BINARY
            )
        ),
    CONSTRAINT ck_lineage_publications_first_event_type
        CHECK (first_event_type = 'lineage_result_published'),
    CONSTRAINT ck_lineage_publications_first_raw_body_digest
        CHECK (first_raw_body_sha256 REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_publications_manifest_digest
        CHECK (manifest_digest REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_publications_content_digest
        CHECK (publication_content_sha256 REGEXP '^[0-9a-f]{64}$'),
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
) ENGINE = InnoDB ROW_FORMAT = DYNAMIC;

CREATE TABLE lineage_publication_health_events (
    health_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id CHAR(36)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_type ENUM(
        'lineage_result_published',
        'lineage_result_health_changed'
    ) NOT NULL,
    publication_identity VARCHAR(522)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    raw_body_sha256 CHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    manifest_digest CHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
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
    UNIQUE KEY uq_lineage_health_receipt_binding (
        health_event_id,
        event_id
    ),
    KEY ix_lineage_health_event_tuple (
        event_id,
        event_type,
        publication_identity,
        raw_body_sha256
    ),
    KEY ix_lineage_health_publication_time (
        publication_identity,
        observed_at,
        health_event_id
    ),
    KEY ix_lineage_health_publication_digest (
        publication_identity,
        manifest_digest
    ),
    CONSTRAINT fk_lineage_health_publication
        FOREIGN KEY (publication_identity, manifest_digest)
        REFERENCES lineage_publications (
            publication_identity,
            manifest_digest
        )
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT ck_lineage_health_manifest_digest
        CHECK (manifest_digest REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_health_event_type
        CHECK (event_type = 'lineage_result_health_changed'),
    CONSTRAINT ck_lineage_health_raw_body_digest
        CHECK (raw_body_sha256 REGEXP '^[0-9a-f]{64}$'),
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
            (
                health_state = 'TOMBSTONED'
                AND tombstone_record_id IS NOT NULL
                AND CHAR_LENGTH(tombstone_record_id) > 0
            )
            OR (
                health_state <> 'TOMBSTONED'
                AND tombstone_record_id IS NULL
            )
        ),
    CONSTRAINT ck_lineage_health_ref_is_object
        CHECK (JSON_TYPE(original_result_manifest_ref) = 'OBJECT')
) ENGINE = InnoDB ROW_FORMAT = DYNAMIC;

-- Authoritative current health is derived per publication by
-- ORDER BY observed_at DESC, health_event_id DESC LIMIT 1. A delayed older
-- observation remains in append-only history but cannot replace a newer
-- observation. With no health event, the initial derived state is VERIFIED.
-- lineage_publications is never updated to project health state.

-- The receiver reserves/checks event_id before the first domain mutation
-- inside one transaction; a later failure rolls the ledger and domain rows
-- back together. Composite FKs below also prevent reconciliation/direct-import
-- paths from bypassing that immutable tuple.
CREATE TABLE lineage_event_identities (
    event_id CHAR(36)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_type ENUM(
        'lineage_result_published',
        'lineage_result_health_changed'
    ) NOT NULL,
    publication_identity VARCHAR(522)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    raw_body_sha256 CHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_received_at DATETIME(6) NOT NULL,
    PRIMARY KEY (event_id),
    UNIQUE KEY uq_lineage_event_identities_tuple (
        event_id,
        event_type,
        publication_identity,
        raw_body_sha256
    ),
    KEY ix_lineage_event_identities_publication (
        publication_identity,
        first_received_at
    ),
    CONSTRAINT ck_lineage_event_identities_raw_body_digest
        CHECK (raw_body_sha256 REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_event_identities_event_id_uuid
        CHECK (
            event_id REGEXP '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        ),
    CONSTRAINT ck_lineage_event_identities_publication_identity
        CHECK (publication_identity REGEXP '^[A-Za-z0-9._-]+:[^:]+:[^:]+$')
) ENGINE = InnoDB ROW_FORMAT = DYNAMIC;

ALTER TABLE lineage_publications
    ADD CONSTRAINT fk_lineage_publications_first_event_identity
        FOREIGN KEY (
            first_event_id,
            first_event_type,
            publication_identity,
            first_raw_body_sha256
        )
        REFERENCES lineage_event_identities (
            event_id,
            event_type,
            publication_identity,
            raw_body_sha256
        )
        ON UPDATE RESTRICT
        ON DELETE RESTRICT;

ALTER TABLE lineage_publication_health_events
    ADD CONSTRAINT fk_lineage_health_event_identity
        FOREIGN KEY (
            event_id,
            event_type,
            publication_identity,
            raw_body_sha256
        )
        REFERENCES lineage_event_identities (
            event_id,
            event_type,
            publication_identity,
            raw_body_sha256
        )
        ON UPDATE RESTRICT
        ON DELETE RESTRICT;

CREATE TABLE lineage_event_receipts (
    receipt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id CHAR(36)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_type ENUM(
        'lineage_result_published',
        'lineage_result_health_changed'
    ) NOT NULL,
    health_event_id BIGINT UNSIGNED NULL,
    publication_identity VARCHAR(522)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    manifest_digest CHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    raw_body_sha256 CHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    registration_id VARCHAR(200)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    received_at DATETIME(6) NOT NULL,
    replay BOOLEAN NOT NULL,
    PRIMARY KEY (receipt_id),
    KEY ix_lineage_receipts_event (
        event_id,
        received_at
    ),
    KEY ix_lineage_receipts_event_tuple (
        event_id,
        event_type,
        publication_identity,
        raw_body_sha256
    ),
    KEY ix_lineage_receipts_health_binding (
        health_event_id,
        event_id
    ),
    KEY ix_lineage_receipts_publication (
        publication_identity,
        received_at
    ),
    KEY ix_lineage_receipts_publication_ack (
        publication_identity,
        manifest_digest,
        registration_id
    ),
    CONSTRAINT fk_lineage_receipts_event_identity
        FOREIGN KEY (
            event_id,
            event_type,
            publication_identity,
            raw_body_sha256
        )
        REFERENCES lineage_event_identities (
            event_id,
            event_type,
            publication_identity,
            raw_body_sha256
        )
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT fk_lineage_receipts_health_event
        FOREIGN KEY (
            health_event_id,
            event_id
        )
        REFERENCES lineage_publication_health_events (
            health_event_id,
            event_id
        )
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT fk_lineage_receipts_publication
        FOREIGN KEY (
            publication_identity,
            manifest_digest,
            registration_id
        )
        REFERENCES lineage_publications (
            publication_identity,
            manifest_digest,
            registration_id
        )
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT ck_lineage_receipts_manifest_digest
        CHECK (manifest_digest REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_receipts_raw_body_digest
        CHECK (raw_body_sha256 REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT ck_lineage_receipts_health_binding
        CHECK (
            (
                event_type = 'lineage_result_health_changed'
                AND health_event_id IS NOT NULL
            )
            OR (
                event_type = 'lineage_result_published'
                AND health_event_id IS NULL
            )
        ),
    CONSTRAINT ck_lineage_receipts_replay
        CHECK (replay IN (0, 1))
) ENGINE = InnoDB ROW_FORMAT = DYNAMIC;

-- Normative transaction rules live in the OpenSpec capability:
-- - create/check lineage_event_identities inside the same transaction before
--   publication, health or receipt mutation
-- - first valid event commit -> HTTP 201
-- - published same identity + digest + publication_content_sha256 -> HTTP 200 replay
-- - new health event_id -> append health event and receipt, HTTP 201
-- - same health event_id + same raw_body_sha256 -> append replay receipt, HTTP 200
-- - every health receipt carries health_event_id and matches the exact immutable
--   health row; published receipts carry NULL health_event_id
-- - same event_id + different event_type, publication_identity or
--   raw_body_sha256 -> HTTP 409, no mutation
-- - publication first-event, every health row and every receipt match the
--   immutable four-column event tuple; receipts also match the three-column
--   publication ACK binding
-- - every accepted first delivery/replay appends a receipt row; receipts are not updated
-- - parent missing -> HTTP 422
-- - tenant binding mismatch -> HTTP 403
--
-- This file is not evidence that these statements were executed against MySQL.
