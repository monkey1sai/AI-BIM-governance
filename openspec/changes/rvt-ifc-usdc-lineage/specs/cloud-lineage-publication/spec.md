## ADDED Requirements

### Requirement: Cloud lineage publication SHALL use a fixed external Cloud Ingest boundary

Governed lineage publication SHALL use `POST /api/v1/lineage-publications` with the direction `edge bim-review-coordinator → external company-cloud bim-control → cloud MySQL`. The coordinator SHALL be the client, external `bim-control` SHALL host the production receiver and SHALL be the only cloud MySQL writer. This endpoint MUST NOT be exposed as a browser API, producer intake API or repo-hosted production cloud runtime；edge services MUST NOT connect directly to cloud MySQL or hold cloud database credentials。

The endpoint SHALL accept only `lineage_result_published` and `lineage_result_health_changed`. Existing `conversion_result_ready | conversion_failed` workflow callbacks and `POST /api/external/ifc-ready` SHALL remain unchanged and SHALL NOT become a second governed lineage-publication authority。

#### Scenario: Formal result uses the external Cloud Ingest API

- **WHEN** coordinator publishes a governed lineage result
- **THEN** it SHALL POST the versioned event to external `bim-control` at `/api/v1/lineage-publications`
- **AND** only the external cloud service SHALL commit the corresponding cloud MySQL transaction

#### Scenario: Source bundle READY is not a cloud lineage event

- **WHEN** producer calls additive `POST /api/external/source-bundles/ready` or coordinator reconciles a source manifest
- **THEN** coordinator SHALL revalidate the ready claim for edge processing
- **AND** MUST NOT create a cloud lineage publication until a formal derived result is integrity-valid

### Requirement: Only an integrity-valid formal result SHALL trigger publication

Coordinator SHALL create `lineage_result_published` only after the formal ResultManifest and all required result references pass role、ETag、object-version、SHA-256 and size validation。A contract-complete formal result MAY be published for audit when `attempt_outcome` is `succeeded | succeeded_with_warnings | failed | cancelled`；publication MUST NOT change the existing selection rule。A `failed | cancelled` result SHALL remain non-selectable and MUST NOT be active、promoted、rolled back or reported through `conversion_result_ready`。

Unpublished temporary output、diagnostic-only logs/manifests and integrity-invalid result artifacts MUST NOT produce a cloud lineage event。

#### Scenario: Successful formal result is eligible

- **WHEN** a succeeded or succeeded-with-warnings attempt has an integrity-valid formal ResultManifest
- **THEN** coordinator SHALL enqueue exactly one stable `lineage_result_published` identity for at-least-once delivery

#### Scenario: Failed attempt has a complete formal result

- **WHEN** a failed or cancelled attempt nevertheless publishes a contract-complete ResultManifest with all required lineage references
- **THEN** coordinator SHALL publish its locator and summary for audit
- **AND** MUST NOT make the result selectable or emit `conversion_result_ready`

#### Scenario: Diagnostic-only result is excluded

- **WHEN** an attempt leaves only temporary logs、partial objects or a diagnostic-only manifest
- **THEN** coordinator MUST NOT enqueue `lineage_result_published`

### Requirement: Publication payload SHALL contain stable locators and a bounded summary only

`lineage_result_published` SHALL carry stable identities for event、edge site、tenant、project、external model version、source bundle、pipeline job、attempt and result，plus `attempt_outcome`、`publication_identity`、`result_manifest_digest`、timestamps and correlation。`publication_identity` SHALL be stable for the tuple `(edge_site_id, external_model_version_id, result_id)`。

The payload SHALL include exactly these required formal references：

```text
result_manifest_ref
lineage_mapping_ref
alignment_report_json_ref
alignment_report_csv_ref
```

Each reference SHALL include `ref`、`object_version_id`、`etag`、`sha256` and `size_bytes`。`ref` SHALL use the non-expiring credential-free form `minio://{edge_site_id}/{bucket}/{object_key}?versionId={object_version_id}`；locator authority MUST byte-for-byte equal the envelope `edge_site_id`，object key MUST NOT contain raw `?` or `#`，and the only query SHALL be one `?versionId=` value。The query version and `object_version_id` field MUST match，and top-level `result_manifest_digest` MUST equal `result_manifest_ref.sha256`。The cloud receiver MAY store the locator without being able to download from edge MinIO。

Payloads MUST NOT contain RVT/IFC/USDC bytes、manifest/report bodies、element mapping rows、diff ID sets、diagnostics、presigned URLs、HTTP bearer URLs、local paths、credentials or base64。Complete `element_mapping.json`、alignment JSON/CSV and diff sets SHALL remain in edge MinIO。

#### Scenario: Valid result-location projection

- **WHEN** all four references use versioned `minio://` locators and include matching integrity metadata
- **THEN** the payload SHALL be eligible for HMAC signing and delivery

#### Scenario: Payload attempts to send element rows or a presigned URL

- **WHEN** the payload includes an element mapping array、diff identifier set or `X-Amz-*` presigned query
- **THEN** schema validation SHALL fail closed before enqueue or receiver mutation

#### Scenario: Locator points at another edge site

- **WHEN** any locator authority differs from top-level `edge_site_id`
- **THEN** sender and receiver semantic validation SHALL reject the request
- **AND** no publication or receipt SHALL be committed

### Requirement: Alignment summary SHALL use exact metrics and counts

The cloud summary SHALL contain only：

- `ifc_usdc_coverage_ratio`：eligible IFC products mapped to stable USD roots / eligible source `IfcProduct` count。
- `rvt_ifc_alignment_ratio`：valid scheduled rows resolved to IFC / valid unique schedule elements。
- `rvt_ifc_usdc_lineage_ratio`：valid schedule rows resolved through IFC to stable USD roots / valid unique schedule elements。

Each metric SHALL contain `numerator`、`denominator`、`ratio` and `status`。For an evaluated metric，ratio `1` SHALL use `complete` and ratio below `1` SHALL use `partial`。When denominator is `0`，numerator SHALL be `0`、ratio SHALL be `null` and status SHALL be `not_evaluable`。

The only count fields SHALL be `csv_total_count`、`csv_valid_count`、`eligible_ifc_product_count`、`duplicate_rvt_id_count`、`duplicate_ifc_guid_count`、`invalid_row_count`、`csv_only_count`、`ifc_only_count`、`ifc_usdc_unmapped_count` and `full_lineage_matched_count`。`warning_codes` SHALL be unique、bounded to at most 64 versioned codes and accompanied by `warning_code_count`。No count field MAY be replaced by a list of element identifiers。

#### Scenario: Zero denominator remains not evaluable

- **WHEN** any metric denominator is zero
- **THEN** its numerator SHALL be zero、ratio SHALL be null and status SHALL be `not_evaluable`
- **AND** the cloud summary MUST NOT claim 0% or 100%

#### Scenario: Full diff sets remain at edge

- **WHEN** alignment contains CSV-only、IFC-only or IFC-to-USDC-unmapped elements
- **THEN** the cloud summary SHALL include only their non-negative counts and bounded warning codes
- **AND** the corresponding element identifier sets SHALL remain in edge reports

### Requirement: Target、mode and HMAC SHALL be server-controlled

The publisher SHALL accept only these server-side settings：

```text
CLOUD_LINEAGE_PUBLICATION_MODE=disabled|required
CLOUD_LINEAGE_PUBLICATION_BASE_URL
CLOUD_LINEAGE_PUBLICATION_HMAC_KEY_ID
CLOUD_LINEAGE_PUBLICATION_HMAC_SECRET
```

Producer、browser、manifest and event payload fields MUST NOT override target URL or key material。`disabled` SHALL be the local/development default and SHALL create no enqueue、send or fake dead-letter side effect。Production SHALL explicitly use `required`；missing/invalid URL、key ID or secret、unknown mode or non-HTTPS production URL SHALL fail startup closed。Explicit test profiles MAY use HTTP only for a loopback fake。

Each request SHALL carry `X-Lineage-Event-Id`、`X-Lineage-Signature-Timestamp`、`X-Lineage-Signature-Key-Id` and `X-Lineage-Webhook-Signature`。Signature SHALL be `sha256=<lowercase-hex>` of `HMAC-SHA256(secret, signature_timestamp + "\n" + raw_request_body)`。Receiver SHALL verify raw bytes with constant-time comparison、require header/body event IDs to match and reject an unknown key、signature mismatch、body tamper or timestamp outside the default ±300-second window。

Secrets MUST NOT appear in payload、logs、UI、committed examples or evidence；future `.env.example` changes SHALL contain blank key names only。

#### Scenario: Publication is disabled

- **WHEN** mode is `disabled`
- **THEN** coordinator SHALL start without publisher credentials
- **AND** SHALL report `DISABLED` without creating an outbox entry or dead letter

#### Scenario: Required mode is misconfigured

- **WHEN** mode is `required` but URL/HMAC settings are missing or the production URL is not HTTPS
- **THEN** coordinator startup SHALL fail closed before accepting work

#### Scenario: Signed body is changed after signing

- **WHEN** receiver observes a raw body、event ID or timestamp that does not match the signature contract
- **THEN** receiver SHALL reject the request without receipt or publication mutation

### Requirement: Receiver commit and ACK SHALL be synchronous and idempotent

Delivery SHALL be at-least-once，with event-type-specific idempotency。`lineage_result_published` SHALL use publication identity plus manifest digest as its logical key；a first commit SHALL return `201`，while the same identity、digest and immutable publication content SHALL return `200`、`replay=true` and the original registration identity。A sender transport retry MUST reuse the stable event ID and raw body；same identity/digest with changed immutable content or same event ID with another raw-body digest SHALL return `409` without mutation。

`lineage_result_health_changed` SHALL NOT use publication identity/digest alone as a replay key。Each new health transition SHALL use a new event ID、append a new health row and return `201`；only the same event ID plus the same raw-body digest SHALL return `200` with `replay=true`。Same health event ID with a different raw-body digest SHALL return `409` without mutation。The success body for both event types SHALL contain exactly `registration_id`、`event_id`、`publication_identity`、`manifest_digest`、`stored_at` and `replay`。

The sender SHALL mark `DELIVERED` only when status is `200` or `201`、the body matches the response schema and returned event/publication/digest values exactly match the sent event。HTTP `202`、empty/malformed body、unexpected 2xx or mismatched ACK SHALL be a protocol failure。

The receiver SHALL return `409` without mutation for a published identity with another manifest digest、same identity/digest with changed immutable publication content，or any reused event ID with another raw-body digest。`422` applies when the authoritative parent model-version does not exist，and `403` when tenant/project/model-version binding mismatches。It MUST NOT create cloud authority from a MinIO path。Network errors、timeouts、`408`、`429` and `5xx` SHALL be retryable；schema/auth/binding/conflict deterministic `4xx` SHALL require manual correction/replay。

#### Scenario: First commit and replay

- **WHEN** receiver commits a new valid publication
- **THEN** it SHALL return `201` and `replay=false`
- **AND** a published same-identity same-digest same-content replay SHALL return `200`、`replay=true` and the same registration identity

#### Scenario: Same identity has a different digest

- **WHEN** receiver already stored the publication identity with another manifest digest
- **THEN** it SHALL return `409` without changing publication、receipt or health history

#### Scenario: A new health transition shares the publication digest

- **WHEN** a known publication receives a new health event ID with the same publication identity and manifest digest
- **THEN** receiver SHALL append the transition and return `201` with `replay=false`
- **AND** MUST NOT collapse it into the earlier health event

#### Scenario: Health event ID is reused with another body

- **WHEN** a health event ID already exists but the raw-body digest differs
- **THEN** receiver SHALL return `409` without publication、health or receipt mutation

#### Scenario: ACK is incomplete

- **WHEN** receiver returns `202`、an empty body or an ACK with a different event ID、publication identity or manifest digest
- **THEN** sender SHALL treat delivery as a protocol failure
- **AND** MUST NOT mark the outbox item `DELIVERED`

#### Scenario: Cloud parent binding is not authoritative

- **WHEN** model-version parent is unresolved or tenant binding mismatches
- **THEN** receiver SHALL return `422` or `403` respectively
- **AND** MUST NOT infer or create the parent from object paths

### Requirement: Edge publication outbox SHALL be durable、recoverable and availability-independent

Coordinator SHALL persist a stable event ID、publication identity、raw body and body digest to atomic local outbox JSON before send。Restart SHALL resume the same event rather than create another logical publication。Only one coordinator dispatcher MAY be active per edge site；shared queue/HA dispatch is outside this contract。Corrupt outbox state SHALL fail safe and be quarantined，never silently cleared or overwritten。

Wire states SHALL be `DISABLED | PENDING | RETRYING | DELIVERED | DEAD_LETTER | CONFLICT`。Default delivery SHALL use at most five bounded attempts with exponential backoff and jitter。Transient dead letters SHALL be automatically reconciled/re-enqueued after cooldown；semantic/security/deterministic 4xx and conflicts SHALL wait for manual correction/replay and MUST NOT be silently dropped。

Cloud delivery state SHALL be orthogonal to source `READY`、result `AVAILABLE`、active-result selection and runtime admission。Cloud outage MUST NOT block edge conversion or revoke formal edge availability。

#### Scenario: Restart after lost ACK

- **WHEN** cloud commits but edge restarts before persisting the ACK
- **THEN** coordinator SHALL replay the same event ID/body/digest
- **AND** exact replay ACK SHALL converge the item to `DELIVERED`

#### Scenario: Transient delivery exhausts five attempts

- **WHEN** network/timeout/408/429/5xx persists through the bounded attempts
- **THEN** the item SHALL enter `DEAD_LETTER`
- **AND** reconciler SHALL re-enqueue it after cooldown without changing the formal result identity

#### Scenario: Deterministic conflict requires intervention

- **WHEN** receiver returns an identity/digest conflict or non-retryable security/semantic response
- **THEN** the item SHALL enter `CONFLICT` or manual `DEAD_LETTER`
- **AND** automatic retry MUST stop until correction or authorized replay

#### Scenario: Cloud is unavailable while result is valid

- **WHEN** a result is `AVAILABLE` but Cloud Ingest cannot be reached
- **THEN** edge conversion/runtime and active-result semantics SHALL continue
- **AND** only publication delivery status SHALL degrade

### Requirement: Health events SHALL preserve immutable publication history

`lineage_result_health_changed` SHALL use exactly `VERIFIED | MISSING | INTEGRITY_FAILED | TOMBSTONED`。It SHALL carry an already known `publication_identity` plus original result ID、result-manifest reference and manifest digest，but SHALL NOT repeat the alignment summary。Receiver SHALL join `lineage_publications` by publication identity and byte-compare those immutable bindings before appending the health event；the original summary remains only in the publication row。Health events and accepted-delivery receipts SHALL be append-only；a health event MUST NOT rewrite the original publication。

`MISSING` and `INTEGRITY_FAILED` SHALL require at least two independent edge reconciler observations before emission。A restored and integrity-valid object set MAY return to `VERIFIED`。`TOMBSTONED` SHALL require a formal retention/revocation record and MUST NOT be inferred from a transient list miss。

#### Scenario: Repeated missing observations

- **WHEN** reconciler confirms the same formal result is missing in two independent checks
- **THEN** coordinator SHALL emit an append-only `MISSING` health event
- **AND** the original locator、digest、summary and edge availability history SHALL remain immutable

#### Scenario: Missing result is restored

- **WHEN** previously missing objects return and all integrity checks pass
- **THEN** coordinator SHALL emit `VERIFIED`
- **AND** cloud history SHALL retain both transitions

#### Scenario: Formal tombstone

- **WHEN** an authorized retention/revocation record tombstones the result
- **THEN** coordinator SHALL emit `TOMBSTONED`
- **AND** a transient object-list miss MUST NOT produce that state

### Requirement: Cloud persistence SHALL be normative logical metadata only

The external cloud logical model SHALL contain `lineage_publications`、`lineage_publication_health_events` and `lineage_event_receipts`。It SHALL preserve publication identity/digest uniqueness、append-only health history、one appended receipt row per accepted first delivery or replay，and the four locators plus bounded summary。Receipt rows MUST NOT be updated into replay counters。It MUST NOT define or require per-element lineage tables。

This change SHALL provide a MySQL 8 `REFERENCE ONLY` DDL as a non-executable mapping aid。The DDL MUST state that external `bim-control` owns physical migrations and credentials，and this repo MUST NOT claim the DDL was applied or real MySQL was validated。A test fake MAY simulate transaction/idempotency behavior but SHALL remain test-only。

#### Scenario: Contract-only delivery is reviewed

- **WHEN** this change is validated and merged
- **THEN** reviewers SHALL find the normative logical model、reference DDL and protocol fixtures
- **AND** MUST NOT infer that an external migration、database connection or live MySQL E2E has occurred

#### Scenario: Element-row table is proposed

- **WHEN** an implementation attempts to add cloud storage for per-element RVT↔IFC↔USDC mapping rows
- **THEN** it SHALL violate this capability
- **AND** the complete rows SHALL remain edge-MinIO artifacts

### Requirement: Existing Outbox SHALL expose text-only cloud publication status

The tracked `docs/plans/*.html` authority SHALL extend only the existing `#/pipeline` Callback Outbox surface with a read-only text status column。It SHALL map `DISABLED → 未啟用`、`PENDING → 待送`、`RETRYING → 重試中`、`DELIVERED → 已登錄`、`DEAD_LETTER → 待人工處理` and `CONFLICT → 衝突`，and SHALL label the direction as `edge coordinator → external bim-control Cloud Ingest API → cloud MySQL`。

This capability MUST NOT add a route、page、button、new visual component or production frontend implementation in the contract-only phase。Text SHALL NOT expose secrets、target URL、full payload or artifact bodies，and a local deliver action MUST NOT display `已登錄` until an exact cloud commit ACK is verified。

#### Scenario: Disabled local mode

- **WHEN** publication mode is disabled
- **THEN** the existing Outbox status text SHALL show `未啟用`
- **AND** no cloud delivery action SHALL be implied

#### Scenario: Delivery is acknowledged

- **WHEN** an outbox item receives a schema-valid exact `200` or `201` ACK
- **THEN** the text status MAY show `已登錄`
- **AND** merely pressing a local deliver action MUST NOT produce that state

#### Scenario: Contract-only UI scope

- **WHEN** this spec updates the tracked HTML authority
- **THEN** it SHALL modify only the existing Outbox text/state contract
- **AND** production UI、manifest/goldens and unrelated lineage screens SHALL remain separate sequenced work
