import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// conv-prioritize-retry §6.3:協調器自有 dispatch 佇列的 controlled action route 測試。
// harness 逐字沿用 conversion-dispatch-queue.test.ts（CONTRACT / makeApp / authHeaders /
// payload / waitFor / startControllableStreamingStub），保持 active/activeStub afterEach 清理。

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-control-test-"));
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
  const pendingSends: Array<() => void> = [];
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

describe("conversion control routes — prioritize", () => {
  it("A in-flight、B/C queued → prioritize C → queued_order C 在 B 前，store position 重算", async () => {
    const stub = await startControllableStreamingStub();
    const app = makeApp({ streamingConversionApiBase: stub.baseUrl });
    // A 進件 → in-flight（stub 不 release）
    await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_p_A", "idem_p_A")).send(payload());
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
        let body = "";
        req.on("data", (c) => {
          body += c.toString("utf8");
        });
        req.on("end", () => {
          n += 1;
          if (n === 1) {
            res.writeHead(500).end(JSON.stringify({ detail: "fail" }));
          } else {
            res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ conversion_job_id: "stream_conv_retry", status: "queued", authority: "bim-streaming-server" }));
          }
        });
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => activeStub?.listen(0, "127.0.0.1", () => r()));
    const addr = activeStub.address();
    if (!addr || typeof addr === "string") throw new Error("bind");
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
    await waitFor(() => stub.bodies.length >= 1);
    stub.releaseNext();
    await waitFor(async () => (await request(app.app).get(`/api/external/ifc-ready/${jobA}`)).body.status === "dispatched");
    const res = await request(app.app).post(`/api/conversion/jobs/${jobA}/retry`).send({});
    expect(res.status).toBe(409);
  });
});
