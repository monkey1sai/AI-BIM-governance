import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// B-scheme（local-coordinator-ifc-ready-intake-boundary T6 §7.3）。
// 本地僅最小 shadow 欄位集，不 mirror 公司 MySQL；control-plane 權威不在本地
// 重新宣告；data-plane 可用性本地可答；external_model_version_id 僅參照。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const IFC_CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json"), "utf-8"),
) as { example: Record<string, unknown> };

const EXPECTED_SHADOW_KEYS = [
  "tenant_id",
  "project_id",
  "external_model_version_id",
  "external_conversion_task_id",
  "correlation_id",
  "source_ifc_ref",
  "source_ifc_etag",
  "conversion_job_id",
  "artifact_manifest_ref",
  "callback_url",
  "callback_status",
  "last_callback_attempt_at",
].sort();

// control-plane 權威欄位——絕不可出現在本地 shadow（會變成 mirror 公司 MySQL）
const FORBIDDEN_CONTROL_PLANE_KEYS = [
  "user_id",
  "users",
  "role",
  "roles",
  "rbac",
  "permission",
  "permissions",
  "license",
  "version_history",
  "commit_history",
  "project_name",
  "tenant_name",
];

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-shadow-test-"));
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

function authHeaders(): Record<string, string> {
  return {
    "X-Webhook-Secret": "dev-webhook-secret",
    "X-Correlation-Id": "corr_shadow_001",
    "X-Idempotency-Key": "idem_shadow_001",
  };
}

function internalHeaders(): Record<string, string> {
  return { "X-Internal-Token": "dev-internal-token" };
}

async function seedJob(app: CoordinatorApp): Promise<string> {
  const created = await request(app.app)
    .post("/api/external/ifc-ready")
    .set(authHeaders())
    .send({ ...structuredClone(IFC_CONTRACT.example) });
  expect(created.status).toBe(202);
  return created.body.ifc_ready_job_id as string;
}

describe("T6 local artifact shadow metadata", () => {
  it("shadow 僅含最小欄位集（不 mirror 公司 MySQL；無 control-plane 權威欄位）", async () => {
    const app = makeApp();
    const jobId = await seedJob(app);
    await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: "corr_shadow_001",
      conversion_job_id: "cj_shadow_001",
      status: "ready",
      artifacts: { manifest_ref: "edge-local://t/mv/cj/artifact_manifest.json" },
    });

    const res = await request(app.app).get(`/api/external/ifc-ready/${jobId}/shadow`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.shadow_metadata).sort()).toEqual(EXPECTED_SHADOW_KEYS);

    const blob = JSON.stringify(res.body.shadow_metadata).toLowerCase();
    for (const forbidden of FORBIDDEN_CONTROL_PLANE_KEYS) {
      expect(blob).not.toContain(`"${forbidden}"`);
    }
    expect(res.body.shadow_metadata.external_model_version_id).toBe(
      IFC_CONTRACT.example.external_model_version_id,
    );
    expect(res.body.shadow_metadata.artifact_manifest_ref).toBe(
      "edge-local://t/mv/cj/artifact_manifest.json",
    );
  });

  it("control-plane 權威不在本地重新宣告（僅以 external_model_version_id 參照）", async () => {
    const app = makeApp();
    const jobId = await seedJob(app);
    const res = await request(app.app).get(`/api/external/ifc-ready/${jobId}/shadow`);
    expect(res.body.control_plane_authority.owner).toBe("company-cloud-bim-control");
    expect(res.body.control_plane_authority.not_mirrored).toBe(true);
    expect(res.body.control_plane_authority.referenced_by).toBe("external_model_version_id");
  });

  it("data-plane 可用性本地可答（不需公司雲端）", async () => {
    const app = makeApp();
    const jobId = await seedJob(app);
    const res = await request(app.app).get(`/api/external/ifc-ready/${jobId}/shadow`);
    expect(res.body.data_plane_availability).toHaveProperty("local_conversion_status");
    expect(res.body.data_plane_availability.source_ifc_available).toBe(true);
    // 尚未回報轉檔結果 → manifest 尚不可用、callback 尚未入列
    expect(res.body.data_plane_availability.artifact_manifest_available).toBe(false);
    expect(res.body.shadow_metadata.callback_status).toBe("not_enqueued");
  });

  it("callback_status / last_callback_attempt_at 來自 outbox，與 conversion 分離", async () => {
    const app = makeApp();
    const jobId = await seedJob(app);
    await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: "corr_shadow_001",
      status: "ready",
      artifacts: { manifest_ref: "edge-local://m.json" },
    });
    const res = await request(app.app).get(`/api/external/ifc-ready/${jobId}/shadow`);
    expect(res.body.shadow_metadata.callback_status).toBe("pending");
    expect(res.body.data_plane_availability.local_conversion_status).toBe("ready");
  });

  it("未知 jobId → 404", async () => {
    const app = makeApp();
    const res = await request(app.app).get("/api/external/ifc-ready/nope/shadow");
    expect(res.status).toBe(404);
  });
});
