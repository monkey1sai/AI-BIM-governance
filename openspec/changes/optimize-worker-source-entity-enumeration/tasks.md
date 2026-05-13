## 1. 準備與影響檢查

- [ ] 1.1 重新閱讀已歸檔 `openspec/changes/archive/2026-05-12-worker-canonical-storage-batch-baseline/`、`docs/verification/2026-05-12-worker-canonical-storage-batch-baseline.md`、`openspec/specs/worker-artifact-pipeline/spec.md` 與 `openspec/specs/runtime-verification-evidence/spec.md`。
- [ ] 1.2 重新閱讀 `_worker/app/converters.py`、`_worker/app/batch_verification.py`、`_worker/app/store.py`、`_worker/scripts/verify_storage_batch.py` 與既有 `_worker/tests/*`。
- [ ] 1.3 對準備修改的 symbols 執行 GitNexus impact analysis，至少包含 `IfcOpenShellUsdConverter.convert`、`IfcOpenShellUsdConverter._source_entities`、`IfcOpenShellUsdConverter._iter_model_entities`、`run_storage_batch_verification`。
- [ ] 1.4 確認 canonical fixture root `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 仍有 13 個 required fixtures，並記錄第一個 89MB fixture identity。

## 2. Baseline Profiling

- [ ] 2.1 使用現有 code 重新跑或引用最近一次 canonical `--limit 1 --timeout-seconds 600` evidence，確認最後已知 phase 為 `source_entity_enumeration`。
- [ ] 2.2 在不改變 coverage denominator 的前提下，量測 `_source_entities(model)` 內的 entity iteration、class/id/guid/name extraction 與 fallback path 耗時。
- [ ] 2.3 產出 baseline diagnostics：entity count progress、elapsed seconds、current phase/status、是否有特定 IFC API call 卡住。
- [ ] 2.4 若 profiling 顯示 bottleneck 不在 `_worker` owned code path，記錄 deterministic external blocker 並停止 speculative refactor。

## 3. Source Entity Enumeration Optimization

- [ ] 3.1 實作 minimal source entity identity scan，保留 `ifc_entity_key`、`ifc_entity_id`、`ifc_class`、`ifc_guid` 與可安全取得的 `name`。
- [ ] 3.2 避免 eager deep relationship expansion、inverse traversal、重複 full-model traversal 或不必要 metadata extraction。
- [ ] 3.3 讓 conversion phase progress 在 long-running enumeration 中能回報 entity count、elapsed seconds 與 last known operation。
- [ ] 3.4 保持 all-IFC-entity coverage denominator，不得改成 geometry-only、`IfcProduct`-only、GUID-only 或 renderable-only。
- [ ] 3.5 保持 conversion result、quality metrics、lineage、artifact group readiness、review viewer handoff payload backward-compatible。

## 4. Tests

- [ ] 4.1 加入或更新 converter unit tests，覆蓋 optimized source entity identity scan 不會漏掉 non-renderable / non-product IFC entities。
- [ ] 4.2 加入 tests 證明 optimization 不會把 synthetic/fallback IDs 當成 real IFC GUID，也不會錯增 `mapped_count` 或 `coverage_ratio`。
- [ ] 4.3 加入 tests 覆蓋 enumeration diagnostics 為 additive fields，既有 consumer payload keys 不變。
- [ ] 4.4 加入 timeout/progress tests，證明 source enumeration 卡住時 evidence 能指出 last known operation 或 entity count progress。

## 5. Canonical Verification

- [ ] 5.1 執行 focused `_worker` tests：converter、batch verification、store quality metrics 與 API/UI regression。
- [ ] 5.2 執行 `openspec validate optimize-worker-source-entity-enumeration --strict`。
- [ ] 5.3 使用 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 重跑 canonical `python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600`。
- [ ] 5.4 若 single-fixture conversion succeeds，記錄 `conversion_job_id`、`artifact_group_id`、derived USDC artifact ID/URL、mapping artifact ID/URL、readiness state 與 `source_entity_enumeration` timing。
- [ ] 5.5 若 single-fixture conversion 仍 timeout / failed，記錄 exact phase、diagnostics、elapsed duration、owned/external blocker 判定，並維持 `minimum_coverage_locked=false`。

## 6. Evidence 與 Roadmap 對齊

- [ ] 6.1 更新或建立 verification evidence，記錄 source entity enumeration before/after timing、canonical command、fixture identity 與結果。
- [ ] 6.2 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`，把 archived canonical batch change 與新的 `optimize-worker-source-entity-enumeration` active change 對齊。
- [ ] 6.3 由同名 Markdown 重新產生 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`。
- [ ] 6.4 執行 `git diff --check` 與 GitNexus detect changes，確認 affected scope 維持在 `_worker`、OpenSpec artifacts、verification/roadmap docs。
