## 背景

`worker-mapping-lineage-quality-baseline` 已把 lineage 與 all-IFC-entity coverage semantics 併入現行 specs，但它的 real storage batch evidence 仍未完成。已知事實如下：

- canonical fixture glob：`C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`
- dry-run 找到 13 個 IFC fixtures，每個 observed size 為 `89394282` bytes
- 第一次 real `--limit 1` run 失敗於過長 OpenUSD output path，後續已用 short staging mitigation
- 第二次 real `--limit 1` run 在 600s 後 timeout，沒有 completed result
- `minimum_coverage_locked=true` 必須維持 false，直到 full canonical batch evidence passed

主要 owner 仍是 `_worker`：它擁有 source bytes、conversion jobs、artifact groups、lineage API 與 conversion quality evidence。`runtime-verification-evidence` 擁有 evidence acceptance semantics。`web-viewer-sample` 與 `bim-streaming-server` 只負責用既有 review viewer / Kit runtime 驗證「worker 產出的 `model.usdc` 能被看見」，不接管批次轉檔 ownership。`_bim-control` 與 `bim-review-coordinator` 只維持既有 metadata / session control plane 邊界。

## 目標 / 非目標

**目標：**

- 把 canonical storage batch gap 轉成 active、可稽核的 OpenSpec follow-up。
- 加入足夠的 phase timing，辨識 timeout 是來自 IFC open、source entity enumeration、geometry iteration、mesh writing、non-renderable entity materialization、stage save/reopen、artifact publish 或 lineage lookup。
- 讓 batch helper 對 `blocked`、`partial`、`timed_out`、`failed`、`passed` 提供 deterministic status classes。
- 要求 successful canonical `--limit 1` real conversion 先完成，再嘗試或宣稱 full 13-file baseline。
- 單檔成功後，透過既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` flow 載入 worker-hosted `model.usdc`，留下 visual preview evidence；若 runtime prerequisite 不可用，留下 `blocked`。
- 要求 13 個 canonical fixtures 全部完成 real conversion 並通過 quality criteria 後，才能 lock production mapping baseline。

**非目標：**

- 不重新定義 lineage API、coverage denominator 或 `minimum_coverage_ratio=1.0`；它們已是現行 specs。
- 不建立 production distributed batch-job service、queue 或 worker fleet。
- 不把 file ownership 移到 `_bim-control`，也不把 review session ownership 移到 `_worker`。
- 不讓 `_worker` UI 直接 parse / render USD 或 USDC；worker UI 只提供 lineage、quality observability 與 review viewer handoff。
- 不要求 13 個 canonical fixtures 全部都逐一產生 browser screenshot；full batch lock 依 `_worker` conversion / quality evidence 判斷，visual preview 先以通過的 canonical single fixture 作為人工檢視與 flow proof。
- 不在 full canonical batch evidence 實際 passed 前，把 roadmap 標成 production-ready。

## 決策

### 1. 這是 follow-up change，不改寫 archive

已歸檔 change 保留作為歷史接受需求的 evidence。此 change 修改現行 specs，定義更嚴格的 follow-up acceptance 與 implementation tasks。這能維持 OpenSpec history append-only，並讓剩餘風險可見，而不是悄悄重寫 archive 內容。

曾考慮把 archived change 移回 active；但 PR #29/#30 已 merge，現行 specs 也已含 accepted requirements，因此不採用。

### 2. 先 profile 一個 canonical fixture，再跑 full batch

第一個 implementation slice 必須重現 `--limit 1` 並記錄 phase timings。在不知道 bottleneck 前直接跑 13 files，只會放大同一個 failure 並產生 noisy evidence。

Timing payload 應為 per fixture，並使用穩定 phase names：

- `source_read`
- `artifact_intake`
- `conversion_total`
- `ifc_open`
- `source_entity_enumeration`
- `geometry_iteration`
- `mesh_authoring`
- `non_renderable_entity_materialization`
- `stage_save`
- `stage_reopen`
- `artifact_publish`
- `lineage_lookup`

不是每個 converter internal phase 都必須在每次 result 中存在；但若 timeout 或 failure 發生在某 phase 開始前，missing phase timing 必須以 diagnostic 呈現，不可靜默省略。

### 3. 單檔成功後先做 USDC visual preview handoff

canonical `--limit 1` 完成後，evidence 必須使用該 worker-produced artifact 的 `conversion_job_id`、`artifact_group_id`、`model.usdc` URL 與 mapping URL，透過既有 review viewer flow 載入並檢視結果。

這個 flow 的目的不是讓 `_worker` 變成 viewer，而是證明：

- worker result 的 artifact IDs / URLs 足以 handoff 到 review flow
- `bim-review-coordinator` 可把 artifact binding 傳給 viewer / Kit
- `bim-streaming-server` 可載入 worker-hosted `model.usdc`
- `web-viewer-sample` 可顯示非空 viewport 並留下 screenshot 或等效 visual proof

若 Kit、GPU、browser automation 或 streaming prerequisite 在當前環境不可用，evidence 必須標示 single-file visual preview 為 `blocked`，並列出缺少的 prerequisite；不得把 conversion success 說成 visual preview passed。

### 4. 批次 status 必須比 helper availability 更嚴格

Helper 存在、dry-run 可找到 13 fixtures，仍不等於 evidence passed。Summary status 必須是：

- `blocked`：root missing/unreadable/empty 或 converter prerequisites unavailable
- `partial`：dry-run、intentional subset，或 limit 小於 fixture count
- `timed_out`：任何 fixture 超過 configured timeout
- `failed`：任何 fixture conversion failed、USDC openability failed、truthful mapping failed、lineage lookup failed 或 locked coverage failed
- `passed`：每個 required fixture 都完成，且所有 quality gates passed

只有 `passed` 可設定 `minimum_coverage_locked=true`。

### 5. Timeout diagnostics 保留在 `_worker`

Timeout classification 應由 `_worker` batch verification 記錄，而不是只存在 shell wrapper 行為。CLI 可以 expose timeout option，但 evidence JSON 必須包含 per-fixture timeout details，讓 docs 不需要依賴 terminal history 也可稽核。

### 6. Roadmap 必須區分 active risk burn-down 與新功能候選

Roadmap 應把 `worker-canonical-storage-batch-baseline` 列為下一個 worker risk burn-down，優先於 unrelated new feature candidates。這不代表 lifecycle events 的 P1 重要性下降；只是明確表示 production mapping readiness 仍有未解 evidence gate。

## 風險 / 取捨

- [Long runtimes] 89MB fixture conversion 可能真的超過互動式本機時間限制。→ 先加入 phase timings 與 configurable per-fixture timeout，再擴到 13 files。
- [Large output size] all-IFC-entity materialization 可能產生大量 non-renderable prims。→ 先量測 entity counts、prim counts、output bytes 與 phase timings，再決定是否最佳化。
- [Viewer prerequisite] local Kit/GPU/browser flow 可能不在所有環境可用。→ conversion / batch evidence 與 visual preview evidence 分層記錄；不能用 unavailable runtime 阻止 `_worker` 記錄確定的 conversion diagnostics，也不能把 blocked visual preview 說成 passed。
- [Overfitting to one fixture] 只修第一個 file 不代表 13 files 都過。→ Full baseline 仍維持 unlocked，直到所有 required fixtures passed。
- [Local machine dependency drift] IfcOpenShell/OpenUSD 或 Python package versions 漂移會讓 evidence 難重現。→ Verification report 必須記錄 converter identity 與 dependency versions。
- [Spec scope creep] 若拉進 production batch service，會帶入 queue 與 deployment concerns。→ 此 change 維持 single-host `_worker` verification；若需要 production batch-job，再開後續 spec。

## Migration Plan

1. 以 backward-compatible 方式新增 timing/status fields；既有 batch helper consumers 可忽略新欄位。
2. 針對 timeout/status/timing semantics 加入 fake converter unit tests。
3. 使用 canonical fixture root 重現 `--limit 1`，記錄 evidence。
4. 修正或最佳化已定位的 bottleneck。
5. 重跑 `--limit 1`；通過後用該 artifact 做 single-file web viewer / Kit visual preview。
6. 單檔 conversion 與 visual preview evidence 都有明確結果後，再跑 full 13-file batch。
7. 依實際 outcome 更新 verification docs 與 roadmap。

Rollback 很直接：revert implementation PR。既有 archived specs 與過去 evidence 保持不變，production baseline 也會維持 unlocked。

## Open Questions

- 第一輪 controlled run 的 per-fixture timeout 應採 600s、1200s，或經人工批准後更長？
- Full 13-file batch 應先 serial run 取得 deterministic evidence，還是在單檔穩定後允許 later parallel mode？
- 若某些 canonical fixtures 因 unsupported IFC content 持續失敗，應 curate fixture set，還是擴充 `coverage_status=warn` policy 加入明確允許的 degradation reasons？
- 單檔 visual preview 的最小 evidence 應固定為 screenshot + `openedStageResult` + non-zero video dimensions，還是允許 headless browser artifact inspection 作為替代？
