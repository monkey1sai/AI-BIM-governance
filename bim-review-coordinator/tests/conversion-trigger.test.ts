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

// endpoint/bucket 有設、但 access/secret 為空字串（env 未設時的預設）。模擬「連線參數不齊全」。
// 與 makeApp 唯一差異：credentials 留空 → minioWatchConfigured() 應為 false → trigger 須誠實 503。
async function makeAppNoCreds(): Promise<CoordinatorApp> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-trigger-nocreds-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    externalIntakeWebhookSecret: "test-secret",
    externalIntakeIpAllowlist: [],
    minioWatchEnabled: false,
    minioWatchEndpoint: "http://minio.test:9000",
    minioWatchBucket: "bim-control",
    minioWatchAccessKey: "", // 空字串：未設 credentials
    minioWatchSecretKey: "", // 空字串：未設 credentials
    minioWatchPrefix: "",
    minioWatchKeySuffix: "/model.ifc",
    minioWatchTenantId: "tenant_demo_001",
  });
  const port = await listenOnRandomPort(active.server);
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

  // 誠實守門：credentials 不齊全時（access/secret 空字串）即使 endpoint/bucket 有設，
  // 也不可放行 self-POST（presign 會以空憑證簽出 URL → 下游 MinIO 認證必失敗、job 靜默 failed）。
  // 必須在 presign 之前以 503 誠實回絕，而非 202。
  it("endpoint/bucket 有設但 credentials 缺 → 503（不放行 self-POST）", async () => {
    const app = await makeAppNoCreds();
    const res = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "proj/main/uuid/model.ifc" });
    expect(res.status).toBe(503);
    expect(res.body.ifc_ready_job_id).toBeUndefined();
  });

  // key 含 `|` → 400（不放行）。idempotencyKeyFor / correlationIdFor 文件化前置條件：
  // hash input 以 `|` 分隔 bucket|key|etag，key 含 `|` 會多切欄位，違反不變式、理論上可造成
  // 不同 (bucket, key, etag) 撞同一 hash。deriveIntakeFromKey 只擋空段/`.`/`..`，故端點須在
  // 計算冪等鍵前先擋 `|`。
  it("key 含 `|` → 400（違反 idempotency hash 不變式，不放行）", async () => {
    const app = await makeApp();
    const res = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "proj/ma|in/uuid/model.ifc" });
    expect(res.status).toBe(400);
    expect(res.body.ifc_ready_job_id).toBeUndefined();
  });

  // S3/MinIO object key 上限 1024 bytes：超長 key 在 presign / hash 前先擋（quality review important）。
  it("key 過長（>1024 bytes）→ 400（S3 key 上限守衛）", async () => {
    const app = await makeApp();
    const res = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "a".repeat(1025) });
    expect(res.status).toBe(400);
    expect(res.body.ifc_ready_job_id).toBeUndefined();
  });

  // 冪等：同 key 重觸發回既有 job（spec §5）。完整走 self-POST → /api/external/ifc-ready，
  // 同 key 派生同 idempotencyKey → findExisting 命中 → 回相同 ifc_ready_job_id。
  it("同 key 觸發兩次 → 回相同 ifc_ready_job_id（冪等）", async () => {
    const app = await makeApp();
    const first = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "proj/main/uuid/model.ifc" });
    expect([200, 202]).toContain(first.status);
    expect(first.body.ifc_ready_job_id).toBeTruthy();

    const second = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "proj/main/uuid/model.ifc" });
    expect([200, 202]).toContain(second.status);
    expect(second.body.ifc_ready_job_id).toBe(first.body.ifc_ready_job_id);
  });

  it("同 key force_retrigger → 建立新的 ifc_ready_job_id（終局 conversion failed 的 operator recovery）", async () => {
    const app = await makeApp();
    const first = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "proj/main/uuid/model.ifc" });
    expect([200, 202]).toContain(first.status);
    expect(first.body.ifc_ready_job_id).toBeTruthy();

    const retrigger = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "proj/main/uuid/model.ifc", force_retrigger: true });
    expect([200, 202]).toContain(retrigger.status);
    expect(retrigger.body.ifc_ready_job_id).toBeTruthy();
    expect(retrigger.body.ifc_ready_job_id).not.toBe(first.body.ifc_ready_job_id);
    expect(retrigger.body.force_retrigger).toBe(true);
    expect(retrigger.body.recovery_action).toBe("retrigger_submitted");
  });
});
