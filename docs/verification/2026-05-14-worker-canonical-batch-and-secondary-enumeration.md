# worker canonical-batch & secondary-enumeration verification

日期：2026-05-14（implementation 落地）

## Scope

本紀錄對應 OpenSpec change `optimize-worker-canonical-batch-and-secondary-enumeration`，範圍限於：

- `_worker` 全 13 檔 canonical batch 的 outcome distribution
- per-fixture `minimum_coverage_baseline_locked` 與 batch 級 `minimum_coverage_locked` 解鎖條件
- `no_guid_entity_count` 與 `mapped_renderable_count` additive 診斷
- secondary `guid_extraction` / `name_extraction` profile 量測（gated optimization）

本 change 不處理 `_bim-control` metadata authority、`bim-review-coordinator` session lifecycle、`web-viewer-sample` UI、Kit runtime、WebRTC、GPU provisioning 或 production batch scheduler。

## Baseline Before This Change

前一份 canonical evidence：`docs/verification/2026-05-13-worker-non-renderable-materialization-optimization.md`

- Command: `python scripts/verify_storage_batch.py --limit 1 --timeout-seconds 600 --profile-source-entities`
- Fixture: `許良宇圖書館建築_2026 - 複製 (10).ifc`（89394282 bytes）
- Result: `passed`，`conversion_total=267.72s`
- `materialization_strategy=sidecar`、`sidecar_carrier_count=1,597,773`、`mapped_renderable_count≈6,998`（implied）
- `source_ifc_entity_count=1,604,773`、`mapped_count=1,604,771`、`unmapped_count=2`、`coverage_ratio=0.99999875`、`coverage_status=warn`
- `minimum_coverage_baseline_locked=false`、`minimum_coverage_locked=false`
- 13 檔 batch：not run

## Implemented Behaviour Changes

`_worker/app/converters.py`：

- `IfcOpenShellUsdConverter.convert` 在 `_materialize_unmapped_entities` 呼叫前先快照 `mapped_renderable_count = len(mapping_by_entity)`；materialization 補上的 sidecar entries 即為 sidecar carrier 部分，兩者加總等於 `mapped_count`，不會重複計算同一 entity。
- 新增 `no_guid_entity_count`：source_entities 中 `ifc_guid` 為 `None`/falsy 的數量，作為 additive diagnostic 寫入 `quality_metrics` 與 mapping summary。
- 新增 lock gate：`source_count > 0 AND unmapped_count == 0` → `minimum_coverage_baseline_locked=True`、`coverage_status="pass"`、`threshold_status="locked"`、`issue_to_real_prim_readiness=True`；否則保留 `unlocked` / `measure_only` 狀態。`element_mapping.json` 的 `coverage_policy.minimum_coverage_baseline_locked` 同步更新。
- sidecar inclusion predicate 仍以「`entity_key not in mapping_by_entity`」評估，已涵蓋 no-GUID geometry-shape entries；新增測試明確驗證該行為。

`_worker/app/store.py`：

- `_quality_metrics_summary` 增列 `no_guid_entity_count`、`mapped_renderable_count`、`sidecar_carrier_count`、`materialization_strategy`，使 lineage / quality summary 對下游可見。`_normalize_quality_metrics` 不需變更（已能保留未列舉的 metric 鍵）。

`_worker/app/batch_verification.py`：

- 新增 5-bucket `outcome_distribution`：`passed` / `passed_with_quality_warning` / `timed_out` / `failed` / `blocked`，count + rate；total = `len(records)`，分佈完全由 per-fixture rows 派生。
- `_fixture_outcome_bucket` 將 `coverage_status ∈ {unlocked, None}` 與 `passed` fixture status 對應到 `passed_with_quality_warning`，避免「unlocked but passed」靜默通過 lock gate；`coverage_status="fail"` 與 `status="failed"` 都歸 `failed`。
- `minimum_coverage_locked` gate 收緊為：`not partial AND outcome_distribution.passed.count == len(selected_sources) AND locked_passes == len(selected_sources)`。`--limit` 子集執行不再可能 lock，符合「Full canonical batch locks coverage」spec scenario。

`_worker/scripts/verify_storage_batch.py`：

- JSON output 之外，CLI 結尾額外印一行 `outcome_distribution: total=N passed=N ... minimum_coverage_locked=...`，純人類可讀 diagnostic，不更動 JSON shape。

## Tests Added / Updated

`_worker/tests/test_worker_converters.py`：

- `test_sidecar_carrier_picks_up_no_guid_geometry_shape_entities`
- `test_quality_metrics_record_no_guid_entity_count`
- `test_clean_fixture_locks_baseline_and_reports_coverage_pass`
- `test_mapped_renderable_and_sidecar_counts_do_not_overlap`

`_worker/tests/test_worker_batch_verification.py`：

- `test_batch_verification_outcome_distribution_is_derivable_from_records`
- `test_batch_verification_outcome_distribution_mixes_quality_warning_and_failure`
- `test_batch_verification_subset_run_cannot_lock_baseline_even_when_all_pass`
- `test_batch_verification_failed_fixture_buckets_into_failed`
- `test_batch_verification_timed_out_fixture_buckets_into_timed_out`

## Focused Test Results

```
$ python -m pytest tests/ -q
.........s....................................................... [...]
124 passed, 1 skipped in 33.65s
```

執行於 `_worker/` 目錄，使用該服務的 venv，符合 CLAUDE.md「Python tests 必須在各自服務目錄執行」要求。

## Pending Canonical Evidence

以下 evidence 未在 implementation PR 內收齊，留待後續 canonical run 補完並追加到本文件：

### Full canonical 13-file batch

- Command: `python scripts/verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`
- Storage root: `C:\Repos\active\iot\AI-BIM-governance\storage`
- 預計記錄欄位（每 fixture）：filename、relative path、size、SHA-256、`conversion_job_id`、`artifact_group_id`、source artifact ID、derived USDC / mapping / sidecar artifact ID、`status`、`coverage_status`、`coverage_ratio`、`unmapped_count`、`no_guid_entity_count`、`mapped_renderable_count`、phase timings
- 預計 batch summary：`outcome_distribution`（含 `total=13`、各 bucket count/rate）、`minimum_coverage_locked`、`failure_count`、`timed_out_count`

`minimum_coverage_locked=true` 解鎖條件：
1. `outcome_distribution.passed.count == 13`
2. 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true`
3. 所有 fixture `coverage_status=pass`

如有任一條件未滿足，本紀錄將列出阻塞 fixture 與分桶。

### Secondary `guid_extraction` / `name_extraction` measurement

- 同一 canonical run 帶 `--profile-source-entities`，自每個 fixture 的 `source_entity_enumeration.details.profile` 取 `guid_extraction_seconds` 與 `name_extraction_seconds`
- 若 aggregate saving ≥ 5 s 且可保證 `ifc_guid` / `name` 對所有 source entity byte-identical → 開 follow-up change 實作優化
- 否則 evidence 標記 `optimization_applied=deferred_to_follow_up`，候選名稱：`optimize-worker-secondary-enumeration`

### Visual preview attempt

- 取通過子集（至少 89MB fixture）透過既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` flow 載入 `model.usdc`
- 若 Kit / GPU / browser automation 不可用 → 記 `not_observed` 並列出 missing prerequisite，不宣稱 visual preview 通過

## Risks Known After Implementation

- Lock gate 仰賴 per-fixture `minimum_coverage_baseline_locked=True` 的真實量測。任何將該 flag 強制設為 True 的旁路（例如外部覆寫 quality_metrics）都會破壞 spec invariant；目前實作只在 converter `unmapped_count == 0` 路徑會設為 True。
- `passed_with_quality_warning` bucket 將 `coverage_status=unlocked` 的 passed fixture 一併收進來，這比 spec scenario「known, explicitly allowed degradation」略寬鬆；canonical run 後若觀察到混合，需在後續 change 收斂 unlocked vs warn 的語意。
- secondary optimization 還沒在本 change 落地（gated on measured win）；profile 仍會記錄，但 `name_extraction` 與 `guid_extraction` 在 `_FakeModel` 下的時間趨近 0，無法以單元測試確認真實 fixture 量級的省略。

## Roadmap Sync

完成 canonical run 後同步：

- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §5.2 改為 `active` / `archived`，引用本 change ID 與 verification doc
- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §10 #4 反映 batch 結果；若 `minimum_coverage_locked=true` 達成 → 同步 §1.3 production baseline 紀錄
- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html` 同名再產
