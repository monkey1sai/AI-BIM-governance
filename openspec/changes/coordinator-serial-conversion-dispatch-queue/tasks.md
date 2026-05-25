# Tasks — coordinator-serial-conversion-dispatch-queue

## 0. Setup

- [x] 0.1 Create branch `codex/openspec/coordinator-serial-conversion-dispatch-queue`
      from latest `main`.
- [x] 0.2 Inspect existing dispatch flow in
      `bim-review-coordinator/src/app.ts` (`POST /api/external/ifc-ready` handler
      around line 523) and `services/externalIfcReadyStore.ts`.
- [x] 0.3 Create OpenSpec scaffold:proposal / design / tasks / spec delta.

## 1. Failing tests first (TDD)

- [ ] 1.1 Add vitest spec `tests/conversion-dispatch-queue.test.ts`:
      - unit:enqueue → dispatcher called in FIFO order;一個 in-flight
        dispatcher 完成後下一個才被呼叫
      - unit:dispatcher 拋 exception 時 worker 仍處理下一個
      - unit:`getQueuePosition(jobId)` 對 in-flight 回 0、queued 回 1-based
      - unit:`drain()` 清空並回傳 dropped ids
- [ ] 1.2 Add vitest spec section to `tests/external-ifc-ready.test.ts` (or
      新增 `tests/external-ifc-ready-queue.test.ts`):
      - integration:controllable streaming stub(等 manual release)
      - 兩個並發 POST → 第二個 `status="queued_for_conversion"` + `queue_position=1`
      - release 第一個 → 第一個 `status="dispatched"`,worker tick 後第二個 `status="dispatched"`
      - 第一個 streaming-server 回 500 → 第二個仍 dispatch
- [ ] 1.3 Add restart-drop test:對 `ConversionDispatchQueue` 呼叫 `drain()`
      → 確認 `markDroppedOnRestart` 被觸發、`status="dropped_on_restart"`
- [ ] 1.4 Run `npm test` → 新 tests FAIL(模組不存在/欄位不存在)

## 2. Implementation

- [ ] 2.1 新增 `src/services/conversionDispatchQueue.ts`:
      `class ConversionDispatchQueue` with `enqueue` / `setDispatcher` /
      `getQueuePosition` / `getInFlight` / `getQueuedJobIds` / `drain`
- [ ] 2.2 修改 `src/types.ts`:`IfcReadyIntakeStatus` 加 `queued_for_conversion`
      與 `dropped_on_restart`;`IfcReadyIntakeJob` 加 `queue_position?: number | null`
- [ ] 2.3 修改 `src/services/externalIfcReadyStore.ts`:
      - `create(...)` 帶 `queue_position: null` 預設
      - 加 `markQueuedForConversion(jobId, queuePosition)`
      - 加 `markDroppedOnRestart(jobId)`
      - `markDispatched(...)` 清 `queue_position = null`
      - 加 `getById(jobId)`(若不存在;dispatcher 需要查 event 來 rebuild)
- [ ] 2.4 修改 `src/app.ts`:
      - 在 `createCoordinatorApp` 內 instantiate `ConversionDispatchQueue`
      - 注入 dispatcher(closure capture `streamingConversionClient`、`externalIfcReadyStore`、
        `pollerRegistry`、`schedulePollerForConversion`)
      - 維護 `pendingDispatchEvents: Map<string, ExternalIfcReadyEvent>`,
        enqueue 時存,worker 取出用
      - 修改 `POST /api/external/ifc-ready` handler:downloaded 後改為
        `markQueuedForConversion` + `enqueue`,**不再** 直接 await
        `createConversionJob`
      - `GET /api/external/ifc-ready/:jobId` response 帶 `queue_position`
- [ ] 2.5 確認 `npm run build`(TypeScript 編譯)通過

## 3. Verify

- [ ] 3.1 `cd bim-review-coordinator && npm test`
- [ ] 3.2 `cd bim-review-coordinator && npm run build`
- [ ] 3.3 `cd bim-review-coordinator && npm run verify`
- [ ] 3.4 `openspec validate coordinator-serial-conversion-dispatch-queue --strict`
- [ ] 3.5 `openspec validate --specs --strict`
- [ ] 3.6 既有 `tests/external-ifc-ready.test.ts` 仍 pass(single-job 等價)

## 4. Commit / PR

- [ ] 4.1 `git diff --cached --check`
- [ ] 4.2 Commit:`feat(coordinator): 並發 ifc-ready 序列化 dispatch + queue lifecycle (coordinator-serial-conversion-dispatch-queue)`
- [ ] 4.3 Push branch and open PR with Traditional Chinese title / body.
- [ ] 4.4 Wait for GitHub Actions verify + human review.
- [ ] 4.5 Address review inside this branch (新 commit,不 amend).

## 5. Archive (post-merge)

- [ ] 5.1 Sync local main with `origin/main`.
- [ ] 5.2 `openspec archive coordinator-serial-conversion-dispatch-queue`.
- [ ] 5.3 Sync delta into
      `openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md`.
- [ ] 5.4 Update `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` and
      regenerate the HTML view.
- [ ] 5.5 Closeout per `AGENTS.md`:check / delete merged branches and report.
