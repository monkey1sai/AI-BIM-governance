import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// introduce-host-native-conversion-authority-service / conversion-webhook-lifecycle
// (ADDED): coordinator 主動拉 host-native `GET /api/conversions/{id}/result`，
// 映射成既有 report 形狀 → 同一條 metadata-only callback outbox 路徑。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const IFC_CONTRACT = JSON.parse(
  fs.readFileSync(
    path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json"),
    "utf-8",
  ),
) as { example: Record<string, unknown> };

const INTERNAL_TOKEN = "dev-internal-token";
const CORRELATION = "corr_cbk_001";

let active: CoordinatorApp | null = null;
let stub: http.Server | null = null;

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  if (stub) {
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = null;
  }
});

function startStreamingStub(resultPayload: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    stub = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            conversion_job_id: "stream_conv_test_001",
            status: "queued",
            authority: "bim-streaming-server",
            correlation_id: CORRELATION,
          }),
        );
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/api/conversions/stream_conv_test_001/result"
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resultPayload));
        return;
      }
      res.writeHead(404).end("{}");
    });
    stub.listen(0, "127.0.0.1", () => {
      const port = (stub!.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function makeApp(streamingBase: string, overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-hnci-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    bimControlApiBase: "http://127.0.0.1:1",
    streamingConversionApiBase: streamingBase,
    callbackOutboxMaxAttempts: 2,
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

async function seedIfcReadyJob(app: CoordinatorApp): Promise<void> {
  await request(app.app)
    .post("/api/external/ifc-ready")
    .set({
      "X-Webhook-Secret": "dev-webhook-secret",
      "X-Correlation-Id": CORRELATION,
      "X-Idempotency-Key": "idem_cbk_001",
    })
    .send({ ...structuredClone(IFC_CONTRACT.example) });
}

const READY_RESULT = {
  conversion_job_id: "stream_conv_test_001",
  authority: "bim-streaming-server",
  status: "succeeded",
  ready: true,
  correlation_id: CORRELATION,
  model: { status: "ready", format: "usdc", url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/model.usdc" },
  artifacts: {
    model_usdc: { url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/model.usdc" },
    element_mapping: { url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/element_mapping.json" },
    entity_index: { url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/entity_index.json" },
    metadata: { url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/metadata.json" },
  },
  quality_metrics: { coverage_status: "pass" },
};

const FAILED_RESULT = {
  conversion_job_id: "stream_conv_test_001",
  authority: "bim-streaming-server",
  status: "failed",
  ready: false,
  correlation_id: CORRELATION,
  model: { status: "failed", format: "usdc", url: null },
  artifacts: {},
  error: { code: "converter_unavailable", message: "converter prerequisites missing" },
};

describe("host-native conversion result ingest (pull)", () => {
  it("ready result enqueues a metadata-only conversion_result_ready callback", async () => {
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.conversion_status).toBe("ready");
    expect(res.body.callback.event).toBe("conversion_result_ready");
    const payloadText = JSON.stringify(res.body.callback.payload);
    // metadata refs only — no large file bodies.
    expect(res.body.callback.payload.artifacts.usdc_ref).toContain("model.usdc");
    expect(payloadText).not.toContain("PXR-USDC");
    expect(res.body.ifc_ready_job.conversion_status).toBe("ready");
  });

  it("failed result enqueues conversion_failed with reason", async () => {
    const base = await startStreamingStub(FAILED_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.conversion_status).toBe("failed");
    expect(res.body.callback.event).toBe("conversion_failed");
    expect(res.body.callback.payload.reason).toContain("converter prerequisites missing");
  });

  it("rejects internal route without internal token", async () => {
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .send({});

    expect(res.status).toBe(401);
  });
});
