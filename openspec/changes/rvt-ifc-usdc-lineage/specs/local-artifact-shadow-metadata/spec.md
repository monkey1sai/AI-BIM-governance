## MODIFIED Requirements

### Requirement: Company cloud and local runtime own distinct metadata authorities

The company cloud `bim-control` SHALL remain the authority for control-plane metadata: tenant/customer, project, user, role/permission/RBAC, license, model version / commit record, IFC conversion task request, version history, high-level artifact index, and callback receipt status. This repo SHALL be the authority for data-plane metadata: local conversion job state, source IFC / USDC / element_mapping local availability, artifact manifest, converter version, runtime image digest, Kit launcher validation evidence, local web view session, and callback outbox retry state.

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：Governed lineage 下，data-plane authority SHALL additive 包含：edge MinIO 擁有 governed source／result artifact bytes 與 source／result manifest 表達的 bundle lineage；本 repo 擁有 stable `pipeline_job_id`、durable orchestration／admission state、active-result pointer、promotion／rollback audit，以及獨立 lineage publication outbox 的 delivery state。External company cloud `bim-control` 仍 SHALL 是 control-plane authority，並額外擁有 cloud 端的 formal result locator、bounded lineage summary、event receipt 與 health history（由 `cloud-lineage-publication` 定義，且 external `bim-control` 是唯一 cloud MySQL writer）。Edge MUST NOT 直接連 cloud MySQL、持有 cloud database credentials，或把 company database mirror 到本地。

#### Scenario: Control-plane metadata is not re-owned locally

- **WHEN** project / user / RBAC / license / model-version authority is needed
- **THEN** the company cloud `bim-control` is the authority
- **AND** this repo does not present itself as the authority for that metadata

#### Scenario: Data-plane availability is owned locally

- **WHEN** local conversion job state or local artifact availability is queried
- **THEN** this repo answers as the authority
- **AND** it does not require the company cloud to answer local artifact availability

#### Scenario: MinIO 與 cloud 的 lineage authority 不重疊

- **WHEN** 需要判定 governed artifact bytes、bundle lineage 或 formal result locator 的 authority
- **THEN** edge MinIO SHALL 是 artifact bytes 與 manifest lineage 的 authority
- **AND** external company cloud SHALL 只保存 result locator、bounded summary、receipt 與 health history
- **AND** 本 repo MUST NOT 直接連 cloud MySQL 或保存 cloud database credentials

### Requirement: Local runtime keeps only minimal shadow metadata, not a cloud mirror

This repo SHALL persist only the minimal shadow fields required for idempotency, conversion, local web view, and callback retry: `tenant_id`, `project_id`, `external_model_version_id`, `external_conversion_task_id`, `correlation_id`, `source_ifc_ref`, `source_ifc_etag` (checksum), `conversion_job_id`, `artifact_manifest_ref`, `callback_url`, `callback_status`, `last_callback_attempt_at`. It MUST NOT mirror the full company cloud database.

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：Governed lineage 落地後，minimal shadow field set SHALL additive 擴充下列 governed identity／state 欄位，且 SHALL 維持「不 mirror company cloud database」的原則：`source_bundle_id`、source manifest 的 `manifest_sha256`、`pipeline_job_id`、`job_state`、`attempt_id`、`result_id`、`result_manifest_ref`、`result_manifest_digest`、`active_result_id`（active-result pointer）與其 append-only audit 參照、runtime admission state（`admission_status`、`runtime_profile`、`requires_exclusive_runtime`、`lease_id`、`readiness_evidence[]`、`blocker_codes[]`），以及獨立 lineage publication outbox 的 `publication_identity` 與 delivery state。這些欄位 SHALL 只保存 identity、digest、locator 與 state；MUST NOT 保存逐 element mapping rows、alignment／report body、artifact bytes、MinIO credentials、cloud DB credentials 或 cloud MySQL 內容的複本。完整 artifact bytes 的 authority 仍是 edge MinIO；cloud 端的 formal result locator、bounded summary、receipt 與 health history 由 `cloud-lineage-publication` 擁有。上列 12 個既有 legacy shadow 欄位 SHALL 逐字保留。

#### Scenario: No full database mirror

- **WHEN** local runtime needs identifiers to run a job, resolve a viewer artifact, or retry a callback
- **THEN** only the minimal shadow field set is stored locally
- **AND** the local store is not a synchronized copy of the company cloud MySQL

#### Scenario: External platform stays the model-version authority

- **WHEN** model version truth is needed
- **THEN** the external company cloud platform remains authoritative
- **AND** the local shadow record references it via `external_model_version_id` without claiming authority

#### Scenario: Governed identity 是 additive shadow，不是 cloud mirror

- **WHEN** governed pipeline job／attempt／formal result 需要冪等、restart recovery、UI read model 或 publication 追蹤
- **THEN** 本 repo SHALL 只保存上列 governed identity／digest／locator／state 欄位
- **AND** 它 MUST NOT 保存逐 element lineage rows、alignment／report body 或 cloud MySQL 的複本
- **AND** external company cloud 仍 SHALL 是 tenant、project、model-version 與 RBAC 的 authority
