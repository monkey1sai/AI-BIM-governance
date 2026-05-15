## 1. 準備與影響檢查

- [x] 1.1 重新閱讀已歸檔 `openspec/changes/archive/2026-05-14-optimize-worker-non-renderable-materialization/`、`docs/verification/2026-05-13-worker-non-renderable-materialization-optimization.md`、`openspec/specs/worker-artifact-pipeline/spec.md` 與 `openspec/specs/runtime-verification-evidence/spec.md`。
- [x] 1.2 重新閱讀 `_worker/app/converters.py`（`_materialize_unmapped_entities`、sidecar inclusion predicate、source entity enumeration helpers）、`_worker/app/batch_verification.py`、`_worker/app/store.py`、`_worker/scripts/verify_storage_batch.py` 與既有 `_worker/tests/*`。
- [x] 1.3 對準備修改的 symbols 執行 GitNexus impact analysis，至少包含 `IfcOpenShellUsdConverter._materialize_unmapped_entities`、`IfcOpenShellUsdConverter.convert`、`run_storage_batch_verification`、batch summary builder。三者皆為 LOW risk（每個目標僅 d=1 caller=1）。
- [ ] 1.4 確認 canonical fixture root `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 有 13 個 required fixtures；記錄 fixture filename、size、relative path、SHA-256（或 git-tracked equivalent）作為 batch run 的 input identity。
- [ ] 1.5 確認 `_worker` repo-local `.venv` 與 `fastapi==0.111.0 / starlette==0.37.2 / uvicorn==0.45.0` baseline 已就緒；若未就緒先補。

## 2. Carrier-rule 與 `unmapped_count=2` 修正

- [x] 2.1 在 `_materialize_unmapped_entities` 內把 sidecar inclusion predicate 由「non-renderable AND has identity」調整為「any source IFC entity that was not authored as a renderable USD prim」。允許 `ifc_guid=null` 的 entry 進入 sidecar，但 `ifc_entity_key` / `ifc_entity_id` / `ifc_class` 必須存在（既有實作已涵蓋全部 source_entities；補測試 `test_sidecar_carrier_picks_up_no_guid_geometry_shape_entities`）。
- [x] 2.2 在 quality metrics 增加 additive `no_guid_entity_count` 診斷（per-fixture），用以稽核 no-GUID geometry-shape entries 數量。
- [x] 2.3 確保 `mapped_count = mapped_renderable_count + sidecar_carrier_count` 不重複計算同一 entity（sidecar inclusion 在 renderable authoring 之後決定；補 `mapped_renderable_count` 與不重疊測試）。
- [x] 2.4 確認 `entity_index.json` schema 對 `ifc_guid=null` 是合法 entry（既有 schema 已標示 `ifc_guid: "..." | null`，由 `test_sidecar_carrier_picks_up_no_guid_geometry_shape_entities` 覆蓋）。

## 3. Outcome distribution

- [x] 3.1 在 `batch_verification` summary builder 計算 `outcome_distribution`：對 13 個 fixture 的 record 做分桶（`passed` / `passed_with_quality_warning` / `timed_out` / `failed` / `blocked`），輸出 `{total, <bucket>: {count, rate}}`。
- [x] 3.2 把 `outcome_distribution` 寫入 batch summary 為 additive optional field；既有 `status`、`fixtures`、`minimum_coverage_locked` 等 key 維持不變。
- [x] 3.3 在 `verify_storage_batch.py` 結尾 print distribution summary line（CLI human-readable diagnostic；不影響 JSON output）。
- [x] 3.4 確定 bucket 對應：`passed`=fixture_status=passed AND coverage_status=pass；`passed_with_quality_warning`=fixture_status=passed AND coverage_status∈{warn, unlocked, None}；`failed`=fixture_status=failed 或 coverage_status=fail；`timed_out` 與 `blocked` 沿用 record.status。

## 4. `minimum_coverage_locked` 解鎖條件

- [x] 4.1 在 batch summary builder 計算 `minimum_coverage_locked` 時，新增 gate：`partial=False` AND `outcome_distribution.passed.count == len(selected_sources)` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true`。任一不滿足 → `false`。（`== 13` 對應 canonical full batch 沒有 `--limit` 的情況；本實作以 `not partial AND passed.count == selected_count` 等價表達，以支援其他環境的最小驗證。）
- [x] 4.2 在 per-fixture quality metrics 上設定 `minimum_coverage_baseline_locked=true` 的條件：converter 在 `source_count > 0 AND unmapped_count == 0` 時把 `minimum_coverage_baseline_locked` 設為 `True`、`coverage_status` 設為 `"pass"`、`threshold_status` 設為 `"locked"`、`issue_to_real_prim_readiness` 設為 `True`；否則維持 unlocked。
- [x] 4.3 加入 batch summary 測試覆蓋 `outcome_distribution.passed.count < selected_count` 時 `minimum_coverage_locked=false`（`test_batch_verification_subset_run_cannot_lock_baseline_even_when_all_pass`、`test_batch_verification_outcome_distribution_mixes_quality_warning_and_failure`）。

## 5. Secondary `guid_extraction` / `name_extraction` profiling 與選擇性優化

- [x] 5.1 確認 `verify_storage_batch.py --profile-source-entities` 仍輸出 `guid_extraction` 與 `name_extraction` 的 per-fixture timings；canonical batch run 必須帶 `--profile-source-entities`（`profile_source_entity_enumeration` flag 由 batch 層傳遞至 converter `_source_entities`）。
- [ ] 5.2 收集本 change canonical run 的 `guid_extraction + name_extraction` aggregate timing；若 measured win ≥ 5 s 且 IFC GUID / Name fidelity 可保證 → 進 §5.3 實作；否則跳到 §5.4 deferral。（本 change implementation PR 留給 canonical run evidence；參見 §7。）
- [ ] 5.3（optional）實作 secondary optimization（例如 batch attribute access、schema lookup cache、預先 IfcOpenShell schema mapping），保證 `ifc_guid` / `name` 對所有 source entity 仍 byte-identical；加入 fidelity 測試。
- [ ] 5.4（fallback to deferral）若 §5.3 不執行，在 `docs/verification/2026-05-14-worker-canonical-batch-and-secondary-enumeration.md` 與本 change `design.md` 註明 deferral 原因（measured saving < 5 s 或 fidelity 風險），並建立 follow-up change 候選名稱（建議 `optimize-worker-secondary-enumeration`）。

## 6. Tests

- [x] 6.1 加入或更新 `_worker/tests/test_worker_converters.py` 測試覆蓋：sidecar inclusion 對 no-GUID geometry-shape entity 仍正確 carrier；`mapped_count + unmapped_count = source_ifc_entity_count` 不變；無重複 carrier。
- [x] 6.2 加入或更新 `_worker/tests/test_worker_converters.py` 測試覆蓋：`no_guid_entity_count` 為 additive diagnostic；`coverage_status=pass` 在 `unmapped_count=0` 時成立（即 `test_quality_metrics_record_no_guid_entity_count`、`test_clean_fixture_locks_baseline_and_reports_coverage_pass`）。
- [x] 6.3 加入或更新 `_worker/tests/test_worker_batch_verification.py` 測試覆蓋：`outcome_distribution` 對不同 status 組合的計算正確；batch summary 既有 keys 不變；`minimum_coverage_locked` gate 滿足條件才為 `true`（`test_batch_verification_outcome_distribution_*` 系列）。
- [ ] 6.4 加入 fidelity test：對 representative 子集 fixture，secondary `guid_extraction` / `name_extraction` 優化前後 `ifc_guid` / `name` 值對所有 source entity 一致（適用於 §5.3 才實作的情況；本 change 未啟用 §5.3，延後）。
- [x] 6.5 加入 backward-compat test：sidecar `entity_index.json` schema 仍可被 lineage API 與既有 readiness check 消費；無新欄位 required（既有 `test_sidecar_carrier_contains_all_non_renderable_identities` + 新增 `test_sidecar_carrier_picks_up_no_guid_geometry_shape_entities` 覆蓋）。

## 7. Canonical Verification

- [x] 7.1 在 `_worker/` 目錄執行 focused tests：126 passed / 1 skipped（含 2 條 key-uniqueness regression）。
- [x] 7.2 執行 `openspec validate optimize-worker-canonical-batch-and-secondary-enumeration --strict`：綠。
- [x] 7.3 canonical full 13-file batch 跑三次（v1/v2 診斷真因，v3 全綠）；v3 jobs/objects 移出 worktree 避 Windows 檔案鎖。
- [x] 7.4 v3 每 fixture 的 `conversion_job_id`/`artifact_group_id`/source/usdc/mapping artifact ID、`status`/`coverage_status`/`coverage_ratio`/phase timings/`unmapped_count`/`no_guid_entity_count`/`mapped_renderable_count` 與 batch `outcome_distribution` 全數記入 verification doc，raw JSON 保留於 `_worker/data/verification/2026-05-14-canonical-batch-v3.json`。
- [x] 7.5 v3：`outcome_distribution.passed.count == 13` AND 全 fixture `coverage_status=pass` AND `minimum_coverage_baseline_locked=true` → batch `minimum_coverage_locked=true` 確認。
- [x] 7.6 visual preview：本 session 未啟動 Kit/GPU/browser，依 spec 記為 `not_observed` 並列 missing prerequisite，不宣稱通過（demo-runtime readiness 範疇）。

## 8. Evidence 與 Roadmap 對齊

- [x] 8.1 `docs/verification/2026-05-14-worker-canonical-batch-and-secondary-enumeration.md`：input identity（13 byte-identical 副本 + SHA-256）、canonical command、per-fixture outcome、`outcome_distribution`、`minimum_coverage_locked=true`、secondary deferral（Decision 9）、visual preview `not_observed`、root cause discovery、58GB scratch cleanup 全數記錄。
- [x] 8.2 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §5.2 更新為 v3 GOAL ACHIEVED、引用 change 與 verification doc；§10 #4 反映 `minimum_coverage_locked=true`。
- [x] 8.3 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html` 同名 surgical sync（含 TOC）。
- [ ] 8.4 執行 `git diff --check` 與 GitNexus `detect_changes`（commit 前四層驗證執行）。
