import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// B-scheme（local-coordinator-ifc-ready-intake-boundary T3 §4.5）契約測試。
// 契約權威 = repo-root tests/contracts/ifc_ready_payload.json（凍結契約，
// 與 OQ pending 緩解一致）。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json");
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as {
  example: Record<string, unknown>;
  worker_compatibility_example: { payload: Record<string, unknown> };
};

const WEBHOOK_SECRET = "dev-webhook-secret"; // = config 預設（環境設定，非契約資料）

let active: CoordinatorApp | null = null;
let activeStreamingServer: http.Server | null = null;
// harden-coordinator-ifc-intake:strict download test 用的 IFC source stub。
let activeIfcSourceServer: http.Server | null = null;

afterEach(async () => {
  if (activeStreamingServer) {
    await new Promise<void>((resolve) => activeStreamingServer?.close(() => resolve()));
    activeStreamingServer = null;
  }
  if (activeIfcSourceServer) {
    await new Promise<void>((resolve) => activeIfcSourceServer?.close(() => resolve()));
    activeIfcSourceServer = null;
  }
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-ifcready-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    // streaming 不可達 → 內部派工失敗應 graceful（job dispatch_failed，仍 202）
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(CONTRACT.example), ...overrides };
}

function authHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": "corr_test_001",
    "X-Idempotency-Key": "idem_test_001",
    ...overrides,
  };
}

/**
 * coordinator-serial-conversion-dispatch-queue:dispatch 改為 in-memory queue
 * 非同步處理,POST response 立即帶 status="queued_for_conversion"。test 需要
 * 等 worker 把 in-flight job 推進到 dispatched / dispatch_failed 才 assert。
 */
async function waitForDispatchEnd(
  appHandle: CoordinatorApp,
  jobId: string,
  expectedStatuses: string[] = ["dispatched", "dispatch_failed", "failed"],
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(appHandle.app).get(`/api/external/ifc-ready/${jobId}`);
    if (res.status === 200 && typeof res.body?.status === "string" && expectedStatuses.includes(res.body.status)) {
      return res.body as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${jobId} did not reach ${expectedStatuses.join("/")} within ${timeoutMs}ms`);
}

async function startStreamingConversionStub(): Promise<{ baseUrl: string; bodies: unknown[] }> {
  const bodies: unknown[] = [];
  activeStreamingServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
        bodies.push(JSON.parse(body));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ conversion_job_id: "stream_conv_test_001", status: "queued", authority: "bim-streaming-server" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "not found" }));
    });
  });
  await new Promise<void>((resolve) => {
    activeStreamingServer?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = activeStreamingServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected streaming conversion stub to listen on a TCP port.");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, bodies };
}

// harden-coordinator-ifc-intake:回 non-2xx 的 IFC source stub。source_ifc.ref 指向
// 它(http scheme,非 edge-local/minio——否則 downloader 走 placeholder 繞開 fetch),
// strict 模式下 coordinator 同步下載拿到 non-2xx → 502,不 dispatch。
async function startNon2xxIfcSourceStub(status = 404): Promise<{ ifcUrl: string }> {
  activeIfcSourceServer = http.createServer((_req, res) => {
    res.writeHead(status, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => {
    activeIfcSourceServer?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = activeIfcSourceServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected IFC source stub to listen on a TCP port.");
  }
  return { ifcUrl: `http://127.0.0.1:${address.port}/edge/source.ifc` };
}

describe("POST /api/external/ifc-ready", () => {
  it("接受 spec-correct ifc-ready，建立本地 job 並綁定 external_model_version_id", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders())
      .send(payload());

    expect(res.status).toBe(202);
    expect(res.body.ifc_ready_job_id).toMatch(/^ifcready_/);
    expect(res.body.idempotent_replay).toBe(false);
    expect(res.body.external_model_version_id).toBe(CONTRACT.example.external_model_version_id);
    expect(res.body.correlation_id).toBe("corr_test_001");
    expect(res.body.source_ifc_ref).toBe((CONTRACT.example.source_ifc as { ref: string }).ref);
    // coordinator-serial-conversion-dispatch-queue:POST 回應現為 async dispatch
    // 階段(queued_for_conversion);streaming 不可達 → worker 拋 error → 標 dispatch_failed。
    const final = await waitForDispatchEnd(app, res.body.ifc_ready_job_id as string, ["dispatch_failed"]);
    expect(final.status).toBe("dispatch_failed");
    expect(final.conversion_authority).toBeNull();
  });

  it("lists recent IFC-ready jobs with dashboard-safe progress fields", async () => {
    const streaming = await startStreamingConversionStub();
    const app = makeApp({ streamingConversionApiBase: streaming.baseUrl });

    const first = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Correlation-Id": "corr_list_001", "X-Idempotency-Key": "idem_list_001" }))
      .send(payload());
    const second = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Correlation-Id": "corr_list_002", "X-Idempotency-Key": "idem_list_002" }))
      .send(payload({ external_model_version_id: "ext_mv_demo_002" }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    // coordinator-serial-conversion-dispatch-queue:等兩個 jobs 都被 worker
    // 推進到 dispatched(streaming stub 立即回 202),再 query listed。
    await waitForDispatchEnd(app, first.body.ifc_ready_job_id);
    await waitForDispatchEnd(app, second.body.ifc_ready_job_id);

    const listed = await request(app.app).get("/api/external/ifc-ready?limit=1");

    expect(listed.status).toBe(200);
    expect(listed.body.count).toBe(2);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      ifc_ready_job_id: second.body.ifc_ready_job_id,
      download_status: "downloaded",
      conversion_job_id: "stream_conv_test_001",
      conversion_status: "queued",
      conversion_authority: "bim-streaming-server",
      web_view_session_id: null,
      viewer_url: null,
    });
    expect(listed.body.items[0]).not.toHaveProperty("idempotency_key");
    expect(listed.body.items[0]).not.toHaveProperty("callback_url");
  });

  it("對相同 X-Idempotency-Key 為 idempotent（回相同 job、replay 標記）", async () => {
    const app = makeApp();
    const first = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders())
      .send(payload());
    const second = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders())
      .send(payload());

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.idempotent_replay).toBe(true);
    expect(second.body.ifc_ready_job_id).toBe(first.body.ifc_ready_job_id);
  });

  it("缺少 X-Webhook-Secret → 401，且不建立 job", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set({ "X-Correlation-Id": "c1", "X-Idempotency-Key": "i1" })
      .send(payload());
    expect(res.status).toBe(401);
  });

  it("錯誤的 X-Webhook-Secret → 401", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Webhook-Secret": "wrong-secret" }))
      .send(payload());
    expect(res.status).toBe(401);
  });

  it("缺少 X-Correlation-Id → 401", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set({ "X-Webhook-Secret": WEBHOOK_SECRET, "X-Idempotency-Key": "i1" })
      .send(payload());
    expect(res.status).toBe(401);
  });

  it("缺少 source_ifc → 400（payload 驗證）", async () => {
    const app = makeApp();
    const bad = payload();
    delete (bad as Record<string, unknown>).source_ifc;
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders())
      .send(bad);
    expect(res.status).toBe(400);
  });

  it("成功呼叫 streaming internal conversion API 後標記 dispatched", async () => {
    const streaming = await startStreamingConversionStub();
    const app = makeApp({ streamingConversionApiBase: streaming.baseUrl });

    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders())
      .send(payload());

    expect(res.status).toBe(202);
    // coordinator-serial-conversion-dispatch-queue:wait for worker to dispatch.
    const final = await waitForDispatchEnd(app, res.body.ifc_ready_job_id as string, ["dispatched"]);
    expect(final.status).toBe("dispatched");
    expect(final.conversion_job_id).toBe("stream_conv_test_001");
    expect(final.conversion_authority).toBe("bim-streaming-server");
    expect(streaming.bodies).toHaveLength(1);
    expect((streaming.bodies[0] as Record<string, unknown>).event_type).toBe("ifc_ready");
  });

  it("X-Webhook-Signature 使用原始 body bytes 驗證", async () => {
    const app = makeApp();
    const rawBody = JSON.stringify(payload(), null, 2);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set({
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Correlation-Id": "corr_hmac_001",
        "X-Idempotency-Key": "idem_hmac_001",
      })
      .send(rawBody);

    expect(res.status).toBe(202);
    expect(res.body.correlation_id).toBe("corr_hmac_001");
  });

  it("拒絕不在公司雲端同 origin 的 callback_url", async () => {
    const app = makeApp({
      cloudCallbackBaseUrl: "https://company-cloud.example/api/bim-control/conversion-callbacks",
    });
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders())
      .send(payload({ callback_url: "http://169.254.169.254/latest/meta-data" }));

    expect(res.status).toBe(403);
  });

  // harden-coordinator-ifc-intake:strict 模式(IFC_DOWNLOAD_STRICT=true →
  // fallbackOnFetchError=false)下,http scheme 的 source_ifc.ref 真實下載拿到
  // non-2xx 必須回 502 + download_status:"failed",且**不** dispatch streaming-server。
  // source_ifc.ref 用 http(非 edge-local/minio)否則 downloader 走 placeholder 繞開 fetch。
  it("strict 下 http source 回 non-2xx → 502 download failed 且不 dispatch", async () => {
    const streaming = await startStreamingConversionStub();
    const source = await startNon2xxIfcSourceStub(404);
    const app = makeApp({
      ifcDownloadStrict: true,
      streamingConversionApiBase: streaming.baseUrl,
    });

    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders())
      .send(
        payload({
          source_ifc: {
            ref: source.ifcUrl,
            etag: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
            filename: "demo-model.ifc",
            format: "ifc",
          },
        }),
      );

    expect(res.status).toBe(502);
    expect(res.body.download_status).toBe("failed");
    // strict-fail 在 enqueue 之前 return,給一小段時間確認沒有 stray dispatch。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streaming.bodies).toHaveLength(0);
  });
});

// backfill-coordinator-webhook-and-auto-session §1：worker compatibility payload
// 規格權威：openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md
// §"Coordinator accepts worker ifc-ready compatibility payload"
describe("POST /api/external/ifc-ready (worker compatibility payload)", () => {
  function workerPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      status: "ifc_ready",
      ifc_path: "http://edge-internal.example/storage/demo-model.ifc",
      project_id: "project_worker_001",
      version: "ver_worker_001",
      task_id: "task_worker_001",
      ...overrides,
    };
  }

  function workerAuthHeaders(overrides: Record<string, string> = {}): Record<string, string> {
    // worker payload 預設不帶 X-Correlation-Id / X-Idempotency-Key；由 task_id 派生。
    return {
      "X-Webhook-Secret": WEBHOOK_SECRET,
      ...overrides,
    };
  }

  it("contract captures the image-derived absolute IFC URL worker payload", () => {
    expect(CONTRACT.worker_compatibility_example.payload).toEqual({
      status: "ifc_ready",
      ifc_path: "http://192.168.20.234:9000/bim-control/899/xxx/model.ifc",
      project_id: "899",
      version: "xxx",
      task_id: "task_img_001",
    });
  });

  it("accepts image-derived IFCWorker payload with absolute S3 URL shape", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(CONTRACT.worker_compatibility_example.payload);

    expect(res.status).toBe(202);
    expect(res.body.external_model_version_id).toBe("xxx");
    expect(res.body.external_conversion_task_id).toBe("task_img_001");
    expect(res.body.source_ifc_ref).toBe("http://192.168.20.234:9000/bim-control/899/xxx/model.ifc");
    expect(res.body.correlation_id).toBe("worker:899::xxx::task_img_001");
  });

  it("worker payload is accepted and normalized → 202 with canonical fields", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(workerPayload());

    expect(res.status).toBe(202);
    expect(res.body.ifc_ready_job_id).toMatch(/^ifcready_/);
    // version → external_model_version_id
    expect(res.body.external_model_version_id).toBe("ver_worker_001");
    // task_id → external_conversion_task_id
    expect(res.body.external_conversion_task_id).toBe("task_worker_001");
    // ifc_path → source_ifc.ref
    expect(res.body.source_ifc_ref).toBe("http://edge-internal.example/storage/demo-model.ifc");
    // 派生 correlation_id 從 project_id+version+task_id
    expect(res.body.correlation_id).toMatch(/^worker:project_worker_001::ver_worker_001::task_worker_001$/);
  });

  it("non-ready worker status → 4xx，不建 local job 也不 dispatch", async () => {
    const streaming = await startStreamingConversionStub();
    const app = makeApp({ streamingConversionApiBase: streaming.baseUrl });
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(workerPayload({ status: "ifc_pending" }));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // dispatch 不可被觸發
    expect(streaming.bodies).toHaveLength(0);
  });

  it("worker payload 缺 ifc_path → 4xx，無 partial shadow metadata", async () => {
    const app = makeApp();
    const bad = workerPayload();
    delete (bad as Record<string, unknown>).ifc_path;
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(bad);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("worker payload 缺 task_id → 4xx", async () => {
    const app = makeApp();
    const bad = workerPayload();
    delete (bad as Record<string, unknown>).task_id;
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(bad);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("worker 缺 X-Correlation-Id / X-Idempotency-Key 時從 project_id+version+task_id 派生穩定 idempotency", async () => {
    const app = makeApp();
    const first = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(workerPayload());
    const second = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(workerPayload());

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.idempotent_replay).toBe(true);
    expect(second.body.ifc_ready_job_id).toBe(first.body.ifc_ready_job_id);
  });

  it("explicit X-Correlation-Id 優先於 task_id 派生", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders({
        "X-Correlation-Id": "explicit_corr_999",
        "X-Idempotency-Key": "explicit_idem_999",
      }))
      .send(workerPayload());

    expect(res.status).toBe(202);
    expect(res.body.correlation_id).toBe("explicit_corr_999");
    expect(res.body.idempotency_key).toBe("explicit_idem_999");
  });

  it("worker payload 經 normalize 後 dispatch 給 streaming 仍走 canonical shape，不洩漏 worker 形狀", async () => {
    const streaming = await startStreamingConversionStub();
    const app = makeApp({ streamingConversionApiBase: streaming.baseUrl });
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(workerPayload());

    expect(res.status).toBe(202);
    // coordinator-serial-conversion-dispatch-queue:等 worker 完成 dispatch。
    await waitForDispatchEnd(app, res.body.ifc_ready_job_id as string, ["dispatched"]);
    expect(streaming.bodies).toHaveLength(1);
    const dispatched = streaming.bodies[0] as Record<string, unknown>;
    // canonical streaming internal contract
    expect(dispatched.event_type).toBe("ifc_ready");
    expect(dispatched.external_model_version_id).toBe("ver_worker_001");
    expect(dispatched.external_conversion_task_id).toBe("task_worker_001");
    // 不洩漏 worker 形狀
    expect(dispatched.status).toBeUndefined();
    expect(dispatched.ifc_path).toBeUndefined();
    expect(dispatched.version).toBeUndefined();
    expect(dispatched.task_id).toBeUndefined();
  });
});
