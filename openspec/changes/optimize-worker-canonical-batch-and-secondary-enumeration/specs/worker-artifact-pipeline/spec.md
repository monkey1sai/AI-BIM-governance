## MODIFIED Requirements

### Requirement: Worker reports conversion quality before enforcing coverage gates

`_worker` SHALL only mark an artifact group ready for review when the real conversion output passes hard quality gates. Hard gates MUST include USDC openability, renderable prim presence, non-placeholder output, and truthful mapping output when `generate_mapping=true`.

Mapping coverage MUST be measured and reported when `generate_mapping=true`. Before a baseline is locked, `_worker` MUST continue to report coverage as observed data and MUST NOT fail CI only because coverage is below an unstabilized threshold. After baseline stabilization, `_worker` MUST expose a locked minimum coverage policy with `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status`, and policy diagnostics.

Coverage calculation MUST include every source IFC entity in the denominator. `_worker` MUST carry every IFC entity in the artifact group with stable traceability back to the source IFC entity. Each source IFC entity's carrier MUST be one of: (a) a renderable or highlightable USD prim authored into `model.usdc` when geometry exists, (b) a non-renderable USD prim authored into `model.usdc`, or (c) a sidecar mapping artifact entry (`element_mapping.json` or a dedicated `entity_index.json`) that records the same stable IFC traceability fields. The chosen carrier MUST preserve IFC class, entity identifier, GlobalId when present, Name when present, and relationship metadata when available. No IFC entity class may be excluded from coverage solely because it is not renderable, regardless of which carrier is used.

Every source IFC entity MUST resolve to at least one carrier — a USD prim path or a sidecar mapping entry — for `coverage_status=pass`, **including geometry-shape source IFC entities that lack `ifc_guid` and were not authored as a renderable USD prim**. Such entries MUST land in the sidecar mapping artifact with `ifc_guid=null` while still recording `ifc_entity_key`, `ifc_entity_id`, and `ifc_class`. When coverage status is `warn`, `_worker` MAY keep the artifact group eligible for review-session creation as degraded quality, but MUST NOT classify issue-to-real-prim readiness as verified. When coverage status is `fail`, `_worker` MUST NOT claim mapping readiness or issue-to-real-prim highlight readiness.

When a sidecar carrier is used for non-renderable IFC entities, the conversion result and lineage MUST surface the sidecar artifact alongside `model.usdc`, `ifc_index.json`, `usd_index.json`, and `element_mapping.json`, so that `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` can continue to obtain complete coverage data without requiring those entities to be present as USD prims. Renderable mapped entries MUST keep existing `primary_usd_prim_path` / `usd_prim_path` / `usd_prim_paths` semantics.

Quality metrics MUST additionally expose an additive `no_guid_entity_count` diagnostic counting source IFC entities that lack `ifc_guid` and therefore rely on `ifc_entity_key` / `ifc_entity_id` for identity. The diagnostic MUST be backward-compatible (consumers that ignore it MUST NOT break).

#### Scenario: Hard quality gate passes

- **WHEN** a conversion job produces an openable USDC, renderable prims, non-placeholder output, and truthful mapping report
- **THEN** `_worker` marks the conversion job `succeeded`, returns derived artifact URLs, and includes coverage metrics in the result payload

#### Scenario: Mapping coverage is measured before threshold lock

- **WHEN** a conversion job produces an openable USDC and coverage report before a minimum threshold is locked
- **THEN** `_worker` returns the coverage report with `minimum_coverage_baseline_locked=false`, does not fail CI only for low coverage, and does not claim that minimum issue-to-real-prim coverage has been verified

#### Scenario: Mapping coverage passes locked threshold

- **WHEN** every source IFC entity resolves to at least one carrier (USD prim path or sidecar mapping entry)
- **THEN** `_worker` returns `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status=pass`, the applied denominator, and no coverage failure diagnostic

#### Scenario: Mapping coverage falls into warning policy

- **WHEN** a conversion job produces openable USDC and mostly truthful mapping, but one or more IFC entities cannot be carried in either USD prim or sidecar form for a known, explicitly allowed degradation reason
- **THEN** `_worker` returns `coverage_status=warn`, preserves artifact traceability, keeps the artifact group eligible for review-session creation, and reports that issue-to-real-prim highlight readiness is degraded rather than verified

#### Scenario: Mapping coverage fails locked threshold

- **WHEN** any source IFC entity lacks any carrier (no USD prim and no sidecar mapping entry) and the condition is not covered by an explicitly allowed warning policy
- **THEN** `_worker` returns `coverage_status=fail`, records validation diagnostics, and MUST NOT mark mapping readiness or issue-to-real-prim highlight readiness as verified

#### Scenario: Quality metrics are exposed

- **WHEN** `GET /api/conversions/{conversion_job_id}/result` returns a conversion result with status `succeeded`
- **THEN** the payload includes converter identity, conversion duration, source IFC entity count, USD prim count, sidecar carrier count when present, mapped count, unmapped count, coverage ratio, `minimum_coverage_ratio`, denominator policy, baseline lock status, coverage status, validation warnings when present, and `no_guid_entity_count`

#### Scenario: Non-geometric IFC entity is carried with stable traceability

- **WHEN** the source IFC contains non-geometric entities such as property sets, type objects, relationship entities, project, site, building, or storey containers
- **THEN** `_worker` carries each entity in `model.usdc` (as a non-renderable USD prim) or in a sidecar mapping artifact, recording IFC class, entity identifier, GlobalId when present, Name when present, and relationship metadata when available
- **AND** those entities are included in `source_ifc_entity_count` and coverage calculation regardless of which carrier was used

#### Scenario: Sidecar carrier is surfaced in conversion result and lineage

- **WHEN** `_worker` uses a sidecar mapping artifact to carry non-renderable IFC entity identity
- **THEN** the conversion result, `derived_artifact_ids`, and the lineage graph response identify the sidecar artifact alongside `model.usdc`, `ifc_index.json`, `usd_index.json`, and `element_mapping.json`
- **AND** downstream consumers can obtain complete coverage data without requiring non-renderable entities to be present as USD prims

#### Scenario: No-GUID geometry-shape entities are carried via sidecar

- **WHEN** the source IFC contains geometry-shape entities (for example construction geometry, mesh shape representations, or auxiliary geometry items) that lack `ifc_guid` and are not authored as renderable USD prims
- **THEN** `_worker` records each such entity in the sidecar mapping artifact with `ifc_guid=null` and preserved `ifc_entity_key`, `ifc_entity_id`, and `ifc_class`
- **AND** these entries count toward `mapped_count` and the `coverage_denominator=source_ifc_entity_count` calculation
- **AND** `coverage_status=pass` is reachable when no other carrier gaps remain

### Requirement: Worker optimizes source entity enumeration for canonical IFC fixtures

`_worker` MUST 在轉換 canonical IFC fixtures 時，把 `source_entity_enumeration` 視為自己擁有、可量測的 conversion subphase。Converter MUST 保留 all-IFC-entity 的 coverage denominator，同時避免不必要的重複 full-model traversal、過早的 deep relationship expansion，或對於建立穩定 source entity identity 並非必要的昂貴 metadata extraction。

優化後的 enumeration path MUST 為每個 source IFC entity 保留穩定識別欄位：`ifc_entity_key`、可取得時的 `ifc_entity_id`、`ifc_class`、存在時的 `ifc_guid`，以及可取得時的 `name`，且不得犧牲 bounded execution。It MUST NOT 將 all-entity coverage 退化為僅幾何、僅 `IfcProduct`、僅 GUID 或僅 renderable 的 coverage。

Real/canonical converter path MUST NOT 以 `model.by_type("IfcProduct")` 作為 all-entity 的 fallback。若無法進行 all-entity iteration，`_worker` MUST 以 deterministic diagnostics 讓 conversion 失敗或 block，而不是輸出僅 product-only 的 coverage evidence。

在長時間的 canonical conversions 中，`_worker` MUST 揭露 additive source enumeration diagnostics，例如 elapsed seconds、enumerated entity count、目前 phase 狀態、`fallback_used`、最後已知 operation，以及可取得時的 blocker 細節。這些 diagnostics MUST 與既有 conversion result 與 quality metrics payloads 保持向後相容。Fine-grained profiling diagnostics MAY 於 verification evidence 中啟用，且 MUST 為可選。

Secondary `guid_extraction` 與 `name_extraction` 子階段成本 MUST 在每次 canonical burn-down run 透過既有 `--profile-source-entities` 路徑量測並記錄。`_worker` MAY 在後續變更中優化此二子階段成本，但 MUST 保留 `ifc_guid` 與 `name` 對所有 source IFC entity 的真實值，不得以 synthetic ID 取代 real GUID，亦不得用 default name 取代 source-declared name。當 canonical run 未啟用任何 secondary 優化時，`_worker` 仍 MUST 在 evidence 中記錄當次量測值與「沒有變更」的事實，使 follow-up change 有 baseline 可比。

#### Scenario: Canonical source enumeration advances past timeout bottleneck

- **WHEN** 以設定的 per-fixture timeout 對第一個 89MB fixture 執行 canonical `--limit 1` storage verification
- **THEN** `_worker` 在 timeout 前完成 `source_entity_enumeration` 並進入下一個 conversion phase，或記錄 deterministic blocker diagnostics 指認非 `_worker` 端的限制
- **AND** 若 conversion 仍未完成，batch 結果維持 non-passed

#### Scenario: Enumeration preserves all-entity denominator

- **WHEN** `_worker` 優化 source entity enumeration
- **THEN** `source_ifc_entity_count`、`coverage_denominator=source_ifc_entity_count`、mapping 輸出與 non-renderable entity materialization 仍涵蓋所有 source IFC entity，而不僅是 renderable geometry entity

#### Scenario: Enumeration diagnostics are additive

- **WHEN** source entity enumeration 發出 progress 或 completion diagnostics
- **THEN** 既有 conversion result fields 仍然可用
- **AND** 新增的 diagnostics 為可選的 nested fields，consumer 可忽略而不影響 lineage、readiness 或 review viewer handoff

#### Scenario: Product-only fallback is rejected for canonical evidence

- **WHEN** real converter 無法 iterate 所有 IFC source entity
- **THEN** `_worker` 記錄 conversion blocker，而非退化為 `IfcProduct`-only enumeration
- **AND** 結果 MUST NOT 以 product-only 的子集宣稱 all-entity coverage evidence

#### Scenario: Optimization does not lock baseline prematurely

- **WHEN** source entity enumeration 已改善，但整個 canonical batch 尚未通過所有 archived baseline gates
- **THEN** `_worker` 維持 `minimum_coverage_locked=false`，並記錄剩餘的 blocker 或下一個 gate

#### Scenario: Secondary GUID and name extraction cost is measured

- **WHEN** canonical burn-down run 以 `--profile-source-entities` 對 first 89MB fixture（或任一 canonical fixture）執行
- **THEN** evidence 記錄 `guid_extraction` 與 `name_extraction` 的 elapsed seconds、所佔 `source_entity_enumeration` 比例，以及該次 run 是否啟用 secondary 優化
- **AND** 若該 run 啟用 secondary 優化，evidence 記錄 before/after timing 與 `ifc_guid` / `name` fidelity 對所有 source IFC entity 一致的證明
- **AND** 若該 run 未啟用 secondary 優化，evidence 記錄量測值與「deferred」的事實，並指出 follow-up change 候選名稱

## ADDED Requirements

### Requirement: Worker quantifies full canonical batch outcome distribution under sidecar carrier

`_worker` MUST 在執行 full canonical 13-file `storage/*.ifc` batch verification 時，於 batch summary 中產出 additive `outcome_distribution`，依以下分桶記錄各 fixture 的結果計數與比例：`passed`（status=passed AND coverage_status=pass）、`passed_with_quality_warning`（status=passed AND coverage_status=warn）、`timed_out`、`failed`（含 status=failed 或 status=passed AND coverage_status=fail），以及 `blocked`（fixture 未進入轉檔，例如缺 prerequisites）。

`outcome_distribution` MUST 為 additive optional field；既有 `status`、`fixtures`、`minimum_coverage_locked` 等 batch summary key 必須保持不變且向後相容。分桶結果 MUST 完全由 per-fixture row 派生，不得引入新的權威來源；測試 MUST 證明從 per-fixture rows 重新計算所得的 distribution 與記錄的 distribution 完全一致。

`_worker` MUST 僅在 `outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass` 同時成立時，才設定 batch summary `minimum_coverage_locked=true`。任一條件不滿足 → `minimum_coverage_locked=false`，且 batch summary MUST 記錄阻塞的 fixture 與原因（per-fixture row 已記錄足夠時不另增 row）。

`_worker` MUST NOT 在 full batch verification 中對單一 fixture 自動 retry。一個 fixture 在一次 batch run 內只記錄一次 outcome；使用者若要重跑單一 fixture，應另外執行 `--limit 1` 對該檔案，並產生獨立的 evidence。

#### Scenario: Full canonical batch records outcome distribution

- **WHEN** `_worker` 對 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 執行 `verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`
- **THEN** batch summary 中包含 `outcome_distribution` 物件，欄位含 `total`（=13）、`passed`、`passed_with_quality_warning`、`timed_out`、`failed`、`blocked` 各自的 `count` 與 `rate`
- **AND** distribution 計數加總 = `total` = `outcome_distribution.total`
- **AND** 既有 batch summary key（`status`、`fixtures`、`minimum_coverage_locked` 等）維持原樣

#### Scenario: Distribution is derived from per-fixture rows

- **WHEN** consumer 從 batch summary 重新計算 `outcome_distribution`（用 per-fixture row 的 `status` 與 `coverage_status`）
- **THEN** 重算結果與 batch summary 內記錄的 `outcome_distribution` 完全一致

#### Scenario: Coverage lock requires clean full batch

- **WHEN** `outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass`
- **THEN** batch summary `minimum_coverage_locked=true`
- **AND** batch summary `status=passed`

#### Scenario: Partial batch does not lock coverage

- **WHEN** 13 個 fixture 中有任一個 fixture status ≠ `passed` 或 coverage_status ≠ `pass`
- **THEN** batch summary `minimum_coverage_locked=false`
- **AND** batch summary 記錄阻塞的 fixture 與分類（`timed_out` / `failed` / `passed_with_quality_warning` / `blocked`）

#### Scenario: No automatic retry within a batch run

- **WHEN** 某個 fixture 在 batch run 中發生 timeout 或 failure
- **THEN** `_worker` 將該 fixture 的 outcome 記為單次結果（不重試），並繼續處理下一個 fixture
- **AND** batch summary 不得標示曾被自動 retry 過的 fixture 為 `passed`
