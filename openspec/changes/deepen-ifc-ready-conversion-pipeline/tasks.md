## 1. 基線與影響

- [x] 1.1 在 `codex/openspec/deepen-ifc-ready-conversion-pipeline`（或等價 worktree）確認除本 change 外工作區意圖清楚；記錄 HEAD。
- [x] 1.2 對 `createCoordinatorApp`、`ingestConversionReport`、dispatch/queue 相關 symbol 跑 GitNexus impact；HIGH/CRITICAL 先回報策略。
- [x] 1.3 Baseline vitest（`bim-review-coordinator`）：`external-ifc-ready`、`auto-poll-conversion`、`conversion-dispatch-queue`、`conversion-control-routes`、`host-native-conversion-ingest`、`cloud-callback-outbox`、`conversion-ledger-intake-integration`；記錄 pass 數。
- [x] 1.4 `npx openspec validate deepen-ifc-ready-conversion-pipeline --strict` 通過。

## 2. Pipeline shell（dispose / pending 觀測）

- [x] 2.1 新增 `IfcReadyConversionPipeline` module（檔名 `ifcReadyConversionPipeline.ts`），constructor 接收 design 所列 DI（store、client、queue、outbox、ledger、download、config 切片、hook、log）。
- [x] 2.2 遷移 `pendingDispatchEvents`、`pollerRegistry`、queue `setDispatcher` 骨架與 `dispose` / `hasPendingDispatch` 委派；`createCoordinatorApp` 建構 pipeline。
- [x] 2.3 驗證：dispatch-queue 與 control-routes 中 `hasPendingDispatch`、dispose drain 測仍綠；行為不變更。
- [x] 2.4 PR review：shutdown 先收斂 MinIO watcher intake 再 drain pipeline；以順序回歸測試鎖定。

## 3. Conversion terminal 路徑

- [x] 3.1 遷移 `ingestConversionReport`、`ingestStreamingConversionResult`、`schedulePollerForConversion` 入 pipeline。
- [x] 3.2 outbox enqueue + ledger terminal 留在 pipeline；auto-session 改掛 `onConversionTerminal`（同步、失敗不回灌）。
- [x] 3.3 observer 結果綁定單次 ingest return，移除跨 request `lastTerminalSession` mutable slot。
- [x] 3.3 Internal conversion-result / manual ingest routes 只轉呼叫 pipeline；對外 JSON 相容。
- [x] 3.4 驗證：auto-poll、host-native-ingest、cloud-callback-outbox、session handoff 相關測全綠。

## 4. Accept 路徑（J2）

- [x] 4.1 遷移 ifc-ready accept 核心：findExisting/create/replay/download/enqueue/ledger queued。
- [x] 4.2 Route：auth + normalize → `pipeline.accept` → HTTP 映射；MinIO loopback 仍走同一 route。
- [x] 4.3 驗證：external-ifc-ready、ledger intake 整合測全綠。

## 5. Operator recovery

- [x] 5.1 `retryDispatch` / `prioritize` 實作於 pipeline；control routes 委派。
- [x] 5.2 保留 rebuild pending、delete-on-success、422 脈絡遺失語意。
- [x] 5.3 驗證：conversion-control-routes 全綠。

## 6. 清場與收尾

- [x] 6.1 刪除 app.ts 內已死的 conversion 編排 helpers；確認無重複 outbox/session 邏輯。
- [x] 6.2 對齊 `CONTEXT.md` 詞與實作符號；必要時微調文件一句話。
- [x] 6.3 重跑 §1.3 同一 vitest 集合，與 baseline 同綠。
- [x] 6.4 `npx openspec validate deepen-ifc-ready-conversion-pipeline --strict`；PR 描述附輸出。
- [x] 6.5 不宣告 viewer/design/full-system E2E complete（本 change 無 UI wire 變更）。
