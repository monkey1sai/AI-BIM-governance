## MODIFIED Requirements

### Requirement: Source entity enumeration optimization evidence

Runtime verification evidence MUST 在 canonical batch baseline 推進前記錄 source entity enumeration burn-down。Evidence MUST 包含 canonical fixture 識別、command、timeout 設定、baseline 計時或 timeout 結果、實作的優化摘要、優化後的 `source_entity_enumeration` 計時、source IFC entity 數量、conversion 是否越過 enumeration 階段、fallback 使用情形，以及下一個 gating phase 或 blocker。

若 source entity enumeration 在設定的 timeout 內仍無法完成，evidence MUST 將結果歸類為 `timed_out` 或 `blocked`，保留 `minimum_coverage_locked=false`，並指出尚未解除的限制屬於 `_worker` 內部，或是 worker converter 邏輯之外的外部因素。

Fine-grained source enumeration profiling evidence MAY 於 canonical burn-down runs 中紀錄。啟用時，SHOULD 區分 model iteration、entity id extraction、IFC class extraction、GlobalId extraction、Name extraction、row append 與 progress write 計數，使 evidence 能將 IfcOpenShell/runtime 成本與 `_worker` identity-scan 成本分離。

任何 canonical burn-down run（無論該 run 是否啟用 secondary `guid_extraction` / `name_extraction` 優化），若以 `--profile-source-entities` 旗標執行，evidence MUST 記錄該次 run 的 `guid_extraction` 與 `name_extraction` 子階段 elapsed seconds、它們所佔 `source_entity_enumeration` 的比例，以及該 run 的優化狀態（`optimization_applied=true`、`optimization_applied=false`、`deferred_to_follow_up`）。當 evidence 記錄為 `deferred_to_follow_up` 時，MUST 附上下一個候選 change 名稱。

#### Scenario: Before and after timing recorded

- **WHEN** `_worker` 對 canonical fixtures 變更 source entity enumeration 行為
- **THEN** verification evidence 同時記錄改動前的 timeout 或 baseline 計時、以及改動後的 `source_entity_enumeration` 計時
- **AND** evidence 引用所使用的 canonical fixture 實際路徑或 source identity

#### Scenario: Canonical single fixture advances past enumeration

- **WHEN** 優化後重跑 canonical `--limit 1 --timeout-seconds 600`
- **THEN** evidence 記錄 conversion 是否越過 `source_entity_enumeration`
- **AND** 若 conversion 成功，evidence 記錄產出的 `conversion_job_id`、`artifact_group_id`、衍生 USDC artifact ID 或 URL、mapping artifact ID 或 URL，以及 readiness 狀態

#### Scenario: Optimization evidence keeps baseline unlocked when incomplete

- **WHEN** 優化後的執行仍 timeout、失敗或僅產出部分 evidence
- **THEN** runtime verification evidence 記錄確切的 phase 與失敗原因
- **AND** canonical batch baseline 維持 `minimum_coverage_locked=false`

#### Scenario: Secondary GUID and name extraction measurement is always recorded

- **WHEN** canonical burn-down run 以 `--profile-source-entities` 執行（即便該 run 並未啟用 secondary 優化）
- **THEN** evidence 記錄 `guid_extraction` 與 `name_extraction` 子階段 elapsed seconds、`source_entity_enumeration` 佔比，以及 `optimization_applied` 狀態（`true` / `false` / `deferred_to_follow_up`）
- **AND** 若 `optimization_applied=true`，evidence 記錄 before/after 差值與 `ifc_guid` / `name` fidelity 在所有 source entity 一致的證明
- **AND** 若 `optimization_applied=deferred_to_follow_up`，evidence 記錄 follow-up change 候選名稱與 deferral 原因

## ADDED Requirements

### Requirement: Full canonical batch outcome distribution evidence

Runtime verification evidence MUST 為每次 full canonical 13-file storage batch run 記錄完整的 outcome distribution。Evidence MUST 包含：

- batch command 與引數（建議 `verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`）；
- 13 個 fixture 的 input identity（filename、relative path、size、source artifact ID 或 SHA-256 之類 stable hash）；
- 每個 fixture 的 outcome 分桶（`passed` / `passed_with_quality_warning` / `timed_out` / `failed` / `blocked`）、`coverage_status`、`coverage_ratio`、`unmapped_count`、`no_guid_entity_count`、可取得時的 phase timings 與 stable artifact IDs（`conversion_job_id`、`artifact_group_id`、source artifact ID、derived USDC / mapping / sidecar artifact ID）；
- aggregate `outcome_distribution`（含 `total=13`、各分桶的 `count` 與 `rate`）；
- batch summary 的 `minimum_coverage_locked` 狀態與條件達成情形。

Evidence MUST NOT 宣稱 `minimum_coverage_locked=true` 除非 `outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass`。若 batch 因外部因素（檔案不可讀、磁碟空間、prerequisite 缺失）部分 fixture 為 `blocked`，evidence MUST 區分 owned blocker 與 external blocker。

Evidence MUST 至少對通過的 fixture 子集（建議第一個 89MB fixture，若已通過）嘗試 single-file visual preview，透過既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` flow 載入 `model.usdc`；若 Kit / GPU / browser automation 不可用，記錄 `not_observed` 並附 missing prerequisite，不得宣稱 visual preview 通過。

#### Scenario: Full batch evidence records distribution

- **WHEN** `_worker` 對 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 跑 `verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`
- **THEN** evidence 包含 13 個 fixture 的 outcome 分桶（`passed` / `passed_with_quality_warning` / `timed_out` / `failed` / `blocked`），以及 aggregate `outcome_distribution` 物件（含 `total=13` 與各分桶的 `count` 與 `rate`）
- **AND** evidence 引用每個 fixture 的 filename、relative path、size、stable hash 或 source artifact ID
- **AND** evidence 引用 batch command 與引數

#### Scenario: Full batch evidence records phase timings and IDs for completed fixtures

- **WHEN** batch run 中任一 fixture 完成 real conversion（無論 coverage_status 為 pass 或 warn）
- **THEN** evidence 為該 fixture 記錄 `conversion_job_id`、`artifact_group_id`、source artifact ID、derived USDC / mapping / sidecar artifact ID、phase timings、`coverage_status`、`coverage_ratio`、`unmapped_count`、`no_guid_entity_count`

#### Scenario: Coverage lock requires full batch pass

- **WHEN** `outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass`
- **THEN** evidence 記錄 batch summary `minimum_coverage_locked=true` 與 `status=passed`
- **AND** evidence 含 production baseline 已鎖定的紀錄與 fixture-level 證據連結

#### Scenario: Partial batch keeps coverage unlocked

- **WHEN** 13 個 fixture 中任一個 fixture status ≠ `passed` 或 coverage_status ≠ `pass`
- **THEN** evidence 記錄 batch summary `minimum_coverage_locked=false`，並列出阻塞 fixture 與 outcome 分桶
- **AND** evidence MUST NOT 將 batch 整體標示為 `passed`

#### Scenario: Visual preview attempt is recorded for passing fixtures

- **WHEN** batch run 中至少一個 fixture status=passed 且 coverage_status=pass
- **THEN** evidence 為該 fixture 嘗試 single-file visual preview，透過既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` flow 載入 `model.usdc`
- **AND** 若 Kit / GPU / browser automation 不可用，evidence 將 visual preview 記為 `not_observed` 並列出 missing prerequisite

#### Scenario: External blocker is distinguished from owned blocker

- **WHEN** 一個或多個 fixture 因檔案系統錯誤、磁碟空間、prerequisite 缺失或 IfcOpenShell 限制而被分類為 `blocked` 或 `failed`
- **THEN** evidence 記錄是 `_worker`-owned blocker（轉檔器邏輯、quality 政策）或 external blocker（IO、依賴、輸入檔案損毀）
- **AND** evidence 不得用 external blocker 解釋 `_worker`-owned coverage 退化
