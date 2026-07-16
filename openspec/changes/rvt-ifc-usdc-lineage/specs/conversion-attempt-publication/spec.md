## ADDED Requirements

### Requirement: Pipeline job SHALL 保持穩定，且attempt SHALL 不可變

每個 immutable `source_bundle_id` SHALL 對應一個由 coordinator擁有的 stable `pipeline_job_id` 與 durable orchestration state；ready-event replay、retry、backoff、runtime re-admission、streaming restart與 coordinator restart MUST NOT 建立第二個 logical job。Streaming conversion authority只在真正開始 execution時 SHALL 配置不可重用的 `attempt_id`。

#### Scenario: 重複入列

- **WHEN**相同 source manifest ready event 被重放
- **THEN**系統 SHALL 回傳既有 `pipeline_job_id`
- **AND** MUST NOT 建立平行 logical job

#### Scenario: 等待容量

- **WHEN** runtime admission 回報 `WAITING_CAPACITY`
- **THEN** job SHALL 保持等待
- **AND** attempt counter SHALL 不增加

### Requirement: Failure classification SHALL 控制 retry

Transient MinIO/network/dispatch failure SHALL 可 backoff；publishing interruption SHALL 在同一 attempt 驗證既有 hashes 後冪等續傳；semantic-invalid source SHALL 進入人工修正狀態並停止自動無限 retry。

#### Scenario: Publishing 中斷

- **WHEN**部分 result artifacts 已上傳但 `result-manifest.json` 尚未發布
- **THEN** retry SHALL 在同一 attempt 續傳
- **AND** MUST NOT 因重複上傳建立第二個 formal result

#### Scenario: 語意無效的來源

- **WHEN** source bundle integrity 通過但內容無法滿足 conversion/alignment semantic contract
- **THEN** job SHALL 顯示人工修正 blocker
- **AND** SHALL NOT 無限建立新 attempts
- **AND** 修正 SHALL 建立新的 source bundle／pipeline job，不得覆寫原 READY source後 retry原 job

### Requirement: Result manifest SHALL 最後發布並裁決 AVAILABLE

每個 attempt SHALL 使用 immutable result prefix，先發布 `model.usdc`、`element_mapping.json`、required indexes、quality/alignment reports，再 conditional-create `result-manifest.json`。只有 manifest 可讀、required roles 齊全且 refs/etags/SHA-256/sizes 全部驗證成功，result 才 SHALL 為 `AVAILABLE`；local file 存在或 converter exit 0 均不足以裁決 formal availability。

#### Scenario: 完整發布結果

- **WHEN**所有 declared result artifacts integrity 通過，最後成功建立 result manifest
- **THEN** attempt result SHALL 進入 `AVAILABLE`
- **AND** coordinator MAY 建立或更新 active-result pointer

#### Scenario: Manifest 缺失或 checksum mismatch

- **WHEN** result manifest 缺失，或任一 referenced artifact integrity 不符
- **THEN** result SHALL 保持 non-available
- **AND** MUST NOT 送出 `conversion_result_ready`

#### Scenario: Local cache 缺失但 formal result 完整

- **WHEN** local artifact cache 被移除，但 MinIO result manifest 與 referenced objects 完整
- **THEN** formal result SHALL 保持 `AVAILABLE`
- **AND** runtime MAY 由 MinIO 重建 cache

#### Scenario: Result manifest replay 或 conflict

- **WHEN**同一 attempt重放相同 result manifest digest
- **THEN** publication SHALL 冪等成功並回傳既有 formal result
- **AND**若同一 attempt嘗試 conditional-create不同 digest，系統 SHALL 回傳 conflict且 MUST NOT 覆寫

### Requirement: Attempt outcome、publication 與 result selection SHALL 為正交狀態

Attempt SHALL 保存 `attempt_outcome = succeeded | succeeded_with_warnings | failed | cancelled` 與 `publication_state = UNPUBLISHED | PUBLISHING | AVAILABLE | INVALID`。只有符合selectable matrix的formal result SHALL 保存 `selection_state = candidate | active | historical`；沒有ResultManifest的attempt，以及failed/cancelled的audit-only formal result，均沒有selection state。系統 MUST NOT 將converter outcome、formal availability或active selection合併成單一status。Wire literal `AVAILABLE` SHALL 固定使用大寫；小寫 `available` 只能作自然語言，不得作另一個 enum。

#### Scenario: Warning result 完整發布

- **WHEN** attempt outcome為 `succeeded_with_warnings` 且 result manifest/integrity完整
- **THEN** publication state MAY 為 `AVAILABLE`
- **AND** formal result selection SHALL 由active pointer獨立裁決

#### Scenario: Converter 成功但 publication 不完整

- **WHEN** converter outcome為 `succeeded` 但 result manifest缺失或 invalid
- **THEN** publication state SHALL NOT 為 `AVAILABLE`
- **AND** attempt SHALL 沒有formal result selection state

#### Scenario: Failed 或 cancelled attempt 留下完整診斷

- **WHEN** attempt outcome為 `failed` 或 `cancelled`，且其diagnostic-only manifest完整可讀
- **THEN**該manifest SHALL NOT 成為formal selectable result或cloud publication
- **AND** MUST NOT 自動active、promote、rollback或送出ready callback

#### Scenario: Failed 或 cancelled attempt 發布audit-only formal result

- **WHEN** attempt outcome為 `failed` 或 `cancelled`，但仍建立符合完整ResultManifest contract且required lineage refs/integrity有效的formal result
- **THEN** publication state MAY 為`AVAILABLE`且 MAY 送出`lineage_result_published` locator/summary
- **AND**該result SHALL 沒有selection state，MUST NOT active、promote、rollback或送出`conversion_result_ready`

### Requirement: Active result promotion 與 rollback SHALL 可稽核

Pipeline job MAY 有一個 active-result pointer。Selectable result SHALL 同時滿足 `publication_state == AVAILABLE` 與 `attempt_outcome in {succeeded, succeeded_with_warnings}`。第一個selectable result MAY 自動成為active，但自動assignment同樣 SHALL 建立包含actor/system、reason、from/to result、time與correlation的append-only audit；後續成功result MUST NOT 自動取代active。Promote/rollback SHALL 只接受selectable result、驗證對應capability並建立相同audit。

#### Scenario: 第二個 attempt 成功

- **WHEN** job 已有 active result，後續 attempt 產生新的 `AVAILABLE` result
- **THEN**新 result SHALL 保持 candidate
- **AND** active pointer SHALL 不變，直到授權 promote

#### Scenario: 回滾

- **WHEN**具 `result.rollback` 的 operator 切回歷史 `AVAILABLE` result
- **THEN** pointer SHALL 更新且歷史 objects SHALL 保留
- **AND** audit SHALL 記錄完整 transition

### Requirement: Selectable AVAILABLE results SHALL 支援 read-only compare

具 `result.compare` 的 caller SHALL 可比較同一 pipeline job下兩個selectable `AVAILABLE` results的 artifact identity、converter/profile、quality、三種 alignment ratios、warnings與 diff counts。Compare SHALL 是read-only，MUST NOT 改變 active pointer、selection state或formal artifacts，且不要求 `result.promote` capability。

#### Scenario: Compare active 與 candidate result

- **WHEN**授權 operator比較同一 job的 active與candidate AVAILABLE result
- **THEN** API SHALL 回傳可稽核的差異摘要與兩側 result identities
- **AND** active pointer SHALL 保持不變

#### Scenario: Compare non-AVAILABLE 或跨 job result

- **WHEN**任一 result不是 AVAILABLE，或兩個 results不屬同一 pipeline job
- **THEN** compare SHALL 採fail closed
- **AND** MUST NOT 推測或組合不完整差異

### Requirement: Formal artifacts 與 audit SHALL 不自動刪除

Source RVT、schedule、IFC、source manifest、任何 valid result manifest 引用的 artifacts，以及 promotion/rollback/alignment audit SHALL 不受一般自動 retention 刪除。只有 failed-attempt logs、temporary uploads 與 diagnostics MAY 依明確 retention policy 清理。

#### Scenario: Failed diagnostics 到期

- **WHEN** failed-attempt diagnostics 超過 deployment retention
- **THEN**系統 MAY 清理 diagnostics/local cache
- **AND** MUST NOT 刪除 formal source/result artifacts 或 audit
