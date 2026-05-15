# queue-batch dispatch & post-USDC artifact retention verification

日期：2026-05-15（apply 分批落地）

## Scope

本紀錄對應 OpenSpec change `queue-batch-dispatch-and-post-usdc-artifact-retention`，範圍限於：

- `_worker` canonical batch 由 monolithic `--limit 13` 改為 persisted resumable queue（`batch_queue.json` manifest-as-index）
- 單筆短命 dispatch（`--run-next`）、`--retry`、`--summary`、`--status`、`--enqueue`、`--cleanup-scratch`
- post-coverage retention strategy A（僅作用 `tenant_batch_verification` scratch tenant）
- manifest 路徑預設在 git worktree 外、可由 settings/env 設定
- `outcome_distribution` / `minimum_coverage_locked` 語意凍結自 archived predecessor

本 change 不處理 `_bim-control` metadata authority、`bim-review-coordinator` session lifecycle、`web-viewer-sample` UI、Kit runtime、WebRTC、GPU、converter 端 stream-compute（proposal Q6 為 out of scope）。

## Baseline Before This Change

前身 `optimize-worker-canonical-batch-and-secondary-enumeration` 已 archive
（`openspec/changes/archive/2026-05-15-optimize-worker-canonical-batch-and-secondary-enumeration/`，
evidence：`docs/verification/2026-05-14-worker-canonical-batch-and-secondary-enumeration.md`）：

- v3：13/13 `coverage_status=pass`、`unmapped_count=0`、`minimum_coverage_locked=true`
- 但 monolithic（單一 ~65min process，全有全無，無 resume）；一次 canonical session 累積 ≈58GB scratch（v1/v2/v3 合計），多在 git worktree 內
- v2 因 fixture 4 的 Windows `PermissionError [WinError 5]`（`<jobs_dir>/conv_*.phase.json.tmp` rename）整批 exit 非零、已過 3 筆被丟棄

## Implemented Behaviour Changes

`_worker/app/settings.py`

- 新增 `batch_queue_path`（env `WORKER_BATCH_QUEUE_PATH`；未設時預設 `~/.ai-bim-governance/batch_queue/batch_queue.json`，絕對且在 git worktree 外，root-fix Windows `.tmp`-rename lock 與 worktree 污染）。既有欄位行為不變、向後相容。

`_worker/app/batch_verification.py`

- 行為保留式抽取 `_compute_minimum_coverage_locked` / `_count_locked_passes`（lock-gate 算式與 inputs 與 predecessor 逐字一致；`run_storage_batch_verification` 改呼叫該函式）。
- 目的：`--summary` 重用「同一個未改的」gate 函式，避免重新實作造成語意漂移。

`_worker/app/batch_queue.py`（新增模組）

- `batch_queue.json` schema（manifest-as-index）：`{manifest_version, root, created_at, updated_at, fixtures:[{source_id, filename, relative_path, size_bytes, modified_at, status, conversion_job_id, artifact_group_id, retained_paths, retention_class, coverage_summary, history}]}`，`status ∈ pending|running|passed|passed_with_quality_warning|failed|timed_out`。
- `enqueue_batch_queue`：由 `list_dev_ifc_sources` 建/刷新 manifest；idempotent（既有 row 不被覆寫、保留 status/history，新 fixture 補 `pending`，消失的 source 仍保留 row）。原子寫（temp + `os.replace`）。
- `run_next_batch_queue`：挑第一個 `pending`/`running`（crash 殘留可重領）→ 標 `running` → 呼叫既有 `_run_single_fixture_with_timeout` → 寫回單一 terminal outcome；單筆短命、無 drain loop。
- `retry_batch_queue`：僅 `failed`/`timed_out` 可 reset 回 `pending`，history 記 `who/prev_outcome`；其他 status 拒絕。
- resume 正確性：已有 terminal outcome 的 row 不自動重跑（守 predecessor Decision 7）。
- `summarize_batch_queue`：以 manifest rows 重建 records，呼叫**未改的** `_compute_outcome_distribution` + `_compute_minimum_coverage_locked`。
- retention strategy A（`apply_post_coverage_retention`）：coverage 算完後，僅對 `tenant_batch_verification` scratch tenant 刪 `ifc_index.json`/`element_mapping.json`/`entity_index.json`，保留 `model.usdc`/`usd_index.json`/`metadata.json`；**prune 成功後才把 retained_paths 寫入 row**（防 manifest/磁碟 drift）。`_is_scratch_tenant_path` 安全邊界：非 scratch tenant 路徑一律不刪。
- `cleanup_batch_scratch`：idempotent 移除 scratch tenant 樹。
- `_retained_paths_drift`：`--status`/`--summary` 驗證 row.retained_paths 實際存在，缺檔以 diagnostic 揭露、不靜默 pass。

`_worker/scripts/verify_storage_batch.py`

- 新增 `--enqueue`/`--status`/`--run-next`/`--summary`/`--retry`/`--cleanup-scratch`，皆 additive 短路；既有 one-shot CLI（`--limit`/`--timeout-seconds`/`--profile-source-entities`/`--dry-run`）行為完全不變。

## Validation Performed

| 層 | 指令 | 結果 |
|---|---|---|
| OpenSpec strict | `openspec validate queue-batch-dispatch-and-post-usdc-artifact-retention --strict` | ✓ valid |
| focused（`_worker` 目錄內） | `python -m pytest tests/` | ✓ 138 passed, 1 skipped（既有 skip；含 +12 本 change 新測試，gate 抽取零回歸） |
| parity（task 4.3/6.4） | `test_batch_queue_summary_is_bit_identical_to_monolithic` | ✓ queue 跑完的 `outcome_distribution` + `minimum_coverage_locked` 與 monolithic 路徑在相同 fixture 下逐欄相等（含 `minimum_coverage_locked=true`） |
| retention 範圍（task 5.2） | `test_batch_queue_retention_never_touches_non_scratch_tenant` | ✓ 非 `tenant_batch_verification` 路徑回 `not_scratch_tenant`，0 檔被刪 |
| resume（task 3.4） | `test_batch_queue_resume_reclaims_running_but_not_terminal` | ✓ `running` 重領、terminal 不重跑 |
| retry（task 3.3） | `test_batch_queue_retry_only_resets_recorded_failures` | ✓ 僅 recorded failure 生效，`passed` 拒絕並記 history |
| 位置（task 6.6） | `test_batch_queue_default_manifest_path_is_outside_worktree` | ✓ 預設絕對路徑、不在 service/worktree 樹內；env override 生效 |
| drift（task 5.4） | `test_batch_queue_status_reports_retained_path_drift` | ✓ 缺檔以 diagnostic 揭露 |
| dry-run（task 7.3） | `verify_storage_batch.py --enqueue/--status`（tmp fixture set，env 指向 tmp） | ✓ manifest 建得出、idempotent、`--status` 正確反映 pending |
| diff 衛生 | `git diff --check` | ✓ clean |

## Blocked / Not Observed（誠實標記，不宣稱通過）

| 項目 | 狀態 | 原因 |
|---|---|---|
| 真實 13 檔 canonical `--run-next` 逐筆跑完（task 7.4） | **blocked** | 真實 canonical `.ifc`（≈89MB 級，共 13 檔）為 gitignored 大檔，不在 worktree；本 apply 環境無該 fixture root |
| retention 後實際 footprint ≈130MB-class vs v3 ≈58GB 量測（task 7.5） | **blocked / recorded_only** | 依賴 7.4 真實跑批；設計目標來自 predecessor evidence（單檔 ≈1.58GB derived → 僅保留 ≈9.4MB `model.usdc` + 小檔），real number 待可跑環境補量 |
| visual preview（task 7.6） | **not_observed** | 沿用 predecessor 範疇；本 change 不觸 Kit/GPU/browser，不在此宣稱 viewport 通過 |

> 真實 13 檔 evidence 與 footprint 量測須在具備 canonical IFC fixture root 的環境補跑 `python scripts/verify_storage_batch.py --enqueue` 後反覆 `--run-next`，再 `--summary` 斷言與 predecessor v3 一致（`passed=13`、`locked=true`），並記錄 `--cleanup-scratch` 前後磁碟用量。

## Repo Boundary

owner=`_worker`。改動侷限 `_worker/app/{settings,batch_verification,batch_queue}.py`、`_worker/scripts/verify_storage_batch.py`、`_worker/tests/test_worker_batch_verification.py` + OpenSpec artifacts + 本 doc/roadmap。未觸 `_bim-control` / `bim-review-coordinator` / `bim-streaming-server` / `web-viewer-sample`；GitNexus pre-change impact（`run_storage_batch_verification`、`_compute_outcome_distribution`、`verify_storage_batch.main`、`Settings`）全 LOW。

## Known Risks

- 真實 footprint / canonical pass 仍 blocked（見上）；merge 前 reviewer 應知此為 recorded_only，不可當 real-run pass。
- retention 為破壞性（刪 scratch array），已用 `_is_scratch_tenant_path` 邊界 + 測試把關僅作用 throwaway scratch tenant；真實 review-artifact 路徑不受影響。
