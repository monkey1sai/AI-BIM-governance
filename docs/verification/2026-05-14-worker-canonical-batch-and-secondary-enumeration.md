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
- `test_source_entities_keep_no_guid_keys_unique_under_id_collision`（no-GUID `id()==0` 撞名）
- `test_source_entities_keep_keys_unique_under_duplicate_global_id`（duplicate GlobalId — canonical 真因 regression）

`_worker/tests/test_worker_batch_verification.py`：

- `test_batch_verification_outcome_distribution_is_derivable_from_records`
- `test_batch_verification_outcome_distribution_mixes_quality_warning_and_failure`
- `test_batch_verification_subset_run_cannot_lock_baseline_even_when_all_pass`
- `test_batch_verification_failed_fixture_buckets_into_failed`
- `test_batch_verification_timed_out_fixture_buckets_into_timed_out`

## Focused Test Results

```
$ python -m pytest tests/ -q
..........s............................................................. [ 56%]
.......................................................                  [100%]
126 passed, 1 skipped in 34.34s
```

執行於 `_worker/` 目錄，使用該服務的 venv，符合 CLAUDE.md「Python tests 必須在各自服務目錄執行」要求。126 = 原 124 + 2 條 key-uniqueness regression（no-GUID id 撞名 / duplicate GlobalId）。

## Canonical Evidence (v3, 2026-05-15) — GOAL ACHIEVED

Command: `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage WORKER_JOBS_DIR=C:\Temp\wk-canon-v3\jobs WORKER_OBJECTS_ROOT=C:\Temp\wk-canon-v3\objects python scripts/verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`

`WORKER_JOBS_DIR` / `WORKER_OBJECTS_ROOT` relocated outside the git worktree to root-mitigate the Windows `PermissionError [WinError 5]` on `<jobs_dir>/conv_*.phase.json.tmp` rename observed in v2 (high-frequency progress writes inside a long-lived process under git/AV watch).

### Three canonical runs

| Run | 變更 | 結果 |
|---|---|---|
| v1 | monolithic 原樣 | 13/13 轉檔成功，但每檔 `unmapped_count=2`、`coverage_status=unlocked` → distribution `passed=0` / `passed_with_quality_warning=13`、`minimum_coverage_locked=false`。推翻 pre-change 的「殘留是 no-GUID geometry-shape」假設。 |
| v2 | no-GUID-only key fix | 完成的 fixture 仍 `unmapped_count=2`；4 檔 `PermissionError [WinError 5]`。`ifc_index.json` summary 揭露真因：`guid_count=73,743` vs entities-with-GlobalId `73,745` → **模型本身 2 個重複 GlobalId**。 |
| **v3** | `ifc_entity_key` 無條件唯一 + jobs/objects 移出 worktree | **全 13 檔 `status=passed`、`coverage_status=pass`、`unmapped_count=0`、`minimum_coverage_locked=true`。** |

### Input identity

13 個 `storage/*.ifc`，**全部 byte-identical 副本**：每個 `89,394,282` bytes、`sha256=54d77fe1c8839bdd7d2cb46a9a87e4491b75f0019462608fab7bc5fc86155b71`。檔名：`許良宇圖書館建築_2026.ifc`、`許良宇圖書館建築_2026 - 複製.ifc`、`許良宇圖書館建築_2026 - 複製 (2..12).ifc`。

> 誠實聲明：13 檔為同一模型的副本，因此本 batch 驗證的是「同一輸入跑 13 次的可重現性 + lock gate 行為」，**不是** 13 個不同 IFC 作者工具 / schema 版本的多樣性。多樣性 fixture 屬未來 risk burn-down，不在本 change scope。

### Per-fixture outcome（全 13 檔一致）

| 欄位 | 值（13 檔皆同） |
|---|---|
| `status` / `coverage_status` | `passed` / `pass` |
| `source_ifc_entity_count` | `1,604,773` |
| `mapped_count` | `1,604,773` |
| `mapped_renderable_count` | `6,998` |
| `sidecar_carrier_count` | `1,597,775`（pre-change 為 1,597,773；+2 = 修正後正確接住的 2 個 duplicate-GUID entity） |
| `unmapped_count` | `0`（pre-change 為 2） |
| `no_guid_entity_count` | `1,531,028` |
| `coverage_ratio` | `1.0` |
| `minimum_coverage_baseline_locked` | `true` |

不變式 `mapped_renderable_count + sidecar_carrier_count == mapped_count == source_ifc_entity_count`：`6,998 + 1,597,775 = 1,604,773` ✓

Stable artifact IDs（每 fixture 一組，`conv_*` / `ag_*` / `artifact_src_*` / `artifact_usdc_*` / `artifact_mapping_*`）完整記錄於 `_worker/data/verification/2026-05-14-canonical-batch-v3.json`（已保留，394K）。樣本第一檔：`conversion_job_id=conv_20260515050643_73f633e9`、`artifact_group_id=ag_2aa32793474c`、`source_artifact_id=artifact_src_84bd5a2e5ac6`。

Phase timing 範圍（13 檔）：`ifc_open≈4.1–4.3s`、`source_entity_enumeration≈26.6–44.0s`、`geometry_iteration≈178.6–269.9s`、`mesh_authoring≈6.9–13.6s`、`non_renderable_entity_materialization≈10.8–14.9s`、`stage_save≈0.2–0.3s`、`stage_reopen≈0.01–0.02s`、`conversion_total≈221.6–333.5s`。

### Batch summary

```
status=passed   minimum_coverage_locked=True   failure_count=0   timed_out_count=0
outcome_distribution: total=13
  passed                       13   (rate 1.0)
  passed_with_quality_warning  0
  timed_out                    0
  failed                       0
  blocked                      0
```

三項解鎖條件全數成立：(1) `outcome_distribution.passed.count == 13`；(2) 所有 fixture `minimum_coverage_baseline_locked=true`；(3) 所有 fixture `coverage_status=pass`。**本 change 的 stated goal 達成。**

### Secondary `guid_extraction` / `name_extraction` — DEFERRED（design Decision 9）

`--profile-source-entities` 量測（13 檔範圍）：`guid_extraction≈10.39–17.13s`、`name_extraction≈9.84–16.19s`，aggregate 約 20–33s，佔 `source_entity_enumeration≈26.6–44.0s` 的大宗，但相對 `conversion_total≈221.6–333.5s` 約 7–10%。

這是 **cost**，不是可達成的 **saving**。實際省下 ≥5s 需動 IfcOpenShell 屬性存取，有 `ifc_guid` / `name` fidelity 風險，predecessor 已明確 defer。依 design Option C1 deferral arm：`optimization_applied=deferred_to_follow_up`，follow-up 候選 `optimize-worker-secondary-enumeration`。本 change 不實作優化，只記錄量測。

### Visual preview attempt — `not_observed`

本 session 未啟動 Kit / GPU / browser automation，未透過 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` flow 載入 `model.usdc`。依 spec scenario，記為 `not_observed`，缺的 prerequisite：single-Kit runtime + WebRTC + browser automation。**不宣稱 visual preview 通過**；屬 demo-runtime readiness 範疇（active change `stabilize-demo-runtime-readiness` 承接），不在本 change scope。

### Scratch footprint & cleanup

每 fixture derived artifact ≈1.58 GB（`element_mapping.json` 663MB + `ifc_index.json` 578MB + `entity_index.json` 330MB vs `model.usdc` 僅 9.4MB）。v1/v2/v3 累積約 58 GB（worktree 內 36GB + `C:/Temp` 22GB）。本 session 收尾時已手動清除全部 scratch（保留 `_worker/data/verification/*.json` 小證據檔，394K）。自動 retention / 結構化檔案管理已記入 design「Successor handoff」，由後繼 change `queue-batch-dispatch-and-post-usdc-artifact-retention` 承接（route α）。

## Root Cause Discovery

Pre-change proposal/design 假設 `unmapped_count=2` 是「geometry-shape entities lacking `ifc_guid`」。Canonical 實證推翻：

- v3 通過前，`element_mapping.json` 的 `unmapped_ifc_entities` 為**空**，代表沒有真的缺 carrier 的 entity——`unmapped_count=2` 純粹是 `len(source_entities)=1,604,773`（list）vs `len(mapping_by_entity)=1,604,771`（dict）的 cardinality artifact。
- `ifc_index.json` summary：`guid_count=73,743`，entities-with-GlobalId = `1,604,773 − 1,531,028 = 73,745` → **恰好 2 個重複 GlobalId**。
- 兩個不同 entity 共用同一 GlobalId，以 `guid` 當 `ifc_entity_key` 互撞，`mapping_by_entity` 的 per-key dedup 靜默 drop 第二個。
- 修正：`ifc_entity_key` 無條件附加 1-based enumeration index（`f"{guid}:{index}"` / `f"{ifc_class}:{entity_id}:{index}"`）。`ifc_guid` 保留真實（含重複）GlobalId，不合成識別碼（design A3 仍 rejected），all-entity denominator 不變；renderable geometry 仍透過 raw GlobalId 對映（`source_by_guid` 以 `ifc_guid` 為 key），USD prim `ifc:guid` attribute 不受影響。design.md Decision 1 已補 empirical correction。

## Risks Known After Implementation

- Lock gate 仰賴 per-fixture `minimum_coverage_baseline_locked=True` 的真實量測。任何將該 flag 強制設為 True 的旁路（例如外部覆寫 quality_metrics）都會破壞 spec invariant；目前實作只在 converter `unmapped_count == 0` 路徑會設為 True。v3 證實真實 canonical fixture 走此路徑。
- `passed_with_quality_warning` bucket 把 `coverage_status=unlocked` 的 passed fixture 一併收進；v3 全 13 檔皆 `pass`，此路徑未被觸發，但未來多樣性 fixture 仍可能落入，unlocked vs warn 語意收斂留給後續 change。
- secondary optimization 未在本 change 落地（design Decision 9 deferral）；v3 已記錄真實量級（`guid_extraction≈10–17s`、`name_extraction≈10–16s`），後繼 change 有 baseline 可比。
- 13 檔為 byte-identical 副本，batch 證實可重現性與 lock gate，但**未**證實跨多樣 IFC 作者工具的 robustness——屬未來 risk burn-down。
- 每 fixture ≈1.58GB derived artifact、無自動 retention：本 session 已手動清 58GB，自動化留給後繼 change `queue-batch-dispatch-and-post-usdc-artifact-retention`。

## Roadmap Sync（已執行）

- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §5.2「Active risk burn-down」更新為 v3 GOAL ACHIEVED，引用本 change ID 與本 verification doc
- §10 #4 反映 `minimum_coverage_locked=true` 達成
- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html` 同名 surgical 同步
- queue + post-USDC file-management 切為後繼 change（route α），記入 design「Successor handoff」
