# conversion-artifact-id-sanitize Specification

## Purpose
TBD - created by archiving change conversion-artifact-id-sanitize. Update Purpose after archive.
## Requirements
### Requirement: coordinator SHALL 對送往 conversion authority 的內部識別欄位做確定性 sanitize

coordinator 派工 conversion authority（`POST /api/conversions/ifc-to-usdc`）前，SHALL 以確定性純函式 `sanitizeArtifactIdPart` 處理全部受 `SAFE_ID_RE = ^[A-Za-z0-9_.-]+$` 驗證的內部識別欄位（`ifc_artifact.artifact_id`、`model_version_id`、`correlation_id`、`event_id` 含 fallback 派生路徑）。規則：輸入全為 safe 字元時 SHALL 原樣回傳（零行為變化）；含非 safe 字元時 SHALL 回傳 `${safe}_${sha256[:8]}`（保留 safe 字元 + SHA-256 前 8 碼後綴，確定性且防碰撞）；全非 safe 時 SHALL 回傳 `mv_<hash8>`。`external_model_version_id` 等外部對帳欄位 SHALL 保留原始值。SHALL NOT 放寬 conversion 端 `SAFE_ID_RE`。

#### Scenario: 中文 external_model_version_id 派工成功（不再 400）

- **WHEN** 外部 ifc-ready intake 帶 `external_model_version_id="271_pieple_管線"` 且 IFC 下載成功
- **THEN** coordinator 送往 conversion 的內部識別欄位 SHALL 全數通過 `SAFE_ID_RE`
- **AND** job SHALL 進入 `dispatched`（SHALL NOT 因 `Invalid ifc_artifact_id` 進 `dispatch_failed`）
- **AND** job 的 `external_model_version_id` SHALL 保留原始中文值

#### Scenario: 純 safe id 零行為變化（向後相容）

- **WHEN** intake 的識別欄位全為 `[A-Za-z0-9_.-]` 字元
- **THEN** sanitize SHALL 原樣回傳，送往 conversion 的 payload SHALL 與修復前完全一致

#### Scenario: worker 派生含冒號 event_id / correlation_id 同樣通過

- **WHEN** worker compat 派生出含冒號的 `correlation_id`（如 `worker:899::xxx`）或 fallback `event_id`
- **THEN** sanitize 後的值 SHALL 通過 `SAFE_ID_RE`，派工 SHALL NOT 被 400 擋下

### Requirement: conversion 結果回拋 SHALL 以 sanitize 後 correlation 命中原 job 且 SHALL NOT 污染 intake 去重

conversion authority 儲存/回傳的是 sanitize 後 `correlation_id`。coordinator SHALL 將 sanitize 後鍵登記於獨立索引（與原始 correlation 索引分桶）：結果回拋（`ingestConversionReport` → `getByCorrelation`）SHALL 先查原始鍵、查不到再查 sanitize 鍵而命中原 job；intake 去重（`findExisting`）SHALL 只查原始鍵，SHALL NOT 因另一請求的真實 correlation 恰等於某 job 的 sanitize 值而誤判為 idempotent replay。

#### Scenario: sanitize 後 correlation 回拋命中原 job（閉環不斷）

- **WHEN** 以含冒號 raw correlation 建立的 job 派工後，conversion result 以 sanitize 後 `correlation_id` 回拋
- **THEN** coordinator SHALL 命中原 job（SHALL NOT 404），狀態 SHALL 正確推進並走既有 callback outbox

#### Scenario: intake aliasing 防護（sanitize 鍵不參與去重）

- **WHEN** job A 的 raw correlation sanitize 後為 `S`，之後另一 intake 以真實 `X-Correlation-Id: S` 與不同 idempotency key 進來
- **THEN** coordinator SHALL 建立獨立新 job（`idempotent_replay=false`），SHALL NOT 視為 job A 的 replay

### Requirement: `#/minio` Ifc-ready jobs 列表 SHALL 顯示 dispatch_error 明細

EdgeConsole `#/minio`（ModelDataPage · GlobalConversionPane；#303/#304 IA 合併後 Ifc-ready jobs 佇列表自 `#/conv` 移入，`#/conv`（ConversionPage）佇列僅保留裸文字錯誤附註）的 Ifc-ready jobs 列表 SHALL 消費 `GET /api/external/ifc-ready` 回應的 `dispatch_error` 欄位：有錯時 SHALL 顯示截斷明細（完整字串置於 `title`）；`dispatch_error` 為 null 時 SHALL NOT 渲染錯誤節點。

#### Scenario: dispatch_failed job 的失敗原因可見

- **WHEN** 某 job 派工失敗且後端回傳非空 `dispatch_error`
- **THEN** `#/minio` 列表該 job 列 SHALL 顯示 dispatch_error 明細（截斷 + 完整字串入 title），operator 無需打 API 即可知失敗原因

#### Scenario: 無錯誤時不佔版面

- **WHEN** job 的 `dispatch_error` 為 null
- **THEN** 列表 SHALL NOT 渲染 dispatch_error 錯誤節點
