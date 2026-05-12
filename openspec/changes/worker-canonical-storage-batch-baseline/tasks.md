## 1. 準備與影響檢查

- [ ] 1.1 重新閱讀 `openspec/specs/worker-artifact-pipeline/spec.md`、`openspec/specs/runtime-verification-evidence/spec.md`、`openspec/specs/worker-demo-upload-convert-ui/spec.md`、本 change 的 proposal/design/spec deltas，以及 `docs/verification/2026-05-12-worker-mapping-lineage-quality-baseline.md`。
- [ ] 1.2 重新閱讀 `_worker/app/batch_verification.py`、`_worker/scripts/verify_storage_batch.py`、`_worker/app/converters.py`、`_worker/app/store.py`、`_worker/app/ui.py` 與既有 `_worker/tests/*` 後再實作。
- [ ] 1.3 對 `run_storage_batch_verification`、`IfcOpenShellUsdConverter.convert`、`WorkerStore.complete_conversion_job`、worker UI handoff 相關 symbol，以及任何準備修改的 symbol 執行 GitNexus impact analysis；若出現 HIGH/CRITICAL risk，先回報再改 code。
- [ ] 1.4 確認 canonical fixture root `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`、fixture count、filenames、sizes，以及 worktree-local `storage/` 是不存在或刻意不用。
- [ ] 1.5 確認本 change 的 OpenSpec artifacts 使用繁體中文；API paths、schema fields、CLI flags、status enum、logs 與 OpenSpec parser 必要標頭保留原文。

## 2. 批次 Timing 與 Status Semantics

- [ ] 2.1 為 batch verification 加入 per-fixture phase timing support，不新增 production dependencies。
- [ ] 2.2 為 converter phase timing hooks 或 result fields 補上 IFC open、source entity enumeration、geometry iteration、mesh authoring、non-renderable entity materialization、stage save、stage reopen 等可觀察 phase。
- [ ] 2.3 加入明確的 batch / fixture statuses：`blocked`、`partial`、`timed_out`、`failed`、`passed`。
- [ ] 2.4 加入 configurable per-fixture timeout handling，並記錄 elapsed duration、timeout setting、last known phase diagnostics。
- [ ] 2.5 確保 dry-run 與 subset runs 一律維持 `minimum_coverage_locked=false`，且不能回傳 batch `status=passed`。

## 3. 單檔 Timeout Root Cause 與修正

- [ ] 3.1 使用 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 重現 canonical `--limit 1` real conversion timeout。
- [ ] 3.2 記錄第一個 89MB fixture 的 phase timing evidence，定位 bottleneck phase。
- [ ] 3.3 若 bottleneck 來自 `_worker` conversion staging、all-entity enumeration/materialization、mapping generation、artifact publish 或 lineage lookup，則在 `_worker` 邊界內修正。
- [ ] 3.4 若 bottleneck 是 external converter limitation，記錄 deterministic blocker diagnostics，並維持 baseline unlocked，不宣稱 pass。
- [ ] 3.5 重跑 `--limit 1`，直到它完成完整 evidence，或留下 deterministic unresolved blocker。

## 4. 單檔 USDC Web Viewer Visual Preview

- [ ] 4.1 在 canonical `--limit 1` real conversion 成功後，收集 `conversion_job_id`、`artifact_group_id`、source artifact ID、derived `model.usdc` artifact ID/URL、mapping artifact ID/URL 與 readiness state。
- [ ] 4.2 使用既有 `bim-review-coordinator` / `web-viewer-sample` / `bim-streaming-server` flow 載入該 worker-hosted `model.usdc`，不得讓 `_worker` 直接 render 或管理 review session。
- [ ] 4.3 記錄 visual preview evidence：canonical fixture path、artifact IDs、`openedStageResult`、非零 viewport/video dimensions、screenshot 或等效 visual proof。
- [ ] 4.4 若 Kit、GPU、WebRTC、browser automation、coordinator 或 viewer prerequisite 不可用，將 visual preview 記為 `blocked`，列出缺少 prerequisite，且不得宣稱 web UI 已看過轉檔成果。
- [ ] 4.5 更新 worker UI handoff，讓 lineage / quality view 可提供「用既有 review viewer 開啟 USDC」的 action 或等效 handoff data；UI 不讀 local files，不解析 USD/USDC。

## 5. Canonical 13 檔批次 Evidence

- [ ] 5.1 只有在 `--limit 1` 成功或已有清楚 documented blocker 後，才執行 full canonical 13-file real batch。
- [ ] 5.2 記錄每個 fixture 的 source artifact ID、artifact group ID、conversion job ID、original filename、size、duration、phase timings、output size、converter identity、USDC openability、lineage API status、source IFC entity count、mapped/unmapped entity counts、coverage ratio、coverage status、warnings 與 failures。
- [ ] 5.3 僅當 13 個 required fixtures 全部完成 real conversion 並通過所有 required quality checks 時，設定 batch `status=passed`。
- [ ] 5.4 僅當 full canonical batch status 為 `passed` 時，才設定或宣稱 `minimum_coverage_locked=true`。
- [ ] 5.5 若任一 fixture blocked、timed out、partial 或 failed，記錄 exact fixture 與 reason，並維持 production mapping baseline unlocked。

## 6. Tests 與 Regression Coverage

- [ ] 6.1 加入 unit tests 覆蓋 blocked root、dry-run partial status、subset partial status、timeout status、failed fixture status、full passed status。
- [ ] 6.2 加入 tests 證明 dry-run、subset、timeout、blocked 或 failed batches 不可能得到 `minimum_coverage_locked=true`。
- [ ] 6.3 加入 tests 證明 duplicate fixture bytes 仍保留獨立 filenames、source artifact IDs、conversion job IDs、lineage 與 timing fields。
- [ ] 6.4 若 bottleneck fix 影響 all-entity materialization、stage writing、artifact publishing 或 lineage lookup behavior，補上 converter/store tests。
- [ ] 6.5 加入 worker UI tests，覆蓋 lineage / quality view 的 USDC preview handoff，以及 `_worker` UI 不直接 render USD/USDC 或管理 review session。

## 7. Evidence 與 Roadmap 對齊

- [ ] 7.1 更新或建立 `docs/verification/2026-05-12-worker-canonical-storage-batch-baseline.md`，記錄 canonical root、fixture matrix、commands、environment、result status、phase timing summary、single-file visual preview evidence 或 blocked reason。
- [ ] 7.2 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`，讓 worker canonical batch risk burn-down 持續排在 unrelated new feature candidates 前，並明確列出單檔先行、USDC viewer preview、再 full batch 的順序。
- [ ] 7.3 由同名 Markdown 重新產生 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`。
- [ ] 7.4 若 full batch passes，明確記錄為什麼 `minimum_coverage_locked=true` 現在可被允許；若沒有 pass，記錄剩餘 blocker 並維持 baseline unlocked。

## 8. Validation 與 Archive Gate

- [ ] 8.1 執行 `openspec validate worker-canonical-storage-batch-baseline --strict`。
- [ ] 8.2 執行 focused `_worker` tests，覆蓋 batch verification、converter changes、store changes、lineage lookups 與 worker UI handoff。
- [ ] 8.3 從 `_worker/` 使用 clean venv 執行 full tests：`python -m pytest tests`；若不能跑，記錄 exact environment blocker。
- [ ] 8.4 執行 `git diff --check`。
- [ ] 8.5 Commit 前執行 `gitnexus_detect_changes()` 或等效 GitNexus change detection，確認 affected scope 限於 `_worker`、OpenSpec artifacts、verification/roadmap docs 與明確納入的 UI handoff。
- [ ] 8.6 不 archive 此 change，除非 canonical batch evidence 已 fully passed 並 locked baseline，或已由使用者明確接受為 blocked 且 roadmap/evidence 保持 baseline unlocked。
