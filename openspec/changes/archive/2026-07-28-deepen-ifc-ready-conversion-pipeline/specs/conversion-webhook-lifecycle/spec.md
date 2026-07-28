## ADDED Requirements

### Requirement: conversion terminal side effects split between pipeline and session observer

當 conversion 結果進入 terminal（ready 或 failed）時，`bim-review-coordinator` SHALL：

1. 由 **IfcReadyConversionPipeline** 必做：更新 IFC-ready job terminal 狀態、向 metadata-only **callback outbox** enqueue 對應事件（`conversion_result_ready` / `conversion_failed` 或等價）、best-effort 更新 ConversionLedger。
2. 由 **onConversionTerminal**（或等價 app 層 observer）可選做：auto Review Session 建立／啟用。僅 terminal **ready** 且具可串流 artifact 時 MAY 建立可串流 session；terminal **failed** SHALL NOT 建立可串流 session。
3. outbox 狀態與 session 狀態 SHALL 互相獨立：pending／dead-letter callback SHALL NOT 阻塞 session handoff；session 失敗 SHALL NOT 回滾已成功的 outbox enqueue 或將 ingest 改為失敗。

本 requirement SHALL NOT 改變外部 ifc-ready 或 cloud callback 的 public payload 欄位契約；只釐清 coordinator 內編排擁有者。

#### Scenario: ready 時 outbox 與 session 獨立

- **WHEN** internal conversion result terminal ready 完成 ingest
- **THEN** callback outbox SHALL 已 enqueue ready 事件
- **AND** auto-session MAY 由 observer 執行
- **AND** 若 session 因無 kit capacity 等原因未建立，outbox 項目仍 SHALL 存在且可後續 deliver

#### Scenario: failed 時 outbox 入列且無串流 session

- **WHEN** internal conversion result terminal failed 完成 ingest
- **THEN** callback outbox SHALL enqueue failed 事件
- **AND** coordinator SHALL NOT 因該 failed terminal 建立新的可串流 Review Session
