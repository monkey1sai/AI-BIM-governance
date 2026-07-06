import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { createLogger, type StructLogger } from "../src/lib/structLog.js";

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

function makeApp(overrides: Partial<CoordinatorConfig> = {}, structLog?: StructLogger): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-control-test-"));
  active = createCoordinatorApp(
    {
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      streamingConversionApiBase: "http://127.0.0.1:1",
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      ...overrides,
    },
    structLog ? { structLog } : {},
  );
  return active;
}

/** 讀 audit-capable logger 寫出的 jsonl,回 event_type=audit 的 record 陣列。 */
function readAuditRecords(logger: StructLogger): Array<Record<string, unknown>> {
  const text = fs.readFileSync(logger.currentFile(), "utf-8").trim();
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((rec) => rec.event_type === "audit");
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
    expect(res.body.recovery_action).toBe("none");
  });

  it("dropped_on_restart（dispose 後 pending 脈絡確失）→ retry → 422「請重新進件」", async () => {
    // §4.2 / §6.3「retry：脈絡失效→422」。dispose() 把 queued job 標 dropped_on_restart
    // 並刪除其 pendingDispatchEvents 脈絡;此後 retry 雖然 status 合法(dropped_on_restart
    // ∈ 可重試)但 pending 確不存在 → 422,不假裝可重試。
    const stub = await startControllableStreamingStub();
    const app = makeApp({ streamingConversionApiBase: stub.baseUrl });
    // A in-flight(hold)→ B queued。
    await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_drop_A", "idem_drop_A")).send(payload());
    await waitFor(() => stub.bodies.length >= 1);
    const b = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_drop_B", "idem_drop_B")).send(payload({ external_model_version_id: "ext_drop_B" }));
    const jobB = b.body.ifc_ready_job_id as string;
    await waitFor(async () => (await request(app.app).get(`/api/external/ifc-ready/${jobB}`)).body.status === "queued_for_conversion");
    // dispose:drain queued → B 變 dropped_on_restart 且 pending 被刪。
    await app.dispose();
    const bAfter = await request(app.app).get(`/api/external/ifc-ready/${jobB}`);
    expect(bAfter.body.status).toBe("dropped_on_restart");
    // 狀態本身合法(否則會 409),但脈絡確失 → 422。
    const retry = await request(app.app).post(`/api/conversion/jobs/${jobB}/retry`).send({ reason: "after restart" });
    expect(retry.status).toBe(422);
    expect(retry.body.detail).toMatch(/re-POST|re-post|重新進件|context lost/i);
    stub.releaseNext(); // teardown：放行 in-flight A
  });

  it("prioritize / retry 成功時 reason 寫入 audit log（模式 3 ③）", async () => {
    // §2 第 4 點 + §6.3「reason 進 audit」:操作者 confirm 對話框填入的 reason 必須出現在
    // audit trail,而非僅 HTTP response。注入 tmp-dir logger 讀回 jsonl 驗 audit record。
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-control-audit-"));
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260616_120000_abc123", skipEnvSnapshot: true });
    const stub = await startControllableStreamingStub();
    const app = makeApp({ streamingConversionApiBase: stub.baseUrl }, logger);
    // A in-flight(hold)→ B/C queued,prioritize C(reason)。
    await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_aud_A", "idem_aud_A")).send(payload());
    await waitFor(() => stub.bodies.length >= 1);
    await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_aud_B", "idem_aud_B")).send(payload({ external_model_version_id: "ext_aud_B" }));
    const c = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_aud_C", "idem_aud_C")).send(payload({ external_model_version_id: "ext_aud_C" }));
    const jobC = c.body.ifc_ready_job_id as string;
    await waitFor(async () => (await request(app.app).get(`/api/external/ifc-ready/${jobC}`)).body.status === "queued_for_conversion");

    const res = await request(app.app).post(`/api/conversion/jobs/${jobC}/prioritize`).send({ reason: "very urgent client demo" });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe("very urgent client demo");

    const audits = readAuditRecords(logger);
    const prioritizeAudit = audits.find((rec) => (rec.data as Record<string, unknown>)?.action === "conversion.prioritize");
    expect(prioritizeAudit).toBeDefined();
    const auditData = prioritizeAudit!.data as Record<string, unknown>;
    expect(auditData.action).toBe("conversion.prioritize");
    expect(auditData.target).toBe(jobC);
    expect(auditData.reason).toBe("very urgent client demo");
    expect(auditData.actor).toBe("local-operator");
    stub.releaseNext(); // teardown
  });
});

describe("conversion control routes — IP 守門（IMPORTANT 1）", () => {
  // 兩條控制路由是協調器 control-plane 的 mutation surface;AGENTS.md MUST NOT 禁止
  // 「外部公司雲端 control-plane 取代」。沿用 /api/external/ifc-ready 的 IP allowlist
  // 模式(isIpAllowed + externalIntakeIpAllowlist)阻擋非本地請求。supertest 走 loopback,
  // 故把 allowlist 設成排除 loopback 的網段 → 預期 403(在 id 驗證之前先擋)。
  it("prioritize：caller IP 不在 allowlist → 403（在 id/state 檢查之前）", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: ["10.0.0.0/8"] });
    const res = await request(app.app).post(`/api/conversion/jobs/ifcready_anything/prioritize`).send({});
    expect(res.status).toBe(403);
  });
  it("retry：caller IP 不在 allowlist → 403（在 id/state 檢查之前）", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: ["10.0.0.0/8"] });
    const res = await request(app.app).post(`/api/conversion/jobs/ifcready_anything/retry`).send({});
    expect(res.status).toBe(403);
  });
  it("prioritize：loopback 在預設 allowlist → 非 403（落到 404 找不到 job）", async () => {
    const app = makeApp({ streamingConversionApiBase: "http://127.0.0.1:1" });
    const res = await request(app.app).post(`/api/conversion/jobs/ifcready_nope/prioritize`).send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });
  it("prioritize：空 allowlist → bypass 全部放行（與 IntranetDevAuthProvider length>0 守門一致）", async () => {
    // IMPORTANT 2：rejectIfIpNotAllowed 對「空 allowlist」必須與 authProvider.ts 的
    // `length > 0 && !isIpAllowed(...)` 語意一致 — 空清單代表「未啟用 IP 守門」→ bypass，
    // 而非 `![].some()` = true 造成全部 403。傳空 allowlist → 預期非 403（落到 404）。
    const app = makeApp({ streamingConversionApiBase: "http://127.0.0.1:1", externalIntakeIpAllowlist: [] });
    const res = await request(app.app).post(`/api/conversion/jobs/ifcready_nope/prioritize`).send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });
  it("retry：空 allowlist → bypass 全部放行（與 IntranetDevAuthProvider length>0 守門一致）", async () => {
    const app = makeApp({ streamingConversionApiBase: "http://127.0.0.1:1", externalIntakeIpAllowlist: [] });
    const res = await request(app.app).post(`/api/conversion/jobs/ifcready_nope/retry`).send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });
});

describe("conversion control routes — actor 標頭長度上限（IMPORTANT 1）", () => {
  // resolveActor 對 X-Operator / X-Actor 只 .trim() 無上限,與 parseReason 的 .slice(0,500)
  // 不對稱;超大 header 會讓每筆 audit record 膨脹。預期截斷到 200 字元寫入 audit。
  it("超長 X-Operator 標頭 → audit actor 截斷到 200 字元", async () => {
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-control-actor-cap-"));
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260616_130000_actor1", skipEnvSnapshot: true });
    const stub = await startControllableStreamingStub();
    const app = makeApp({ streamingConversionApiBase: stub.baseUrl }, logger);
    // A in-flight(hold)→ B/C queued,prioritize C 帶超長 X-Operator。
    await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_cap_A", "idem_cap_A")).send(payload());
    await waitFor(() => stub.bodies.length >= 1);
    await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_cap_B", "idem_cap_B")).send(payload({ external_model_version_id: "ext_cap_B" }));
    const c = await request(app.app).post("/api/external/ifc-ready").set(authHeaders("corr_cap_C", "idem_cap_C")).send(payload({ external_model_version_id: "ext_cap_C" }));
    const jobC = c.body.ifc_ready_job_id as string;
    await waitFor(async () => (await request(app.app).get(`/api/external/ifc-ready/${jobC}`)).body.status === "queued_for_conversion");

    const hugeActor = "x".repeat(8000);
    const res = await request(app.app).post(`/api/conversion/jobs/${jobC}/prioritize`).set("X-Operator", hugeActor).send({ reason: "cap test" });
    expect(res.status).toBe(200);

    const audits = readAuditRecords(logger);
    const prioritizeAudit = audits.find((rec) => (rec.data as Record<string, unknown>)?.action === "conversion.prioritize");
    expect(prioritizeAudit).toBeDefined();
    const actor = (prioritizeAudit!.data as Record<string, unknown>).actor as string;
    expect(actor.length).toBe(200);
    expect(actor).toBe("x".repeat(200));
    stub.releaseNext(); // teardown
  });
});
