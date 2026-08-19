## MODIFIED Requirements

### Requirement: Conversion ready status requires serveable artifacts

`bim-streaming-server` SHALL NOT publish or continue serving a conversion job as ready when the persisted job/result metadata points to required artifact files that are missing or not serveable by the conversion authority.

Required artifacts for ready IFC→USDC output include the primary `model.usdc`, `metadata.json`, and any required sidecars declared by the result (`element_mapping.json`, `entity_index.json` when requested). The authority MAY preserve the original converter exit status in diagnostics, but browser-visible and coordinator-consumed readiness MUST reflect current artifact availability.

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：本 requirement 的 on-disk serveability 判定 SHALL 限於 `bim-streaming-server` 對 conversion job 與 viewer 服務面的 readiness。Governed formal result 的 `publication_state = AVAILABLE` 由 `conversion-attempt-publication` 依 MinIO `result-manifest.json` 及其 referenced refs／ETags／SHA-256／sizes 裁決；local artifact directory 只是 staging／cache。Local cache 缺失 MUST NOT 把已驗證的 governed `AVAILABLE` 改判為 non-available，也 MUST NOT 刪除或撤銷 formal result 與其 audit，但 SHALL 可讓本地服務面誠實標為暫時不可服務並由 MinIO 重建 cache。反之，local file 存在或 converter exit 0 MUST NOT 用來宣告 governed `AVAILABLE`。

#### Scenario: persisted ready job loses model.usdc

- **WHEN** a persisted conversion job result says `status="succeeded"` or `ready=true`
- **AND** the `model.usdc` file referenced by the result does not exist on disk or cannot be served from `/artifacts/.../model.usdc`
- **THEN** `GET /api/conversions`, `GET /api/conversions/{id}`, and `GET /api/conversions/{id}/result` MUST expose the job as non-ready
- **AND** the response MUST include a diagnostic reason such as `artifact_missing`
- **AND** coordinator MUST NOT create or present a viewer-open-ready review session from that result

#### Scenario: ready job artifacts are serveable

- **WHEN** a conversion job has required artifacts present on disk
- **AND** the authority can serve `model.usdc` from its public artifact URL
- **THEN** the job MAY be exposed as `ready=true` / `status="succeeded"`
- **AND** coordinator MAY ingest it as conversion-ready metadata

#### Scenario: governed AVAILABLE 不因 local cache 消失而撤回

- **WHEN** 某 governed formal result 的 MinIO `result-manifest.json` 與所有 referenced objects 完整且 integrity 通過
- **AND** 其 local artifact directory 的 `model.usdc` 已被清除
- **THEN** governed `publication_state` SHALL 維持 `AVAILABLE`
- **AND** 本地服務面 MAY 暫時標為不可服務並由 MinIO 重建 cache
- **AND** 系統 MUST NOT 因 local cache 缺失刪除或撤銷 formal result 與其 audit

### Requirement: Terminal converter failures recover by re-trigger, not dispatch retry

`bim-review-coordinator` SHALL distinguish dispatch failures from terminal converter failures. Dispatch retry is only valid before a conversion job is successfully accepted by `bim-streaming-server`. Once a conversion job reaches terminal `failed`, recovery SHALL be modeled as re-ingest or re-trigger from the source IFC, producing a new conversion attempt/correlation trail rather than mutating the terminal conversion job into ready.

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：本 requirement 的 re-trigger／re-ingest 復原模型 SHALL 限於 legacy ifc-ready job。Governed pipeline job 的復原由 `conversion-attempt-publication` 與 `conversion-runtime-admission` 擁有：transient MinIO／network／dispatch failure SHALL 在同一 stable `pipeline_job_id` 下 backoff 重試；publishing 中斷 SHALL 在同一 `attempt_id` 冪等續傳且 MUST NOT 建立第二個 formal result；runtime capacity 不足 SHALL 表達為 `WAITING_CAPACITY` 且不消耗 attempt。只有 semantic-invalid source 才 SHALL 讓原 job 停在 terminal `manual_correction_required`，且修正 MUST 建立新的 `source_bundle_id` 與新的 `pipeline_job_id`，MUST NOT 原地覆寫已 `READY` 的 source bundle 後從原 job retry，也 MUST NOT 以 legacy re-trigger／re-ingest 路徑重跑 governed job。

#### Scenario: dispatch failure remains retryable

- **WHEN** an ifc-ready job has `status="dispatch_failed"` or `status="dropped_on_restart"`
- **THEN** the existing retry action MAY requeue the original pending dispatch context
- **AND** no new source IFC trigger is required if pending dispatch context still exists

#### Scenario: converter failure requires source re-trigger

- **WHEN** an ifc-ready job has a `conversion_job_id`
- **AND** its conversion lifecycle is terminal `failed`
- **THEN** `/api/conversion/jobs/:id/retry` MUST NOT pretend dispatch retry can rerun the converter
- **AND** browser-visible job summary MUST expose a recovery action equivalent to `retrigger_required` or `reingest_required`
- **AND** the operator-facing action MUST submit a new ifc-ready/trigger request from the source IFC when source access is still available

#### Scenario: source IFC cache is missing

- **WHEN** a terminal failed conversion job points at a source IFC cache path that no longer exists
- **THEN** the recovery status MUST say source re-trigger is required
- **AND** the system MUST NOT present the old job as directly retryable

#### Scenario: governed semantic-invalid source 需要新 bundle 與新 job

- **WHEN** governed source bundle 通過 integrity 驗證但內容不滿足 conversion／alignment semantic contract
- **THEN** 原 `pipeline_job_id` SHALL 停在 terminal `manual_correction_required`
- **AND** 復原 SHALL 建立新的 `source_bundle_id` 與新的 `pipeline_job_id`
- **AND** 系統 MUST NOT 以 legacy re-trigger／re-ingest 在原 job 上重跑，也 MUST NOT 原地覆寫已 `READY` 的 source bundle
