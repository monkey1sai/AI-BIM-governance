## Context

coordinator 的 `POST /api/external/ifc-ready` 流程目前是:

```txt
auth → idempotency 檢查 → store create job → 同步下載 IFC
→ streamingConversionClient.createConversionJob(event, ...)
→ store.markDispatched(jobId, conversion_job_id)
→ schedulePollerForConversion
→ 202 Accepted
```

沒有任何 dispatch serialization。下游 `bim-streaming-server` 的 host-native
conversion authority 是單一 PowerShell / HOOPS / IfcOpenShell / OpenUSD pipeline,
並發 dispatch 會踩到 GPU / Kit subprocess / artifact dir 衝突。

## Approach

### D1. ConversionDispatchQueue service

新增 `src/services/conversionDispatchQueue.ts`,負責「序列化 dispatch 動作」(不
serialize 下載階段,下載仍可並行,只在 dispatch streaming-server 那一刻 serialize)。

```typescript
type DispatcherFn = (jobId: string) => Promise<void>;

export class ConversionDispatchQueue {
  private readonly queued: string[] = [];
  private inFlightJobId: string | null = null;
  private dispatcher: DispatcherFn | null = null;
  private worker: Promise<void> | null = null;

  /** dispatcher 由 app.ts 注入(可呼叫 streaming-server + markDispatched + poller)。 */
  setDispatcher(dispatcher: DispatcherFn): void;

  enqueue(jobId: string): void;          // push + 啟動 worker(若 idle)
  drain(): string[];                      // 清空 queue,回 dropped job ids
  getQueuePosition(jobId: string): number | null;
                                          // 1-based for queued items; 0 = in-flight; null = not in queue
  getInFlight(): string | null;
  getQueuedJobIds(): string[];
}
```

queue 行為:

- `enqueue(jobId)`:append to `queued`;若 worker idle,觸發 worker
- worker loop:while `queued.length > 0`,shift → 設 `inFlightJobId` → await
  `dispatcher(jobId)` → catch 任何 error(不卡 worker)→ 清 `inFlightJobId`
- `drain()`:把 `queued` 全部 splice 出來,回傳;**不清** `inFlightJobId`(in-flight
  job 仍可能完成);用於 restart cleanup 或 test teardown
- `getQueuePosition(jobId)`:`inFlightJobId === jobId` 回 0;在 `queued` 內回 1-based
  index;否則 null

### D2. ExternalIfcReadyStore 擴充

```typescript
markQueuedForConversion(jobId: string, queuePosition: number): IfcReadyIntakeJob | undefined;
markDroppedOnRestart(jobId: string): IfcReadyIntakeJob | undefined;
```

`markDispatched` 觸發時順手清 `queue_position = null`。

### D3. types.ts 擴充

```typescript
export type IfcReadyIntakeStatus =
  | "accepted"
  | "queued_for_conversion"   // 新
  | "dispatched"
  | "dispatch_failed"
  | "dropped_on_restart"      // 新
  | "failed";

// IfcReadyIntakeJob 加:
queue_position?: number | null;
```

### D4. app.ts POST handler 改動

```typescript
// 既有 download 完成後的 dispatch 區段:
//   await streamingConversionClient.createConversionJob(...)
// 改為:
externalIfcReadyStore.markQueuedForConversion(job.ifc_ready_job_id, queue.getQueuedJobIds().length + 1);
conversionDispatchQueue.enqueue(job.ifc_ready_job_id);

// 注入 dispatcher 在 createCoordinatorApp 啟動時做(不在每個 request):
conversionDispatchQueue.setDispatcher(async (jobId) => {
  const ifcReadyJob = externalIfcReadyStore.getById(jobId);
  if (!ifcReadyJob) return;
  try {
    const dispatch = await streamingConversionClient.createConversionJob(...rebuild event from job);
    externalIfcReadyStore.markDispatched(jobId, dispatch.conversion_job_id, dispatch.status);
    if (config.conversionPollEnabled && !pollerRegistry.has(dispatch.conversion_job_id)) {
      schedulePollerForConversion(dispatch.conversion_job_id);
    }
  } catch (err) {
    externalIfcReadyStore.markDispatchFailed(jobId, String(err));
    // 不 re-throw,worker 繼續處理下一個
  }
});
```

`event` rebuild:`externalIfcReadyStore` 需要保存 original event 或回填關鍵欄位
(`tenant_id`、`project_id`、`source_ifc` 等)。既有 store 已保有大部分欄位,但
`requested_outputs` / `callback_url` 等需要確認是否完整;若缺,改為在 enqueue 時順手
存 raw event 進 in-memory map。

簡化:job → event rebuild 用 `ExternalIfcReadyEvent` 內已有的欄位,coordinator
side-cache `pendingDispatchEvents: Map<jobId, event>`(in-memory)在 enqueue 時存,
worker dispatch 時取。

### D5. Restart cleanup

coordinator process 重啟時 in-memory queue 自然空,但 `externalIfcReadyStore` 也是
in-memory(現有設計),所以 restart 後 store 內的 `queued_for_conversion` 永遠不會被
觀察到。

但仍要在 spec 與行為層**支持** `dropped_on_restart` 概念,因為將來若有 disk-persistent
store,restart 行為需要被定義。本 change 提供:

```typescript
// createCoordinatorApp 啟動時(在 store 創建之後)即時 call:
const droppedIds = conversionDispatchQueue.drain();  // 此時通常為空
droppedIds.forEach(id => externalIfcReadyStore.markDroppedOnRestart(id));
```

對 in-memory store 這是 no-op,但 spec scenario 仍可驗證行為。

更實際:**測試以 `queue.drain()` 觸發 mark dropped 行為**,assert lifecycle 變化。

### D6. Single-job happy path equivalence

確保「只有一個 job 時行為與舊 happy path 等價」:
- POST 進來 → download → enqueue → worker 立即 dispatch → markDispatched → poller →
  最終 status=`dispatched`、`conversion_status=queued`(streaming server 回的)
- 不會看到 `queued_for_conversion` 狀態(因為 worker 立即取出 dispatch)
- 但 store 內 transient 經過 `queued_for_conversion` 在 enqueue 階段;若客戶端在
  enqueue 與 dispatch 之間查 status,**可能** 看到 `queued_for_conversion`(這是
  expected,非 bug)

### D7. Test strategy

vitest tests in `bim-review-coordinator/tests/conversion-dispatch-queue.test.ts`:

- **單元 test**:`ConversionDispatchQueue` 純邏輯(enqueue → dispatcher 觸發、
  drain、getQueuePosition、in-flight failure 不卡後續)
- **整合 test**:用 controllable streaming stub(stub 不立即回應,等 manual release)
  - 起 coordinator + stub
  - POST A → 等 A 進入 stub bodies(=in-flight)
  - POST B → assert B `status=queued_for_conversion` + `queue_position>=1`
  - release A → A 收到 streaming response → A `status=dispatched`
  - 等 worker tick → B 進入 stub bodies
  - release B → B `status=dispatched`
- 既有 `external-ifc-ready.test.ts` 不破壞(single-job 仍 pass)

### D8. Archive evidence

- vitest 全綠
- 並發 POST smoke(可選):用 `scripts/smoke-bscheme-intake.ps1` 加 2-3 並發場景,
  或人工 Postman 並發兩個 ifc-ready 並查 `GET /api/external/ifc-ready` 看
  queued_for_conversion + queue_position
- 不需要 GPU / Kit live evidence(本 change 是 coordinator side queue)

## Risks

- `pendingDispatchEvents` map 與 store 不同步可能引發 dispatch 取 event 失敗;
  test 必須驗證 enqueue → dispatcher 取 event 的 happy path
- worker error 處理:必須 catch 所有 dispatcher error,避免單一 dispatch failure
  把 worker loop 卡住
- HTTP response timing:POST 進來時 enqueue 後立即 202,viewer 看到 session 之前
  可能 conversion 還沒 dispatch;這是 expected 行為(viewer 已能處理
  `queued_for_instance`,新加 `queued_for_conversion` 對應)
