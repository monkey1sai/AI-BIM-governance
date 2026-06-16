# #conv 轉檔佇列插隊／重試控制動作（IX-CV-03）Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

- **Goal:** 把 `#conv` 上「插隊／重試 controlled action endpoint 待建」的誠實佔位翻成真按鈕＋真協調器端點，成為產品首個「intent→confirm→audited」controlled action。
- **Architecture:** 全部改動限在 `bim-review-coordinator`（dispatcher delete-on-success 改造 + `ConversionDispatchQueue` 兩個 additive method + 兩條 production 控制路由 + `queue_position` 上 wire + 結構化 audit log）與 `web-viewer-sample`（client POST helper + 首個 `IntentDialog` 共用件 + `#conv` 列控制按鈕）。插隊／重試對象是協調器端 in-memory dispatch FIFO，`:id` = `ifc_ready_job_id`；`bim-streaming-server` 零改動。
- **Tech Stack:** TypeScript / Express 5（coordinator，vitest + supertest）；React 18（`web-viewer-sample`，vitest + `react-dom/server`/`react-dom/client` + Playwright E2E）。

## 來源檔案座標（執行前必讀，已逐一查證 commit `feat/conv-prioritize-retry` worktree）

協調器（`bim-review-coordinator/`）：

- `src/services/conversionDispatchQueue.ts` — `ConversionDispatchQueue` class；`queued: string[]`（17）、`inFlightJobId`（18）、`enqueue`（27）、`getQueuePosition`（36：in-flight→0、queued→1-based、不在→null）、`getInFlight`（42）、`getQueuedJobIds`（46）、`drain`（55）、private `runWorker`（60）。**無 reorder / retry method。**
- `src/app.ts`：
  - `isSafeConversionJobId`（57，pattern `/^[A-Za-z0-9_.-]+$/` 在 56；不可複用 `isSafeSessionId`）。
  - `conversionDispatchQueue` 建立（382）、`pendingDispatchEvents` Map（385-394）、dispatcher closure（398-429，**delete 在 400、`markDispatched` 在 415、`markDispatchFailed`（catch）在 424**）。
  - `express.json()` 全域中介層（440-447），故 ~588 之後註冊的 POST 路由 `request.body` 已被解析。
  - 既有 conv route 範例 `GET /api/conversions/:conversionJobId/quality-metrics`（588-616，含 safe-id 400、404 對應、錯誤不外溢內部欄位 611-614）。
  - intake enqueue 段（`pendingDispatchEvents.set` 838-844、`enqueue` 845、`getQueuePosition`+`markQueuedForConversion` 850-854）。
  - `summarizeIfcReadyJob`（1938-1967，C 頁列表與單一 job 共用；**目前未輸出 `queue_position`**）。
  - dispose drain（1821-1825，`drain` + `markDroppedOnRestart` + `pendingDispatchEvents.delete`）。
  - 回傳 `{ app, server, io, config, store, eventLog, structLog, dispose }`（1828）。
- `src/services/externalIfcReadyStore.ts` — `markDispatched`（102）、`markQueuedForConversion`（117，寫 `queue_position`）、`markDroppedOnRestart`（131）、`markDispatchFailed`（183，註解明寫「為可重試狀態」）、`get`（277）、`list`（281）。
- `src/lib/structLog.ts` — `StructLogger.audit(component, msg, data: AuditData, level?)`（122）；`AuditData = { action; actor; target }`（61-65）；`event_type` 含 `"audit"`（37）。
- `src/types.ts` — `IfcReadyIntakeStatus`（154-165）= `accepted | queued_for_conversion | dispatched | dispatch_failed | dropped_on_restart | failed`；`IfcReadyIntakeJob.queue_position`（store 寫此欄）。
- `tests/conversion-dispatch-queue.test.ts` — controllable streaming stub harness（`startControllableStreamingStub` 75、`makeApp` 38、`authHeaders` 56、`payload` 52、`waitFor` 134）；既有 FIFO / exception / drain / dispose 斷言（143-388）。
- `tests/external-ifc-ready.test.ts` — list 形狀鎖（`toMatchObject` 255-265，含 `not.toHaveProperty("idempotency_key" / "callback_url")`）。
- `tests/host-native-conversion-ingest.test.ts` — dispatch ingest 回歸網（spec §6.2 點名）。

前端（`web-viewer-sample/`）：

- `src/console/coordinatorClient.ts` — `jsonGet`（27-33，非 2xx→throw）；`IfcReadyListItem`（99-115，已含 `status`/`conversion_status`/`dispatch_error`/`conversion_job_id`，**無 `queue_position`**）；`coordinatorClient` 物件（153-165，目前全 GET）。
- `src/console/pages.tsx` — `ConversionSchedulingPage`（437-579）；`load`（445-459）；`toggleCoverage`（461-487）；佔位 Field `pages.tsx:496`（`prov="p1"`）；job 表（540-575，coverage 鈕在 562-564）。
- `src/console/components.tsx` — `Panel`（31）、`Field`（58）、`Btn`（80，支援 `disabled` / `onClick` / `data-testid` / `caption`）。
- `src/console/ConversionSchedulingPage.test.tsx` — 前端測試慣例（`react-dom/server` `renderToString` 純渲染 + `react-dom/client` `createRoot`/`act` + `vi.spyOn(coordinatorClient, ...)` mock）。
- `e2e/conv-coverage-report.spec.ts` — 既有 #conv E2E 慣例（守門 conditional `test.skip`、檔頭 skip-gate 效力限制說明、coordinator base 由 `E2E_COORDINATOR_BASE_URL` 注入預設 `:8005`、截圖落 `../artifacts/e2e/`）。
- `playwright.config.ts` — webServer 起 viewer 於 `:5180`，`baseURL` 由 `E2E_VIEWER_BASE_URL` 預設 `http://127.0.0.1:5180`。

---

## Task 0: dispatcher delete-on-success 改造（cr1 BLOCKER 1，先決且回歸鎖）

> 把 `pendingDispatchEvents.delete(jobId)` 從「worker 取件即刪」改為「`markDispatched` 成功後才刪」，使 `dispatch_failed` job 保留 pending 脈絡可被 retry 重派。此為**既有 dispatch 行為變更**（非 additive），必須先做、跑 GitNexus impact、回歸鎖。

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（dispatcher closure 398-429）
- Test: `bim-review-coordinator/tests/conversion-dispatch-queue.test.ts`（新增 integration 段斷言 pending 保留）

**Steps:**

- [ ] 改前先跑 GitNexus impact 鎖 blast radius。執行（worktree 已 index 該 repo）：

  ```
  mcp__gitnexus__context name="setDispatcher"  （或對 dispatcher closure 所在 createCoordinatorApp）
  ```

  以及 spec §7 點名的目標符號：`markDispatched` / `markDispatchFailed` / `markQueuedForConversion` / `ConversionDispatchQueue`。預期：`pendingDispatchEvents` 的讀者僅 dispatcher closure 與 dispose drain（`app.ts:1824`），無第三方依賴「取件即刪」。若 impact 報出 closure 以外的 `pendingDispatchEvents` 讀者，停止並回報（spec 假設被推翻）。

- [ ] 先在 `tests/conversion-dispatch-queue.test.ts` 的 `describe("Concurrent IFC-ready POST → serial dispatch (integration)")` 內新增一個失敗測試，**只鎖 Task 0 本身交付的半段**：「派工失敗 → `dispatch_failed` 且 pending 脈絡保留（不會自動再派工）」。**此測試不得引用 Task 2 的 `POST .../retry` 路由**——retry 重派的完整 round-trip 由 Task 2 的 `tests/conversion-control-routes.test.ts`（本 plan Task 2「retry」describe）兜底；如此 Task 0 commit 後測試集即全綠，可獨立 commit、不留跨 task 紅燈。沿用既有 `startControllableStreamingStub` 不適用（它只回 202），改用一個「永遠回 500」的 stub 觸發 `dispatch_failed`。在檔案內既有 import 下方加測試：

  ```ts
  it("派工失敗後狀態為 dispatch_failed，且 pending 保留不自動再派工（delete-on-success 半段）", async () => {
    let callCount = 0;
    activeStub = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
        let body = "";
        req.on("data", (c) => { body += c.toString("utf8"); });
        req.on("end", () => {
          callCount += 1;
          // 永遠失敗：Task 0 只驗「失敗後保留 pending、不自動重派」；retry 重派由 Task 2 route 測試兜底。
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "dispatch always fails" }));
        });
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => activeStub?.listen(0, "127.0.0.1", () => r()));
    const addr = activeStub.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    const app = makeApp({ streamingConversionApiBase: `http://127.0.0.1:${addr.port}` });

    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_retry_ok", "idem_retry_ok"))
      .send(payload());
    const jobId = res.body.ifc_ready_job_id as string;

    // 派工失敗 → dispatch_failed（delete-on-success：失敗路徑不刪 pending）。
    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
      return r.body.status === "dispatch_failed";
    });

    // pending 保留證據：worker 已 shift，保留 pending 不會自動重派 → callCount 維持 1、狀態續為 dispatch_failed。
    // （delete-on-success 失敗路徑保留 pending；自動重派不發生，retry 重派的 round-trip 由 Task 2 route 測試驗。）
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(callCount).toBe(1);
    const after = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
    expect(after.body.status).toBe("dispatch_failed");
  });
  ```

  此測試**不橫跨 task**：Task 0 改完 dispatcher 後即可轉綠，commit 後測試集全綠。執行：

  ```
  cd bim-review-coordinator && npx vitest run tests/conversion-dispatch-queue.test.ts -t "delete-on-success 半段"
  ```

  預期：dispatcher 未改前紅（現行「取件即刪」下 `markDispatchFailed` 行為已成立但本測試斷言點以 delete-on-success 後的語意為準，先 RED 後 GREEN 走 TDD）；改完 dispatcher（下一步）後綠。**無 404、無跨 task 紅燈**。

- [ ] 改 `app.ts` dispatcher closure（398-429）為 delete-on-success。把現行：

  ```ts
  conversionDispatchQueue.setDispatcher(async (jobId) => {
    const pending = pendingDispatchEvents.get(jobId);
    pendingDispatchEvents.delete(jobId);
    if (!pending) {
      externalIfcReadyStore.markDispatchFailed(jobId, "pending dispatch event lost before worker pickup");
      return;
    }
    try {
      const dispatch = await streamingConversionClient.createConversionJob(pending.event, { ... });
      externalIfcReadyStore.markDispatched(jobId, dispatch.conversion_job_id, dispatch.status);
      if (config.conversionPollEnabled && !pollerRegistry.has(dispatch.conversion_job_id)) {
        schedulePollerForConversion(dispatch.conversion_job_id);
      }
    } catch (dispatchError) {
      externalIfcReadyStore.markDispatchFailed(jobId, dispatchError instanceof Error ? dispatchError.message : String(dispatchError));
    }
  });
  ```

  改為（只移動 `delete` 行；`!pending` 守門路徑維持立即 `markDispatchFailed`）：

  ```ts
  conversionDispatchQueue.setDispatcher(async (jobId) => {
    const pending = pendingDispatchEvents.get(jobId);
    if (!pending) {
      // 脈絡確實不存在（restart / drain 後）— 立即標失敗，retry 將回 422「請重新進件」。
      externalIfcReadyStore.markDispatchFailed(jobId, "pending dispatch event lost before worker pickup");
      return;
    }
    try {
      const dispatch = await streamingConversionClient.createConversionJob(pending.event, {
        correlationId: pending.correlationId,
        externalModelVersionId: pending.externalModelVersionId,
        localPath: pending.localPath,
        hostLocalPath: pending.hostLocalPath,
      });
      externalIfcReadyStore.markDispatched(jobId, dispatch.conversion_job_id, dispatch.status);
      // delete-on-success：僅派工成功才刪 pending，使 dispatch_failed job 可被 retry 重派。
      pendingDispatchEvents.delete(jobId);
      if (config.conversionPollEnabled && !pollerRegistry.has(dispatch.conversion_job_id)) {
        schedulePollerForConversion(dispatch.conversion_job_id);
      }
    } catch (dispatchError) {
      // 失敗保留 pending 脈絡供 retry requeue（dispose drain 仍會 delete，見 app.ts:1824）。
      externalIfcReadyStore.markDispatchFailed(jobId, dispatchError instanceof Error ? dispatchError.message : String(dispatchError));
    }
  });
  ```

- [ ] 跑既有回歸鎖確認 delete-on-success 沒破 FIFO/exception/drain/dispose 語意：

  ```
  cd bim-review-coordinator && npx vitest run tests/conversion-dispatch-queue.test.ts
  ```

  預期：既有 5 個既存斷言（FIFO 順序、exception 不卡、getQueuePosition、drain、dispose dropped_on_restart）全綠；新加「派工失敗第二個仍 dispatch」（272-314）仍綠（worker 已 shift，保留 pending 不會自動重派）；本 task 新增的「delete-on-success 半段」測試轉綠。**整檔測試集全綠，無跨 task 紅燈**——retry 重派的完整 round-trip 由 Task 2 `conversion-control-routes.test.ts` 兜底，本檔不依賴尚未存在的 retry 路由。

- [ ] commit（task 邊界）：

  ```
  cd "C:/Repos/active/iot/AI-BIM-governance/.worktrees/conv-prioritize-retry" && git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-dispatch-queue.test.ts && git diff --cached --check && git commit -m "fix(coordinator): dispatcher delete-on-success 保留 dispatch_failed pending 供 retry"
  ```

---

## Task 1: `ConversionDispatchQueue` additive 補 `prioritize` / `requeue`

**Files:**
- Modify: `bim-review-coordinator/src/services/conversionDispatchQueue.ts`（`ConversionDispatchQueue` class）
- Test: `bim-review-coordinator/tests/conversion-dispatch-queue.test.ts`（`describe("ConversionDispatchQueue (unit)")` 段）

**Steps:**

- [ ] 先寫失敗的 unit 測試。在 `tests/conversion-dispatch-queue.test.ts` 的 `describe("ConversionDispatchQueue (unit)")`（143）內，`drain()` 測試（205-213）後面新增：

  ```ts
  it("prioritize 把非首位 queued job 移到隊首回 true", () => {
    const queue = new ConversionDispatchQueue();
    // 不 setDispatcher → worker run 但 dispatcher==null，job 推回 queue（既有慣例 195-203）
    queue.enqueue("A"); queue.enqueue("B"); queue.enqueue("C");
    expect(queue.prioritize("C")).toBe(true);
    expect(queue.getQueuedJobIds()).toEqual(["C", "A", "B"]);
  });

  it("prioritize 對已在隊首 job 回 true 且不動順序（成功 no-op）", () => {
    const queue = new ConversionDispatchQueue();
    queue.enqueue("A"); queue.enqueue("B");
    expect(queue.prioritize("A")).toBe(true);
    expect(queue.getQueuedJobIds()).toEqual(["A", "B"]);
  });

  it("prioritize 對不在 queue 的 job 回 false", () => {
    const queue = new ConversionDispatchQueue();
    queue.enqueue("A");
    expect(queue.prioritize("Z")).toBe(false);
    expect(queue.getQueuedJobIds()).toEqual(["A"]);
  });

  it("requeue 重新 enqueue 並回新的 1-based position", () => {
    const queue = new ConversionDispatchQueue();
    queue.enqueue("A"); queue.enqueue("B");
    const pos = queue.requeue("R");
    expect(pos).toBe(3);
    expect(queue.getQueuePosition("R")).toBe(3);
  });
  ```

  執行：

  ```
  cd bim-review-coordinator && npx vitest run tests/conversion-dispatch-queue.test.ts -t "prioritize|requeue"
  ```

  預期：4 個全紅（`queue.prioritize` / `queue.requeue` is not a function）。

- [ ] 在 `conversionDispatchQueue.ts` 的 `drain()` method（55-58）後、`runWorker`（60）前，加兩個 additive method：

  ```ts
  /**
   * 把 queued job 移到隊首（插隊）。in-flight 不可被搶下；不碰 worker。
   * 回 true：已在隊首（no-op）或成功移到隊首；回 false：in-flight 或不在 queue。
   */
  prioritize(jobId: string): boolean {
    const index = this.queued.indexOf(jobId);
    if (index === -1) return false;
    if (index === 0) return true;
    this.queued.splice(index, 1);
    this.queued.unshift(jobId);
    return true;
  }

  /** 重新 enqueue（retry 用）並回新的 1-based queue position。 */
  requeue(jobId: string): number {
    this.enqueue(jobId);
    return this.getQueuePosition(jobId) ?? 0;
  }
  ```

- [ ] 跑全檔回歸確認既有語意零退化 + 新測試綠：

  ```
  cd bim-review-coordinator && npx vitest run tests/conversion-dispatch-queue.test.ts
  ```

  預期：Task 1 的 4 個新測試綠；既有 unit/integration/restart 斷言全綠（新 method 不碰 `queued`/`inFlightJobId`/worker 既有路徑）。

- [ ] commit：

  ```
  cd "C:/Repos/active/iot/AI-BIM-governance/.worktrees/conv-prioritize-retry" && git add bim-review-coordinator/src/services/conversionDispatchQueue.ts bim-review-coordinator/tests/conversion-dispatch-queue.test.ts && git diff --cached --check && git commit -m "feat(coordinator): ConversionDispatchQueue 補 prioritize/requeue method"
  ```

---

## Task 2: 協調器兩條控制路由 + safe-id + audit

> 依賴 Task 0（retry 才成立）、Task 1（佇列 method）。

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（新增 `isSafeIfcReadyJobId` + 兩條路由，緊接 quality-metrics route 616 之後）
- Create: `bim-review-coordinator/tests/conversion-control-routes.test.ts`

**Steps:**

- [ ] 先寫失敗的 route 測試。建 `bim-review-coordinator/tests/conversion-control-routes.test.ts`，沿用 `conversion-dispatch-queue.test.ts` 的 controllable stub harness（複製 `startControllableStreamingStub` / `makeApp` / `payload` / `authHeaders` / `waitFor` 或自檔案 import 共用 helper；最小做法是在新檔重用相同 pattern）。涵蓋 spec §6.3：

  ```ts
  import http from "node:http";
  import fs from "node:fs";
  import os from "node:os";
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  import request from "supertest";
  import { afterEach, describe, expect, it } from "vitest";
  import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
  import type { CoordinatorConfig } from "../src/config.js";

  // — harness 同 conversion-dispatch-queue.test.ts（CONTRACT / makeApp / authHeaders / payload / waitFor / startControllableStreamingStub）—
  // （把該檔 helper 逐字複製到本檔頂部；保持 active/activeStub afterEach 清理。）

  describe("conversion control routes — prioritize", () => {
    it("A in-flight、B/C queued → prioritize C → queued_order C 在 B 前，store position 重算", async () => {
      const stub = await startControllableStreamingStub();
      const app = makeApp({ streamingConversionApiBase: stub.baseUrl });
      // A 進件 → in-flight（stub 不 release）
      const a = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_p_A", "idem_p_A")).send(payload());
      await waitFor(() => stub.bodies.length >= 1);
      const b = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_p_B", "idem_p_B")).send(payload({ external_model_version_id: "ext_p_B" }));
      const c = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_p_C", "idem_p_C")).send(payload({ external_model_version_id: "ext_p_C" }));
      const jobC = c.body.ifc_ready_job_id as string;
      const jobB = b.body.ifc_ready_job_id as string;

      const res = await request(app.app).post(`/api/conversion/jobs/${jobC}/prioritize`).send({ reason: "urgent" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("queued_for_conversion");
      expect(res.body.queued_order.indexOf(jobC)).toBeLessThan(res.body.queued_order.indexOf(jobB));
      expect(res.body.queue_position).toBe(1);
      // store position 重算：C=1、B=2
      const cView = await request(app.app).get(`/api/external/ifc-ready/${jobC}`);
      const bView = await request(app.app).get(`/api/external/ifc-ready/${jobB}`);
      expect(cView.body.queue_position).toBe(1);
      expect(bView.body.queue_position).toBe(2);
      stub.releaseNext(); // teardown
    });

    it("prioritize 非法 id → 400", async () => {
      const app = makeApp({ streamingConversionApiBase: "http://127.0.0.1:1" });
      const res = await request(app.app).post(`/api/conversion/jobs/${encodeURIComponent("bad id!")}/prioritize`).send({});
      expect(res.status).toBe(400);
    });
    it("prioritize 不存在 → 404", async () => {
      const app = makeApp({ streamingConversionApiBase: "http://127.0.0.1:1" });
      const res = await request(app.app).post(`/api/conversion/jobs/ifcready_nope/prioritize`).send({});
      expect(res.status).toBe(404);
    });
    it("prioritize 對非 queued_for_conversion（dispatched）→ 409", async () => {
      const stub = await startControllableStreamingStub();
      const app = makeApp({ streamingConversionApiBase: stub.baseUrl });
      const a = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_p2_A", "idem_p2_A")).send(payload());
      const jobA = a.body.ifc_ready_job_id as string;
      await waitFor(() => stub.bodies.length >= 1);
      stub.releaseNext();
      await waitFor(async () => (await request(app.app).get(`/api/external/ifc-ready/${jobA}`)).body.status === "dispatched");
      const res = await request(app.app).post(`/api/conversion/jobs/${jobA}/prioritize`).send({});
      expect(res.status).toBe(409);
    });
  });

  describe("conversion control routes — retry", () => {
    it("派工失敗（500 stub）→ dispatch_failed → retry → queued_for_conversion → 再被 worker 取件成功", async () => {
      let n = 0;
      activeStub = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
          let body = ""; req.on("data", (c) => { body += c.toString("utf8"); });
          req.on("end", () => {
            n += 1;
            if (n === 1) { res.writeHead(500).end(JSON.stringify({ detail: "fail" })); }
            else { res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ conversion_job_id: "stream_conv_retry", status: "queued", authority: "bim-streaming-server" })); }
          });
        } else { res.writeHead(404).end(); }
      });
      await new Promise<void>((r) => activeStub?.listen(0, "127.0.0.1", () => r()));
      const addr = activeStub.address(); if (!addr || typeof addr === "string") throw new Error("bind");
      const app = makeApp({ streamingConversionApiBase: `http://127.0.0.1:${addr.port}` });
      const j = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_r", "idem_r")).send(payload());
      const jobId = j.body.ifc_ready_job_id as string;
      await waitFor(async () => (await request(app.app).get(`/api/external/ifc-ready/${jobId}`)).body.status === "dispatch_failed");
      const retry = await request(app.app).post(`/api/conversion/jobs/${jobId}/retry`).send({ reason: "manual retry" });
      expect(retry.status).toBe(200);
      expect(retry.body.status).toBe("queued_for_conversion");
      await waitFor(async () => {
        const r = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
        return r.body.status === "dispatched" && r.body.conversion_job_id === "stream_conv_retry";
      });
    });

    it("retry 對非 dispatch_failed/dropped_on_restart（dispatched）→ 409", async () => {
      const stub = await startControllableStreamingStub();
      const app = makeApp({ streamingConversionApiBase: stub.baseUrl });
      const a = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_r2", "idem_r2")).send(payload());
      const jobA = a.body.ifc_ready_job_id as string;
      await waitFor(() => stub.bodies.length >= 1); stub.releaseNext();
      await waitFor(async () => (await request(app.app).get(`/api/external/ifc-ready/${jobA}`)).body.status === "dispatched");
      const res = await request(app.app).post(`/api/conversion/jobs/${jobA}/retry`).send({});
      expect(res.status).toBe(409);
    });
  });
  ```

  執行：

  ```
  cd bim-review-coordinator && npx vitest run tests/conversion-control-routes.test.ts
  ```

  預期：全紅（route 未建，404/或路徑不存在）。

- [ ] 在 `app.ts` 的 `isSafeConversionJobId`（57-59）下方加語意別名（不可複用 `isSafeSessionId`）：

  ```ts
  // conv-prioritize-retry:ifc_ready_job_id 形狀 ifcready_<ts>_<hex>，落在同一通用字元集。
  // 為語意清楚另命名；實作共用 isSafeConversionJobId 的 regex。
  export function isSafeIfcReadyJobId(value: string): boolean {
    return isSafeConversionJobId(value);
  }
  ```

- [ ] 在 `app.ts` quality-metrics route（`app.get(".../quality-metrics", ...)`，588-616）的閉合 `});`（616）之後、`app.get("/api/review-sessions/:sessionId/events", ...)`（618）之前，新增兩條路由。注意 `conversionDispatchQueue` / `pendingDispatchEvents` / `externalIfcReadyStore` / `structLog` 皆在同一 `createCoordinatorApp` closure 作用域內可直接取用：

  ```ts
  // conv-prioritize-retry (IX-CV-03):協調器自有 dispatch 佇列的 controlled action。
  // :id = ifc_ready_job_id。只動協調器 in-memory FIFO，不碰 bim-streaming-server。
  // 模式 3 ③ audit：成功寫一筆結構化 audit log（actor best-effort）。body optional { reason?: string }。
  function resolveActor(request: express.Request): string {
    const header = request.header("X-Operator") ?? request.header("X-Actor");
    return typeof header === "string" && header.trim().length > 0 ? header.trim() : "local-operator";
  }
  function parseReason(request: express.Request): string {
    const body = request.body as { reason?: unknown } | undefined;
    return typeof body?.reason === "string" ? body.reason.slice(0, 500) : "";
  }

  app.post("/api/conversion/jobs/:id/prioritize", (request, response) => {
    const id = request.params.id;
    if (!isSafeIfcReadyJobId(id)) {
      response.status(400).json({ detail: "Invalid ifc-ready job id." });
      return;
    }
    const job = externalIfcReadyStore.get(id);
    if (!job) {
      response.status(404).json({ detail: "Ifc-ready job not found." });
      return;
    }
    if (job.status !== "queued_for_conversion") {
      response.status(409).json({ detail: `Job not prioritizable in status '${job.status}'.` });
      return;
    }
    if (!conversionDispatchQueue.prioritize(id)) {
      response.status(409).json({ detail: "Job is in-flight or not in the queue." });
      return;
    }
    // 重算受影響 queued position（順手收斂既有 position 快照漂移；in-flight 不在 getQueuedJobIds）。
    const queuedOrder = conversionDispatchQueue.getQueuedJobIds();
    queuedOrder.forEach((qid, idx) => externalIfcReadyStore.markQueuedForConversion(qid, idx + 1));
    const reason = parseReason(request);
    const actor = resolveActor(request);
    structLog.withTraceId(id).audit("conversion-control", "conversion.prioritize", {
      action: "conversion.prioritize", actor, target: id,
    }, "info");
    const updated = externalIfcReadyStore.get(id);
    response.json({
      ifc_ready_job_id: id,
      status: updated?.status ?? "queued_for_conversion",
      queue_position: updated?.queue_position ?? null,
      queued_order: queuedOrder,
      reason,
    });
  });

  app.post("/api/conversion/jobs/:id/retry", (request, response) => {
    const id = request.params.id;
    if (!isSafeIfcReadyJobId(id)) {
      response.status(400).json({ detail: "Invalid ifc-ready job id." });
      return;
    }
    const job = externalIfcReadyStore.get(id);
    if (!job) {
      response.status(404).json({ detail: "Ifc-ready job not found." });
      return;
    }
    if (!["dispatch_failed", "dropped_on_restart"].includes(job.status)) {
      response.status(409).json({ detail: `Job not retryable in status '${job.status}'.` });
      return;
    }
    if (!pendingDispatchEvents.has(id)) {
      // 脈絡確實不存在（restart / drain 後）— 誠實要求重新進件，不假裝可重試。
      response.status(422).json({ detail: "Dispatch context lost (coordinator restart/drain); please re-POST the ifc-ready job." });
      return;
    }
    // 直接用 requeue 回傳 position（不用 0 哨兵 — 0 是 getQueuePosition 的 in-flight 專用值）。
    const pos = conversionDispatchQueue.requeue(id);
    externalIfcReadyStore.markQueuedForConversion(id, pos);
    const reason = parseReason(request);
    const actor = resolveActor(request);
    structLog.withTraceId(id).audit("conversion-control", "conversion.retry", {
      action: "conversion.retry", actor, target: id,
    }, "info");
    response.json({
      ifc_ready_job_id: id,
      status: "queued_for_conversion",
      queue_position: pos,
      reason,
    });
  });
  ```

  注意：`structLog.withTraceId(id)` 需 trace_id 符合 `TRACE_ID_PATTERN`（`structLog.ts:352` `^(ifcready_|rev_|stream_conv_|script_|external_)...`）；`ifc_ready_job_id` 形狀 `ifcready_...` 命中 `ifcready_` 前綴，合法。

- [ ] 跑 route 測試確認全綠 + Task 0 dispatch_failed 半段回歸不壞：

  ```
  cd bim-review-coordinator && npx vitest run tests/conversion-control-routes.test.ts tests/conversion-dispatch-queue.test.ts
  ```

  預期：prioritize 4 案 + retry 2 案全綠；Task 0 「delete-on-success 半段」測試維持綠（Task 2 新增 retry 路由不影響其斷言）。本 task 的 `conversion-control-routes.test.ts`「retry」describe（500-stub→`dispatch_failed`→`POST .../retry`→`queued_for_conversion`→再被 worker 取件成功）是 retry 重派完整 round-trip 的唯一驗證點，補上 Task 0 半段未涵蓋的那半。

- [ ] commit：

  ```
  cd "C:/Repos/active/iot/AI-BIM-governance/.worktrees/conv-prioritize-retry" && git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-control-routes.test.ts bim-review-coordinator/tests/conversion-dispatch-queue.test.ts && git diff --cached --check && git commit -m "feat(coordinator): 新增 conversion prioritize/retry 控制路由 + audit"
  ```

---

## Task 3: `queue_position` 上 wire（cr1 BLOCKER 2）

> §4.5 插隊鈕以 `queue_position` 判 disabled，未上 wire 會永久 disabled。

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（`summarizeIfcReadyJob` 1938-1967）
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（`IfcReadyListItem` 99-115）
- Test: `bim-review-coordinator/tests/external-ifc-ready.test.ts`（形狀鎖 255-265）

**Steps:**

- [ ] 先在 `tests/external-ifc-ready.test.ts` 既有 list 形狀鎖（`toMatchObject` 255-265）的物件內，additive 加一鍵斷言 `queue_position` 在 wire 上（值依該 fixture，已派工 job `queue_position` 為 `null`）。在 255-263 的 `toMatchObject({...})` 內加：

  ```ts
      conversion_authority: "bim-streaming-server",
      queue_position: null,   // conv-prioritize-retry:additive 上 wire（已派工 → null）
      web_view_session_id: null,
  ```

  執行：

  ```
  cd bim-review-coordinator && npx vitest run tests/external-ifc-ready.test.ts -t "limit"
  ```

  預期：紅（`queue_position` 不在回傳物件 → toMatchObject 失敗）。

- [ ] 在 `app.ts` `summarizeIfcReadyJob`（1938-1967）回傳物件內，`conversion_authority` 行（1956）之後 additive 加：

  ```ts
    conversion_authority: job.conversion_authority,
    queue_position: job.queue_position ?? null,
    dispatch_error: job.dispatch_error ?? null,
  ```

- [ ] 在 `coordinatorClient.ts` `IfcReadyListItem`（99-115）的 `conversion_authority` 行（106）之後 additive 加型別欄：

  ```ts
    conversion_authority: string | null;
    // conv-prioritize-retry:in-flight→0、queued→1-based、其餘→null。供插隊鈕 disabled 判斷。
    queue_position?: number | null;
    conversion_job_id: string | null;
  ```

- [ ] 跑 wire 回歸鎖確認形狀只新增一欄：

  ```
  cd bim-review-coordinator && npx vitest run tests/external-ifc-ready.test.ts
  ```

  預期：全綠（含新 `queue_position` 斷言、既有 `not.toHaveProperty("idempotency_key"/"callback_url")` 維持）。

- [ ] commit：

  ```
  cd "C:/Repos/active/iot/AI-BIM-governance/.worktrees/conv-prioritize-retry" && git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/external-ifc-ready.test.ts web-viewer-sample/src/console/coordinatorClient.ts && git diff --cached --check && git commit -m "feat(coordinator): summarizeIfcReadyJob 補 queue_position 上 wire + 前端型別"
  ```

---

## Task 4: 前端 client POST helper + control 方法

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（`jsonGet` 27-33 下加 `jsonPost`；`coordinatorClient` 物件 153-165）
- Test: `web-viewer-sample/src/console/coordinatorClient.test.ts`（若不存在則 Create）

**Steps:**

- [ ] 確認是否已有 `coordinatorClient.test.ts`：

  ```
  ls web-viewer-sample/src/console/coordinatorClient.test.ts 2>/dev/null && echo EXISTS || echo MISSING
  ```

  若 MISSING 則 Create；若 EXISTS 則 append。先寫失敗測試（mock `fetch`，驗 `conversionPrioritize` 打對 path/method/body 並回 JSON、非 2xx throw）：

  ```ts
  import { afterEach, describe, expect, it, vi } from "vitest";
  import { coordinatorClient } from "./coordinatorClient";

  describe("coordinatorClient conversion control", () => {
    afterEach(() => vi.restoreAllMocks());

    it("conversionPrioritize 打 POST .../prioritize 帶 reason，回 JSON", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ifc_ready_job_id: "ifcready_x", status: "queued_for_conversion", queue_position: 1 }), { status: 200 }),
      );
      const r = await coordinatorClient.conversionPrioritize("ifcready_x", "urgent");
      expect(r.status).toBe("queued_for_conversion");
      const call = spy.mock.calls[0];
      expect(String(call[0])).toContain("/api/conversion/jobs/ifcready_x/prioritize");
      expect((call[1] as RequestInit).method).toBe("POST");
      expect(String((call[1] as RequestInit).body)).toContain("urgent");
    });

    it("conversionRetry 非 2xx 時 throw", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "nope" }), { status: 409, statusText: "Conflict" }));
      await expect(coordinatorClient.conversionRetry("ifcready_x")).rejects.toThrow();
    });
  });
  ```

  執行：

  ```
  cd web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts
  ```

  預期：紅（`conversionPrioritize` / `conversionRetry` 未定義）。

- [ ] 在 `coordinatorClient.ts` `jsonGet`（27-33）下方加 `jsonPost`：

  ```ts
  async function jsonPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${COORD_BASE}${path}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      throw new Error(`coordinator ${path} -> ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }
  ```

- [ ] 在 `ConversionQualityMetricsResponse`（145-151）附近加 control 回應型別，並在 `coordinatorClient` 物件（153-165）的 `openInViewerUrl` 之前加兩個方法：

  ```ts
  // conv-prioritize-retry:POST /api/conversion/jobs/:id/{prioritize,retry} 回應形狀。
  export interface ConversionControlResponse {
    ifc_ready_job_id: string;
    status: string;
    queue_position?: number | null;
    queued_order?: string[];
  }
  ```

  ```ts
    conversionPrioritize: (id: string, reason?: string) =>
      jsonPost<ConversionControlResponse>(`/api/conversion/jobs/${encodeURIComponent(id)}/prioritize`, { reason }),
    conversionRetry: (id: string, reason?: string) =>
      jsonPost<ConversionControlResponse>(`/api/conversion/jobs/${encodeURIComponent(id)}/retry`, { reason }),
  ```

- [ ] 跑前端 client 測試確認綠：

  ```
  cd web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts
  ```

  預期：2 案綠。

- [ ] commit：

  ```
  cd "C:/Repos/active/iot/AI-BIM-governance/.worktrees/conv-prioritize-retry" && git add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinatorClient.test.ts && git diff --cached --check && git commit -m "feat(viewer): coordinatorClient 補 jsonPost + conversionPrioritize/Retry"
  ```

---

## Task 5: 前端 `IntentDialog`（首個 controlled-action 共用件）

> 模式 3 ① intent ② confirm；非樂觀（`await onConfirm` 成功才由呼叫端關閉）。USER-FACING。

**Files:**
- Create: `web-viewer-sample/src/console/IntentDialog.tsx`
- Test: `web-viewer-sample/src/console/IntentDialog.test.tsx`

**Steps:**

- [ ] 先寫失敗測試（mirror `ConversionSchedulingPage.test.tsx` 的 `createRoot`/`act` 慣例）。建 `IntentDialog.test.tsx`：

  ```tsx
  import { act } from "react";
  import { createRoot } from "react-dom/client";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { IntentDialog } from "./IntentDialog";

  describe("IntentDialog", () => {
    const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
    let container: HTMLDivElement; let prev: unknown;
    beforeEach(() => { prev = (globalThis as Record<string, unknown>)[actEnvKey]; (globalThis as Record<string, unknown>)[actEnvKey] = true; container = document.createElement("div"); document.body.appendChild(container); });
    afterEach(() => { document.body.removeChild(container); (globalThis as Record<string, unknown>)[actEnvKey] = prev; });

    it("open=false 不渲染內容", async () => {
      const root = createRoot(container);
      await act(async () => { root.render(<IntentDialog open={false} title="t" cost="c" onConfirm={async () => {}} onCancel={() => {}} />); });
      expect(container.textContent ?? "").not.toContain("確認執行");
    });

    it("確認執行呼叫 onConfirm 帶 reason 文字", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const root = createRoot(container);
      await act(async () => { root.render(<IntentDialog open title="插隊" cost="此 job 將排到佇列最前" onConfirm={onConfirm} onCancel={() => {}} />); });
      const textarea = container.querySelector("textarea")!;
      await act(async () => { textarea.value = "趕工"; textarea.dispatchEvent(new Event("input", { bubbles: true })); });
      const confirmBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("確認執行"))!;
      await act(async () => { confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(onConfirm).toHaveBeenCalledWith("趕工");
    });
  });
  ```

  執行：

  ```
  cd web-viewer-sample && npx vitest run src/console/IntentDialog.test.tsx
  ```

  預期：紅（`IntentDialog` 不存在）。

- [ ] 建 `web-viewer-sample/src/console/IntentDialog.tsx`（用既有 `ec-*` class，不引新依賴；最小、不過度抽象）：

  ```tsx
  import { useState } from "react";

  // conv-prioritize-retry:模式 3（intent→confirm）首個 controlled-action 共用 modal。
  // 非樂觀：confirm 後 await onConfirm；成功與否由呼叫端決定關閉（POST 成功才關）。
  export function IntentDialog({
    open, title, cost, onConfirm, onCancel, busy,
  }: {
    open: boolean;
    title: string;
    cost: string;
    onConfirm: (reason: string) => void | Promise<void>;
    onCancel: () => void;
    busy?: boolean;
  }) {
    const [reason, setReason] = useState("");
    if (!open) return null;
    return (
      <div className="ec-modal-backdrop" data-testid="intent-dialog">
        <div className="ec-modal" role="dialog" aria-modal="true">
          <h3>{title}</h3>
          <p className="ec-warn-note">{cost}</p>
          <label className="ec-field-k" htmlFor="intent-reason">原因（可空）</label>
          <textarea
            id="intent-reason"
            className="ec-input"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
          <div className="ec-modal-actions">
            <button className="ec-btn" disabled={busy} onClick={onCancel} data-testid="intent-cancel">取消</button>
            <button className="ec-btn primary" disabled={busy} onClick={() => void onConfirm(reason)} data-testid="intent-confirm">
              {busy ? "執行中…" : "確認執行"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```

  注意：若 `ec-modal*` class 在 console CSS 尚未定義，dialog 仍可運作（無樣式不影響行為與測試）；如需最小樣式可在 console stylesheet additive 加 `.ec-modal-backdrop`/`.ec-modal`，但**非本卡必要**，不擅自擴張（YAGNI）。

- [ ] 跑測試確認綠：

  ```
  cd web-viewer-sample && npx vitest run src/console/IntentDialog.test.tsx
  ```

  預期：2 案綠。

- [ ] commit：

  ```
  cd "C:/Repos/active/iot/AI-BIM-governance/.worktrees/conv-prioritize-retry" && git add web-viewer-sample/src/console/IntentDialog.tsx web-viewer-sample/src/console/IntentDialog.test.tsx && git diff --cached --check && git commit -m "feat(viewer): 新增 IntentDialog 首個 controlled-action 共用件"
  ```

---

## Task 6: `#conv` 列控制按鈕（插隊／重試）接 `IntentDialog` + 真 POST

> USER-FACING。取代 `pages.tsx:496` 佔位 Field；非樂觀（POST 成功後 `load()` 重抓真狀態）。

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`ConversionSchedulingPage` 437-579）
- Test: `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx`（append control 行為段）

**Steps:**

- [ ] 先寫失敗測試。在 `ConversionSchedulingPage.test.tsx` 末尾新增 `describe`，mock `listIfcReady` 回一筆 `dispatch_failed` job + `conversionRetry` 成功，驗「重試鈕渲染 → 點開 dialog → 確認 POST → load() 重抓」。沿用既有 `createRoot`/`act`/`vi.spyOn` 慣例：

  ```tsx
  describe("ConversionSchedulingPage 控制動作（插隊／重試）", () => {
    const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
    let container: HTMLDivElement; let prev: unknown;
    beforeEach(() => { prev = (globalThis as Record<string, unknown>)[actEnvKey]; (globalThis as Record<string, unknown>)[actEnvKey] = true; container = document.createElement("div"); document.body.appendChild(container); });
    afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); (globalThis as Record<string, unknown>)[actEnvKey] = prev; });

    const failedJob: IfcReadyListItem = {
      ifc_ready_job_id: "ifcready_failed", status: "dispatch_failed", project_id: "271",
      external_model_version_id: "ext_f", download_status: "downloaded", conversion_status: "dispatch_failed",
      conversion_authority: null, conversion_job_id: null, dispatch_error: "stub failure",
      queue_position: null, review_session_id: null, viewer_url: null,
      expected_stage_url: null, expected_mapping_url: null, created_at: "2026-06-16T00:00:00Z",
    };

    it("dispatch_failed job 顯重試鈕 → 確認 → conversionRetry 被呼叫且 load 重抓", async () => {
      const listSpy = vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [failedJob] });
      vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
      const retrySpy = vi.spyOn(coordinatorClient, "conversionRetry").mockResolvedValue({ ifc_ready_job_id: "ifcready_failed", status: "queued_for_conversion", queue_position: 1 });
      const root = createRoot(container);
      await act(async () => { root.render(<ConversionSchedulingPage />); });
      await act(async () => { await Promise.resolve(); });

      const retryBtn = container.querySelector('[data-testid="conv-retry-ifcready_failed"]') as HTMLButtonElement;
      expect(retryBtn).toBeTruthy();
      await act(async () => { retryBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

      const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
      expect(confirm).toBeTruthy();
      await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await Promise.resolve(); });

      expect(retrySpy).toHaveBeenCalledWith("ifcready_failed", "");
      expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // 初次 load + 成功後 load
    });
  });
  ```

  執行：

  ```
  cd web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx -t "控制動作"
  ```

  預期：紅（無 `conv-retry-*` testid、無 dialog）。

- [ ] 在 `pages.tsx` 頂部 import 區加 `IntentDialog` 與 control 方法（`conversionPrioritize`/`conversionRetry` 已在 `coordinatorClient` 物件，無需單獨 import）。確認 `IntentDialog` import：

  ```tsx
  import { IntentDialog } from "./IntentDialog";
  ```

- [ ] 在 `ConversionSchedulingPage`（437）的 state 區（443-444 附近）加：

  ```tsx
  const [pendingAction, setPendingAction] = useState<{ jobId: string; kind: "prioritize" | "retry" } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  ```

- [ ] 加一個 `runAction` callback（在 `toggleCoverage` 後）：confirm 時 `await` 真 POST，成功 `await load()`+關 dialog，失敗 `setErr` 誠實訊息、不關 dialog、不改狀態：

  ```tsx
  const runAction = useCallback(async (reason: string) => {
    if (!pendingAction) return;
    setActionBusy(true);
    try {
      if (pendingAction.kind === "prioritize") await coordinatorClient.conversionPrioritize(pendingAction.jobId, reason);
      else await coordinatorClient.conversionRetry(pendingAction.jobId, reason);
      await load();                 // 證據型更新：重抓真佇列狀態（非樂觀）
      setPendingAction(null);       // 成功才關 dialog
    } catch (e) {
      setErr(`控制動作失敗：${String(e)}`); // 失敗誠實，不關 dialog、不改狀態
    } finally {
      setActionBusy(false);
    }
  }, [pendingAction, load]);
  ```

- [ ] 在 job 表 coverage 欄（562-564）旁，依狀態加控制鈕。把 562-564 的 `<td>` 改為同 `<td>` 內並列 coverage 與 control 鈕，並在表頭（542）加一欄 `<th>控制</th>`，新增控制 `<td>`：

  ```tsx
  <td>
    {j.status === "queued_for_conversion" && (
      <Btn
        data-testid={`conv-prioritize-${j.ifc_ready_job_id}`}
        disabled={j.queue_position == null || j.queue_position <= 1}
        onClick={() => setPendingAction({ jobId: j.ifc_ready_job_id, kind: "prioritize" })}
      >插隊</Btn>
    )}
    {(j.status === "dispatch_failed" || j.status === "dropped_on_restart") && (
      <Btn
        data-testid={`conv-retry-${j.ifc_ready_job_id}`}
        onClick={() => setPendingAction({ jobId: j.ifc_ready_job_id, kind: "retry" })}
      >重試</Btn>
    )}
  </td>
  ```

  （`colSpan={7}` 的展開列 567 須同步改為 `colSpan={8}`，因表頭多一欄。）

- [ ] 移除 `pages.tsx:496` 佔位 Field（`<Field k="插隊 / 重試 / concurrency" ... prov="p1" />`），改為誠實標目前可控範圍：

  ```tsx
  <Field k="插隊 / 重試" v="可於下方 ifc-ready job 列依狀態操作（intent→confirm→audited）" prov="asbuilt" />
  <Field k="concurrency 控制" v="NOT BUILT：獨立 follow-up 卡" prov="p1" />
  ```

- [ ] 在 `ConversionSchedulingPage` return 的 `</>`（577）前掛 `IntentDialog`：

  ```tsx
  <IntentDialog
    open={pendingAction != null}
    title={pendingAction?.kind === "prioritize" ? "插隊到佇列最前" : "重新派工此 job"}
    cost={pendingAction?.kind === "prioritize"
      ? "此 job 將排到佇列最前、較早派工；其他排隊中 job 順位後移。"
      : "將重新派工此 job 至轉檔 authority；可能再次失敗。"}
    busy={actionBusy}
    onConfirm={runAction}
    onCancel={() => { if (!actionBusy) setPendingAction(null); }}
  />
  ```

- [ ] 跑前端測試（control 段 + 既有 coverage / minio 段全回歸）：

  ```
  cd web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx
  ```

  預期：新「控制動作」段綠；既有 MinIO Panel / 錯誤獨立 / coverage 展開段全綠（表頭多一欄不影響既有斷言）。

- [ ] commit：

  ```
  cd "C:/Repos/active/iot/AI-BIM-governance/.worktrees/conv-prioritize-retry" && git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx && git diff --cached --check && git commit -m "feat(viewer): #conv 列插隊/重試控制鈕接 IntentDialog 真 POST"
  ```

---

## Task 7: Browser E2E（Playwright，誠實可達框架）

> A1–A10 唯一接受的 user-facing 證據。比照 `conv-coverage-report.spec.ts` 守門 + 檔頭 skip-gate 效力限制揭露。驗 vertical slice：UI route → 控制鈕 → `IntentDialog` → 真 coordinator POST → 真後端回應 → 列依真狀態刷新。

**Files:**
- Create: `web-viewer-sample/e2e/conv-prioritize-retry.spec.ts`
- Create（evidence 落點，執行時產出）: `web-viewer-sample/../artifacts/e2e/conv-prioritize-retry-*` 與 tracked `docs/evidence/conv-prioritize-retry/`

**Steps:**

- [ ] 建 `web-viewer-sample/e2e/conv-prioritize-retry.spec.ts`，mirror `conv-coverage-report.spec.ts` 結構（`E2E_COORDINATOR_BASE_URL` 預設 `:8005`、conditional `test.skip`、檔頭 skip-gate 效力限制段、截圖落 `../artifacts/e2e/`）。守門：列出 ifc-ready 佇列，二選一驗真切片：

  ```ts
  import { test, expect } from "@playwright/test";

  // IX-CV-03 #conv 插隊／重試 controlled action 端到端：#conv「Refresh queue」→ 對一筆
  // 依狀態渲染的控制鈕（dispatch_failed→重試 / queued_for_conversion 非隊首→插隊）點按 →
  // IntentDialog confirm → 真 coordinator POST /api/conversion/jobs/:id/{retry,prioritize} →
  // 觀察一次真後端狀態回應（POST 2xx + 列依回傳真狀態刷新）。誠實鐵律：非樂觀更新；
  // 未觀察到的轉移以 notObserved 揭露，深度因果由 conversion-control-routes.test.ts 兜底。
  //
  // *** 服務這頁 viewer 來源（同 conv-coverage-report.spec.ts）：playwright.config webServer
  //     在 :5180 起 fresh viewer；coordinator base 由 VITE_COORDINATOR_API_BASE/E2E_COORDINATOR_BASE_URL
  //     注入（預設 http://127.0.0.1:8005 branch coordinator）。
  // *** skip-gate 效力限制（比照 conv-coverage-report.spec.ts）：beforeEach 守門是 conditional
  //     skip（前置缺失 → skip → 計 pass，非 fail）。本 repo .github/workflows 無 Playwright job，
  //     故 skip 設計不 false-green 任何既有自動化 gate；純本機 / 指揮官手動 P4 gate。***
  const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

  interface Job {
    ifc_ready_job_id: string;
    status: string;
    queue_position?: number | null;
  }

  test.describe("IX-CV-03 #conv 插隊／重試 controlled action", () => {
    test.setTimeout(120_000);
    let target: { job: Job; kind: "retry" | "prioritize" } | null = null;
    const notObserved: string[] = [];

    test.beforeEach(async ({ request }) => {
      let jobs: Job[] = [];
      try {
        const res = await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=50`);
        if (res.ok()) jobs = (await res.json()).items ?? [];
      } catch { jobs = []; }
      const retryJob = jobs.find((j) => j.status === "dispatch_failed" || j.status === "dropped_on_restart");
      const prioJob = jobs.find((j) => j.status === "queued_for_conversion" && (j.queue_position ?? 0) > 1);
      if (retryJob) target = { job: retryJob, kind: "retry" };
      else if (prioJob) target = { job: prioJob, kind: "prioritize" };
      else { target = null; notObserved.push("no dispatch_failed/dropped_on_restart 或 queued(非隊首) job 可驗"); }
      test.skip(!target, "需 branch coordinator :8005 佇列有 dispatch_failed 或 queued(非隊首) job；見檔頭前置。深度因果由 route 測試兜底。");
    });

    test("控制鈕 → IntentDialog → 真 POST → 列依真狀態刷新", async ({ page }) => {
      const t = target!;
      await page.goto(`/#conv`);
      const refresh = page.getByRole("button", { name: /Refresh queue|讀取中/ });
      await refresh.waitFor({ state: "visible", timeout: 30_000 });
      await refresh.click();

      const btn = page.locator(`[data-testid="conv-${t.kind === "retry" ? "retry" : "prioritize"}-${t.job.ifc_ready_job_id}"]`);
      await btn.waitFor({ state: "visible", timeout: 30_000 });
      await btn.click();

      const dialog = page.locator(`[data-testid="intent-dialog"]`);
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      // 真 POST：等 coordinator 控制端點回 2xx（非樂觀證據）。
      const respP = page.waitForResponse((r) => new RegExp(`/api/conversion/jobs/${t.job.ifc_ready_job_id}/(retry|prioritize)`).test(r.url()), { timeout: 30_000 });
      await page.locator(`[data-testid="intent-confirm"]`).click();
      const resp = await respP;
      expect(resp.status()).toBeGreaterThanOrEqual(200);
      expect(resp.status()).toBeLessThan(300);

      // dialog 成功後關閉；列回 queued_for_conversion（重試）或順位前移（插隊）。
      await expect(dialog).toBeHidden({ timeout: 30_000 });

      await page.screenshot({ path: `../artifacts/e2e/conv-prioritize-retry-${t.kind}.png`, fullPage: true });
    });

    test.afterAll(() => {
      if (notObserved.length) console.log("[conv-prioritize-retry] notObserved:", JSON.stringify(notObserved));
    });
  });
  ```

- [ ] 在乾淨環境本機跑（前置：起 branch coordinator `:8005` 指向會回真 result 的 authority、CORS 含 `http://127.0.0.1:5180`、佇列種出一筆 `dispatch_failed` job——可用 500-stub authority 觸發；參考 branch-e2e-isolated-stack memory）。執行：

  ```
  cd web-viewer-sample && E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8005 npx playwright test e2e/conv-prioritize-retry.spec.ts
  ```

  預期（前置齊全）：1 案綠，截圖落 `artifacts/e2e/conv-prioritize-retry-retry.png`。前置缺失 → conditional skip（計 pass），`notObserved` 記錄揭露。把截圖 + summary 複製到 tracked `docs/evidence/conv-prioritize-retry/`（只存抽樣，不存 IFC/usdc）。

- [ ] commit（E2E spec + evidence 抽樣）：

  ```
  cd "C:/Repos/active/iot/AI-BIM-governance/.worktrees/conv-prioritize-retry" && git add web-viewer-sample/e2e/conv-prioritize-retry.spec.ts docs/evidence/conv-prioritize-retry/ && git diff --cached --check && git commit -m "test(e2e): #conv 插隊/重試 controlled action 端到端 + evidence"
  ```

---

## Task 8: 全量回歸 + GitNexus detect_changes + 收尾

**Files:**（無新檔；驗證 + 收尾）

**Steps:**

- [ ] coordinator 全量驗證（spec §6.5 驗收基準）：

  ```
  cd bim-review-coordinator && npm run verify
  ```

  預期：`build` 過（TypeScript 零錯）+ 全 test 綠，含新 `conversion-control-routes.test.ts`、改過的 `conversion-dispatch-queue.test.ts` / `external-ifc-ready.test.ts`，且 `host-native-conversion-ingest.test.ts` 回歸鎖不壞。

- [ ] 前端全量 vitest：

  ```
  cd web-viewer-sample && npx vitest run
  ```

  預期：全綠，含 `IntentDialog.test.tsx` / `coordinatorClient.test.ts` / `ConversionSchedulingPage.test.tsx` 控制段，且既有 console 測試零退化。

- [ ] commit 前跑 GitNexus detect_changes 驗 scope 未超出預期（spec §7：dispatcher 改造須 scope 驗證）：

  ```
  mcp__gitnexus__detect_changes（對 worktree repo）
  ```

  預期：變更集中在 `ConversionDispatchQueue`（+prioritize/requeue）、`createCoordinatorApp` 內 dispatcher closure（delete-on-success）與兩新路由、`summarizeIfcReadyJob`、`coordinatorClient`、`IntentDialog`、`ConversionSchedulingPage`。若 detect_changes 報出未預期符號（例如碰到 `bim-streaming-server` 或 session control 路徑），停止並回報。

- [ ] 回報四項（CLAUDE.md §1 收尾合約）：① 改了哪些 tracked files ② 執行的最小驗證 ③ 哪些測試沒跑及原因（E2E 若前置缺失 → conditional skip，誠實揭露）④ 已知風險（dispatcher delete-on-success 行為變更已回歸鎖；audit who best-effort 無 RBAC；E2E 因果依 `:49101` live 狀態二選一，未觀察轉移由 route 測試兜底）。
