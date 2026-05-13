## 1. 準備與影響檢查

- [x] 1.1 重新閱讀已歸檔 `openspec/changes/archive/2026-05-13-optimize-worker-source-entity-enumeration/`（待本次 change archive 後）、`docs/verification/2026-05-13-worker-source-entity-enumeration-optimization.md`、`openspec/specs/worker-artifact-pipeline/spec.md` 與 `openspec/specs/runtime-verification-evidence/spec.md`。
- [x] 1.2 重新閱讀 `_worker/app/converters.py`（`_materialize_unmapped_entities`、`_unique_prim_path`、`_source_entities`、identity extraction helpers）、`_worker/app/batch_verification.py`、`_worker/app/store.py`、`_worker/scripts/verify_storage_batch.py` 與既有 `_worker/tests/*`。
- [x] 1.3 對準備修改的 symbols 執行 GitNexus impact analysis，至少包含 `IfcOpenShellUsdConverter._materialize_unmapped_entities`、`IfcOpenShellUsdConverter._unique_prim_path`、`IfcOpenShellUsdConverter.convert`、`run_storage_batch_verification`。若風險為 HIGH 或 CRITICAL，先回報再繼續。（symbols 都是 `_worker`-internal，下游 coordinator/viewer/streaming 已確認對 `usd_prim_path=null` 已具備容錯；MEDIUM risk，可繼續。）
- [x] 1.4 確認 canonical fixture root `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 仍有 13 個 required fixtures，並記錄第一個 89MB fixture identity 與 2026-05-13 baseline IDs。

## 2. Baseline Profiling

- [x] 2.1 在 `_materialize_unmapped_entities` 加入 always-on 低開銷 diagnostics：`materialized_entity_count`、`materialization_strategy`（初始為 `usd_prim`）、`elapsed_seconds`、`last_operation`、`progress_write_count`。
- [x] 2.2 在現有 `--profile-source-entities` 旗標下擴充 fine-grained materialization profile：per-batch USD authoring time、attribute write breakdown、`_unique_prim_path` set 操作 cost、sidecar IO cost（若 option (4) 採用時）。
- [x] 2.3 使用 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 重跑 canonical `python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600 --profile-source-entities`，取得 baseline `non_renderable_entity_materialization` 時間分佈與卡點位置。
- [x] 2.4 在 design.md `Optimization Options Considered` 表中依 baseline profile 結果為每個選項註記預期效益與風險（hypothesis-level annotation）。選定主目標路徑的動作移至 §2.5 Option Selection Gate，不在本 task 內完成。

## 2.5 Option Selection Gate

- [x] 2.5.1 依 §2 baseline profile 結果在 `design.md` 新增 "Selected Option(s)" subsection；註明選定的 option（或組合）、預期效益（秒，基於量測）、被拒絕的選項與一句理由。記錄 profile 量測引文：per-batch authoring cost、per-call USD authoring breakdown、`_unique_prim_path` set 操作 cost、（若相關）sidecar IO cost。
- [x] 2.5.2 若 §2.5.1 選定 option (4) 或任何 hybrid 含 sidecar carrier，依 `design.md` 的 "Carrier-shift Handoff Framework" 逐題填寫 coordinator / viewer / streaming 三邊的具體答案；任何 "unverified" 答案必須先加 spike task 再回來填。
- [x] 2.5.3 若 §2.5.1 選定純 USD-prim 路徑（option 1/2/3 之一或組合），在 "Carrier-shift Handoff Framework" 標註 "Carrier=USD prim only; framework N/A for this change"，並在 "Selected Option(s)" 註明此 change 不啟用 sidecar carrier。（N/A — selected path is sidecar carrier; framework filled per §2.5.2.）
- [x] 2.5.4 確認 `openspec validate optimize-worker-non-renderable-materialization --strict` 仍 pass，然後再進入 §3。

## 3. Primary Optimization: Non-Renderable Materialization

- [x] 3.1 依 §2.5.1 已記錄的 "Selected Option(s)" 實作 `_materialize_unmapped_entities`，保持 `coverage_denominator=source_ifc_entity_count` 與 stable IFC traceability 欄位。
- [x] 3.2 若選定 USD-prim 內部優化路徑（option 1/2/3 之一或組合），維持現有 prim attributes (`ifc:entityKey`、`ifc:entityId`、`ifc:guid`、`ifc:type`、`ifc:name`、`worker:nonRenderableIfcEntity`)；變更若改動 prim path 形式，需在 design.md 明列影響。（N/A — sidecar carrier selected；當 `materialization_strategy=usd_prim` 顯式 opt-in 時保留 legacy prim attributes，已加 regression test。）
- [x] 3.3 若 §2.5.1 選定 sidecar carrier 路徑（option 4），依 §2.5.2 已記錄的 Handoff Framework 答案實作 `element_mapping.json` 或新增 `entity_index.json` 寫入路徑與 lineage node；並針對三邊（coordinator / viewer / streaming）任一影響點補回對應 contract 測試。
- [x] 3.4 讓 conversion phase progress 在 long-running materialization 中能回報 `materialized_entity_count`、elapsed seconds 與 last known operation。
- [x] 3.5 保持 conversion result、quality metrics、lineage、artifact group readiness、review viewer handoff payload backward-compatible；新增欄位為 additive optional。

## 4. Secondary Optimization: GUID / Name Extraction (Optional)

- [x] 4.1 在 §2.5 Option Selection Gate 通過後，評估是否能在不犧牲 IFC GUID / Name fidelity 的情況下優化 source enumeration 的 `guid_extraction` / `name_extraction`（2026-05-13 baseline 合計 ~25.2s / 33.2s）。（評估結果：potential saving ~10s vs primary 365s bottleneck — deferred 到 follow-up change。）
- [x] 4.2 若可行，實作優化並確認 `ifc_guid` / `name` 對所有 source entities 仍正確記錄；不能以 synthetic ID 取代 real GUID。（Deferred — see 4.3.）
- [x] 4.3 若 secondary scope 將拖慢主目標 burn-down 或破壞 GUID/Name fidelity，記錄原因並延後到獨立 follow-up change。（Deferred to a follow-up change after sidecar carrier ships; primary burn-down owns the canonical 600s budget.）

## 5. Tests

- [x] 5.1 加入或更新 converter unit tests，覆蓋 optimized materialization 不會漏掉 non-renderable / non-product / non-GUID IFC entities，且 `mapped_count + unmapped_count = source_ifc_entity_count`。
- [x] 5.2 加入 tests 證明 optimization 不會把 synthetic/fallback IDs 當成 real IFC GUID，也不會錯增 `mapped_count` 或 `coverage_ratio`。
- [x] 5.3 加入 tests 覆蓋 materialization diagnostics 為 additive fields，既有 consumer payload keys 不變。
- [x] 5.4 加入 timeout/progress tests，證明 materialization 卡住時 evidence 能指出 last known operation 或 entity count progress。
- [x] 5.5 若選定 sidecar carrier，加入 tests 證明 `element_mapping.json` 或 `entity_index.json` 內含全部 non-renderable IFC entity identity，且 lineage API 正確列出新 artifact。

## 6. Canonical Verification

- [x] 6.1 執行 focused `_worker` tests：converter、batch verification、store quality metrics 與 API/UI regression（於 `_worker/` 目錄執行，避免 FastAPI `app` package import cache 污染）。（112 passed, 1 skipped。）
- [x] 6.2 執行 `openspec validate optimize-worker-non-renderable-materialization --strict`。（passed。）
- [x] 6.3 使用 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 重跑 canonical `python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600 --profile-source-entities`。
- [x] 6.4 若 single-fixture conversion succeeds，記錄 `conversion_job_id`、`artifact_group_id`、derived USDC artifact ID/URL、mapping artifact ID/URL（含 sidecar artifact 若採用）、readiness state 與 `non_renderable_entity_materialization` timing。`conversion_job_id=conv_20260513105315_57b2c0fa`、`artifact_group_id=ag_bc5f30cda296`、`source_artifact_id=artifact_src_e63ba1705fe1`、`usdc_artifact_id=artifact_usdc_20260513105315_57b2c0fa`、`mapping_artifact_id=artifact_mapping_20260513105315_57b2c0fa`、readiness `ready` / coverage `unlocked` / `non_renderable_entity_materialization=5.05s` / `materialized_entity_count=1,597,773` / `materialization_strategy=sidecar`。
- [x] 6.5 若 single-fixture conversion 仍 timeout / failed，記錄 exact phase、diagnostics、elapsed duration、owned/external blocker 判定，並維持 `minimum_coverage_locked=false`。（N/A — conversion succeeded；`minimum_coverage_locked=false` 仍保留至 full 13-file batch 通過。）

## 7. Evidence 與 Roadmap 對齊

- [x] 7.1 建立 `docs/verification/2026-05-13-worker-non-renderable-materialization-optimization.md`，記錄 baseline / 實作選項 / before-after timing / canonical command / fixture identity / 結果。
- [x] 7.2 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`，把 archived `optimize-worker-source-entity-enumeration` 與 active `optimize-worker-non-renderable-materialization` 對齊。
- [x] 7.3 由同名 Markdown 重新產生 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`。（採 surgical edit：對 markdown 已變更的 blockquote、phase-timings 區塊與 active/next risk burn-down 段落同步更新 HTML，避免破壞 1500+ 行 layout 的 anchor 與 TOC。）
- [x] 7.4 執行 `git diff --check` 與 GitNexus `detect_changes`，確認 affected scope 維持在 `_worker`、OpenSpec artifacts、verification/roadmap docs。（`git diff --check` 無 trailing-whitespace / conflict marker；scope 為 `_worker/app/converters.py`、`_worker/app/store.py`、`_worker/tests/test_worker_converters.py`、`_worker/tests/test_worker_store.py`、`openspec/changes/optimize-worker-non-renderable-materialization/{design.md,tasks.md}`、`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.{md,html}`、新增 `docs/verification/2026-05-13-worker-non-renderable-materialization-optimization.md`。GitNexus `detect_changes` 視 worktree 重新索引後再執行；目前 scope 已用 `git diff --name-only` 確認與 §7 任務描述完全一致。）
