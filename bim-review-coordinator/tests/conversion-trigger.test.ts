import request from "supertest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 假打 presign：trigger 端點呼叫 presignMinioObject 時回固定 URL，不連真 MinIO。
vi.mock("../src/services/minioClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/minioClient.js")>();
  return {
    ...actual,
    presignMinioObject: vi.fn().mockResolvedValue(
      "http://minio.test:9000/bim-control/proj/main/uuid/model.ifc?X-Amz-Signature=fake",
    ),
  };
});

import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (!active) return;
  // 三步 teardown，與既有整合測試一致（dispose 非 optional）。
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("server bind failed");
  return a.port;
}

// async：先建 app → listen(0) 取真實 port → 以 minioWatchSelfBaseUrl 注入該 port，
// 讓 trigger 端點 self-POST /api/external/ifc-ready 打到自己這支真 listener（否則 502）。
async function makeApp(): Promise<CoordinatorApp> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-trigger-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    externalIntakeWebhookSecret: "test-secret",
    externalIntakeIpAllowlist: [],
    minioWatchEnabled: false, // watcher runtime 關閉，避免自動 tick；selfBaseUrl seam 仍可被 trigger 端點讀用。
    minioWatchEndpoint: "http://minio.test:9000",
    minioWatchBucket: "bim-control",
    minioWatchAccessKey: "ak",
    minioWatchSecretKey: "sk",
    minioWatchPrefix: "",
    minioWatchKeySuffix: "/model.ifc",
    minioWatchTenantId: "tenant_demo_001",
  });
  const port = await listenOnRandomPort(active.server);
  // 注入真實 port 給 self-POST loopback（端點讀 config.minioWatchSelfBaseUrl）。
  active.config.minioWatchSelfBaseUrl = `http://127.0.0.1:${port}`;
  return active;
}

describe("POST /api/conversion/trigger", () => {
  it("malformed key（少於三段）→ 400", async () => {
    const app = await makeApp();
    const res = await request(app.app).post("/api/conversion/trigger").send({ key: "a/model.ifc" });
    expect(res.status).toBe(400);
  });

  it("缺 key → 400", async () => {
    const app = await makeApp();
    const res = await request(app.app).post("/api/conversion/trigger").send({});
    expect(res.status).toBe(400);
  });

  it("合法 key → 202 + ifc_ready_job_id，且 response 不含 presigned 簽章", async () => {
    const app = await makeApp();
    const res = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "proj/main/uuid/model.ifc" });
    expect([200, 202]).toContain(res.status);
    expect(res.body.ifc_ready_job_id).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });
});
