## 1. 準備與影響檢查

- [ ] 1.1 重新閱讀已歸檔 `openspec/changes/archive/2026-05-14-optimize-worker-non-renderable-materialization/`、`docs/verification/2026-05-13-worker-non-renderable-materialization-optimization.md`、`openspec/specs/worker-artifact-pipeline/spec.md` 與 `openspec/specs/runtime-verification-evidence/spec.md`。
- [ ] 1.2 重新閱讀 `_worker/app/converters.py`（`_materialize_unmapped_entities`、sidecar inclusion predicate、source entity enumeration helpers）、`_worker/app/batch_verification.py`、`_worker/app/store.py`、`_worker/scripts/verify_storage_batch.py` 與既有 `_worker/tests/*`。
- [ ] 1.3 對準備修改的 symbols 執行 GitNexus impact analysis，至少包含 `IfcOpenShellUsdConverter._materialize_unmapped_entities`、`IfcOpenShellUsdConverter.convert`、`run_storage_batch_verification`、batch summary builder。若風險為 HIGH 或 CRITICAL，先回報再繼續。
- [ ] 1.4 確認 canonical fixture root `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 有 13 個 required fixtures；記錄 fixture filename、size、relative path、SHA-256（或 git-tracked equivalent）作為 batch run 的 input identity。
- [ ] 1.5 確認 `_worker` repo-local `.venv` 與 `fastapi==0.111.0 / starlette==0.37.2 / uvicorn==0.45.0` baseline 已就緒；若未就緒先補。

## 2. Carrier-rule 與 `unmapped_count=2` 修正

- [ ] 2.1 在 `_materialize_unmapped_entities` 內把 sidecar inclusion predicate 由「non-renderable AND has identity」調整為「any source IFC entity that was not authored as a renderable USD prim」。允許 `ifc_guid=null` 的 entry 進入 sidecar，但 `ifc_entity_key` / `ifc_entity_id` / `ifc_class` 必須存在。
- [ ] 2.2 在 quality metrics 增加 additive `no_guid_entity_count` 診斷（per-fixture），用以稽核 no-GUID geometry-shape entries 數量。
- [ ] 2.3 確保 `mapped_count = mapped_renderable_count + sidecar_carrier_count` 不重複計算同一 entity（sidecar inclusion 在 renderable authoring 之後決定）。
- [ ] 2.4 確認 `entity_index.json` schema 對 `ifc_guid=null` 是合法 entry（既有 schema 已標示 `ifc_guid: "..." | null`，僅補測試覆蓋）。

## 3. Outcome distribution

- [ ] 3.1 在 `batch_verification` summary builder 計算 `outcome_distribution`：對 13 個 fixture 的 `status` 做分桶（`passed` / `timed_out` / `failed` / `mapping_quality_failed`），輸出 `{total, <status>: {count, rate}}`。
- [ ] 3.2 把 `outcome_distribution` 寫入 batch summary 為 additive optional field；既有 `status`、`fixtures`、`minimum_coverage_locked` 等 key 維持不變。
- [ ] 3.3 在 `verify_storage_batch.py` 結尾 print distribution summary line（CLI human-readable diagnostic；不影響 JSON output）。
- [ ] 3.4 收斂 `mapping_quality_failed` 的判定：當任一 fixture 的 `coverage_status ∈ {warn, fail}` 但 conversion 本身完成時，該 fixture status 歸 `mapping_quality_failed`。`timed_out` 與 `failed` 沿用既有判定。

## 4. `minimum_coverage_locked` 解鎖條件

- [ ] 4.1 在 batch summary builder 計算 `minimum_coverage_locked` 時，新增 gate：`outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass`。任一不滿足 → `false`。
- [ ] 4.2 在 per-fixture quality metrics 上設定 `minimum_coverage_baseline_locked=true` 的條件不變（仍由 converter 決定）；本任務只在 batch 層 aggregate。
- [ ] 4.3 加入 batch summary 測試覆蓋 `outcome_distribution.passed.count < 13` 時兩個 key 都為 `false`。

## 5. Secondary `guid_extraction` / `name_extraction` profiling 與選擇性優化

- [ ] 5.1 確認 `verify_storage_batch.py --profile-source-entities` 仍輸出 `guid_extraction` 與 `name_extraction` 的 per-fixture timings；canonical batch run 必須帶 `--profile-source-entities`。
- [ ] 5.2 收集本 change canonical run 的 `guid_extraction + name_extraction` aggregate timing；若 measured win ≥ 5 s 且 IFC GUID / Name fidelity 可保證 → 進 §5.3 實作；否則跳到 §5.4 deferral。
- [ ] 5.3（optional）實作 secondary optimization（例如 batch attribute access、schema lookup cache、預先 IfcOpenShell schema mapping），保證 `ifc_guid` / `name` 對所有 source entity 仍 byte-identical；加入 fidelity 測試。
- [ ] 5.4（fallback to deferral）若 §5.3 不執行，在 `docs/verification/2026-05-14-worker-canonical-batch-and-secondary-enumeration.md` 與本 change `design.md` 註明 deferral 原因（measured saving < 5 s 或 fidelity 風險），並建立 follow-up change 候選名稱（建議 `optimize-worker-secondary-enumeration`）。

## 6. Tests

- [ ] 6.1 加入或更新 `_worker/tests/test_worker_converters.py` 測試覆蓋：sidecar inclusion 對 no-GUID geometry-shape entity 仍正確 carrier；`mapped_count + unmapped_count = source_ifc_entity_count` 不變；無重複 carrier。
- [ ] 6.2 加入或更新 `_worker/tests/test_worker_store.py` 測試覆蓋：`no_guid_entity_count` 為 additive diagnostic；`coverage_status=pass` 在 `unmapped_count=0` 時成立。
- [ ] 6.3 加入或更新 `_worker/tests/test_batch_verification.py`（如不存在則新建）測試覆蓋：`outcome_distribution` 對 13 個 fixture 與不同 status 組合的計算正確；batch summary 既有 keys 不變；`minimum_coverage_locked` gate 滿足條件才為 `true`。
- [ ] 6.4 加入 fidelity test：對 representative 子集 fixture，secondary `guid_extraction` / `name_extraction` 優化前後 `ifc_guid` / `name` 值對所有 source entity 一致（適用於 §5.3 才實作的情況）。
- [ ] 6.5 加入 backward-compat test：sidecar `entity_index.json` schema 仍可被 lineage API 與既有 readiness check 消費；無新欄位 required。

## 7. Canonical Verification

- [ ] 7.1 在 `_worker/` 目錄執行 focused tests：converter、batch verification、store quality metrics 與 API/UI regression。Python tests 必須在 `_worker/` 各自目錄執行，避免 FastAPI `app` package import cache 污染。
- [ ] 7.2 執行 `openspec validate optimize-worker-canonical-batch-and-secondary-enumeration --strict`。
- [ ] 7.3 使用 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 執行 canonical full 13-file batch：`python scripts\verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`。
- [ ] 7.4 記錄每個 fixture 的 `conversion_job_id`、`artifact_group_id`、source artifact ID、`status`、`coverage_status`、`coverage_ratio`、phase timings、`unmapped_count`，以及 batch 層 `outcome_distribution`。
- [ ] 7.5 若 `outcome_distribution.passed.count == 13` AND 所有 fixture `coverage_status=pass` AND `minimum_coverage_baseline_locked=true` → 確認 batch summary `minimum_coverage_locked=true`；否則確認兩 key 為 `false` 並記錄阻塞原因。
- [ ] 7.6 對通過的 fixture 子集（建議第一個 89MB fixture）執行 single-file visual preview：透過既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` flow 載入 `model.usdc`；若 Kit / GPU / browser 不可用 → 記錄 blocked，不宣稱 visual preview 通過。

## 8. Evidence 與 Roadmap 對齊

- [ ] 8.1 建立 `docs/verification/2026-05-14-worker-canonical-batch-and-secondary-enumeration.md`，記錄：batch input identity（13 fixtures）、canonical command、per-fixture outcome、`outcome_distribution`、`minimum_coverage_locked` 狀態、secondary enumeration 量測或 deferral、visual preview 嘗試結果。
- [ ] 8.2 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`：
  - §5.2「Next worker risk burn-down」狀態從「待開 OpenSpec change」改為 active / archived，引用本 change 與 verification doc。
  - §10 #4 反映 batch 結果；若 `minimum_coverage_locked=true` 達成 → 同步 §1.3 production baseline 紀錄；否則記下個 gate。
- [ ] 8.3 由同名 Markdown 重新產生 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`（採 surgical edit，避免破壞 1500+ 行 layout 的 anchor 與 TOC）。
- [ ] 8.4 執行 `git diff --check` 與 GitNexus `detect_changes`，確認 affected scope 維持在 `_worker`、OpenSpec artifacts、verification/roadmap docs。
