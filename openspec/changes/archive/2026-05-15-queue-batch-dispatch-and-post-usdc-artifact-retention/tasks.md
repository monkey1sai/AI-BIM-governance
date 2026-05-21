## 1. 準備與影響檢查

- [x] 1.1 重新閱讀 archived predecessor `openspec/changes/archive/2026-05-15-optimize-worker-canonical-batch-and-secondary-enumeration/`（特別是 design「Successor handoff」）、`docs/verification/2026-05-14-worker-canonical-batch-and-secondary-enumeration.md`、`openspec/specs/worker-artifact-pipeline/spec.md`、`openspec/specs/runtime-verification-evidence/spec.md`。
- [x] 1.2 重新閱讀 `_worker/app/batch_verification.py`（`run_storage_batch_verification`、`_run_single_fixture_with_timeout`、`_compute_outcome_distribution`、lock gate）、`_worker/app/dev_sources.py`（`_source_id`）、`_worker/app/settings.py`、`_worker/app/store.py`（derived artifact layout / `tenant_batch_verification`）、`_worker/scripts/verify_storage_batch.py`、既有 `_worker/tests/test_worker_batch_verification.py`。
- [x] 1.3 對準備修改的 symbols 跑 GitNexus impact（至少 `run_storage_batch_verification`、`_compute_outcome_distribution`、`verify_storage_batch.main`、retention helper 落點）。HIGH/CRITICAL 先回報。
- [x] 1.4 確認 canonical fixture root 仍為 13 檔；記錄 `source_id` / SHA-256 作為 manifest key 對照。

## 2. Queue manifest 模型（manifest-as-index）

- [x] 2.1 定義 `batch_queue.json` schema：`{manifest_version, root, created_at, fixtures: [{source_id, filename, relative_path, size_bytes, sha256?, status, conversion_job_id?, artifact_group_id?, retained_paths{}, retention_class, coverage_summary{}, history[]}]}`。status ∈ `pending|running|passed|passed_with_quality_warning|failed|timed_out`。
- [x] 2.2 `--enqueue`：由 `list_dev_ifc_sources` 建/刷新 manifest；既有已 outcome 的 row 不被覆寫（idempotent），新 fixture 補成 `pending`。
- [x] 2.3 manifest 讀寫採原子寫（temp + replace），路徑預設在 worktree 外（見 §5）。

## 3. 單筆 dispatch（沿用既有機制）

- [x] 3.1 `--run-next`：挑第一個 `pending`（或 `running` 視為 crash 殘留可重領）→ 標 `running` → 呼叫既有 `_run_single_fixture_with_timeout` → 寫回單一 terminal outcome + `conversion_job_id` + coverage summary 欄位到該 row。
- [x] 3.2 一個 `--run-next` 只處理一筆、為短命行程；不得在單行程內 loop 跑完整個 queue（no `--drain`）。
- [x] 3.3 `--retry <source_id>`：僅當該 row 為 `failed`/`timed_out` 時，明確將其 reset 回 `pending` 並在 `history[]` 記一筆 retry（who/when/prev_outcome）。其他 status 不允許 retry。
- [x] 3.4 resume 正確性：crash 後重跑 `--run-next` 只重領沒有 terminal outcome 的 row；已 `passed`/`failed`/`timed_out` 的 row 不自動重跑（守 predecessor Decision 7）。

## 4. Summary / status（語意凍結自 predecessor）

- [x] 4.1 `--summary`：以 manifest rows 為輸入，呼叫**既有未改的** `_compute_outcome_distribution` 與 lock gate 函式算 `outcome_distribution` + `minimum_coverage_locked`；bucket 定義與 gate 與 predecessor 完全一致。
- [x] 4.2 `--status`：human-readable 進度（total / 各 bucket count / 還剩幾個 pending / 是否可 lock）；不影響 JSON。
- [x] 4.3 parity test：同一組 fixture，queue 跑完的 `outcome_distribution` + `minimum_coverage_locked` == 既有 monolithic 路徑結果（pin 相等）。

## 5. Retention strategy A + 位置

- [x] 5.1 coverage 算完並寫入 manifest row 後，對 **`tenant_batch_verification` scratch tenant** 刪除該 fixture 的 `ifc_index.json`/`element_mapping.json`/`entity_index.json`；保留 `model.usdc`/`usd_index.json`/`metadata.json` + coverage summary + `unmapped_*` 小清單；retained 路徑寫入 row。
- [x] 5.2 retention 僅作用於 scratch tenant；非 `tenant_batch_verification` 路徑一律不動（測試斷言）。
- [x] 5.3 manifest 路徑 + canonical scratch root 預設在 git worktree 外，經 settings/env 可設定；提供 idempotent scratch cleanup 指令/路徑。
- [x] 5.4 drift 偵測：`--status`/`--summary` 驗證 row.retained_paths 實際存在，缺檔以 diagnostic 揭露，不靜默 pass。

## 6. Tests

- [x] 6.1 `test_worker_batch_verification.py`：`--enqueue` 建 manifest、idempotent 不覆寫已 outcome row。
- [x] 6.2 `--run-next` 單筆推進 + crash（`running` 殘留）後 resume 只重領該筆；`passed`/`failed` 不自動重跑。
- [x] 6.3 `--retry` 僅對 recorded failure 生效並記 history；對 `passed` 拒絕。
- [x] 6.4 parity：queue 跑完 == monolithic `outcome_distribution`/`minimum_coverage_locked`（同 input）。
- [x] 6.5 retention：scratch tenant 巨型 array 被刪、必留檔保留、retained_paths 正確；非 scratch tenant 不受影響。
- [x] 6.6 location：manifest/scratch root 可由 settings/env 指到 worktree 外；預設不落在 git worktree。

## 7. Canonical Verification

- [x] 7.1 `_worker/` focused tests 全綠（在 `_worker/` 目錄執行）。
- [x] 7.2 `openspec validate queue-batch-dispatch-and-post-usdc-artifact-retention --strict`。
- [x] 7.3 dry-run：`--enqueue` + `--status` 於 tmp fixture set，確認 manifest 形狀與 idempotency。
- [ ] 7.4 real evidence：對 13 檔 canonical 反覆 `--run-next` 跑完（短命行程逐筆），`--summary` 取得 `outcome_distribution`/`minimum_coverage_locked`；斷言與 predecessor v3 一致（passed=13、locked=true）。 — **superseded** (Retro-audited 2026-05-21): `_worker` 已從 product runtime 刪除（CLAUDE.md §2、`local-coordinator-ifc-ready-intake-boundary` archive、`introduce-host-native-conversion-authority-service` archive）；canonical batch v3 evidence 不再是現行 demo gating。原 **blocked**（gitignored fixture）為次要原因。
- [ ] 7.5 量測 retention 後 footprint（目標 ≈130 MB-class）與 v3 ≈58 GB 對比，記入 verification doc。 — **superseded** (Retro-audited 2026-05-21): 依賴 7.4 之 `_worker` 路徑；B 方案 host-native conversion authority 已取代，retention footprint 規則待新 capability 重新定義。原 **blocked/recorded_only** 為次要原因。
- [x] 7.6 visual preview 沿用 predecessor 範疇（`not_observed` 除非 Kit/GPU/browser 可用），不在本 change 宣稱通過。

## 8. Evidence 與 Roadmap 對齊

- [x] 8.1 建立 `docs/verification/2026-05-1X-queue-batch-and-artifact-retention.md`：manifest schema、resume 行為、retention footprint 前後、parity 結果、scratch cleanup。
- [x] 8.2 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §5.2：predecessor 標 archived、本 change 接為 active risk burn-down。
- [x] 8.3 同名 `.html` surgical sync。
- [x] 8.4 `git diff --check` + GitNexus `detect_changes`，scope 維持在 `_worker` + OpenSpec artifacts + docs。 — `git diff --check` clean（每批驗證）；GitNexus `detect_changes` 受 git worktree 獨立 index 限制無法解析（已誠實記錄於 verification doc），scope 改由 pre-change impact 全 LOW + 變更檔全 `_worker`/OpenSpec/docs + 140 passed 零回歸確證。

## 最小可逆驗證（smallest reversible diff that proves it works）

- [x] M.1 只加 `--enqueue` + `--status`（純讀 + 建一個 standalone `batch_queue.json`，不刪任何 artifact、不改既有 CLI、不改 `outcome_distribution` 程式），對 tmp fixture set 證明：manifest 建得出、idempotent、`--status` 正確反映 pending。此步不碰 retention、不碰既有 monolithic 路徑，完全可逆（刪 manifest 檔即還原）。
