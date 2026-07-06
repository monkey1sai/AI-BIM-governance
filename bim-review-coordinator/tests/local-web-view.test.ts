import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// B-scheme（local-coordinator-ifc-ready-intake-boundary T7 §8.1-8.3）。
// 使用者 auth 用可替換 provider；不做死 EZPLUS SSO，sso_binding=pending_oq5（OQ5）。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const IFC_CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json"), "utf-8"),
) as { example: Record<string, unknown> };

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-lwv-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

function svcAuth(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Webhook-Secret": "dev-webhook-secret",
    "X-Correlation-Id": "corr_lwv_001",
    "X-Idempotency-Key": "idem_lwv_001",
    ...overrides,
  };
}

function internalHeaders(): Record<string, string> {
  return { "X-Internal-Token": "dev-internal-token" };
}

async function seedJob(
  app: CoordinatorApp,
  headers: Record<string, string> = svcAuth(),
): Promise<{ jobId: string; emv: string }> {
  const res = await request(app.app)
    .post("/api/external/ifc-ready")
    .set(headers)
    .send({ ...structuredClone(IFC_CONTRACT.example) });
  expect(res.status).toBe(202);
  return { jobId: res.body.ifc_ready_job_id, emv: res.body.external_model_version_id };
}

describe("T7 local web view session / artifact resolution", () => {
  it("缺使用者 token → 401（不做死 SSO，可替換 provider）", async () => {
    const app = makeApp();
    const { jobId } = await seedJob(app);
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .send({ ifc_ready_job_id: jobId });
    expect(res.status).toBe(401);
  });

  it("帶 user token + ifc_ready_job_id → 201，sso_binding=pending_oq5、含 artifact_resolution", async () => {
    const app = makeApp();
    const { jobId, emv } = await seedJob(app);
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ Authorization: "Bearer dev_user_001" })
      .send({ ifc_ready_job_id: jobId });

    expect(res.status).toBe(201);
    expect(res.body.web_view_session_id).toMatch(/^lwv_/);
    expect(res.body.user_id).toBe("dev_user_001");
    expect(res.body.auth_provider).toBe("local-dev");
    expect(res.body.sso_binding).toBe("pending_oq5");
    expect(res.body.external_model_version_id).toBe(emv);
    expect(res.body.artifact_resolution.source_ifc_ref).toBe(
      (IFC_CONTRACT.example.source_ifc as { ref: string }).ref,
    );
    expect(res.body.artifact_resolution.conversion_artifact_ready).toBe(false);
    expect(res.body.artifact_resolution.viewer_open_state).toBe("not_observed");
    expect(res.body.artifact_resolution.viewer_open_ready).toBe(false);
  });

  it("以 external_model_version_id 解析；轉檔 ready 後只標 conversion_artifact_ready，不標 viewer_open_ready", async () => {
    const app = makeApp();
    const { emv } = await seedJob(app);
    await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: "corr_lwv_001",
      conversion_job_id: "cj_lwv_001",
      status: "ready",
      artifacts: { manifest_ref: "edge-local://m.json" },
    });
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ "X-User-Token": "dev_user_002" })
      .send({ external_model_version_id: emv });

    expect(res.status).toBe(201);
    expect(res.body.user_id).toBe("dev_user_002");
    expect(res.body.artifact_resolution.conversion_status).toBe("ready");
    expect(res.body.artifact_resolution.conversion_artifact_ready).toBe(true);
    expect(res.body.artifact_resolution.viewer_open_state).toBe("not_observed");
    expect(res.body.artifact_resolution.viewer_open_ready).toBe(false);
    expect(res.body.artifact_resolution.artifact_manifest_ref).toBe("edge-local://m.json");
  });

  it("以 external_model_version_id 解析時選最新 job", async () => {
    const app = makeApp();
    const first = await seedJob(app, svcAuth({ "X-Correlation-Id": "corr_lwv_old", "X-Idempotency-Key": "idem_lwv_old" }));
    const second = await seedJob(app, svcAuth({ "X-Correlation-Id": "corr_lwv_new", "X-Idempotency-Key": "idem_lwv_new" }));
    expect(first.emv).toBe(second.emv);
    await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: "corr_lwv_new",
      conversion_job_id: "cj_lwv_new",
      status: "ready",
      artifacts: { manifest_ref: "edge-local://new.json" },
    });

    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ "X-User-Token": "dev_user_latest" })
      .send({ external_model_version_id: second.emv });

    expect(res.status).toBe(201);
    expect(res.body.ifc_ready_job_id).toBe(second.jobId);
    expect(res.body.artifact_resolution.artifact_manifest_ref).toBe("edge-local://new.json");
  });

  it("缺 ifc_ready_job_id 與 external_model_version_id → 400", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ Authorization: "Bearer u" })
      .send({});
    expect(res.status).toBe(400);
  });

  it("無對應 job → 404", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ Authorization: "Bearer u" })
      .send({ ifc_ready_job_id: "ifcready_nope" });
    expect(res.status).toBe(404);
  });
});
