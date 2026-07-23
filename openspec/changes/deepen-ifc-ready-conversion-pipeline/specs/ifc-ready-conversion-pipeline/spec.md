## ADDED Requirements

### Requirement: IfcReadyConversionPipeline SHALL own IFC-ready accept through conversion terminal

`bim-review-coordinator` SHALL 將下列行為收斂於單一 deep module **IfcReadyConversionPipeline**（domain 名見 root `CONTEXT.md`），而非散落於 composition root 的多個無關 closures：

1. **accept**：對已驗證 **IntakeCommand** 執行 findExisting（idempotent replay）或 create job、shared-volume download、ConversionLedger `queued` 寫入（best-effort 失敗不得阻塞已成功 download 的 enqueue 語意）、以及 `pending` 脈絡與 serial dispatch enqueue（`pending.set` SHALL 同步先於 enqueue，中間 SHALL NOT await）。
2. **dispatch / poll**：序列派工至 conversion authority client；dispatch 成功後 MAY 啟動 in-process poller；poller 不對 Express 外露。
3. **ingest**：conversion terminal（ready|failed）時寫入 job terminal 狀態、metadata-only callback outbox enqueue、ConversionLedger terminal 回填（ledger 失敗 best-effort 不得阻塞 ingest 成功）。
4. **retryDispatch / prioritize**：與既有 HTTP 控制路由語意相容的 operator 動作。
5. **dispose**：取消 pollers、drain 未派工 queue 並標記 dropped_on_restart、清理 pending 脈絡；dispose SHALL 冪等。

Composition root / Express routes SHALL 僅做 HTTP auth、normalize、status 映射與依賴注入 wiring。Public HTTP path 與對外 JSON 形狀 SHALL NOT 因本 capability 故意變更。

#### Scenario: accept 成功後 job 進入序列派工

- **WHEN** 已驗證 IntakeCommand 通過 auth 且非 idempotent replay，且 IFC download 成功
- **THEN** IfcReadyConversionPipeline SHALL 建立或更新 job、enqueue serial dispatch，並使後續 list/detail 可觀察到 queued_for_conversion 或後續 dispatched 語意
- **AND** HTTP 層仍回既有成功狀態（例如 202）與 sanitized job 形狀

#### Scenario: idempotent replay 不重跑 download 與 dispatch

- **WHEN** 相同 idempotency/correlation 的 IntakeCommand 再次 accept
- **THEN** pipeline SHALL 回既有 job 的 replay 結果，SHALL NOT 重 download、SHALL NOT 重複建立 active conversion dispatch

#### Scenario: download 失敗不派工

- **WHEN** download 失敗
- **THEN** job SHALL 標記 download 失敗語意，SHALL NOT enqueue conversion dispatch，HTTP 層仍映射既有錯誤狀態（例如 502）

### Requirement: onConversionTerminal hook SHALL NOT own conversion success

IfcReadyConversionPipeline 在 **conversion terminal**（ready 或 failed）完成 job terminal 寫入、outbox enqueue、與 ledger best-effort 更新之後，SHALL **同步**呼叫注入的 **onConversionTerminal** observer。

- Observer 例外或失敗 SHALL 只記錄，SHALL NOT 將已成功的 ingest 改為失敗，SHALL NOT 重試或回滾 outbox 項目。
- download_failed 與 dispatch_failed SHALL NOT 觸發 onConversionTerminal（它們不是 conversion terminal）。
- **Review Session** 建立／啟用（含 auto-session）SHALL NOT 實作於 pipeline 核心；若產品需要，SHALL 僅由 onConversionTerminal（或等同 app 層 observer）執行。
- ingest 的 pipeline 層結果型別 SHALL NOT 將 session 物件作為 conversion 成功的必要欄位；HTTP 若需回 session 相關資訊，SHALL 由 app/route 在 hook 之後組合，且對外 JSON 保持相容。

#### Scenario: ready terminal 觸發 hook 且 outbox 已入列

- **WHEN** conversion 結果 terminal ready 並完成 ingest
- **THEN** outbox SHALL 已 enqueue conversion_result_ready（或等價 metadata-only 事件）
- **AND** onConversionTerminal SHALL 被同步呼叫
- **AND** 即使 hook 內 auto-session 失敗，ingest 對 caller 仍為成功、outbox 項目仍存在

#### Scenario: failed terminal 觸發 hook 但不建可串流 session

- **WHEN** conversion 結果 terminal failed 並完成 ingest
- **THEN** outbox SHALL enqueue conversion_failed（或等價）
- **AND** onConversionTerminal SHALL 被呼叫
- **AND** observer SHALL NOT 被 pipeline 強制建立可串流 Review Session

#### Scenario: dispatch_failed 不呼叫 onConversionTerminal

- **WHEN** job 僅處於 dispatch_failed
- **THEN** pipeline SHALL NOT 視為 conversion terminal
- **AND** SHALL NOT 呼叫 onConversionTerminal

### Requirement: test-only pending observation remains available

Pipeline SHALL 保留 test-only 觀測：`hasPendingDispatch(jobId): boolean`（或等價經 CoordinatorApp 委派），使既有測試能斷言 dispatch_failed 時 pending 保留、成功後刪除。公開 production 介面 SHALL NOT 暴露 pending map 本體或可 mutating 的內部結構。

#### Scenario: dispatch_failed 時 pending 可觀測

- **WHEN** 某 ifc_ready job 派工失敗進入 dispatch_failed
- **THEN** `hasPendingDispatch(jobId)` SHALL 為 true
- **AND** 待後續成功 markDispatched 後 SHALL 為 false
