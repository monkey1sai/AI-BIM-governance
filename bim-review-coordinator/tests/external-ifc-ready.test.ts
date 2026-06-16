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

// conv-prioritize-retry (cr1 BLOCKER 2 回歸鎖):serial dispatch worker 只有單一
// in-flight slot。此 stub 對第一個 POST /api/conversions/ifc-to-usdc **永不回應**
// (hang),讓 in-flight job 卡住 → 後續 job 停在 queued_for_conversion + 正值
// queue_position,供列表端點驗證 wire 的完整三段語意(null / 0 / ≥1)。
// release() 在 afterEach 之前釋放 hang 的 socket,避免 server.close 卡住。
async function startBlockingStreamingConversionStub(): Promise<{ baseUrl: string; release: () => void }> {
  const heldSockets: import("node:net").Socket[] = [];
  activeStreamingServer = http.createServer((req) => {
    if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
      // 故意不寫 response:in-flight dispatch 永久卡在 await fetch。
      heldSockets.push(req.socket);
    }
  });
  await new Promise<void>((resolve) => {
    activeStreamingServer?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = activeStreamingServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected blocking streaming conversion stub to listen on a TCP port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    release: () => {
      for (const socket of heldSockets) socket.destroy();
    },
  };
}

// conv-prioritize-retry (cr1 BLOCKER 2 回歸鎖):輪詢列表端點直到指定 job 進入
// queued_for_conversion 狀態(被 blocking stub 卡在 in-flight 之後的 queued slot)。
async function waitForListedQueueStatus(
  appHandle: CoordinatorApp,
  jobId: string,
  status: string,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const listed = await request(appHandle.app).get("/api/external/ifc-ready");
    const items = (listed.body?.items ?? []) as Array<Record<string, unknown>>;
    const item = items.find((entry) => entry.ifc_ready_job_id === jobId);
    if (item && item.status === status) return item;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${jobId} did not reach listed status '${status}' within ${timeoutMs}ms`);
}

// mv1/mv2/mv2b/st1（指揮官審計 + 對抗複驗）：對齊真 conversion_authority.py
// StreamingConversionStore.create_conversion_job 的完整 _safe_id 驗證面——
// required：event_id(:238)、idempotency_key(:239，缺省 fallback 到 event_id)、
// correlation_id(:261)、tenant_id(:262)、project_id(:263)、model_version_id(:264)、
// ifc_artifact.artifact_id(_ifc_artifact)；optional（None/空字串放行，比照
// _safe_optional_id）：export_job_id(:265)、source_rvt_artifact_id(:266-268)。
// 任一非 safe → 400（同真 API ValueError → 400）。
async function startSafeIdValidatingStub(): Promise<{ baseUrl: string; bodies: unknown[] }> {
  const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;
  const bodies: unknown[] = [];
  activeStreamingServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c.toString("utf8")));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/api/conversions/ifc-to-usdc") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "not found" }));
        return;
      }
      const parsed = JSON.parse(body || "{}") as Record<string, any>;
      bodies.push(parsed);
      // 真 API 對 event_id 先跑 _safe_id（:238），idempotency_key 缺省 fallback 到
      // event_id（:239）；模仿其求值順序，缺省同樣 fallback。
      const eventId = String(parsed?.event_id ?? "");
      const idempotencyKey = String(parsed?.idempotency_key || eventId);
      const requiredSafeIdFields: Record<string, unknown> = {
        event_id: eventId,
        idempotency_key: idempotencyKey,
        ifc_artifact_id: parsed?.ifc_artifact?.artifact_id ?? "",
        model_version_id: parsed?.model_version_id ?? "",
        correlation_id: parsed?.correlation_id ?? "",
        tenant_id: parsed?.tenant_id ?? "",
        project_id: parsed?.project_id ?? "",
      };
      for (const [label, value] of Object.entries(requiredSafeIdFields)) {
        if (typeof value !== "string" || !SAFE_ID_RE.test(value)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: `Invalid ${label}: ${String(value)}` }));
          return;
        }
      }
      // optional id（_safe_optional_id）：None / "" 放行；有值才驗 SAFE_ID_RE。
      const optionalSafeIdFields: Record<string, unknown> = {
        export_job_id: parsed?.export_job_id,
        source_rvt_artifact_id: parsed?.source_rvt_artifact_id,
      };
      for (const [label, value] of Object.entries(optionalSafeIdFields)) {
        if (value === undefined || value === null || value === "") continue;
        if (typeof value !== "string" || !SAFE_ID_RE.test(value)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: `Invalid ${label}: ${String(value)}` }));
          return;
        }
      }
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ conversion_job_id: "stream_conv_safeid", status: "queued", authority: "bim-streaming-server" }),
      );
    });
  });
  await new Promise<void>((resolve) => activeStreamingServer?.listen(0, "127.0.0.1", () => resolve()));
  const address = activeStreamingServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected safe-id validating stub to listen on a TCP port.");
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
      queue_position: null,   // conv-prioritize-retry:additive 上 wire（已派工 → null）
      web_view_session_id: null,
      viewer_url: null,
    });
    expect(listed.body.items[0]).not.toHaveProperty("idempotency_key");
    expect(listed.body.items[0]).not.toHaveProperty("callback_url");
    // conv-prioritize-retry (cr1 BLOCKER 2 回歸鎖):列表端點 summarizeIfcReadyJob 必須上 wire
    // queue_position(dispatched 後為 null);否則 #conv 經列表取件時插隊鈕 disabled 條件失效。
    expect(listed.body.items[0]).toHaveProperty("queue_position");
    expect(listed.body.items[0].queue_position).toBeNull();
  });

  it("列表端點對 queued_for_conversion job 回傳正值 queue_position（鎖住 wire 完整三段語意）", async () => {
    // conv-prioritize-retry (cr1 BLOCKER 2 回歸鎖 / spec §4.3):serial worker 單一 in-flight
    // slot。第一個 job 被 blocking stub 卡在 in-flight,第二個 job 停在 queued_for_conversion
    // 且 queue_position=1。鎖住「summarizeIfcReadyJob 不可把 queued job 的正值 queue_position
    // 截掉」——若未來誤改成只在 dispatched 才上 wire,此測試會抓到。
    const blocking = await startBlockingStreamingConversionStub();
    const app = makeApp({ streamingConversionApiBase: blocking.baseUrl });

    const first = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Correlation-Id": "corr_queue_001", "X-Idempotency-Key": "idem_queue_001" }))
      .send(payload());
    const second = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Correlation-Id": "corr_queue_002", "X-Idempotency-Key": "idem_queue_002" }))
      .send(payload({ external_model_version_id: "ext_mv_queue_002" }));

    try {
      // POST 斷言移入 try：blocking stub 已持有 hang 的 in-flight socket,任一斷言
      // (含這兩個 202)失敗都必須走 finally 的 blocking.release(),否則 afterEach 的
      // server.close() 會等不到 keep-alive socket 銷毀而 hang 到 runner timeout。
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);

      // first job 卡在 in-flight(blocking stub 永不回應);second job 排在其後 → 列表端點
      // 必須對 second 回 queue_position=1(in-flight 之後第一個 queued slot)。
      const queuedItem = await waitForListedQueueStatus(
        app,
        second.body.ifc_ready_job_id as string,
        "queued_for_conversion",
      );
      expect(queuedItem).toHaveProperty("queue_position");
      expect(queuedItem.queue_position).toBe(1);

      // in-flight 的 first job 在列表端點同樣上 wire queue_position(0=派工中),
      // 與 queued(≥1)、dispatched(null)合成完整三段語意。
      // NOTE(時序假設):此處 queue_position=0 依賴 runWorker 的同步 shift 語意
      // (conversionDispatchQueue.ts:107-108 在第一個 await dispatcher 之前同步
      // 完成 shift + inFlightJobId=jobId)。此非 race condition——blocking stub
      // 確保 first job 永久卡在 in-flight,getQueuePosition 必回 0。若未來把
      // runWorker 的 shift 移入 setImmediate/queueMicrotask 包裝,此斷言會先失效
      // (store 寫成 1 而非 0),屆時請改的是 worker 時序假設而非此測試。
      const listed = await request(app.app).get("/api/external/ifc-ready");
      const firstItem = (listed.body.items as Array<Record<string, unknown>>).find(
        (entry) => entry.ifc_ready_job_id === first.body.ifc_ready_job_id,
      );
      expect(firstItem).toBeDefined();
      expect(firstItem).toHaveProperty("queue_position");
      expect(firstItem?.queue_position).toBe(0);
    } finally {
      // 釋放 hang 的 socket,讓 afterEach 的 server.close 不卡。
      blocking.release();
    }
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
    // #9 review fix:pin 502 來自 HTTP non-2xx(reason=http_status),而非 timeout /
    // invalid_source_ref 等其他 download 失敗——否則 strict 接線 regress 成別的原因
    // 仍會綠,失去「non-2xx 必須不被吞掉」的保護意義。
    expect(res.body.reason).toBe("http_status");
    // strict-fail 在 enqueue 之前 return,給一小段時間確認沒有 stray dispatch。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streaming.bodies).toHaveLength(0);
  });

  // #9 review fix(對稱保護網):non-strict 預設下,同一個 http non-2xx source MUST
  // 維持既有 fallback——回 placeholder、202 accepted、且照常 dispatch streaming-server。
  // 這條鎖住「strict 接線不破壞 demo loop」:若未來有人翻轉 default 或 invert
  // !config.ifcDownloadStrict,本測試會紅。
  it("non-strict(預設)下 http source 回 non-2xx → placeholder fallback → 202 且照常 dispatch", async () => {
    const streaming = await startStreamingConversionStub();
    const source = await startNon2xxIfcSourceStub(404);
    const app = makeApp({
      ifcDownloadStrict: false,
      streamingConversionApiBase: streaming.baseUrl,
    });

    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders())
      .send(
        payload({
          source_ifc: {
            ref: source.ifcUrl,
            etag: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
            filename: "demo-model.ifc",
            format: "ifc",
          },
        }),
      );

    expect(res.status).toBe(202);
    expect(res.body.download_status).not.toBe("failed");
    // fallback 走 placeholder → 照常 enqueue dispatch；給一小段時間讓 in-process queue 派工。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streaming.bodies.length).toBeGreaterThan(0);
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

  it("中文 external_model_version_id 的 dispatch 不再被 conversion 端 SAFE_ID_RE 擋成 400", async () => {
    // conversion-artifact-id-sanitize（spec 2026-06-11 §4）：以 conversion 端逐字同款
    // 規則驗收 ifc_artifact.artifact_id；中文 id 經 coordinator sanitize 後必須通過，
    // 證明 dispatch 不再被 400 擋下（job 走到 dispatched，dispatch_error 為 null）。
    const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;
    activeStreamingServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        // mv1（指揮官實證根治缺口）：stub 升級為對齊真 conversion_authority.py:261-264
        // 的 _safe_id 驗證面——model_version_id / correlation_id / tenant_id / project_id
        // 全跑 SAFE_ID_RE，外加 ifc_artifact.artifact_id（_ifc_artifact）。任一非 safe → 400，
        // 比照真 API ValueError → 400。
        const safeIdFields: Record<string, unknown> = {
          ifc_artifact_id: parsed?.ifc_artifact?.artifact_id ?? "",
          model_version_id: parsed?.model_version_id ?? "",
          correlation_id: parsed?.correlation_id ?? "",
          tenant_id: parsed?.tenant_id ?? "",
          project_id: parsed?.project_id ?? "",
        };
        for (const [label, value] of Object.entries(safeIdFields)) {
          if (typeof value !== "string" || !SAFE_ID_RE.test(value)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: `Invalid ${label}: ${String(value)}` }));
            return;
          }
        }
        // 真 conversion API 受理回 202 Accepted（stub 對齊真 API 行為）。
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            conversion_job_id: "stream_conv_cjk",
            status: "queued",
            authority: "bim-streaming-server",
          }),
        );
      });
    });
    await new Promise<void>((r) => activeStreamingServer!.listen(0, "127.0.0.1", () => r()));
    const convAddress = activeStreamingServer.address();
    if (!convAddress || typeof convAddress === "string") {
      throw new Error("Expected conversion stub to listen on a TCP port.");
    }

    // stub IFC source server 回最小 IFC bytes，讓 non-strict download 成功。
    activeIfcSourceServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
    });
    await new Promise<void>((r) => activeIfcSourceServer!.listen(0, "127.0.0.1", () => r()));
    const srcAddress = activeIfcSourceServer.address();
    if (!srcAddress || typeof srcAddress === "string") {
      throw new Error("Expected IFC source stub to listen on a TCP port.");
    }
    const ifcRef = `http://127.0.0.1:${srcAddress.port}/edge/271_pieple.ifc`;

    const app = makeApp({ streamingConversionApiBase: `http://127.0.0.1:${convAddress.port}` });

    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(
        authHeaders({
          "X-Correlation-Id": "corr_cjk_001",
          "X-Idempotency-Key": "idem_cjk_001",
        }),
      )
      .send(
        payload({
          external_model_version_id: "271_pieple_管線",
          source_ifc: {
            ref: ifcRef,
            etag: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            filename: "271_pieple.ifc",
            format: "ifc",
          },
        }),
      );

    expect(res.status).toBe(202);
    // dispatch 終態走 top-level status（summarizeIfcReadyJob 的 dispatch 生命週期欄位）；
    // 中文 id 通過 sanitize 後 conversion 端不再 400 → dispatched，dispatch_error 為 null。
    const detail = await waitForDispatchEnd(app, res.body.ifc_ready_job_id as string, ["dispatched"]);
    expect(detail.status).toBe("dispatched");
    expect(detail.dispatch_error).toBeNull();
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

  it("mv2：worker 派生含冒號 correlation_id 經 sanitize 後 dispatch 不再被 SAFE_ID_RE 擋成 400", async () => {
    // worker compat 缺 explicit X-Correlation-Id 時派生 `worker:project::version::task`（含冒號），
    // 冒號不在 conversion 端 SAFE_ID_RE；未 sanitize 則真 API 對 correlation_id 跑 _safe_id → 400。
    const streaming = await startSafeIdValidatingStub();
    const app = makeApp({ streamingConversionApiBase: streaming.baseUrl });
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(workerPayload());

    expect(res.status).toBe(202);
    // 派生 correlation_id 含冒號（對帳/回應用原始值）。
    expect(res.body.correlation_id).toBe("worker:project_worker_001::ver_worker_001::task_worker_001");
    // sanitize 後內部 correlation_id 通過嚴格 stub（= 真 API SAFE_ID_RE）→ dispatched，dispatch_error null。
    const detail = await waitForDispatchEnd(app, res.body.ifc_ready_job_id as string, ["dispatched"]);
    expect(detail.status).toBe("dispatched");
    expect(detail.dispatch_error).toBeNull();
    // 送出 payload 的內部 correlation_id 已 sanitize（無冒號）。
    const sent = streaming.bodies[0] as Record<string, unknown>;
    expect(sent.correlation_id).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("mv2b：worker compat 無 event_id 時派生的 event_id 已 sanitize（通過 SAFE_ID_RE，dispatch 不再 400）", async () => {
    // worker compat normalize（app.ts normalizeIntakePayload）不產 event_id，
    // 且 correlation_id 派生為含冒號的 `worker:project::version::task`。
    // toInternalIfcReadyEvent 的 event_id fallback 過去直接用原始 correlationId
    // （`evt_${binding.correlationId}`）→ 含冒號 → 真 conversion_authority.py:238
    // 對 event_id 跑 _safe_id 先炸成 400。此測試用「完整 _safe_id 驗證面」stub
    // （含 event_id / idempotency_key），鎖住派生 event_id 必須是 safe。
    const streaming = await startSafeIdValidatingStub();
    const app = makeApp({ streamingConversionApiBase: streaming.baseUrl });
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(workerAuthHeaders())
      .send(workerPayload());

    expect(res.status).toBe(202);
    const detail = await waitForDispatchEnd(app, res.body.ifc_ready_job_id as string, ["dispatched"]);
    expect(detail.status).toBe("dispatched");
    expect(detail.dispatch_error).toBeNull();
    // 實送 payload 的 event_id 已 sanitize（無冒號），通過 conversion 端 SAFE_ID_RE。
    const sent = streaming.bodies[0] as Record<string, unknown>;
    expect(typeof sent.event_id).toBe("string");
    expect(sent.event_id as string).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});
