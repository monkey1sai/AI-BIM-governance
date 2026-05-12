## 背景與目的

`worker-mapping-lineage-quality-baseline` 已歸檔，並把 all-IFC-entity coverage policy 併入現行 specs；但 canonical `storage/*.ifc` real batch evidence 仍未完成。`C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` dry-run 可找到 13 個 IFC fixtures，然而 real `--limit 1` 曾在 600s 後 timeout，因此 production mapping baseline 仍不能宣稱 locked。

這個 follow-up change 用來收斂已歸檔 change 留下的 readiness gap：先讓 canonical 單檔 real conversion 跑通並可被現有 web viewer / Kit 載入檢視，再擴到 13-file real batch evidence。只有 full batch passed 時，才允許宣稱 `minimum_coverage_locked=true`。

## 變更內容

- 為 canonical storage batch conversion runs 新增 deterministic phase timing 與 timeout diagnostics。
- 要求 canonical `--limit 1` 單檔 real conversion 先完成，才擴到 full 13-file batch。
- 單檔轉檔成功後，必須透過現有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` review viewer flow 載入 worker-hosted `model.usdc`，留下 `openedStageResult`、非零 viewport/video 尺寸與 screenshot 或等效 visual proof；若 Kit/GPU/browser prerequisite 不可用，必須記錄 `blocked`，不得宣稱 visual preview passed。
- 要求 batch evidence report 清楚區分 `blocked`、`partial`、`timed_out`、`failed`、`passed`；任何非 `passed` 狀態都不得 lock baseline。
- 要求每個 canonical fixture result 記錄 conversion duration、phase timings、USDC openability、lineage API status、source IFC entity count、mapped/unmapped entity counts、coverage ratio、coverage status、warnings 與 failure details。
- 只有 13 個 canonical fixtures 全部完成 real conversion，且符合 locked all-IFC-entity coverage criteria 時，才允許 `minimum_coverage_locked=true`。
- `_worker` 仍只負責 artifact / conversion / lineage / quality evidence；`web-viewer-sample` 與 Kit 只作既有 review viewer visual evidence，不接管轉檔或批次任務 ownership。

## 能力變更

### 新增能力

- 無。

### 修改能力

- `worker-artifact-pipeline`：收緊 storage batch verification 行為，讓 timeout diagnostics、phase timing、單檔先行與 full real-batch success 成為 worker batch verification contract 的一部分。
- `runtime-verification-evidence`：收緊 canonical storage batch evidence acceptance，避免 dry-run、partial、timed-out、subset evidence 被誤用來 lock production mapping baseline，並要求單檔成功後有 web viewer / Kit visual preview evidence 或明確 blocked 記錄。
- `worker-demo-upload-convert-ui`：worker demo UI 必須提供 lineage / quality view 中的 USDC preview handoff，將使用者導向既有 review viewer flow；它不得直接解析或渲染 USD/USDC，也不得管理 review session lifecycle。

## 影響範圍

- `_worker/app/batch_verification.py`、`_worker/scripts/verify_storage_batch.py` 與相關 tests 可能需要調整，以加入 phase timing、timeout classification、單檔先行與 stricter summary semantics。
- `_worker/app/converters.py` 可能需要調整；若 profiling 顯示 all-entity materialization、stage save/reopen 或 mapping generation 是 timeout bottleneck，應在 `_worker` 邊界內修正。
- `_worker/app/ui.py` 與 worker UI tests 可能需要補上 preview handoff；handoff 應使用現有 worker API 回傳的 artifact IDs / URLs，不讀取 local files。
- `docs/verification/` 需記錄 canonical batch matrix、單檔 visual preview evidence，以及 baseline lock 是 blocked、failed 或 passed。
- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 與 `.html` 需在 evidence 變更後同步，避免 roadmap 在 full batch success 前暗示 production readiness。
- 預期不新增 production dependency。若 profiling 需要 optional tooling，必須維持 dev-only，並在實作前說明理由。
