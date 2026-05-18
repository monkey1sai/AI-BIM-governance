import fs from "node:fs";
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
};

const WEBHOOK_SECRET = "dev-webhook-secret"; // = config 預設（環境設定，非契約資料）

let active: CoordinatorApp | null = null;

afterEach(async () => {
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
    bimControlApiBase: "http://127.0.0.1:1",
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
    // streaming 不可達 → 接受但派工失敗（intake 本身未被否定）
    expect(res.body.status).toBe("dispatch_failed");
    expect(res.body.conversion_authority).toBeNull();
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
});
