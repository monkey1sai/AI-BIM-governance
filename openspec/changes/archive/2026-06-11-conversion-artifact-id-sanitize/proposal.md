## Why

2026-06-11 測試區實測（issue #205）：真實 MinIO intake 帶中文 `external_model_version_id="271_pieple_管線"` 的 ifc-ready job 下載成功但派工失敗 — coordinator 直接把外部 id 嵌進 conversion 內部識別欄位，被 conversion authority 的 `SAFE_ID_RE = ^[A-Za-z0-9_.-]+$` 驗證擋下（400 `Invalid ifc_artifact_id`）。本專案資料即中文命名（機電/水電/消防），此鏈路必踩。對抗複驗另實證兩顆連環雷：`model_version_id` 與 `event_id`（worker 派生含冒號）同樣會被真 API `_safe_id` 擋下，且 `#/conv` 頁看不到 `dispatch_error` 原因。

## What Changes

- **coordinator `streamingConversionClient`**：新增 `sanitizeArtifactIdPart` 純函式（safe 字元 identity 回傳；含非 safe 字元 → `${safe}_${sha256[:8]}`；全非 safe → `mv_<hash8>`），套用於送往 conversion authority 的全部 `_safe_id` 欄位（`ifc_artifact.artifact_id`、`model_version_id`、`correlation_id`、`event_id` 含 fallback 路徑）。`external_model_version_id` 等外部對帳欄位保留原始值。
- **coordinator `externalIfcReadyStore`**：`correlationIndex` 雙鍵登記（原始 + sanitize 後），conversion result 以 sanitize 值回拋仍命中原 job（修復 sanitize 引入的對帳斷裂）；callback outbox 對外仍用原始 correlation_id。
- **整合測試 stub 對齊真 API 驗證面**：`startSafeIdValidatingStub` 逐欄鏡像 `conversion_authority.py` 的 `_safe_id`/`_safe_optional_id` 欄位清單（event_id、idempotency_key fallback、correlation/tenant/project/model、optional 欄位），中文與 worker 派生案例端到端鎖死。
- **EdgeConsole `#/conv`**：`IfcReadyListItem` 補 `dispatch_error` 欄位，列表顯示截斷明細（完整字串入 title；無錯不渲染錯誤節點）。
- **Browser E2E（Playwright）**：中文 id intake 進入 dispatched（非 dispatch_failed）+ 必失敗 job 的 `dispatch_error` 明細可見；證據 tracked 於 `docs/evidence/conversion-artifact-id-sanitize/`（STUB CONVERSION API 已誠實標註）。
- 非目標：不放寬 conversion 端 `SAFE_ID_RE`；不做 dispatch_failed 重派端點/UI（#205 follow-up）；不動 download/binding/callback 流程契約。

## Capabilities

### New Capabilities

- `conversion-artifact-id-sanitize`: 外部（含中文/特殊字元）model_version_id 經確定性 sanitize 後可通過 conversion authority 驗證完成派工；派工失敗原因於 `#/conv` 可見。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder：`bim-review-coordinator/src/services/`、`bim-review-coordinator/tests/`、`web-viewer-sample/src/console/`、`web-viewer-sample/e2e/`。
- API / data shape：`GET /api/external/ifc-ready` 回應的 `dispatch_error` 欄位由前端正式消費（後端欄位既有）；送往 conversion 的內部識別欄位 sanitize（純 safe 輸入零變化，向後相容）。
- Runtime boundary：不動 ports/服務拓樸；部署區生效需 merge 後重建（coordinator 為 host dispatch 邏輯 + docker web plane dist）。
