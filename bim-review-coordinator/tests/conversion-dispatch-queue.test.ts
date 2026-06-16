import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { ConversionDispatchQueue } from "../src/services/conversionDispatchQueue.js";

// coordinator-serial-conversion-dispatch-queue:in-memory FIFO 序列化 dispatch。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json");
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as {
  example: Record<string, unknown>;
};

const WEBHOOK_SECRET = "dev-webhook-secret";

let active: CoordinatorApp | null = null;
let activeStub: http.Server | null = null;

afterEach(async () => {
  if (active) await active.dispose();
  if (activeStub) {
    await new Promise<void>((resolve) => activeStub?.close(() => resolve()));
    activeStub = null;
  }
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-queue-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(CONTRACT.example), ...overrides };
}

function authHeaders(correlationId: string, idempotencyKey: string): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": correlationId,
    "X-Idempotency-Key": idempotencyKey,
  };
}

/**
 * 可控 streaming stub:每個 POST /api/conversions/ifc-to-usdc 進來時拿 next gate
 * promise,呼叫 release() 才回應 202。一律回 conversion_job_id = `stream_conv_N`。
 */
interface ControllableStreamingStub {
  baseUrl: string;
  bodies: unknown[];
  releaseNext(): void;
  pendingCount(): number;
}

async function startControllableStreamingStub(): Promise<ControllableStreamingStub> {
  const bodies: unknown[] = [];
  // 每個 pending POST 對應一個 `send` closure,等 releaseNext 觸發才回應。
  const pendingSends: Array<() => void> = [];
  // 若 releaseNext 比 POST 早呼叫,記錄一份 pre-release,下個 POST 立即 send。
  let preReleases = 0;
  let conversionCounter = 0;

  activeStub = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/conversions/ifc-to-usdc") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      bodies.push(JSON.parse(body));
      conversionCounter += 1;
      const myId = conversionCounter;
      const send = () => {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            conversion_job_id: `stream_conv_${myId}`,
            status: "queued",
            authority: "bim-streaming-server",
          }),
        );
      };
      if (preReleases > 0) {
        preReleases -= 1;
        send();
      } else {
        pendingSends.push(send);
      }
    });
  });
  await new Promise<void>((resolve) => activeStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = activeStub.address();
  if (!address || typeof address === "string") throw new Error("stub bind failed");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    bodies,
    releaseNext() {
      const send = pendingSends.shift();
      if (send) {
        send();
      } else {
        preReleases += 1;
      }
    },
    pendingCount: () => pendingSends.length,
  };
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("ConversionDispatchQueue (unit)", () => {
  it("dispatcher 依 FIFO 順序被呼叫,一個 in-flight 完成後下一個才被呼叫", async () => {
    const queue = new ConversionDispatchQueue();
    const log: string[] = [];
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    queue.setDispatcher(async (jobId) => {
      log.push(`start:${jobId}`);
      if (jobId === "A") await firstGate;
      log.push(`end:${jobId}`);
    });

    queue.enqueue("A");
    queue.enqueue("B");

    // A 已 in-flight,B 還在 queue
    await waitFor(() => log.includes("start:A"));
    expect(log).toEqual(["start:A"]);
    expect(queue.getInFlight()).toBe("A");
    expect(queue.getQueuePosition("A")).toBe(0);
    expect(queue.getQueuePosition("B")).toBe(1);

    resolveFirst();

    await waitFor(() => log.includes("end:B"));
    expect(log).toEqual(["start:A", "end:A", "start:B", "end:B"]);
    expect(queue.getInFlight()).toBeNull();
    expect(queue.getQueuePosition("B")).toBeNull();
  });

  it("dispatcher 拋 exception 時 worker 仍處理下一個", async () => {
    const queue = new ConversionDispatchQueue();
    const log: string[] = [];

    queue.setDispatcher(async (jobId) => {
      log.push(`start:${jobId}`);
      if (jobId === "A") throw new Error("boom");
      log.push(`end:${jobId}`);
    });

    queue.enqueue("A");
    queue.enqueue("B");
    await waitFor(() => log.includes("end:B"));

    expect(log).toEqual(["start:A", "start:B", "end:B"]);
  });

  it("getQueuePosition 對 in-flight 回 0、queued 回 1-based、不在 queue 回 null", () => {
    const queue = new ConversionDispatchQueue();
    // 未 setDispatcher 之前 enqueue:worker run 但 dispatcher==null,job 推回 queue
    queue.enqueue("A");
    queue.enqueue("B");
    queue.enqueue("C");
    expect(queue.getQueuePosition("A")).toBe(1);
    expect(queue.getQueuePosition("B")).toBe(2);
    expect(queue.getQueuePosition("C")).toBe(3);
    expect(queue.getQueuePosition("D")).toBeNull();
  });

  it("drain() 清空 queued 並回傳 dropped ids", () => {
    const queue = new ConversionDispatchQueue();
    queue.enqueue("A");
    queue.enqueue("B");
    queue.enqueue("C");
    const dropped = queue.drain();
    expect(dropped).toEqual(["A", "B", "C"]);
    expect(queue.getQueuedJobIds()).toEqual([]);
  });
});

describe("Concurrent IFC-ready POST → serial dispatch (integration)", () => {
  it("第二個 POST 應該觀察到 queued_for_conversion 與 queue_position", async () => {
    const stub = await startControllableStreamingStub();
    const app = makeApp({ streamingConversionApiBase: stub.baseUrl });

    // POST A:fire and forget(因為 stub 不立即回應,但 coordinator 的 streaming
    // client 是 fetch+await,所以 worker 會在 stub release 前一直 in-flight)。
    const postA = request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_serial_A", "idem_serial_A"))
      .send(payload());
    // wait for first POST to return(coordinator POST handler 自己回 202,不等
    // streaming;但要等 stub 收到 dispatch body,代表 worker 已 in-flight)。
    const resA = await postA;
    expect(resA.status).toBe(202);
    const jobA = resA.body.ifc_ready_job_id as string;
    await waitFor(() => stub.bodies.length >= 1);

    // POST B:此時 worker A 還沒被 release,B 應該 queued。
    const resB = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_serial_B", "idem_serial_B"))
      .send(payload({ external_model_version_id: "ext_mv_serial_B" }));
    expect(resB.status).toBe(202);
    const jobB = resB.body.ifc_ready_job_id as string;

    // B 應為 queued_for_conversion 且 queue_position >= 1
    const bView = await request(app.app).get(`/api/external/ifc-ready/${jobB}`);
    expect(bView.body.status).toBe("queued_for_conversion");
    expect(bView.body.queue_position).toBeGreaterThanOrEqual(1);

    // Release A → dispatcher 完成 A 後取 B
    stub.releaseNext();
    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobA}`);
      return r.body.status === "dispatched";
    });
    // 等 stub 收到 B 的 dispatch body
    await waitFor(() => stub.bodies.length >= 2);
    stub.releaseNext();
    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobB}`);
      return r.body.status === "dispatched";
    });

    // 最終狀態:兩個都 dispatched,queue_position 都清空
    const finalA = await request(app.app).get(`/api/external/ifc-ready/${jobA}`);
    const finalB = await request(app.app).get(`/api/external/ifc-ready/${jobB}`);
    expect(finalA.body.status).toBe("dispatched");
    expect(finalA.body.queue_position).toBeNull();
    expect(finalB.body.status).toBe("dispatched");
    expect(finalB.body.queue_position).toBeNull();
    // stub 收到兩個 dispatch body
    expect(stub.bodies.length).toBe(2);
  });

  it("第一個 dispatch 失敗時第二個仍會 dispatch", async () => {
    // streaming server 永遠回 500 → 第一個 dispatch_failed,第二個也是 dispatch_failed
    // 但兩個都應被 worker 處理(stub.bodies 收到 2 個 POST)
    const bodies: unknown[] = [];
    activeStub = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
        let body = "";
        req.on("data", (c) => {
          body += c.toString("utf8");
        });
        req.on("end", () => {
          bodies.push(JSON.parse(body));
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "stub failure" }));
        });
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => activeStub?.listen(0, "127.0.0.1", () => r()));
    const addr = activeStub.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    const stubBase = `http://127.0.0.1:${addr.port}`;

    const app = makeApp({ streamingConversionApiBase: stubBase });
    const resA = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_failtwo_A", "idem_failtwo_A"))
      .send(payload());
    const resB = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_failtwo_B", "idem_failtwo_B"))
      .send(payload({ external_model_version_id: "ext_mv_failtwo_B" }));

    await waitFor(async () => {
      const a = await request(app.app).get(`/api/external/ifc-ready/${resA.body.ifc_ready_job_id}`);
      const b = await request(app.app).get(`/api/external/ifc-ready/${resB.body.ifc_ready_job_id}`);
      return a.body.status === "dispatch_failed" && b.body.status === "dispatch_failed";
    });

    // 兩個都被 worker 處理過(stub 收到 2 個 POST)→ A 失敗不卡 B
    expect(bodies.length).toBe(2);
  });

  it("派工失敗後狀態為 dispatch_failed，且 pending 保留不自動再派工（delete-on-success 半段）", async () => {
    let callCount = 0;
    activeStub = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
        let body = "";
        req.on("data", (c) => {
          body += c.toString("utf8");
        });
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

    // pending 保留證據（直接斷言）：透過 test-only accessor 確認 dispatch_failed job
    // 的 pending 仍在 map。這是 falsifiable 的核心斷言——若 app.ts 回到「失敗就刪
    // pending」的舊行為，這行會直接 fail（callCount/status 那兩個間接斷言無法區分
    // 「pending 保留」與「pending 被刪但沒人再 enqueue」）。
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(app.hasPendingDispatch(jobId)).toBe(true);
    // 輔助斷言：worker 已 shift，保留 pending 不會自動重派 → callCount 維持 1、狀態續為
    // dispatch_failed。retry 重派的 round-trip 由 Task 2 route 測試驗。
    expect(callCount).toBe(1);
    const after = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
    expect(after.body.status).toBe("dispatch_failed");

    // dispose 必須清掉 dispatch_failed job 殘留的 pending(drain 只回收 queued,
    // dispatch_failed 的 pending 不在 drain 範圍;Task 2 retry route 尚未實作前無人
    // 清,dispose 全清杜絕 process lifecycle 結束時的 map 累積)。
    await app.dispose();
    expect(app.hasPendingDispatch(jobId)).toBe(false);
  });
});

describe("Restart drop semantics", () => {
  it("queue.drain() 之後 marked dropped_on_restart helper 行為由 store 表達", () => {
    // 純 unit:queue.drain() 回 dropped ids;app.ts 由它 mark store。
    const queue = new ConversionDispatchQueue();
    queue.setDispatcher(async () => {
      throw new Error("dispatcher should not be invoked in this test");
    });
    // 不 setDispatcher 之前 enqueue: worker run 但 dispatcher==null → 推回 queue
    const fresh = new ConversionDispatchQueue();
    fresh.enqueue("X");
    fresh.enqueue("Y");
    const dropped = fresh.drain();
    expect(dropped).toEqual(["X", "Y"]);
    expect(fresh.getQueuedJobIds()).toEqual([]);
  });

  // Review feedback(HIGH #2):dispose() 必須真實觸發 markDroppedOnRestart,
  // 才能讓 spec scenario「Coordinator restart drops queued jobs」不只是 hollow
  // helper(原本 markDroppedOnRestart 只在 store 有 method,但 app lifecycle
  // 沒接線)。
  it("app.dispose() 把佇列中未派工 job 標 dropped_on_restart", async () => {
    // controllable stub:回 202 但 hold response 等 release,造成 in-flight 卡住
    const stub = await startControllableStreamingStub();
    const app = makeApp({ streamingConversionApiBase: stub.baseUrl });

    // POST A:讓它 in-flight(stub 不 release)
    const resA = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_dispose_A", "idem_dispose_A"))
      .send(payload());
    expect(resA.status).toBe(202);
    const jobA = resA.body.ifc_ready_job_id as string;
    await waitFor(() => stub.bodies.length >= 1);

    // POST B、C:這兩個應該停在 queued_for_conversion
    const resB = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_dispose_B", "idem_dispose_B"))
      .send(payload({ external_model_version_id: "ext_mv_dispose_B" }));
    const resC = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_dispose_C", "idem_dispose_C"))
      .send(payload({ external_model_version_id: "ext_mv_dispose_C" }));
    const jobB = resB.body.ifc_ready_job_id as string;
    const jobC = resC.body.ifc_ready_job_id as string;

    // 驗 B / C 為 queued_for_conversion
    const bView = await request(app.app).get(`/api/external/ifc-ready/${jobB}`);
    const cView = await request(app.app).get(`/api/external/ifc-ready/${jobC}`);
    expect(bView.body.status).toBe("queued_for_conversion");
    expect(cView.body.status).toBe("queued_for_conversion");

    // 觸發 dispose(模擬 coordinator process shutdown / restart 準備動作)
    await app.dispose();

    // dispose 之後 B / C 應該被標 dropped_on_restart;A 仍 in-flight(dispose
    // 不會強制中斷已 in-flight 的 dispatcher 呼叫)。
    const bAfter = await request(app.app).get(`/api/external/ifc-ready/${jobB}`);
    const cAfter = await request(app.app).get(`/api/external/ifc-ready/${jobC}`);
    expect(bAfter.body.status).toBe("dropped_on_restart");
    expect(bAfter.body.queue_position).toBeNull();
    expect(cAfter.body.status).toBe("dropped_on_restart");
    expect(cAfter.body.queue_position).toBeNull();

    // A 在 in-flight 期間 dispose,不會被 mark dropped(只 queued 被影響)
    const aAfter = await request(app.app).get(`/api/external/ifc-ready/${jobA}`);
    expect(aAfter.body.status).not.toBe("dropped_on_restart");

    // teardown release 讓 stub 完成,避免 dangling promise
    stub.releaseNext();
  });
});
