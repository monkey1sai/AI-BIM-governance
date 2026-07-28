## 背景

### 現況

- `bim-review-coordinator` 的 `createCoordinatorApp` 同時持有：IFC-ready intake、download、`pendingDispatchEvents`、`ConversionDispatchQueue` dispatcher、auto-poll registry、`ingestConversionReport`、callback outbox、ConversionLedger dual-write、auto Review Session。
- 週邊已有相對清楚的 adapters：`ExternalIfcReadyStore`、`StreamingConversionClient`、`ConversionDispatchQueue`、`CallbackOutbox`、`ConversionLedger`，但 **編排深度不在它們身上**。
- 硬不變量已存在並有測試：`pendingDispatchEvents.set` 必須同步先於 `enqueue`；dispatch 失敗保留 pending、成功才刪；`hasPendingDispatch` 為 test-only；dispose drain + 冪等。
- Auto session 與 outbox **狀態獨立**（註解與實作已寫）：terminal ready 才建 session；hook/session 失敗不得回滾 outbox。

### 約束與假設

- **Wire freeze**：public HTTP path 與對外 JSON 形狀不變；既有 vitest 為行為尺。
- **邊界**：conversion authority 仍在 streaming；pipeline 只經 client adapter 對話；不擁有 Kit/WebRTC。
- **Review Session** 仍屬 coordinator session control-plane，不屬 conversion pipeline 核心。
- Domain 詞：`CONTEXT.md`（IfcReadyConversionPipeline、IntakeCommand、Conversion terminal、onConversionTerminal）。
- C1 grilling 定案：B + B1 + E1 + J2 + H1 + DI 表。

### 假設、成功標準與最小安全改動

- **Assumption**：可先搬程式、不改產品語意；測試已覆蓋 closed loop 主路徑。
- **Success criteria**：composition root 不再持有 conversion poller/pending 編排；改 terminal 順序只需動 pipeline；上列 vitest 與 baseline 同綠。
- **Smallest safe change**：新增一 module + 逐步委派；不重寫 store/outbox/client；dispose 不等待或取消既有 in-flight dispatch，但其 post-dispose completion 不得再建立 poller。

## 目標／非目標

### 目標

1. Deep module **IfcReadyConversionPipeline** 擁有 accept→terminal 編排 + ledger + outbox enqueue。
2. Route 薄化：auth/normalize 與 HTTP 映射在外。
3. **onConversionTerminal** 承載 auto-session（及未來同類 observer），契約固定。
4. retry / prioritize / dispose / hasPendingDispatch 同一 module。

### 非目標

- 前端、streaming authority、governance、identity 跨語言統一、artifact health 完整事件模型。

## 架構

### 控制流（目標）

```txt
[HTTP ifc-ready]
  auth + normalize → IntakeCommand
  → pipeline.accept
       findExisting | create | download | ledger queued
       pending.set ; enqueue
  → HTTP 200/202/502 + sanitize

[Queue worker / internal]
  dispatch → streaming client
  schedule poller (internal)
  → pipeline.ingest
       job terminal + outbox + ledger
       onConversionTerminal (sync, swallow errors)
  → HTTP (若來自 route)

[app hook]
  onConversionTerminal → autoCreateOrActivateSession (ready only)
```

### 依賴注入（constructor）

| 依賴 | 用途 |
|------|------|
| ExternalIfcReadyStore | job SoT |
| StreamingConversionClient | conversion authority |
| ConversionDispatchQueue | serial FIFO |
| CallbackOutbox | metadata-only |
| ConversionLedger | shadow 觀測 |
| download 函式 | shared volume |
| config 切片 | poll/timeout/profile/callback fallback… |
| onConversionTerminal | H1 hook |
| structLog（可選） | anomaly |

**不注入：** SessionStore、kitPool、EventLog、ArtifactHealthLedger。

### Interface 草圖（決策凍結，非最終 TS 檔）

```txt
accept(IntakeCommand) → AcceptResult
ingest(...) → IngestResult          // 不含 session 欄位
retryDispatch(ifcReadyJobId) → ...
prioritize(ifcReadyJobId) → ...
dispose() → ...
@internal hasPendingDispatch(jobId) → boolean
```

### 檔案落點

- 新：`bim-review-coordinator/src/services/ifcReadyConversionPipeline.ts`
- 改：`app.ts`（wiring + routes + hook）、必要時測試僅改 import/委派

### 遷移切片

1. Shell：pending + pollerRegistry + dispose + hasPendingDispatch
2. Terminal：ingest + poller + outbox + ledger + hook（session 外移）
3. Accept：J2 create/replay/download/enqueue
4. retry / prioritize
5. 清死碼 + 全量回歸

## 風險與取捨

| 風險 | 緩解 |
|------|------|
| 大 diff / merge conflict on app.ts | 嚴格分 slice；每片綠 |
| ingest 回應曾帶 session 欄位 | HTTP 層組合或 hook 後查 store；對外 JSON 不變 |
| dispose vs in-flight dispatch race | 不等待或取消既有 in-flight dispatch；completion path 以 `disposed` guard 禁止重建 poller，回歸測試鎖定 |
| MinIO watcher final tick 在 queue drain 後 enqueue | app shutdown 先 await watcher dispose，再呼叫 pipeline dispose；順序測試鎖定 |
| 過度抽象 ports/ | 一 adapter 不硬拆 interface 檔；DI 用 concrete + 測試 fake |

## 驗證策略

- 最小：受影響 vitest 檔（external-ifc-ready、auto-poll-conversion、conversion-dispatch-queue、conversion-control-routes、host-native-conversion-ingest、cloud-callback-outbox、conversion-ledger-intake-integration）。
- 不要求 GPU/Kit；不要求 viewer E2E（本 change 無 user-facing UI 變更）。
- `npx openspec validate deepen-ifc-ready-conversion-pipeline --strict`。
