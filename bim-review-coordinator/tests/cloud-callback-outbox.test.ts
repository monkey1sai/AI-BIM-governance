import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { CallbackOutbox } from "../src/services/callbackOutbox.js";

// B-scheme（local-coordinator-ifc-ready-intake-boundary T5 §6.3）契約測試。
// 契約權威 = tests/contracts/conversion_result_callback.json（凍結，OQ1 pending
// 緩解：real cloud endpoint 標 pending，outbox 對不可達保留重試→dead_letter）。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const IFC_CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json"), "utf-8"),
) as { example: Record<string, unknown> };
const CB_CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "conversion_result_callback.json"), "utf-8"),
) as { events: { conversion_result_ready: { required_fields: string[] } } };

const WEBHOOK_SECRET = "dev-webhook-secret";
const INTERNAL_TOKEN = "dev-internal-token";

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-cbk-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    // 真實公司雲端 endpoint 待 OQ1：以契約 callback_url（不可達 .example）驅動
    // outbox 不可達→重試→dead_letter；retry 2 次快速耗盡。
    callbackOutboxMaxAttempts: 2,
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

function authHeaders(o: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": "corr_cbk_001",
    "X-Idempotency-Key": "idem_cbk_001",
    ...o,
  };
}

function internalHeaders(): Record<string, string> {
  return { "X-Internal-Token": INTERNAL_TOKEN };
}

async function seedIfcReadyJob(app: CoordinatorApp): Promise<string> {
  const res = await request(app.app)
    .post("/api/external/ifc-ready")
    .set(authHeaders())
    .send({ ...structuredClone(IFC_CONTRACT.example) });
  expect(res.status).toBe(202);
  return "corr_cbk_001";
}

describe("T5 cloud callback outbox（metadata-only / retry / dead-letter）", () => {
  it("ready 結果→組 conversion_result_ready（僅 metadata refs）入 outbox，conversion 與 callback 狀態分離", async () => {
    const app = makeApp();
    const correlationId = await seedIfcReadyJob(app);

    const res = await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: correlationId,
      conversion_job_id: "cj_cbk_001",
      status: "ready",
      artifacts: {
        usdc_ref: "edge-local://t/mv/cj/model.usdc",
        element_mapping_ref: "edge-local://t/mv/cj/element_mapping.json",
        manifest_ref: "edge-local://t/mv/cj/artifact_manifest.json",
      },
      artifact_summary: { usdc_openable: true, coverage_status: "pass" },
    });

    expect(res.status).toBe(202);
    // conversion 在本地 ready；callback 投遞狀態獨立（尚未送達）
    expect(res.body.ifc_ready_job.conversion_status).toBe("ready");
    expect(res.body.callback.status).toBe("pending");
    expect(res.body.callback.event).toBe("conversion_result_ready");
    // payload 僅含 metadata refs，無 .usdc 本體
    for (const f of CB_CONTRACT.events.conversion_result_ready.required_fields) {
      expect(res.body.callback.payload).toHaveProperty(f);
    }
    expect(JSON.stringify(res.body.callback.payload)).not.toMatch(/PXR-USDC|usdc_body|content_base64/);
    expect(res.body.callback.payload.artifacts.usdc_ref).toBe("edge-local://t/mv/cj/model.usdc");
  });

  it("誠實鐵律:conversion_result_ready callback payload 的 source_ifc.ref 遮蔽 presigned 簽章(P0 全出口)", async () => {
    const app = makeApp();
    // seed 一個 source_ifc.ref 帶 X-Amz 簽章的 job(覆寫 fixture,確定性驗遮蔽生效)
    const signedRef = "https://minio.example.com/bim-control/proj/cat/v1/model.ifc?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeefcafe&X-Amz-Credential=AKIA%2F20260701&X-Amz-Expires=3600";
    const example = structuredClone(IFC_CONTRACT.example) as Record<string, unknown>;
    const seeded = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Correlation-Id": "corr_mask_001", "X-Idempotency-Key": "idem_mask_001" }))
      .send({ ...example, source_ifc: { ...(example.source_ifc as Record<string, unknown>), ref: signedRef } });
    expect(seeded.status).toBe(202);
    const res = await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: "corr_mask_001",
      conversion_job_id: "cj_mask_001",
      status: "ready",
      artifacts: { usdc_ref: "edge-local://t/mv/cj/model.usdc" },
      artifact_summary: { usdc_openable: true },
    });
    expect(res.status).toBe(202);
    const payload = res.body.callback.payload;
    // source_ifc.ref 仍在(metadata 標示來源),但簽章已剝除
    expect(payload.source_ifc.ref).not.toMatch(/X-Amz-Signature|X-Amz-Credential|X-Amz-Expires/i);
    expect(payload.source_ifc.ref).toBe("https://minio.example.com/bim-control/proj/cat/v1/model.ifc");
    // 整包 payload 不含任何簽章殘留
    expect(JSON.stringify(payload)).not.toMatch(/X-Amz-Signature|X-Amz-Credential/i);
  });

  it("cloud 不可達 → outbox 保留重試，retry 耗盡 → dead_letter（不靜默丟棄）", async () => {
    const app = makeApp();
    const correlationId = await seedIfcReadyJob(app);
    const enqueue = await request(app.app)
      .post("/api/internal/conversion-result")
      .set(internalHeaders())
      .send({ correlation_id: correlationId, status: "ready", artifacts: {} });
    const outboxId = enqueue.body.callback.outbox_id;

    // 第 1 次投遞：不可達 → 仍 pending、attempts=1
    await request(app.app).post("/api/internal/callback-outbox/deliver").set(internalHeaders()).send({});
    let entry = (await request(app.app).get(`/api/internal/callback-outbox/${outboxId}`).set(internalHeaders())).body;
    expect(entry.status).toBe("pending");
    expect(entry.attempts).toBe(1);

    // 第 2 次投遞：retry 耗盡（max=2）→ dead_letter，evidence 記錄、不丟棄
    await request(app.app).post("/api/internal/callback-outbox/deliver").set(internalHeaders()).send({});
    entry = (await request(app.app).get(`/api/internal/callback-outbox/${outboxId}`).set(internalHeaders())).body;
    expect(entry.status).toBe("dead_letter");
    expect(entry.attempts).toBe(2);
    expect(entry.evidence.some((e: { outcome: string }) => e.outcome === "dead_letter")).toBe(true);
    expect(entry.last_error).toBeTruthy();
  });

  it("conversion 失敗 → conversion_failed callback（status/reason/retryable）", async () => {
    const app = makeApp();
    const correlationId = await seedIfcReadyJob(app);
    const res = await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: correlationId,
      status: "failed",
      reason: "converter_failed: USDC could not be opened",
      retryable: false,
    });
    expect(res.status).toBe(202);
    expect(res.body.callback.event).toBe("conversion_failed");
    expect(res.body.callback.payload.status).toBe("failed");
    expect(res.body.callback.payload.reason).toMatch(/converter_failed/);
    expect(res.body.callback.payload.retryable).toBe(false);
    expect(res.body.ifc_ready_job.conversion_status).toBe("failed");
  });

  it("metadata-only 鐵律：callback payload 內嵌模型本體 → 422 拒絕", async () => {
    const app = makeApp();
    const correlationId = await seedIfcReadyJob(app);
    const res = await request(app.app)
      .post("/api/internal/conversion-result")
      .set(internalHeaders())
      .send({
        correlation_id: correlationId,
        status: "ready",
        artifacts: {},
        artifact_summary: { content_base64: "PXR-USDC" + "A".repeat(5000) },
      });
    expect(res.status).toBe(422);
  });

  it("未知 correlation_id → 404", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/internal/conversion-result")
      .set(internalHeaders())
      .send({ correlation_id: "nope", status: "ready" });
    expect(res.status).toBe(404);
  });

  it("internal conversion-result 需要 service token", async () => {
    const app = makeApp();
    const correlationId = await seedIfcReadyJob(app);
    const res = await request(app.app)
      .post("/api/internal/conversion-result")
      .send({ correlation_id: correlationId, status: "ready", artifacts: {} });
    expect(res.status).toBe(401);
  });

  it("接受 streaming /result 的 succeeded 並正規化為 ready", async () => {
    const app = makeApp();
    const correlationId = await seedIfcReadyJob(app);
    const res = await request(app.app)
      .post("/api/internal/conversion-result")
      .set(internalHeaders())
      .send({ correlation_id: correlationId, status: "succeeded", artifacts: {} });

    expect(res.status).toBe(202);
    expect(res.body.ifc_ready_job.conversion_status).toBe("ready");
    expect(res.body.callback.payload.status).toBe("ready");
  });

  it("outbox entries survive service re-instantiation through the JSON store", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-cbk-persist-test-"));
    const storePath = path.join(root, "callback-outbox.json");
    const first = new CallbackOutbox(2, async () => undefined, storePath);
    const entry = first.enqueue({
      event: "conversion_result_ready",
      targetUrl: null,
      correlationId: "corr_persist_001",
      externalModelVersionId: "ext_mv_persist_001",
      conversionJobId: "cj_persist_001",
      payload: { event: "conversion_result_ready", status: "ready", artifacts: { usdc_ref: "edge-local://model.usdc" } },
    });

    const reloaded = new CallbackOutbox(2, async () => undefined, storePath);
    expect(reloaded.get(entry.outbox_id)?.status).toBe("pending");
    expect(reloaded.get(entry.outbox_id)?.payload).toEqual(entry.payload);
  });
});
