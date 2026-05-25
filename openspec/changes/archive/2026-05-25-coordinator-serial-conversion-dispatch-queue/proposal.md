## Why

`bim-review-coordinator` `POST /api/external/ifc-ready` 目前 IFC 同步下載完成後
**直接** 對 `bim-streaming-server` 呼叫 `POST /api/conversions/ifc-to-usdc`,沒有任何
serialization。下游 host-native conversion authority 只有一條 HOOPS / IfcOpenShell /
OpenUSD pipeline,並發 dispatch 會造成 GPU / Kit subprocess 競爭、artifact dir 衝突、
viewer 拿到 session 後 conversion 還沒輪到。

2026-05-25 fast MVP 觀察筆記明確指出此缺口:多個 POST 行為「先用安全的寫法」做
in-memory FIFO 序列化、顯示等待中狀態。

## What Changes

- 新增 `bim-review-coordinator/src/services/conversionDispatchQueue.ts`:
  - in-memory FIFO,單一 `inFlight` slot
  - `enqueue(jobId)` / `getQueuePosition(jobId)` / `getInFlight()` / `getQueuedJobIds()`
  - `processNext(dispatcher)`:取下一個 → 呼叫 dispatcher → 成功或失敗都繼續取下一個
  - `drain()`:清空 queue,回傳被丟棄的 jobIds(供 restart cleanup)
- 修改 `ExternalIfcReadyStore`:
  - 加 `markQueuedForConversion(jobId, queuePosition)`:設 `status="queued_for_conversion"`、`queue_position=N`
  - 加 `markDroppedOnRestart(jobId)`:設 `status="dropped_on_restart"`
  - 既有 `markDispatched` 觸發時清空 `queue_position`
- 修改 `IfcReadyIntakeJob`:
  - `status` enum 加 `"queued_for_conversion"` / `"dropped_on_restart"`
  - 加 `queue_position?: number | null`
- 修改 `POST /api/external/ifc-ready` handler:
  - 下載完成後不直接 dispatch,改 `enqueue` 進 conversion queue
  - 不阻塞 HTTP 回應(202 仍立即回);queue worker 自己 process
- 修改 coordinator app lifecycle:
  - `createCoordinatorApp` 初始化時建 queue 與 dispatcher
  - 既有 single happy path 不破壞(只有一個 job 時行為等價,直接 dispatch)
- 不引入 production queue dependency(BullMQ / Redis 等)
- 不做 disk-persistent queue;in-memory restart 後丟失,operator 須重 POST

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `local-coordinator-ifc-ready-intake-boundary`:
  - ADD requirement「Coordinator serializes concurrent IFC-ready dispatch with
    in-memory FIFO」covering queued lifecycle, queue position, in-flight failure
    handling, restart drop semantics, single-job equivalence

## Impact

- Owner repo / folder:
  - `bim-review-coordinator/src/services/conversionDispatchQueue.ts`(新)
  - `bim-review-coordinator/src/services/externalIfcReadyStore.ts`
  - `bim-review-coordinator/src/types.ts`
  - `bim-review-coordinator/src/app.ts`
  - `bim-review-coordinator/tests/`
  - `openspec/changes/coordinator-serial-conversion-dispatch-queue/`
- Runtime boundary:不改 streaming-server / viewer / callback outbox。coordinator
  仍是唯一外部 intake;只是在 dispatch streaming-server 前加 gatekeeper。
- API:`POST /api/external/ifc-ready` response shape 不變(仍 202 + accepted body)。
  `GET /api/external/ifc-ready` / `GET /api/external/ifc-ready/:jobId` response
  shape 為 additive 變更(加 `queue_position` 欄位、`status` enum 加 2 個新值)。
- Data:in-memory only;restart 後 queue 清空,未 dispatch 的 job 標
  `dropped_on_restart`(後續 GET 看得到)。
- Dependencies:無新增。
- Non-goals:
  - 不引入 BullMQ / Redis / Celery
  - 不做 disk-persistent / cross-restart queue
  - 不做 priority queue / preempt / per-project quota
  - 不做 cross-coordinator-instance 協調
  - 不改變 streaming-server 內部 serial 行為
