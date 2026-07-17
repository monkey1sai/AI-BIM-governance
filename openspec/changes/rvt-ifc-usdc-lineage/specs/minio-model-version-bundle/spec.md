## ADDED Requirements

### Requirement: MinIO SHALL 是 governed edge artifact bytes 的唯一持久 authority

Governed model version 的 source 與正式 derived artifact bytes SHALL 持久保存於 customer-edge MinIO。Repo 本機 `storage/`、shared volume、`ifc-cache` 與 conversion artifact directory SHALL 只作 staging、cache 或 test fixture，且 SHALL 可由 MinIO formal objects 重建；local path 或 `file://`／`edge-local://` ref MUST NOT 作為 governed production artifact authority。

#### Scenario: Local cache 被移除

- **WHEN** governed source/result 的 local cache 被刪除，但 MinIO formal objects 與 manifests 仍完整可讀
- **THEN** bundle/result 的 formal availability SHALL 保持不變
- **AND** edge runtime MAY 由 MinIO 重建 local cache

#### Scenario: 只有 local file 存在

- **WHEN** local `model.ifc` 或 `model.usdc` 存在，但沒有可驗證的 MinIO source/result manifest
- **THEN** 系統 SHALL NOT 將其宣告為 governed `READY` 或 `AVAILABLE`

### Requirement: Governed source bundle SHALL 以 source manifest 最後發布

每個 governed source bundle SHALL 包含 role 為 `source_rvt`、`schedule_csv`、`source_ifc` 的三個 immutable artifacts，以及最後 conditional-create 的 `manifest.json`。Manifest SHALL 至少包含 `schema_version`、`source_bundle_id`、`external_model_version_id`、producer/timestamps 與每個 artifact 的 `role`、MinIO `ref`、`etag`、SHA-256、`size_bytes`。Object path SHALL 只作 locator；edge artifact identity 與 lineage SHALL 由 manifest 決定，且 MUST NOT 取代 external cloud 的 tenant/project/model-version/RBAC authority。

#### Scenario: Required artifacts 先完成再發布 manifest

- **WHEN** producer 依序寫入 `model.rvt`、`schedule.csv`、`model.ifc`，再 conditional-create `manifest.json`
- **AND** manifest 所列 refs、etags、sizes 與 SHA-256 全部驗證成功
- **THEN** bundle SHALL 進入 `READY`
- **AND** coordinator SHALL 使該 immutable bundle eligible for one stable pipeline job

#### Scenario: Manifest 早於 artifact 或 integrity 不符

- **WHEN** manifest 引用的 required artifact 缺失、尚未完成，或 etag/SHA-256/size 不符
- **THEN** bundle SHALL 保持 non-ready
- **AND** SHALL 回報具體 integrity diagnostics
- **AND** SHALL NOT 將conversion排入佇列

#### Scenario: Manifest重放

- **WHEN**相同 `source_bundle_id` 與相同 manifest digest 被重放
- **THEN** validation/enqueue SHALL 冪等
- **AND** MUST NOT 建立第二個 logical pipeline job

### Requirement: READY source version SHALL 不可變

一旦 source bundle 進入 `READY`，其 source artifacts 與 manifest SHALL NOT 原地覆寫。任何正式 source bytes、identity、schedule 或 lineage 改變 MUST 建立新的 `source_bundle_id`／model version；object-store versioning MAY 保留底層版本，但不得用同一 bundle identity 指向不同 bytes。

#### Scenario: READY 後 source IFC 改變

- **WHEN** operator 或 producer 嘗試以相同 `source_bundle_id` 發布不同 checksum 的 `model.ifc`
- **THEN**系統 SHALL 拒絕原地更新
- **AND** SHALL 要求建立新 governed version

#### Scenario: Semantic-invalid source 需要人工修正

- **WHEN** READY bundle 的內容通過 integrity但不符合 conversion/alignment semantic contract
- **THEN** 原 bundle與其 logical job SHALL 保持 immutable並標示 `manual_correction_required`
- **AND** 修正後 bytes SHALL 建立新的 `source_bundle_id` 與新的 `pipeline_job_id`
- **AND** operator SHALL NOT 覆寫原 READY bundle後從同一 job retry

### Requirement: Unmanifested legacy data SHALL 顯式治理升格

MinIO 中沒有 source manifest 的既有 IFC/RVT/CSV SHALL 標為 `LEGACY_UNMANAGED`。系統 MAY 提供唯讀 preview 推導候選 metadata，但 MUST NOT 靜默寫入 manifest；只有具 `bundle.publish` capability 的使用者明確確認後，系統才可 conditional-create 一個新 governed version。

#### Scenario: Operator 預覽 legacy bundle

- **WHEN** operator 開啟未具 manifest 的既有 object grouping
- **THEN** UI/API SHALL 顯示 `LEGACY_UNMANAGED` 與候選 metadata/differences
- **AND** preview SHALL NOT 修改 MinIO

#### Scenario: 並行升格登錄

- **WHEN**兩位 operator 同時確認相同 legacy grouping
- **THEN** conditional create SHALL 只允許一個 governed manifest 成功
- **AND**另一個請求 SHALL 取得可重試/重新整理的 conflict，而非覆寫既有 manifest

### Requirement: Governed ready claim SHALL 使用additive intake與獨立重驗

Producer SHALL 在最後發布`manifest.json`後才呼叫additive `POST /api/external/source-bundles/ready`。此claim SHALL 識別governed source bundle但 MUST NOT 被視為authority；coordinator SHALL 在宣告`READY`前讀取並重新驗證required roles、refs、ETags、object versions、SHA-256與sizes。Polling SHALL 僅限於restart recovery/reconciliation。

既有`POST /api/external/ifc-ready` SHALL 保持不變以維持legacy相容性。單獨的`/model.ifc` object observation或source-ready claim MUST NOT 成為governed `READY`，且source-bundle READY MUST NOT 建立cloud lineage publication紀錄。

#### Scenario: Producer送出有效ready claim

- **WHEN** producer最後發布manifest並呼叫`POST /api/external/source-bundles/ready`
- **THEN** coordinator SHALL 獨立驗證manifest與其引用objects
- **AND** 只有所有checks通過後才 SHALL 送出governed READY signal

#### Scenario: Ready claim在manifest integrity完成前到達

- **WHEN** endpoint被呼叫，但required role、object version或digest驗證失敗
- **THEN** coordinator SHALL 維持bundle non-ready並回傳integrity diagnostics
- **AND** MUST NOT 將conversion或cloud lineage publication排入佇列

#### Scenario: Polling發現尚未處理的有效manifest

- **WHEN** restart recovery或reconciliation找到ready claim已遺失的有效manifest
- **THEN** coordinator SHALL 在同一source bundle identity下冪等處理
- **AND** MUST NOT 建立第二個logical job
